import { describe, expect, it, vi } from "vitest";
import { judgeNamedShares, namedShareTitle, openNamedTarget } from "@/modules/knowledge/application/internal/named-share-judgement";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { DocumentShareLink } from "@/modules/knowledge/domain/document-share-link";
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
  it("uses a Source name as its title", async () => {
    expect(await namedShareTitle({} as KnowledgeRepositories, {} as CallerContext, { sourceName: "Notes" })).toBe("Notes");
  });

  it("refuses a missing Source", async () => {
    const r = { shareLinks: { isRecipient: async () => true }, sourcePolicy: { findById: async () => null } } as unknown as KnowledgeRepositories;
    const link = { id: "link", audience: "NAMED", target: { kind: "SOURCE", sourceId: "missing" } } as DocumentShareLink;
    expect(await openNamedTarget(r, link, "00000000-0000-4000-8000-000000000001", new Date())).toBeNull();
  });
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
