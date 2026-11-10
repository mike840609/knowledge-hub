import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbTaskKnowledgeUnitOfWork } from "@/infrastructure/database/mariadb/task-knowledge-transaction";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import { SavedShareService } from "@/modules/knowledge/application/saved-share-service";
import { revisionContentHash } from "@/modules/knowledge/domain/content";
import { AgentReadAccessService } from "@/modules/task-knowledge/application/agent-read-access";
import { IngestTaskResultService } from "@/modules/task-knowledge/application/ingest-task-result";
import { ManageExportBindingService } from "@/modules/task-knowledge/application/manage-export-binding";
import { TaskLifecycleService } from "@/modules/task-knowledge/application/manage-task-lifecycle";
import { TaskResultReadService } from "@/modules/task-knowledge/application/read-task-results";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { withSourcePaths } from "@/server/agent-search";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { insertSyncedDocument, seedMySpaceWithFolderSource } from "./task-knowledge-fixtures";

const injected = vi.hoisted(() => ({ services: null as unknown }));
vi.mock("@/server/composition", () => ({ agentReadServices: () => injected.services }));

import { GET as readDocument } from "@/app/api/agent/documents/route";
import { GET as searchAgent } from "@/app/api/agent/search/route";
import { GET as readTask } from "@/app/api/agent/tasks/route";

let pool: Pool;
beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  injected.services = buildAgentServices();
});
afterAll(async () => { await pool.end(); });
afterEach(() => vi.unstubAllEnvs());

/** The real services `agentReadServices()` wires, through the same search projection it uses. */
function buildAgentServices() {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const taskUnitOfWork = new MariaDbTaskKnowledgeUnitOfWork(pool);
  return {
    access: new AgentReadAccessService(taskUnitOfWork),
    search: withSourcePaths(new KnowledgeSearchService(unitOfWork, new WorkspaceQueryService(unitOfWork)), unitOfWork),
    context: new AgentContextService(unitOfWork),
    tasks: new TaskResultReadService(taskUnitOfWork),
  };
}

const TOKEN_HEADER = "x-knowledge-hub-export-token";
const artifactBase = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/task-artifact/artifact/valid.json"), "utf8"));

function get(pathname: string, token: string): Request {
  return new Request(`https://km.example.com${pathname}`, { headers: { [TOKEN_HEADER]: token } });
}

async function exporter() {
  const seed = await seedMySpaceWithFolderSource(pool);
  const caller = callerFromIdentity(seed.owner);
  const bindings = new ManageExportBindingService(new MariaDbTaskKnowledgeUnitOfWork(pool));
  const { bindingId, token } = await bindings.create(caller, { workspaceId: seed.workspaceId, label: "laptop" });
  const ingest = (body: Record<string, unknown>) =>
    new IngestTaskResultService(new MariaDbTaskKnowledgeUnitOfWork(pool)).ingest(token, new TextEncoder().encode(JSON.stringify({ ...artifactBase, ...body })));
  return { ...seed, caller, bindings, bindingId, token, ingest };
}

/** A synced document with one current revision, so it can be searched and read. */
async function syncedDocument(seed: { owner: { id: string }; sourceId: string }, sourcePath: string, title: string, markdown: string) {
  const documentId = await insertSyncedDocument(pool, seed.sourceId, seed.owner.id, sourcePath);
  const revisionId = uuidv7();
  const content = { title, markdown, metadata: {} };
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.revisions.insert({
      id: revisionId, documentId, revisionNo: 1, ...content,
      contentHash: revisionContentHash(content), createdBy: seed.owner.id, createdAt: new Date(),
    });
    await repositories.documents.setCurrentRevision(documentId, revisionId, seed.owner.id);
    await repositories.documents.assertComplete(documentId);
  });
  return { documentId, revisionId };
}

