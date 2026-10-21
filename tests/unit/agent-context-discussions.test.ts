import { expect, it, vi } from "vitest";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import type { ReviewComment, ReviewThread } from "@/modules/knowledge/domain/document-review";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

const id = "00000000-0000-0000-0000-000000000001";
const otherId = "00000000-0000-0000-0000-000000000002";
const now = new Date("2026-10-21T00:00:00Z");
const caller = callerFromIdentity({ id, emp_id: "1", name: "Alice", org_code: "A" });
function thread(key: string, patch: Partial<ReviewThread> = {}): ReviewThread {
  return { id: key, documentId: id, createdRevisionId: id, createdBy: id, creationIdempotencyKey: key, creationRequestHash: "hash", originShareLinkId: "private-share-id", anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 7, exact: "Passage", prefix: "", suffix: "" }, status: "OPEN", visibility: "VISIBLE", hiddenBy: null, hiddenAt: null, hiddenReason: null, resolvedBy: null, resolvedAt: null, createdAt: now, updatedAt: now, ...patch };
}
function comment(key: string, threadId: string, body: string, patch: Partial<ReviewComment> = {}): ReviewComment {
  return { id: key, threadId, authorUserId: id, body, idempotencyKey: key, requestHash: "hash", createdAt: now, editedAt: null, deletedAt: null, visibility: "VISIBLE", hiddenBy: null, hiddenAt: null, hiddenReason: null, ...patch };
}
function service(threads: ReviewThread[], comments: ReviewComment[], markdown = "Passage") {
  const r = {
    users: { upsertIdentity: vi.fn(), findById: async () => ({ name: "Alice" }) },
    workspaceAccess: { requireWorkspaceRead: vi.fn(), requireMembership: vi.fn() },
    workspaces: { findById: async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: id, lifecycleState: "ACTIVE" }) },
    documents: { findById: async (documentId: string) => ({ id: documentId, sourceId: id, status: "ACTIVE" }) },
    sourcePolicy: { findById: async () => ({ id, workspaceId: id, status: "ACTIVE", name: "Wiki" }) },
    tree: { listBySource: async () => [id, otherId].map(documentId => ({ id: documentId, sourceId: id, documentId, nodeType: "DOCUMENT", parentId: null, status: "ACTIVE" })) },
    revisions: { findCurrent: async (documentId: string) => ({ id: documentId, revisionNo: 1, title: documentId === id ? "First" : "Second", markdown, createdAt: now }) },
    linkedEntries: { findByDocumentId: async () => null },
    reviewThreads: { listByDocument: async (documentId: string) => threads.filter(t => t.documentId === documentId) },
    reviewComments: { listByThread: async (threadId: string) => comments.filter(c => c.threadId === threadId) },
  } as unknown as KnowledgeRepositories;
  return new AgentContextService({ run: work => work(r) });
}
it("exports open and resolved discussions under their document with ordered replies and attribution", async () => {
  const out = await service([thread("open"), thread("resolved", { documentId: otherId, status: "RESOLVED" })], [
    comment("reply", "open", "Later reply", { createdAt: new Date("2026-10-21T01:00:00Z"), editedAt: new Date("2026-10-21T02:00:00Z") }),
    comment("first", "open", "Initial question"), comment("decision", "resolved", "Agreed decision"),
  ]).build(caller, id, [id, otherId]);
  expect(out).toMatchObject({ documentCount: 2, threadCount: 2, commentCount: 3 });
  expect(out.markdown).toContain("OPEN"); expect(out.markdown).toContain("RESOLVED");
  expect(out.markdown).toContain("Alice"); expect(out.markdown).toContain("2026-10-21T02:00:00.000Z");
  expect(out.markdown).toContain('"quote":"Passage"');
  expect(out.markdown.indexOf("Initial question")).toBeLessThan(out.markdown.indexOf("Later reply"));
  expect(out.markdown.indexOf("Later reply")).toBeLessThan(out.markdown.indexOf('"title":"Second"'));
  expect(out.markdown.indexOf("Agreed decision")).toBeGreaterThan(out.markdown.indexOf('"title":"Second"'));
  expect(out.markdown).not.toContain("private-share-id");
  expect(out.bytes).toBe(new TextEncoder().encode(out.markdown).length);
});
it("omits hidden threads and retracted threads, and replaces hidden/deleted bodies with markers", async () => {
  const out = await service([thread("visible"), thread("hidden", { visibility: "HIDDEN" }), thread("retracted")], [
    comment("a", "visible", "Keep this"), comment("b", "visible", "HIDDEN SECRET", { visibility: "HIDDEN" }),
    comment("c", "visible", "DELETED SECRET", { deletedAt: now }),
    comment("d", "hidden", "THREAD SECRET"), comment("e", "retracted", "RETRACTED SECRET", { deletedAt: now }),
  ]).build(caller, id, [id]);
  expect(out).toMatchObject({ threadCount: 1, commentCount: 3 });
  expect(out.markdown).toContain("Keep this"); expect(out.markdown).toContain("[Comment hidden]"); expect(out.markdown).toContain("[Comment deleted]");
  expect(out.markdown).not.toContain("SECRET"); expect(out.markdown).not.toContain('"id":"retracted"');
});
it("keeps outdated discussions without exporting their stale quote", async () => {
  const out = await service([thread("old")], [comment("a", "old", "Still useful discussion")], "Replacement text").build(caller, id, [id]);
  expect(out.markdown).toContain("OUTDATED"); expect(out.markdown).toContain("Still useful discussion");
  expect(out.markdown).not.toContain('"Passage"');
});
it("counts discussions toward the byte limit and rejects rather than truncating replies", async () => {
  await expect(service([thread("large")], Array.from({ length: 100 }, (_, i) => comment(String(i), "large", "字".repeat(1000)))).build(caller, id, [id])).rejects.toThrow("256 KiB");
});

it("relocates older discussions against the bundled revision and handles documents without discussions", async () => {
  const moved = await service([thread("moved", { createdRevisionId: "older-revision" })], [comment("a", "moved", "Context")], "# New heading\n\nPassage").build(caller, id, [id]);
  expect(moved.markdown).toContain('"match":"MOVED","quote":"Passage"');
  const empty = await service([], []).build(caller, id, [id]);
  expect(empty).toMatchObject({ threadCount: 0, commentCount: 0 });
  expect(empty.markdown).not.toContain("### Discussions");
});
