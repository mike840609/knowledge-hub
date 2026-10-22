import { describe, expect, it } from "vitest";
import { notificationHref, notificationLine } from "@/components/knowledge/notification-href";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

const view = (overrides: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "e", workspaceId: "w", documentId: "d", sourceId: "s", documentTitle: "Doc", threadId: "t", commentId: "c",
  authorName: "Ann", excerpt: "Looks good", createdAt: new Date(0), readAt: null, threadStatus: "OPEN", ...overrides,
});

describe("where an Inbox entry leads, and what it says", () => {
  it("an owner's notice opens the document in its Workspace at the discussion", () => {
    expect(notificationHref(view())).toBe("/w/w/knowledge/s/d?thread=t");
    expect(notificationHref(view({ kind: "OWNER" }))).toBe("/w/w/knowledge/s/d?thread=t");
    expect(notificationLine(view())).toBe("Ann: Looks good");
  });
  it("a followed discussion opens the shared page it was followed through", () => {
    const follow = view({ kind: "FOLLOW", token: "tok", linkAvailable: true, replyCount: 1, workspaceId: "", documentId: "", sourceId: "" });
    expect(notificationHref(follow)).toBe("/s/tok?thread=t");
    expect(notificationLine(follow)).toBe("Ann: Looks good");
  });
  it("several new replies say how many", () => {
    expect(notificationLine(view({ kind: "FOLLOW", token: "tok", linkAvailable: true, replyCount: 3 }))).toBe("3 new replies · Ann: Looks good");
  });
  it("a dead link leads nowhere and says only that", () => {
    const dead = view({ kind: "FOLLOW", linkAvailable: false, token: undefined, authorName: undefined, excerpt: "", documentTitle: "" });
    expect(notificationHref(dead)).toBeNull();
    expect(notificationLine(dead)).toBe("This link is no longer available.");
  });
  it("an author without a name is someone", () => {
    expect(notificationLine(view({ authorName: undefined }))).toBe("Someone: Looks good");
  });
});