/** A document in a Team Workspace the owner belongs to; the credential's My Space scope must not reach it. */
async function teamDocument(owner: UserIdentity): Promise<string> {
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const now = new Date();
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `Team ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.sources.insert({
      id: sourceId, name: "Team Notes", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
  });
  const created = await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(callerFromIdentity(owner), {
    sourceId, parentId: null, title: "Team secret", markdown: "TEAMWORD lives here.", metadata: {},
  });
  return created.documentId;
}

describe("agent read over HTTP", () => {
  it("reads a document and a Task Result from its own My Space", async () => {
    const box = await exporter();
    const { documentId } = await syncedDocument(box, "architecture/auth.md", "Auth design", "The auth body lives here.");
    const { taskResultId } = await box.ingest({ taskId: randomUUID(), artifactRevision: 1, title: "Earlier task" });

    const document = await readDocument(get(`/api/agent/documents?${new URLSearchParams({ ref: "architecture/auth.md" })}`, box.token));
    expect(document.status).toBe(200);
    expect(document.headers.get("Cache-Control")).toBe("private, no-store");
    const bundle = await document.json();
    expect(bundle.documentId).toBe(documentId);
    expect(bundle.markdown).toContain("The auth body lives here.");

    const task = await readTask(get(`/api/agent/tasks?id=${taskResultId}`, box.token));
    expect(task.status).toBe(200);
    const answer = await task.json();
    expect(answer).toMatchObject({ taskResultId, revisionNo: 1 });
    expect(answer.content.title).toBe("Earlier task");
  });

  it("finds a document by a word in its body, with its source path", async () => {
    const box = await exporter();
    const { documentId } = await syncedDocument(box, "guides/deploy.md", "Deployment guide", "A unique ZEBRAFISH word.");
    const response = await searchAgent(get(`/api/agent/search?${new URLSearchParams({ q: "ZEBRAFISH" })}`, box.token));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe("documents");
    expect(body.hits).toEqual([
      { id: documentId, title: "Deployment guide", path: "guides/deploy.md", snippet: expect.stringContaining("ZEBRAFISH") },
    ]);
    expect(body.hasMore).toBe(false);
  });

  it("answers 404 for a document ID in another Workspace", async () => {
    const mine = await exporter();
    const other = await exporter();
    const { documentId } = await syncedDocument(other, "private/other.md", "Other", "OTHERWORD body.");

    expect((await readDocument(get(`/api/agent/documents?ref=${documentId}`, mine.token))).status).toBe(404);
    const hits = await (await searchAgent(get("/api/agent/search?q=OTHERWORD", mine.token))).json();
    expect(hits.hits).toEqual([]);
  });

  it("answers 404 for a Task Result owned through another binding's My Space", async () => {
    const mine = await exporter();
    const other = await exporter();
    const { taskResultId } = await other.ingest({ taskId: randomUUID(), artifactRevision: 1 });
    expect((await readTask(get(`/api/agent/tasks?id=${taskResultId}`, mine.token))).status).toBe(404);
  });

  it("answers 404 for an ARCHIVED document, by ID and by path", async () => {
    const box = await exporter();
    const { documentId } = await syncedDocument(box, "old/gone.md", "Gone", "ARCHIVEDWORD body.");
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [box.owner.id, documentId]);
    expect((await readDocument(get(`/api/agent/documents?ref=${documentId}`, box.token))).status).toBe(404);
    expect((await readDocument(get(`/api/agent/documents?${new URLSearchParams({ ref: "old/gone.md" })}`, box.token))).status).toBe(404);
  });

  it("answers 404 for an ARCHIVED Task Result", async () => {
    const box = await exporter();
    const { taskResultId } = await box.ingest({ taskId: randomUUID(), artifactRevision: 1, title: "Archived task" });
    await new TaskLifecycleService(new MariaDbTaskKnowledgeUnitOfWork(pool)).archive(box.caller, box.workspaceId, taskResultId);
    const response = await readTask(get(`/api/agent/tasks?id=${taskResultId}`, box.token));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("does not read a Team Workspace document the owner is a member of", async () => {
    const box = await exporter();
    const documentId = await teamDocument(box.owner);
    expect((await readDocument(get(`/api/agent/documents?ref=${documentId}`, box.token))).status).toBe(404);
    const hits = await (await searchAgent(get("/api/agent/search?q=TEAMWORD", box.token))).json();
    expect(hits.hits).toEqual([]);
  });

  it("does not read a document saved from someone else's share link", async () => {
    const sender = await exporter();
    const reader = await exporter();
    const { documentId } = await syncedDocument(sender, "shared/plan.md", "Plan", "SAVEDWORD body.");
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const link = await new DocumentShareService(unitOfWork, new RandomShareTokenIssuer()).create(sender.caller, { documentId });
    await new SavedShareService(unitOfWork).save(reader.caller, link.path.slice(3));

    expect((await readDocument(get(`/api/agent/documents?ref=${documentId}`, reader.token))).status).toBe(404);
    const hits = await (await searchAgent(get("/api/agent/search?q=SAVEDWORD", reader.token))).json();
    expect(hits.hits).toEqual([]);
  });

  it("returns a bundle with no discussion", async () => {
    const box = await exporter();
    const { documentId, revisionId } = await syncedDocument(box, "docs/threaded.md", "Threaded", "# Context guide\n\nMVP search content.");
    await new DocumentReviewService(new MariaDbUnitOfWork(pool), () => new Date(), () => true).createForOwner(box.caller, {
      documentId, expectedRevisionId: revisionId, body: "MARKER-COMMENT", idempotencyKey: randomUUID(),
      anchor: { schemaVersion: 1, blockPath: [1], blockKind: "paragraph", startUtf16: 0, endUtf16: 3, exact: "MVP", prefix: "", suffix: " search content." },
    });

    const response = await readDocument(get(`/api/agent/documents?ref=${documentId}`, box.token));
    expect(response.status).toBe(200);
    const { markdown } = await response.json();
    expect(markdown).toContain("MVP search content.");
    expect(markdown).not.toContain("MARKER-COMMENT");
    expect(markdown).not.toMatch(/discussion/i);
  });

  it("answers 401 on the next request after revoke, and for the old token after rotate", async () => {
    const box = await exporter();
    const { token: next } = await box.bindings.rotate(box.caller, { workspaceId: box.workspaceId, bindingId: box.bindingId });
    expect((await searchAgent(get("/api/agent/search?q=x", box.token))).status).toBe(401);
    expect((await searchAgent(get("/api/agent/search?q=x", next))).status).toBe(200);
    await box.bindings.revoke(box.caller, { workspaceId: box.workspaceId, bindingId: box.bindingId });
    expect((await searchAgent(get("/api/agent/search?q=x", next))).status).toBe(401);
  });

  it("answers 503 and no rows for kind=tasks while the flag is off", async () => {
    const box = await exporter();
    await box.ingest({ taskId: randomUUID(), artifactRevision: 1, title: "Hidden task" });
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "false");
    const response = await searchAgent(get("/api/agent/search?q=Hidden&kind=tasks", box.token));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ error: { code: "TASK_SEARCH_UNAVAILABLE", message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("Hidden task");
  });

  it("leaves the owner's users row unchanged after a search", async () => {
    const box = await exporter();
    await syncedDocument(box, "keep/row.md", "Keep", "Row word.");
    const before = await pool.query("SELECT * FROM users WHERE id = ?", [box.owner.id]);
    expect((await searchAgent(get("/api/agent/search?q=Row", box.token))).status).toBe(200);
    expect(await pool.query("SELECT * FROM users WHERE id = ?", [box.owner.id])).toEqual(before);
  });

  it.each(["/etc/passwd", "../other/a.md", "a/../../b.md", "x".repeat(5000), ""])("answers 404 or 422 for ref %j", async (ref) => {
    const box = await exporter();
    const response = await readDocument(get(`/api/agent/documents?${new URLSearchParams({ ref })}`, box.token));
    expect([404, 422]).toContain(response.status);
    expect(await response.text()).not.toContain("documentId");
  });
});
