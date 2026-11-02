import { describe, expect, it, vi } from "vitest";
import { judgeNamedShares } from "@/modules/knowledge/application/internal/named-share-judgement";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";

/** Two named shares, one already read; neither document exists, so each judgement is one document read. */
function repositories() {
  const addedAt = new Date(0);
  const rows = [
    { link: { target: { kind: "DOCUMENT", documentId: "read-doc" } }, addedAt, readAt: new Date(1) },
    { link: { target: { kind: "DOCUMENT", documentId: "unread-doc" } }, addedAt, readAt: null },
  ];
  const findById = vi.fn(async () => null);
  const r = { shareLinks: { listForRecipient: async () => rows }, documents: { findById } } as unknown as KnowledgeRepositories;
  return { r, findById };
}

describe("judging the shares that name a reader", () => {
  it("the unread list and badge judge only the shares not yet read", async () => {
    const { r, findById } = repositories();
    const judged = await judgeNamedShares(r, "u", 100, new Date(), true);
    expect(judged.map(share => share.readAt)).toEqual([null]);
    expect(findById.mock.calls).toEqual([["unread-doc"]]);
  });

  it("the activity view and Shares page still judge every share", async () => {
    const { r, findById } = repositories();
    expect(await judgeNamedShares(r, "u", 100, new Date())).toHaveLength(2);
    expect(findById.mock.calls).toEqual([["read-doc"], ["unread-doc"]]);
  });
});
