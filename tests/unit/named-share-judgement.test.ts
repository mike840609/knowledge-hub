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
  const markRecipientRead = vi.fn(async () => undefined);
  const shareLinks = { listForRecipient: async () => rows, listUnreadForRecipient: async () => rows.filter(row => row.readAt === null), markRecipientRead };
  const r = { shareLinks, documents: { findById } } as unknown as KnowledgeRepositories;
  return { r, findById, markRecipientRead };
}

describe("judging the shares that name a reader", () => {
  it("the unread list and badge judge only the shares not yet read, and mark a dead one read", async () => {
    const { r, findById, markRecipientRead } = repositories();
    const now = new Date();
    expect(await judgeNamedShares(r, "u", 100, now, true)).toEqual([]);
    expect(findById.mock.calls).toEqual([["unread-doc"]]);
    expect(markRecipientRead).toHaveBeenCalledTimes(1);
    expect(markRecipientRead.mock.calls[0]).toEqual([undefined, "u", now]);
  });

  it("the activity view and Shares page still judge every share", async () => {
    const { r, findById } = repositories();
    expect(await judgeNamedShares(r, "u", 100, new Date())).toHaveLength(2);
    expect(findById.mock.calls).toEqual([["read-doc"], ["unread-doc"]]);
  });
});
