import { describe, expect, it, vi } from "vitest";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
import type { KnowledgeDocument } from "@/modules/knowledge/domain/document";
import type { ReviewAnchor, ReviewComment, ReviewThread } from "@/modules/knowledge/domain/document-review";
import type { ReviewMention } from "@/modules/knowledge/domain/review-mention";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";

const NOW = new Date("2026-11-26T00:00:00.000Z");
const USER = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-000000000099";
const LINK_ID = "00000000-0000-4000-8000-000000000010";
const DOC_ID = "00000000-0000-4000-8000-000000000020";
const THREAD_ID = "00000000-0000-4000-8000-000000000030";
const COMMENT_ID = "00000000-0000-4000-8000-000000000040";
const ANCHOR: ReviewAnchor = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 0, endUtf16: 1, exact: "x", prefix: "", suffix: "" };

const comment = (overrides: Partial<ReviewComment> = {}): ReviewComment => ({
  id: COMMENT_ID, threadId: THREAD_ID, authorUserId: "author", body: "hi", createdAt: new Date(0), editedAt: null,
  deletedAt: null, idempotencyKey: "key", requestHash: "hash", visibility: "VISIBLE", hiddenBy: null, hiddenAt: null, hiddenReason: null, ...overrides,
});
const thread = (overrides: Partial<ReviewThread> = {}): ReviewThread => ({
  id: THREAD_ID, documentId: DOC_ID, createdRevisionId: "revision", createdBy: "author", creationIdempotencyKey: "key",
  creationRequestHash: "hash", originShareLinkId: null, anchor: ANCHOR, status: "OPEN", resolvedBy: null, resolvedAt: null,
  createdAt: new Date(0), updatedAt: new Date(0), visibility: "VISIBLE", hiddenBy: null, hiddenAt: null, hiddenReason: null, ...overrides,
});
const link = (overrides: Partial<DocumentShareLink> = {}): DocumentShareLink => ({
  id: LINK_ID, target: { kind: "DOCUMENT", documentId: DOC_ID }, token: "token", label: null, audience: "NAMED",
  createdBy: OWNER, createdAt: new Date(0), expiresAt: null, revokedBy: null, revokedAt: null, ...overrides,
});
const document = (overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({
  id: DOC_ID, sourceId: "source", currentRevisionId: "revision", status: "ACTIVE", createdBy: OWNER, updatedBy: OWNER,
  archivedBy: null, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
});
const mention = (overrides: Partial<ReviewMention> = {}): ReviewMention => ({
  commentId: COMMENT_ID, mentionedUserId: USER, shareLinkId: LINK_ID, createdAt: new Date(0), readAt: null, ...overrides,
});

/** One reader's mentions and the repository world a live link is judged against. */
function world() {
  const comments = new Map([[COMMENT_ID, comment()]]);
  const threads = new Map([[THREAD_ID, thread()]]);
  const links = new Map([[LINK_ID, link()]]);
  const documents = new Map([[DOC_ID, document()]]);
  const source = { id: "source", workspaceId: "workspace", name: "Source", sourceType: "HUB" as const, ownership: "HUB_MANAGED" as const, status: "ACTIVE" as "ACTIVE" | "ARCHIVED", syncVersion: 1 };
  const workspace = { id: "workspace", workspaceType: "PERSONAL", lifecycleState: "ACTIVE", personalOwnerUserId: OWNER };
  const folder = { id: "folder", nodeType: "FOLDER" as const, sourceId: "source", status: "ACTIVE" as const, parentId: null, name: "Shared" };
  type ChainNode = { id: string; nodeType: "FOLDER" | "DOCUMENT"; sourceId: string; status: "ACTIVE"; parentId: string | null; name?: string };
  // `doc` starts outside the shared folder; `other` sits inside it.
  const chains = new Map<string, ChainNode[]>([
    [DOC_ID, [{ id: "node-doc", nodeType: "DOCUMENT", sourceId: "source", status: "ACTIVE", parentId: null }]],
    ["other", [
      { id: "node-other", nodeType: "DOCUMENT", sourceId: "source", status: "ACTIVE", parentId: "folder" },
      folder,
    ]],
  ]);
  const unread: ReviewMention[] = [mention()];
  const markRead = vi.fn(async (_userId: string, commentId: string) => {
    const index = unread.findIndex(row => row.commentId === commentId);
    if (index >= 0) unread.splice(index, 1);
  });
  const listUnreadByRecipient = vi.fn(async (_userId: string, limit: number, offset = 0) => unread.slice(offset, offset + limit));
  const r = {
    reviewComments: {
      findByIds: vi.fn(async (ids: readonly string[]) => [...comments.values()].filter(row => ids.includes(row.id))),
      listByThreads: vi.fn(async (threadIds: readonly string[]) => [...comments.values()].filter(row => threadIds.includes(row.threadId))),
    },
    reviewThreads: { findByIds: vi.fn(async (ids: readonly string[]) => [...threads.values()].filter(row => ids.includes(row.id))) },
    shareLinks: {
      findByIds: vi.fn(async (ids: readonly string[]) => [...links.values()].filter(row => ids.some(id => id.toLowerCase() === row.id.toLowerCase()))),
      isRecipient: vi.fn(async () => true),
    },
    documents: { findById: vi.fn(async (id: string) => documents.get(id) ?? null) },
    sourcePolicy: { findById: vi.fn(async (id: string) => id === source.id ? source : null) },
    workspaces: { findById: vi.fn(async (id: string) => id === workspace.id ? workspace : null) },
    workspaceMemberships: { find: vi.fn(async () => ({ role: "OWNER" })) },
    tree: {
      findById: vi.fn(async (id: string) => id === folder.id ? folder : null),
      findByDocumentId: vi.fn(async (documentId: string) => chains.get(documentId)?.[0] ?? null),
      listChain: vi.fn(async (nodeId: string) => [...chains.values()].find(chain => chain[0]!.id === nodeId) ?? []),
    },
    reviewMentions: { listUnreadByRecipient, markRead },
  } as unknown as KnowledgeRepositories;
  return { r, comments, threads, links, documents, source, folder, chains, unread, markRead, listUnreadByRecipient };
}
type World = ReturnType<typeof world>;

const unreadMentions = (w: World) => {
  const service = new DocumentReviewService({} as KnowledgeUnitOfWork, () => NOW);
  const method = (service as unknown as { unreadMentions(r: KnowledgeRepositories, userId: string): Promise<ReviewMention[]> }).unreadMentions;
  return method.call(service, w.r, USER);
};

describe("unread mentions survive a reversible unreachability", () => {
  it.each<[string, (w: World) => void]>([
    ["a deleted comment", w => { w.comments.set(COMMENT_ID, comment({ deletedAt: new Date(1) })); }],
    ["a retracted thread", w => {
      w.comments.set(COMMENT_ID, comment({ deletedAt: new Date(1) }));
      w.comments.set("other", comment({ id: "other", deletedAt: new Date(2) }));
    }],
    ["a revoked link", w => { w.links.set(LINK_ID, link({ revokedAt: new Date(1) })); }],
    ["an expired link", w => { w.links.set(LINK_ID, link({ expiresAt: new Date(0) })); }],
    ["a missing comment", w => { w.comments.clear(); }],
    ["a missing thread", w => { w.threads.clear(); }],
    ["a missing link", w => { w.links.clear(); }],
    ["a missing document", w => { w.documents.clear(); }],
    ["a hidden comment whose document is missing", w => { w.comments.set(COMMENT_ID, comment({ visibility: "HIDDEN" })); w.documents.clear(); }],
  ])("marks %s read", async (_label, arrange) => {
    const w = world();
    arrange(w);
    expect(await unreadMentions(w)).toEqual([]);
    expect(w.markRead).toHaveBeenCalledWith(USER, COMMENT_ID, NOW);
  });

  it.each<[string, (w: World) => void]>([
    ["a hidden comment", w => { w.comments.set(COMMENT_ID, comment({ visibility: "HIDDEN" })); }],
    ["a hidden thread", w => { w.threads.set(THREAD_ID, thread({ visibility: "HIDDEN" })); }],
  ])("leaves %s unread, and it returns when visible again", async (_label, arrange) => {
    const w = world();
    arrange(w);
    expect(await unreadMentions(w)).toEqual([]);
    expect(w.markRead).not.toHaveBeenCalled();
    w.comments.set(COMMENT_ID, comment());
    w.threads.set(THREAD_ID, thread());
    expect(await unreadMentions(w)).toEqual([mention()]);
  });

  it("leaves a mention on a temporarily archived document unread, and returns it once restored", async () => {
    const w = world();
    w.documents.set(DOC_ID, document({ status: "ARCHIVED" }));
    expect(await unreadMentions(w)).toEqual([]);
    expect(w.markRead).not.toHaveBeenCalled();
    w.documents.set(DOC_ID, document());
    expect(await unreadMentions(w)).toEqual([mention()]);
  });

  it("leaves a mention through a folder link unread while the document is outside it, and returns it when moved back", async () => {
    const w = world();
    w.links.set(LINK_ID, link({ target: { kind: "FOLDER", folderNodeId: "folder" } }));
    w.documents.set("other", document({ id: "other" }));
    w.threads.set("thread-moved", thread({ id: "thread-moved", documentId: DOC_ID }));
    w.threads.set("thread-live", thread({ id: "thread-live", documentId: "other" }));
    w.comments.set("moved", comment({ id: "moved", threadId: "thread-moved", createdAt: new Date(2) }));
    w.comments.set("live", comment({ id: "live", threadId: "thread-live", createdAt: new Date(1) }));
    w.comments.delete(COMMENT_ID);
    w.threads.delete(THREAD_ID);
    w.unread.splice(0, w.unread.length,
      mention({ commentId: "moved", createdAt: new Date(2) }),
      mention({ commentId: "live", createdAt: new Date(1) }));
    expect((await unreadMentions(w)).map(row => row.commentId)).toEqual(["live"]);
    expect(w.markRead).not.toHaveBeenCalled();
    // Moving the document back under the shared folder makes it reachable again.
    w.chains.set(DOC_ID, [w.chains.get(DOC_ID)![0]!, w.folder]);
    expect((await unreadMentions(w)).map(row => row.commentId).sort()).toEqual(["live", "moved"]);
  });

  it("pages past hidden mentions to an older live one, without marking them read", async () => {
    const w = world();
    const hidden = Array.from({ length: 100 }, (_, index) => comment({ id: `hidden-${index}`, visibility: "HIDDEN", createdAt: new Date(1000 - index) }));
    const live = comment({ id: "live", createdAt: new Date(0) });
    for (const row of [...hidden, live]) w.comments.set(row.id, row);
    w.unread.splice(0, w.unread.length,
      ...hidden.map((row, index) => mention({ commentId: row.id, createdAt: new Date(1000 - index) })),
      mention({ commentId: live.id, createdAt: new Date(0) }));
    expect((await unreadMentions(w)).map(row => row.commentId)).toEqual(["live"]);
    expect(w.listUnreadByRecipient.mock.calls).toEqual([[USER, 100], [USER, 100, 100]]);
    expect(w.markRead).not.toHaveBeenCalled();
  });

  /** Fills the world with `count` mentions of one kind, each on its own thread, newest first. */
  const fill = (w: World, kind: "deleted" | "hidden", count: number, startAt: number) => {
    const rows: ReviewMention[] = [];
    for (let index = 0; index < count; index += 1) {
      const threadId = `thread-${kind}-${index}`;
      const commentId = `${kind}-${index}`;
      const createdAt = new Date(startAt - index);
      w.threads.set(threadId, thread({ id: threadId, documentId: DOC_ID }));
      w.comments.set(commentId, comment({ id: commentId, threadId, createdAt, ...(kind === "deleted" ? { deletedAt: new Date(1) } : { visibility: "HIDDEN" as const }) }));
      rows.push(mention({ commentId, createdAt }));
    }
    return rows;
  };

  it("returns an older live mention past a full page mixing dead and unreachable rows", async () => {
    const w = world();
    w.comments.clear();
    w.threads.clear();
    const live = comment({ id: "live", threadId: "thread-live", createdAt: new Date(0) });
    w.threads.set("thread-live", thread({ id: "thread-live", documentId: DOC_ID }));
    w.comments.set(live.id, live);
    w.unread.splice(0, w.unread.length,
      ...fill(w, "deleted", 40, 2000),
      ...fill(w, "hidden", 60, 1000),
      mention({ commentId: live.id, createdAt: new Date(0) }));
    expect((await unreadMentions(w)).map(row => row.commentId)).toEqual(["live"]);
    // Only the 40 permanently dead mentions are marked read; the hidden ones keep their unread mark.
    expect(w.markRead).toHaveBeenCalledTimes(40);
    expect(w.listUnreadByRecipient.mock.calls).toEqual([[USER, 100], [USER, 100, 60]]);
  });

  it("stops after MAX_UNREAD_PAGES pages of temporarily unreachable mentions", async () => {
    const w = world();
    w.comments.clear();
    w.threads.clear();
    const live = comment({ id: "live", threadId: "thread-live", createdAt: new Date(0) });
    w.threads.set("thread-live", thread({ id: "thread-live", documentId: DOC_ID }));
    w.comments.set(live.id, live);
    // 500 unread hidden mentions (five full pages) sit ahead of an older live one.
    w.unread.splice(0, w.unread.length, ...fill(w, "hidden", 500, 1000), mention({ commentId: live.id, createdAt: new Date(0) }));
    expect(await unreadMentions(w)).toEqual([]);
    expect(w.listUnreadByRecipient).toHaveBeenCalledTimes(5);
    expect(w.markRead).not.toHaveBeenCalled();
  });
});
