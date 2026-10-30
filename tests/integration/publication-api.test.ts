import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { drainPublicationEvents } from "@/modules/sources/application/publication-drain";
import { PublicationService } from "@/modules/sources/application/publication-service";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

const injected = vi.hoisted(() => ({ caller: null as unknown, services: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    ...(injected.services as object),
    establishTrustedCaller: async () => ({ caller: injected.caller }),
  }),
}));

import { POST as publish } from "@/app/api/publications/route";
import { GET as publicationOptions } from "@/app/api/publications/options/route";
import { POST as preview } from "@/app/api/publications/preview/route";
import { POST as join } from "@/app/api/publications/[publicationId]/join/route";
import { POST as leave } from "@/app/api/publications/[publicationId]/leave/route";
import { POST as resume } from "@/app/api/publications/[publicationId]/resume/route";
import { POST as unpublish } from "@/app/api/publications/[publicationId]/unpublish/route";
import { POST as restore } from "@/app/api/publications/[publicationId]/restore/route";
import { POST as rename } from "@/app/api/publications/[publicationId]/rename/route";
import { GET as status } from "@/app/api/publications/[publicationId]/status/route";
import { GET as list } from "@/app/api/workspaces/[workspaceId]/publications/route";

let fixture: PublicationFixture;
let service: PublicationService;
let sequence = 0;
const previousFlag = process.env.KM_TEAM_WORKSPACES_ENABLED;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

beforeAll(async () => {
  process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
  fixture = await createPublicationFixture();
  service = new PublicationService(fixture.uow);
  injected.services = { publications: service };
});
afterAll(async () => {
  if (previousFlag === undefined) delete process.env.KM_TEAM_WORKSPACES_ENABLED;
  else process.env.KM_TEAM_WORKSPACES_ENABLED = previousFlag;
  await fixture.dispose();
});
afterEach(() => {
  process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
  injected.caller = null;
});

function as(caller: CallerContext): void {
  injected.caller = caller;
}
function request(body?: unknown, method = "POST"): Request {
  return new Request("http://hub.test/api", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
}
const ofPublication = (publicationId: string) => ({ params: Promise.resolve({ publicationId }) });
const ofWorkspace = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) });

async function expectError(response: Response, status: number, code: string) {
  const body = await response.json();
  expect({ status: response.status, code: body.error?.code }).toEqual({ status, code });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  return body as { error: { code: string; message: string } };
}

type Tree = {
  folderNodeId: string;
  root: string;
  documents: { documentId: string }[];
};

async function createFolderTree(
  caller: CallerContext,
  label: string,
  documents: readonly { relative: string; title: string; markdown: string }[],
): Promise<Tree> {
  const root = `repos/${label}`;
  const folder = await fixture.createFolder(caller, root, label);
  const created: { documentId: string }[] = [];
  for (const document of documents) {
    created.push(await fixture.createSyncedOriginal(caller, {
      parentId: folder.treeNodeId,
      sourcePath: `${root}/${document.relative}`,
      title: document.title,
      markdown: document.markdown,
    }));
  }
  return { folderNodeId: folder.treeNodeId, root, documents: created };
}

async function publishTree(
  caller: CallerContext,
  teamWorkspaceId: string,
  tree: Tree,
  name: string,
): Promise<{ publicationId: string }> {
  as(caller);
  const response = await publish(request({
    teamWorkspaceId,
    name,
    origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
  }));
  expect(response.status).toBe(201);
  return (await response.json()) as { publicationId: string };
}

async function sourceRow(sourceId: string): Promise<{ status: string; name: string }> {
  const rows = await fixture.pool.query<{ status: string; name: string }[]>(
    "SELECT status, name FROM knowledge_sources WHERE id = ?", [sourceId]);
  return { status: String(rows[0]?.status), name: String(rows[0]?.name) };
}

async function publicationSourceId(publicationId: string): Promise<string> {
  const rows = await fixture.pool.query<{ source_id: string }[]>(
    "SELECT source_id FROM publications WHERE id = ?", [publicationId]);
  return String(rows[0]?.source_id);
}

