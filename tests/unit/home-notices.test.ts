import { describe, expect, it } from "vitest";
import { unreadHomeNotices } from "@/server/home-notices";
import type { CallerContext } from "@/modules/identity/domain/caller-context";

const caller = {} as CallerContext;
const view = { id: "n1", workspaceId: "ws", documentId: "d", sourceId: "s", documentTitle: "Plan", threadId: "t", commentId: "c", authorName: "Ana", excerpt: "Hi", createdAt: new Date("2026-10-18T00:00:00.000Z"), readAt: null, threadStatus: "OPEN" as const };

describe("unreadHomeNotices", () => {
  it("serialises dates for the client", async () => {
    const result = await unreadHomeNotices({ listUnreadForOwner: async () => ({ notifications: [view] }) } as never, caller);
    expect(result).toEqual([{ ...view, createdAt: "2026-10-18T00:00:00.000Z", readAt: null }]);
  });

  it("yields none when the service throws, so Home still renders", async () => {
    const result = await unreadHomeNotices({ listUnreadForOwner: async () => { throw new Error("db down"); } } as never, caller);
    expect(result).toEqual([]);
  });
});
