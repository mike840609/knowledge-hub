import { describe, expect, it, vi } from "vitest";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";

const caller = callerFromIdentity({ id: "0199f600-0000-7000-8000-000000000010", emp_id: "ORDER", name: "Ann", org_code: "ORDER" });
const workspaceId = "0199f600-0000-7000-8000-000000000020";
const documentId = "0199f600-0000-7000-8000-000000000030";
const threadId = "0199f600-0000-7000-8000-000000000040";
const commentId = "0199f600-0000-7000-8000-000000000050";

/**
 * The team mention is inaccessible, so its body must never be read. These bodies throw if the
 * service loads comments before judging `document.read`.
 */
function repositories(): KnowledgeRepositories {
  // Follows are empty here, so an empty batch is not a body read; a non-empty one must never happen.
  const bodyLoaded = (ids: readonly string[]): Promise<never[]> => {
    if (ids.length === 0) return Promise.resolve([]);
    throw new Error("a comment body was read before access was judged");
  };
  return {
    shareCommentEvents: { listRecentByRecipient: vi.fn().mockResolvedValue([]) },
    reviewFollows: { listFollowing: vi.fn().mockResolvedValue([]) },
    reviewMentions: {
      listRecentByRecipient: vi.fn().mockResolvedValue([
        { commentId, mentionedUserId: caller.identity.id, shareLinkId: null, createdAt: new Date(0), readAt: null },
      ]),
      findByThreads: vi.fn().mockResolvedValue([]),
    },
    reviewComments: {
      listThreadIdsByCommentIds: vi.fn().mockResolvedValue([{ commentId, threadId }]),
      findByIds: vi.fn(bodyLoaded),
      listByThreads: vi.fn(bodyLoaded),
    },
    reviewThreads: {
      findByIds: vi.fn().mockResolvedValue([
        { id: threadId, documentId, visibility: "VISIBLE", status: "OPEN", createdAt: new Date(0), updatedAt: new Date(0) },
      ]),
    },
    shareLinks: { findByIds: vi.fn().mockResolvedValue([]) },
    documents: {
      findById: vi.fn().mockResolvedValue({
        id: documentId, sourceId: "0199f600-0000-7000-8000-000000000060", status: "ACTIVE", currentRevisionId: null,
      }),
    },
    sourcePolicy: {
      findById: vi.fn().mockResolvedValue({
        id: "0199f600-0000-7000-8000-000000000060", workspaceId, sourceType: "PUBLICATION", status: "ACTIVE",
      }),
      findPublicationDocument: vi.fn().mockResolvedValue(null),
    },
    workspaces: {
      findById: vi.fn().mockResolvedValue({
        id: workspaceId, workspaceType: "TEAM", lifecycleState: "ACTIVE", personalOwnerUserId: null,
      }),
    },
  } as unknown as KnowledgeRepositories;
}

describe("team mention access is judged before its body is read", () => {
  it("produces the opaque payload without loading an inaccessible mention's comment body", async () => {
    const repos = repositories();
    const uow = { run: <T,>(work: (r: KnowledgeRepositories) => Promise<T>) => work(repos) } as KnowledgeUnitOfWork;
    const service = new DocumentReviewService(uow, undefined, () => true, () => true);

    const page = await service.listActivityForOwner(caller);

    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]).toMatchObject({
      id: `mention:${commentId}`, kind: "MENTION", access: { kind: "TEAM", available: false },
      workspaceId: "", documentId: "", sourceId: "", documentTitle: "", excerpt: "", authorName: undefined,
    });
    expect(page.notifications[0].token).toBeUndefined();
    expect(repos.reviewComments.findByIds).not.toHaveBeenCalled();
    // The empty follow scan may ask for an empty batch; no real thread may ever be read for a body.
    expect(vi.mocked(repos.reviewComments.listByThreads).mock.calls.flatMap(call => call[0])).toEqual([]);
  });
});
