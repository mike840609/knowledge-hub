import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeLinkServiceImpl } from "@/modules/knowledge/application/knowledge-link-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

const injected = vi.hoisted(() => ({ caller: null as unknown, services: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...(injected.services as object), establishTrustedCaller: async () => ({ caller: injected.caller }) }),
}));

import { POST as archiveDocument } from "@/app/api/documents/[documentId]/archive/route";
import { GET as linkTargets } from "@/app/api/workspaces/[workspaceId]/link-targets/route";
import { POST as createDocument } from "@/app/api/workspaces/[workspaceId]/documents/route";

/**
 * `GET /api/workspaces/:id/link-targets` (daily-driver spec §6.1): the list the editor offers for
 * `[[`. Called as a handler over real services and a real database. What it must hold: the shape
 * the editor reads, that it is never cached, that it is a list of *titles* and nothing of what the
 * documents say, that a document archived a moment ago is gone from it, and that someone who is
 * not in the workspace learns nothing — not even that the workspace exists.
 */

let pool: Pool;
let unitOfWork: MariaDbUnitOfWork;
let services: Record<string, unknown>;

beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  unitOfWork = new MariaDbUnitOfWork(pool);
  services = {
    unitOfWork,
    hub: new HubKnowledgeCommandServiceImpl(unitOfWork),
    queries: new KnowledgeQueryServiceImpl(unitOfWork),
    links: new KnowledgeLinkServiceImpl(unitOfWork),
  };
  injected.services = services;
});
afterAll(async () => { await pool.end(); });

function as(caller: CallerContext) { injected.caller = caller; }
const inWorkspace = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });
const ofDocument = (documentId: string) => ({ params: Promise.resolve({ documentId }) });
const post = (body?: unknown) =>
  new Request("http://hub.test/api", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = () => new Request("http://hub.test/api/workspaces/x/link-targets");

function identity(label: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `ORG-${label}-${id}`, name: `Targets ${label}`, org_code: "ORG" };
}

type World = { workspaceId: string; owner: CallerContext; viewer: CallerContext; outsider: CallerContext; notes: string };

