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
import { GET as recentDocuments } from "@/app/api/workspaces/[workspaceId]/recent-documents/route";
import { POST as createDocument } from "@/app/api/workspaces/[workspaceId]/documents/route";

/**
 * `GET /api/workspaces/:id/recent-documents?ids=…` (B.0): what the palette lists before anything is typed.
 * The IDs are the reader's own browser's say-so and grant nothing, so each is checked: what comes back is
 * the ones this caller may read *here*, by what they are called now, in the order asked, and never anything
 * of what they say. Someone outside the workspace learns nothing, not even that it exists.
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

async function recentOf(caller: CallerContext, workspaceId: string, ids: readonly string[] | string) {
  as(caller);
  const query = typeof ids === "string" ? ids : ids.join(",");
  const response = await recentDocuments(new Request(`http://hub.test/api/workspaces/x/recent-documents?ids=${encodeURIComponent(query)}`), inWorkspace(workspaceId));
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

describe("GET /api/workspaces/:id/recent-documents", () => {
  it("answers with each document's title and source, in the order asked, and is never cached", async () => {
    const w = await world();
    const first = await makeDocument(w, "First");
    const second = await makeDocument(w, "Second");
    const [[source]] = [await pool.query("SELECT name FROM knowledge_sources WHERE id = ?", [w.notes])] as { name: string }[][];

    const { response, body } = await recentOf(w.owner, w.workspaceId, [second.documentId, first.documentId]);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      hits: [
        { documentId: second.documentId, sourceId: w.notes, title: "Second", sourceName: source.name },
        { documentId: first.documentId, sourceId: w.notes, title: "First", sourceName: source.name },
      ],
    });
  });

  it("says nothing of what the documents hold", async () => {
    const w = await world();
    const only = await makeDocument(w, "Plain", "the-secret-body-text-77c1");
    const { text } = await recentOf(w.owner, w.workspaceId, [only.documentId]);
    expect(text).not.toContain("the-secret-body-text-77c1");
  });

  it("says what a document is called now, not what it was when it was opened", async () => {
    const w = await world();
    const document = await makeDocument(w, "Before rename");
    await pool.query("UPDATE knowledge_revisions SET title = ? WHERE document_id = ?", ["After rename", document.documentId]);
    const { body } = await recentOf(w.owner, w.workspaceId, [document.documentId]);
    expect(body.hits.map((hit: { title: string }) => hit.title)).toEqual(["After rename"]);
  });

  it("leaves out a document that has been archived, one that never existed, and an entry that is no ID at all", async () => {
    const w = await world();
    const keep = await makeDocument(w, "Keep");
    const gone = await makeDocument(w, "Gone");
    as(w.owner);
    expect((await archiveDocument(post(), ofDocument(gone.documentId))).status).toBe(200);
    const { response, body } = await recentOf(w.owner, w.workspaceId, [gone.documentId, uuidv7(), "not-an-id", keep.documentId].join(","));
    expect(response.status).toBe(200);
    expect(body.hits.map((hit: { documentId: string }) => hit.documentId)).toEqual([keep.documentId]);
  });

  it("does not list a document of another workspace, even one the caller can read there", async () => {
    const mine = await world();
    const theirs = await world();
    const mineDocument = await makeDocument(mine, "Mine");
    const theirDocument = await makeDocument(theirs, "Theirs");
    // The owner of `mine` is a member of `theirs` too: it is readable, but not in the workspace asked about.
    await unitOfWork.run(async (repositories) => {
      await repositories.workspaceMemberships.insert(
        createDirectMembership({ workspaceId: theirs.workspaceId, userId: mine.owner.identity.id, role: "VIEWER", createdBy: theirs.owner.identity.id, now: new Date() }),
      );
    });
    const inMine = await recentOf(mine.owner, mine.workspaceId, [theirDocument.documentId, mineDocument.documentId]);
    expect(inMine.body.hits.map((hit: { title: string }) => hit.title)).toEqual(["Mine"]);
    const inTheirs = await recentOf(mine.owner, theirs.workspaceId, [theirDocument.documentId, mineDocument.documentId]);
    expect(inTheirs.body.hits.map((hit: { title: string }) => hit.title)).toEqual(["Theirs"]);
  });

  it("gives a member who can only read the list too, since they can read those documents", async () => {
    const w = await world();
    const readable = await makeDocument(w, "Readable");
    const { response, body } = await recentOf(w.viewer, w.workspaceId, [readable.documentId]);
    expect(response.status).toBe(200);
    expect(body.hits).toHaveLength(1);
  });

  it("tells someone outside the workspace nothing: the same 404 as for a workspace that does not exist", async () => {
    const w = await world();
    const secret = await makeDocument(w, "Confidential title");
    const outsider = await recentOf(w.outsider, w.workspaceId, [secret.documentId]);
    const missing = await recentOf(w.outsider, uuidv7(), [secret.documentId]);
    expect(outsider.response.status).toBe(404);
    expect(outsider.response.headers.get("cache-control")).toBe("private, no-store");
    expect(outsider.body).toEqual(missing.body);
    expect(JSON.stringify(outsider.body)).not.toContain("Confidential title");
  });

  it("answers 400 for a workspace that is not an ID", async () => {
    const w = await world();
    const { response, body } = await recentOf(w.owner, "not-an-id", []);
    expect({ status: response.status, code: body.error?.code }).toEqual({ status: 400, code: "INVALID_REQUEST" });
  });

  it("asks about the first few only", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) ids.push((await makeDocument(w, `Doc ${index}`)).documentId);
    const { body } = await recentOf(w.owner, w.workspaceId, ids);
    expect(body.hits.map((hit: { title: string }) => hit.title)).toEqual(Array.from({ length: 8 }, (_, index) => `Doc ${index}`));
  });

  it("is an empty list for no IDs, not an error", async () => {
    const w = await world();
    const none = await recentOf(w.owner, w.workspaceId, "");
    expect(none.response.status).toBe(200);
    expect(none.body).toEqual({ hits: [] });
  });
});