async function contributionsOf(publicationId: string) {
  return fixture.uow.run((repositories) => repositories.publications.listContributions(publicationId));
}

/** A fresh team whose members are exactly the given direct roles. */
async function teamWithRoles(
  label: string,
  roles: readonly { user: CallerContext; role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" }[],
): Promise<string> {
  const teamId = uuidv7();
  const now = new Date();
  await fixture.uow.run(async (repositories) => {
    await repositories.workspaces.insert(createTeamWorkspaceInsert({
      id: teamId, name: `${label} ${teamId}`, createdBy: fixture.mike.identity.id, now,
    }));
    for (const entry of roles) {
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: teamId, userId: entry.user.identity.id, role: entry.role, now,
      }));
    }
  });
  return teamId;
}

function outsiderCaller(label: string): CallerContext {
  const identity: UserIdentity = {
    id: uuidv7(),
    emp_id: `API-${label}-${uuidv7()}`,
    name: `API ${label}`,
    org_code: "TEST",
  };
  return callerFromIdentity(identity);
}

describe("publication API: publish and preview", () => {
  it("publishes a folder and returns its ID and first report", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-publish"), [
      { relative: "a.md", title: "A", markdown: "a" },
      { relative: "nested/b.md", title: "B", markdown: "b" },
    ]);
    const name = unique("API Publication");
    const published = await publishTree(fixture.mike, fixture.teamWorkspaceId, tree, name);

    const sourceId = await publicationSourceId(published.publicationId);
    expect(await sourceRow(sourceId)).toEqual({ status: "ACTIVE", name });
    const contributions = await contributionsOf(published.publicationId);
    expect(contributions).toHaveLength(1);
    expect(contributions[0].userId).toBe(fixture.mike.identity.id);
  });

  it("previews the same shape without writing anything", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-preview"), [
      { relative: "a.md", title: "Preview A", markdown: "a" },
    ]);
    const [before] = await fixture.pool.query<{ sources: unknown; publications: unknown; contributions: unknown }[]>(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_sources WHERE workspace_id = ?) AS sources,
         (SELECT COUNT(*) FROM publications) AS publications,
         (SELECT COUNT(*) FROM publication_contributors) AS contributions`,
      [fixture.teamWorkspaceId],
    );
    as(fixture.mike);
    const response = await preview(request({
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Preview Only"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ nameTaken: false, refusedOriginals: [] });
    const [after] = await fixture.pool.query<{ sources: unknown; publications: unknown; contributions: unknown }[]>(
      `SELECT
         (SELECT COUNT(*) FROM knowledge_sources WHERE workspace_id = ?) AS sources,
         (SELECT COUNT(*) FROM publications) AS publications,
         (SELECT COUNT(*) FROM publication_contributors) AS contributions`,
      [fixture.teamWorkspaceId],
    );
    expect(Number(after.sources)).toBe(Number(before.sources));
    expect(Number(after.publications)).toBe(Number(before.publications));
    expect(Number(after.contributions)).toBe(Number(before.contributions));
  });

  it("answers 400 with the plan's wording for a duplicate name", async () => {
    const first = await createFolderTree(fixture.mike, unique("api-dup-a"), [
      { relative: "a.md", title: "Dup A", markdown: "a" },
    ]);
    const second = await createFolderTree(fixture.mike, unique("api-dup-b"), [
      { relative: "b.md", title: "Dup B", markdown: "b" },
    ]);
    const name = unique("Duplicate Publication");
    await publishTree(fixture.mike, fixture.teamWorkspaceId, first, name);

    as(fixture.mike);
    const response = await publish(request({
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "FOLDER", folderNodeId: second.folderNodeId },
    }));
    const body = await expectError(response, 400, "PUBLICATION_NAME_TAKEN");
    expect(body.error.message).toContain("已有同名發佈，請取一個能說明內容的名字");
  });

  it("answers 403 for a VIEWER who cannot publish", async () => {
    const viewerTeamId = await teamWithRoles("Viewer Team", [
      { user: fixture.mike, role: "OWNER" },
      { user: fixture.ann, role: "VIEWER" },
    ]);
    const tree = await createFolderTree(fixture.ann, unique("api-viewer"), [
      { relative: "a.md", title: "Viewer A", markdown: "a" },
    ]);
    as(fixture.ann);
    const response = await publish(request({
      teamWorkspaceId: viewerTeamId,
      name: unique("Viewer Publication"),
      origin: { kind: "FOLDER", folderNodeId: tree.folderNodeId },
    }));
    await expectError(response, 403, "INSUFFICIENT_WORKSPACE_CAPABILITY");
  });

  it("answers 404 for a non-member and writes nothing", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-outsider"), [
      { relative: "a.md", title: "Outsider A", markdown: "a" },
    ]);
    const outsider = outsiderCaller("Outsider");
    const name = unique("Outsider Publication");
    as(outsider);
    const response = await publish(request({
      teamWorkspaceId: fixture.teamWorkspaceId,
      name,
      origin: { kind: "DOCUMENT", documentId: tree.documents[0].documentId },
    }));
    await expectError(response, 404, "NOT_FOUND");
    const rows = await fixture.pool.query<{ n: unknown }[]>(
      "SELECT COUNT(*) AS n FROM knowledge_sources WHERE workspace_id = ? AND name = ?",
      [fixture.teamWorkspaceId, name],
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("publication API: commands", () => {
  it("joins, leaves and resumes only the caller", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("api-join-mike"), [
      { relative: "a.md", title: "Join Mike A", markdown: "mike" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("api-join-ann"), [
      { relative: "a.md", title: "Join Ann A", markdown: "ann" },
      { relative: "c.md", title: "Join Ann C", markdown: "ann c" },
    ]);
    const published = await publishTree(
      fixture.mike, fixture.teamWorkspaceId, mikeTree, unique("Join API Publication"));

    as(fixture.ann);
    const joined = await join(
      request({ folderNodeId: annTree.folderNodeId }), ofPublication(published.publicationId));
    expect(joined.status).toBe(200);
    const contributionId = (await joined.json()).contributionId as string;

    let contributions = await contributionsOf(published.publicationId);
    expect(contributions.find((entry) => entry.id === contributionId)?.userId).toBe(fixture.ann.identity.id);

    const left = await leave(request(), ofPublication(published.publicationId));
    expect(left.status).toBe(204);
    contributions = await contributionsOf(published.publicationId);
    expect(contributions.find((entry) => entry.id === contributionId)?.leftAt).not.toBeNull();

    const resumed = await resume(request(), ofPublication(published.publicationId));
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ created: expect.any(Number) });
    contributions = await contributionsOf(published.publicationId);
    expect(contributions.find((entry) => entry.id === contributionId)?.leftAt).toBeNull();
  });

  it("requires an explicit acknowledgement for a low-overlap join", async () => {
    const mikeTree = await createFolderTree(fixture.mike, unique("api-low-mike"), [
      { relative: "only/mike.md", title: "Low Mike", markdown: "mike" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("api-low-ann"), [
      { relative: "other/ann.md", title: "Low Ann", markdown: "ann" },
    ]);
    const published = await publishTree(
      fixture.mike, fixture.teamWorkspaceId, mikeTree, unique("Low API Publication"));

    as(fixture.ann);
    await expectError(
      await join(request({ folderNodeId: annTree.folderNodeId }), ofPublication(published.publicationId)),
      409,
      "PUBLICATION_JOIN_LOW_OVERLAP",
    );
    const acknowledged = await join(request({
      folderNodeId: annTree.folderNodeId,
      acknowledgeLowOverlap: true,
    }), ofPublication(published.publicationId));
    expect(acknowledged.status).toBe(200);
  });

  it("renames an active publication without a new revision", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-rename"), [
      { relative: "a.md", title: "Rename A", markdown: "a" },
    ]);
    const published = await publishTree(
      fixture.mike, fixture.teamWorkspaceId, tree, unique("Rename API Publication"));
    const sourceId = await publicationSourceId(published.publicationId);
    const [before] = await fixture.pool.query<{ revisions: unknown }[]>(
      "SELECT COUNT(*) AS revisions FROM knowledge_revisions ORDER BY 1");
    const renamed = unique("Renamed API Publication");

    as(fixture.mike);
    const response = await rename(request({ name: renamed }), ofPublication(published.publicationId));
    expect(response.status).toBe(204);
    expect((await sourceRow(sourceId)).name).toBe(renamed);
    const [after] = await fixture.pool.query<{ revisions: unknown }[]>(
      "SELECT COUNT(*) AS revisions FROM knowledge_revisions ORDER BY 1");
    expect(Number(after.revisions)).toBe(Number(before.revisions));
  });

  it("unpublishes and restores the whole publication", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-lifecycle"), [
      { relative: "a.md", title: "Lifecycle A", markdown: "a" },
    ]);
    const published = await publishTree(
      fixture.mike, fixture.teamWorkspaceId, tree, unique("Lifecycle API Publication"));
    const sourceId = await publicationSourceId(published.publicationId);

    as(fixture.mike);
    expect((await unpublish(request(), ofPublication(published.publicationId))).status).toBe(204);
    expect((await sourceRow(sourceId)).status).toBe("ARCHIVED");
    expect((await restore(request(), ofPublication(published.publicationId))).status).toBe(204);
    expect((await sourceRow(sourceId)).status).toBe("ACTIVE");
  });

  it("names both restore conflicts", async () => {
    const first = await createFolderTree(fixture.mike, unique("api-restore-a"), [
      { relative: "a.md", title: "Restore A", markdown: "a" },
    ]);
    const second = await createFolderTree(fixture.mike, unique("api-restore-b"), [
      { relative: "b.md", title: "Restore B", markdown: "b" },
    ]);
    // The name conflict: another active publication takes the archived name.
    const name = unique("Restore Name Publication");
    const original = await publishTree(fixture.mike, fixture.teamWorkspaceId, first, name);
    as(fixture.mike);
    expect((await unpublish(request(), ofPublication(original.publicationId))).status).toBe(204);
    await publishTree(fixture.mike, fixture.teamWorkspaceId, second, name);
    as(fixture.mike);
    await expectError(
      await restore(request(), ofPublication(original.publicationId)),
      400,
      "PUBLICATION_NAME_TAKEN",
    );

    // The original conflict: another publication claims one of its originals.
    const third = await createFolderTree(fixture.mike, unique("api-restore-c"), [
      { relative: "c.md", title: "Restore C", markdown: "c" },
    ]);
    const originalName = unique("Restore Original Publication");
    const claimed = await publishTree(fixture.mike, fixture.teamWorkspaceId, third, originalName);
    as(fixture.mike);
    expect((await unpublish(request(), ofPublication(claimed.publicationId))).status).toBe(204);
    as(fixture.mike);
    const replacement = await publish(request({
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Replacement Publication"),
      origin: { kind: "DOCUMENT", documentId: third.documents[0].documentId },
    }));
    expect(replacement.status).toBe(201);
    as(fixture.mike);
    await expectError(
      await restore(request(), ofPublication(claimed.publicationId)),
      409,
      "PUBLICATION_ORIGINAL_TAKEN",
    );
  });
});

describe("publication API: access is re-judged before publication shape", () => {
  it("hides an archived publication from a non-member before reporting it archived", async () => {
    const teamId = await teamWithRoles("Hidden Archived Team", [
      { user: fixture.mike, role: "OWNER" },
    ]);
    const tree = await createFolderTree(fixture.mike, unique("hidden-archived"), [
      { relative: "a.md", title: "Hidden Archived A", markdown: "a" },
    ]);
    const published = await publishTree(
      fixture.mike, teamId, tree, unique("Hidden Archived Publication"));
    as(fixture.mike);
    expect((await unpublish(request(), ofPublication(published.publicationId))).status).toBe(204);

    as(outsiderCaller("Join Archived"));
    await expectError(
      await join(request({ folderNodeId: tree.folderNodeId }), ofPublication(published.publicationId)),
      404,
      "NOT_FOUND",
    );
  });

  it("hides a document publication from a non-member before refusing its kind", async () => {
    const teamId = await teamWithRoles("Hidden Document Team", [
      { user: fixture.mike, role: "OWNER" },
    ]);
    const original = await fixture.createHubOriginal(fixture.mike, unique("Hidden Document"), "body");
    const folder = await createFolderTree(fixture.mike, unique("hidden-document-folder"), [
      { relative: "a.md", title: "Hidden Doc A", markdown: "a" },
    ]);
    as(fixture.mike);
    const response = await publish(request({
      teamWorkspaceId: teamId,
      name: unique("Hidden Document Publication"),
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    }));
    expect(response.status).toBe(201);
    const publicationId = (await response.json()).publicationId as string;

    as(outsiderCaller("Join Document"));
    await expectError(
      await join(request({ folderNodeId: folder.folderNodeId }), ofPublication(publicationId)),
      404,
      "NOT_FOUND",
    );
  });

  it("re-judges team read before leave and before resume writes state", async () => {
    const teamId = await teamWithRoles("Rejudge Command Team", [
      { user: fixture.mike, role: "OWNER" },
      { user: fixture.ann, role: "EDITOR" },
    ]);
    const mikeTree = await createFolderTree(fixture.mike, unique("rejudge-mike"), [
      { relative: "a.md", title: "Rejudge Mike A", markdown: "mike" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("rejudge-ann"), [
      { relative: "b.md", title: "Rejudge Ann B", markdown: "ann" },
    ]);
    const published = await publishTree(
      fixture.mike, teamId, mikeTree, unique("Rejudge Publication"));

    as(fixture.ann);
    const joined = await join(
      request({ folderNodeId: annTree.folderNodeId, acknowledgeLowOverlap: true }),
      ofPublication(published.publicationId));
    const contributionId = (await joined.json()).contributionId as string;
    as(fixture.ann);
    expect((await leave(request(), ofPublication(published.publicationId))).status).toBe(204);
    let contributions = await contributionsOf(published.publicationId);
    expect(contributions.find((entry) => entry.id === contributionId)?.leftAt).not.toBeNull();

    await fixture.uow.run((repositories) =>
      repositories.workspaceMemberships.remove(teamId, fixture.ann.identity.id));

    as(fixture.ann);
    await expectError(await resume(request(), ofPublication(published.publicationId)), 404, "NOT_FOUND");
    await expectError(await leave(request(), ofPublication(published.publicationId)), 404, "NOT_FOUND");
    contributions = await contributionsOf(published.publicationId);
    expect(contributions.find((entry) => entry.id === contributionId)?.leftAt).not.toBeNull();
  });
});

describe("publication API: safe read models", () => {
  it("lists names, update time and only the caller's contribution", async () => {
    const teamId = await teamWithRoles("Read Team", [
      { user: fixture.mike, role: "OWNER" },
      { user: fixture.ann, role: "EDITOR" },
    ]);
    const mikeTree = await createFolderTree(fixture.mike, unique("api-read-mike"), [
      { relative: "a.md", title: "Read Mike A", markdown: "mike" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("api-read-ann"), [
      { relative: "b.md", title: "Read Ann B", markdown: "ann" },
    ]);
    const published = await publishTree(fixture.mike, teamId, mikeTree, unique("Read List Publication"));
    as(fixture.ann);
    const joined = await join(
      request({ folderNodeId: annTree.folderNodeId, acknowledgeLowOverlap: true }),
      ofPublication(published.publicationId));
    expect(joined.status).toBe(200);

    as(fixture.ann);
    const response = await list(new Request("http://hub.test/api"), ofWorkspace(teamId));
    expect(response.status).toBe(200);
    const items = (await response.json()) as Array<Record<string, unknown>>;
    const item = items.find((entry) => (entry.publication as { id: string }).id === published.publicationId);
    expect(item).toMatchObject({
      creatorName: "Mike",
      canJoin: false,
      canManage: false,
      publication: { name: expect.any(String), kind: "FOLDER", status: "ACTIVE" },
    });
    expect(typeof item?.updatedAt).toBe("string");
    expect(Object.keys(item?.ownContribution as object).sort()).toEqual(
      ["id", "leftAt", "pendingCatchUp", "rightsFrozenAt", "userId"]);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain(mikeTree.folderNodeId);
    expect(serialized).not.toContain(mikeTree.documents[0].documentId);

    as(fixture.mike);
    const mine = (await (await list(new Request("http://hub.test/api"), ofWorkspace(teamId))).json())
      .find((entry: { publication: { id: string } }) => entry.publication.id === published.publicationId);
    expect(mine.canManage).toBe(true);
    expect(mine.canJoin).toBe(false);

    const admin = outsiderCaller("Admin");
    await fixture.uow.run(async (repositories) => {
      await repositories.users.upsertIdentity(admin.identity);
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: teamId, userId: admin.identity.id, role: "ADMIN", now: new Date(),
      }));
    });
    as(admin);
    const adminItem = (await (await list(new Request("http://hub.test/api"), ofWorkspace(teamId))).json())
      .find((entry: { publication: { id: string } }) => entry.publication.id === published.publicationId);
    expect(adminItem).toMatchObject({ canManage: true, canJoin: true, ownContribution: null });

    const viewer = outsiderCaller("Viewer");
    await fixture.uow.run(async (repositories) => {
      await repositories.users.upsertIdentity(viewer.identity);
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: teamId, userId: viewer.identity.id, role: "VIEWER", now: new Date(),
      }));
    });
    as(viewer);
    const viewerItem = (await (await list(new Request("http://hub.test/api"), ofWorkspace(teamId))).json())
      .find((entry: { publication: { id: string } }) => entry.publication.id === published.publicationId);
    expect(viewerItem).toMatchObject({ canJoin: false, canManage: false, ownContribution: null });
  });

  it("hides the list from a non-member and after membership is removed", async () => {
    const teamId = await teamWithRoles("Revoked Team", [
      { user: fixture.mike, role: "OWNER" },
      { user: fixture.ann, role: "EDITOR" },
    ]);
    const tree = await createFolderTree(fixture.mike, unique("api-revoked"), [
      { relative: "a.md", title: "Revoked A", markdown: "a" },
    ]);
    const published = await publishTree(fixture.mike, teamId, tree, unique("Revoked Publication"));

    as(fixture.ann);
    expect((await list(new Request("http://hub.test/api"), ofWorkspace(teamId))).status).toBe(200);
    await fixture.uow.run((repositories) =>
      repositories.workspaceMemberships.remove(teamId, fixture.ann.identity.id));
    as(fixture.ann);
    await expectError(await list(new Request("http://hub.test/api"), ofWorkspace(teamId)), 404, "NOT_FOUND");
    await expectError(await status(request(undefined, "GET"), ofPublication(published.publicationId)), 404, "NOT_FOUND");

    as(outsiderCaller("No Member"));
    await expectError(await list(new Request("http://hub.test/api"), ofWorkspace(teamId)), 404, "NOT_FOUND");
  });

  it("returns only the caller's own report and pending state", async () => {
    const teamId = await teamWithRoles("Status Team", [
      { user: fixture.mike, role: "OWNER" },
      { user: fixture.ann, role: "EDITOR" },
    ]);
    const mikeTree = await createFolderTree(fixture.mike, unique("api-status-mike"), [
      { relative: "a.md", title: "Status Mike A", markdown: "mike a" },
      { relative: "b.md", title: "Status Mike B", markdown: "mike b" },
    ]);
    const annTree = await createFolderTree(fixture.ann, unique("api-status-ann"), [
      { relative: "c.md", title: "Status Ann C", markdown: "ann c" },
    ]);
    const published = await publishTree(fixture.mike, teamId, mikeTree, unique("Status Publication"));

    as(fixture.mike);
    const mikeStatus = await status(request(undefined, "GET"), ofPublication(published.publicationId));
    expect(mikeStatus.status).toBe(200);
    expect(await mikeStatus.json()).toMatchObject({ pending: false, report: { created: 2 } });

    // A member who is not a contributor reads no report at all.
    as(fixture.ann);
    await expectError(await status(request(undefined, "GET"), ofPublication(published.publicationId)), 404, "NOT_FOUND");

    as(fixture.ann);
    const joined = await join(
      request({ folderNodeId: annTree.folderNodeId, acknowledgeLowOverlap: true }),
      ofPublication(published.publicationId));
    const contributionId = (await joined.json()).contributionId as string;

    const annStatus = await status(request(undefined, "GET"), ofPublication(published.publicationId));
    expect(annStatus.status).toBe(200);
    expect(await annStatus.json()).toMatchObject({ pending: false, report: { created: 1 } });

    // Pending catch-up is the caller's own state, and a report with pending work is too.
    await fixture.uow.run((repositories) => repositories.publications.setContributionState(contributionId, {
      leftAt: null,
      rightsFrozenAt: null,
      pendingCatchUp: true,
    }));
    as(fixture.ann);
    expect(await (await status(request(undefined, "GET"), ofPublication(published.publicationId))).json())
      .toMatchObject({ pending: true });
    await fixture.uow.run(async (repositories) => {
      await repositories.publications.setContributionState(contributionId, {
        leftAt: null,
        rightsFrozenAt: null,
        pendingCatchUp: false,
      });
      await repositories.publications.saveReport(contributionId, {
        created: 0,
        updated: 0,
        moved: 0,
        archived: 0,
        restored: 0,
        notices: [{
          publicationId: published.publicationId,
          originalDocumentId: annTree.documents[0].documentId,
          code: "ORIGINAL_ALREADY_PUBLISHED",
          existingPublicationName: "Another Publication",
        }],
      });
    });
    as(fixture.ann);
    expect(await (await status(request(undefined, "GET"), ofPublication(published.publicationId))).json())
      .toMatchObject({ pending: true });

    // Mike's own status never shows Ann's pending state.
    as(fixture.mike);
    expect(await (await status(request(undefined, "GET"), ofPublication(published.publicationId))).json())
      .toMatchObject({ pending: false });
  });

  it("advances the list's updatedAt after a contributor sync", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, unique("Stamp Document"), "first body");
    as(fixture.mike);
    const published = await publish(request({
      teamWorkspaceId: fixture.teamWorkspaceId,
      name: unique("Stamp Publication"),
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    }));
    expect(published.status).toBe(201);
    const publicationId = (await published.json()).publicationId as string;

    const listedAt = async (): Promise<string> => {
      as(fixture.mike);
      const items = await (await list(
        new Request("http://hub.test/api"), ofWorkspace(fixture.teamWorkspaceId))).json();
      return (items as Array<{ publication: { id: string }; updatedAt: string }>)
        .find((entry) => entry.publication.id === publicationId)!.updatedAt;
    };
    const before = await listedAt();

    await new Promise((resolve) => setTimeout(resolve, 20));
    const hub = new HubKnowledgeCommandServiceImpl(fixture.uow);
    const changed = await hub.createRevision(fixture.mike, {
      documentId: original.documentId,
      expectedCurrentRevisionId: original.revisionId,
      title: "Stamp Document Updated",
      markdown: "second body",
      metadata: {},
    });
    expect(changed.changed).toBe(true);
    const drained = await drainPublicationEvents(fixture.uow, {
      judge: { kind: "CALLER", caller: fixture.mike },
    });
    expect(drained.applied).toBeGreaterThan(0);

    const after = await listedAt();
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });

  it("hides archived publications unless asked for", async () => {
    const tree = await createFolderTree(fixture.mike, unique("api-archived-list"), [
      { relative: "a.md", title: "Archived A", markdown: "a" },
    ]);
    const published = await publishTree(
      fixture.mike, fixture.teamWorkspaceId, tree, unique("Archived List Publication"));
    as(fixture.mike);
    expect((await unpublish(request(), ofPublication(published.publicationId))).status).toBe(204);

    as(fixture.mike);
    const activeOnly = (await (await list(new Request("http://hub.test/api"), ofWorkspace(fixture.teamWorkspaceId))).json())
      .map((entry: { publication: { id: string } }) => entry.publication.id);
    expect(activeOnly).not.toContain(published.publicationId);

    const withArchived = (await (await list(
      new Request("http://hub.test/api?includeArchived=true"), ofWorkspace(fixture.teamWorkspaceId))).json())
      .find((entry: { publication: { id: string } }) => entry.publication.id === published.publicationId);
    expect(withArchived.publication.status).toBe("ARCHIVED");
    expect(withArchived.canJoin).toBe(false);
    expect(withArchived.canManage).toBe(true);
  });

  it("offers options only for teams the caller may publish to and only their own folders", async () => {
    const directViewerTeamId = uuidv7();
    const groupViewerTeamId = uuidv7();
    const now = new Date();
    await fixture.uow.run(async (repositories) => {
      await repositories.workspaces.insert(createTeamWorkspaceInsert({
        id: directViewerTeamId, name: unique("Viewer Team"), createdBy: fixture.mike.identity.id, now,
      }));
      await repositories.workspaceMemberships.insert(createDirectMembership({
        workspaceId: directViewerTeamId, userId: fixture.ann.identity.id, role: "VIEWER", now,
      }));
      await repositories.workspaces.insert(createTeamWorkspaceInsert({
        id: groupViewerTeamId, name: unique("Group Viewer Team"), createdBy: fixture.mike.identity.id, now,
      }));
      await repositories.groupMappings.insert({
        id: uuidv7(), workspaceId: groupViewerTeamId,
        externalGroupId: fixture.annExternalGroupId, role: "VIEWER",
        createdBy: fixture.mike.identity.id, createdAt: now, updatedAt: now,
      });
    });

    await fixture.createFolder(fixture.ann, `repos/ann-options-${unique("f")}`, "Ann Options");

    as(fixture.ann);
    const response = await publicationOptions();
    expect(response.status).toBe(200);
    const body = await response.json() as {
      teams: { id: string; name: string }[];
      folders: { folderNodeId: string; label: string; sourceId: string }[];
    };
    const teamIds = body.teams.map((team) => team.id);
    // Ann is an EDITOR (source.manage) in the direct team, so it is offered.
    expect(teamIds).toContain(fixture.teamWorkspaceId);
    // A direct VIEWER and a group-mapped VIEWER cannot publish.
    expect(teamIds).not.toContain(directViewerTeamId);
    expect(teamIds).not.toContain(groupViewerTeamId);

    // Only Ann's own folders, from her own Hub and synced sources; Mike's never appear.
    const allowedSources = new Set([fixture.annFolderSourceId, fixture.annHubSourceId]);
    expect(body.folders.length).toBeGreaterThan(0);
    expect(body.folders.every((folder) => allowedSources.has(folder.sourceId))).toBe(true);
    expect(body.folders.some((folder) => folder.label.includes("Ann Options"))).toBe(true);
    expect(JSON.stringify(body.folders)).not.toContain("Mike Repo");
  });

  it("answers 404 for every route while the flag is off", async () => {
    process.env.KM_TEAM_WORKSPACES_ENABLED = "false";
    const missing = uuidv7();
    as(fixture.mike);
    const calls = [
      publish(request({ teamWorkspaceId: fixture.teamWorkspaceId, name: "Off", origin: { kind: "FOLDER", folderNodeId: missing } })),
      preview(request({ teamWorkspaceId: fixture.teamWorkspaceId, name: "Off", origin: { kind: "FOLDER", folderNodeId: missing } })),
      join(request({ folderNodeId: missing }), ofPublication(missing)),
      leave(request(), ofPublication(missing)),
      resume(request(), ofPublication(missing)),
      unpublish(request(), ofPublication(missing)),
      restore(request(), ofPublication(missing)),
      rename(request({ name: "Off" }), ofPublication(missing)),
      status(request(undefined, "GET"), ofPublication(missing)),
      list(new Request("http://hub.test/api"), ofWorkspace(fixture.teamWorkspaceId)),
      publicationOptions(),
    ];
    for (const response of await Promise.all(calls)) {
      await expectError(response, 404, "NOT_FOUND");
    }
  });
});