async function world(): Promise<World> {
  const [owner, viewer, outsider] = [identity("owner"), identity("viewer"), identity("outsider")];
  const workspaceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const person of [owner, viewer, outsider]) await repositories.users.upsertIdentity(person);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `Targets ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: viewer.id, role: "VIEWER", createdBy: owner.id, now }));
  });
  const ownerCaller = callerFromIdentity(owner);
  const notes = await ensureDefaultHubSource(unitOfWork, ownerCaller, workspaceId);
  return { workspaceId, owner: ownerCaller, viewer: callerFromIdentity(viewer), outsider: callerFromIdentity(outsider), notes };
}

async function makeDocument(w: World, title: string, markdown = "body") {
  as(w.owner);
  const response = await createDocument(post({ title, markdown }), inWorkspace(w.workspaceId));
  expect(response.status).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

async function targetsOf(caller: CallerContext, workspaceId: string) {
  as(caller);
  const response = await linkTargets(get(), inWorkspace(workspaceId));
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

describe("GET /api/workspaces/:id/link-targets", () => {
  it("lists the workspace's documents, newest edit first, in the shape the editor reads", async () => {
    const w = await world();
    const older = await makeDocument(w, "Older note");
    const newer = await makeDocument(w, "Newer note");
    // Same-millisecond timestamps would leave the order to the tie-break; put the two apart.
    await pool.query("UPDATE knowledge_revisions SET created_at = ? WHERE document_id = ?", [new Date("2026-01-01T00:00:00Z"), older.documentId]);
    await pool.query("UPDATE knowledge_revisions SET created_at = ? WHERE document_id = ?", [new Date("2026-02-01T00:00:00Z"), newer.documentId]);
    const [[source]] = [await pool.query("SELECT name FROM knowledge_sources WHERE id = ?", [w.notes])] as { name: string }[][];

    const { response, body } = await targetsOf(w.owner, w.workspaceId);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      workspaceId: w.workspaceId,
      truncated: false,
      targets: [
        { documentId: newer.documentId, sourceId: w.notes, sourceName: source.name, title: "Newer note", editedAt: "2026-02-01T00:00:00.000Z" },
        { documentId: older.documentId, sourceId: w.notes, sourceName: source.name, title: "Older note", editedAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
  });

  it("is a list of titles: nothing of what the documents say leaves with it", async () => {
    const w = await world();
    await makeDocument(w, "Plain title", "the-secret-body-text-3f9a");
    const { text, body } = await targetsOf(w.owner, w.workspaceId);
    expect(text).not.toContain("the-secret-body-text-3f9a");
    const [target] = body.targets as Record<string, unknown>[];
    expect(Object.keys(target).sort()).toEqual(["documentId", "editedAt", "sourceId", "sourceName", "title"]);
  });

  it("gives a member who can only read the same list, since it is what they could read anyway", async () => {
    const w = await world();
    const only = await makeDocument(w, "Readable");
    const { response, body } = await targetsOf(w.viewer, w.workspaceId);
    expect(response.status).toBe(200);
    expect(body.targets.map((target: { documentId: string }) => target.documentId)).toEqual([only.documentId]);
  });

  it("stops offering a document the moment it is archived", async () => {
    const w = await world();
    const keep = await makeDocument(w, "Keep");
    const gone = await makeDocument(w, "Gone");
    as(w.owner);
    expect((await archiveDocument(post(), ofDocument(gone.documentId))).status).toBe(200);
    const { body } = await targetsOf(w.owner, w.workspaceId);
    expect(body.targets.map((target: { documentId: string }) => target.documentId)).toEqual([keep.documentId]);
  });

  it("never lists another workspace's documents, even to someone who is in both", async () => {
    const mine = await world();
    const theirs = await world();
    await makeDocument(mine, "Mine");
    await makeDocument(theirs, "Theirs only");
    // The owner of `mine` joins `theirs` as well: the list is still per workspace.
    await unitOfWork.run(async (repositories) => {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: theirs.workspaceId, userId: mine.owner.identity.id, role: "VIEWER", createdBy: theirs.owner.identity.id, now: new Date() }),
      );
    });
    const inMine = await targetsOf(mine.owner, mine.workspaceId);
    const inTheirs = await targetsOf(mine.owner, theirs.workspaceId);
    expect(inMine.body.targets.map((target: { title: string }) => target.title)).toEqual(["Mine"]);
    expect(inTheirs.body.targets.map((target: { title: string }) => target.title)).toEqual(["Theirs only"]);
  });

  it("tells someone outside the workspace nothing: the same 404 as for a workspace that does not exist", async () => {
    const w = await world();
    await makeDocument(w, "Confidential title");
    const outsider = await targetsOf(w.outsider, w.workspaceId);
    const missing = await targetsOf(w.outsider, uuidv7());
    expect(outsider.response.status).toBe(404);
    expect(outsider.response.headers.get("cache-control")).toBe("private, no-store");
    expect(outsider.body).toEqual(missing.body);
    expect(JSON.stringify(outsider.body)).not.toContain("Confidential title");
  });

  it("answers 400 for a workspace that is not an ID, without asking the database", async () => {
    const w = await world();
    const { response, body } = await targetsOf(w.owner, "not-an-id");
    expect({ status: response.status, code: body.error?.code }).toEqual({ status: 400, code: "INVALID_REQUEST" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("says when the list is cut, and keeps the most recently edited", async () => {
    const w = await world();
    const [first, second, third] = [await makeDocument(w, "One"), await makeDocument(w, "Two"), await makeDocument(w, "Three")];
    for (const [index, document] of [first, second, third].entries()) {
      await pool.query("UPDATE knowledge_revisions SET created_at = ? WHERE document_id = ?", [new Date(Date.UTC(2026, 0, index + 1)), document.documentId]);
    }
    injected.services = { ...services, links: new KnowledgeLinkServiceImpl(unitOfWork, { linkTargetLimit: 2 }) };
    try {
      const { body } = await targetsOf(w.owner, w.workspaceId);
      expect(body.truncated).toBe(true);
      expect(body.targets.map((target: { title: string }) => target.title)).toEqual(["Three", "Two"]);
    } finally {
      injected.services = services;
    }
  });
});
