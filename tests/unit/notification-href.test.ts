import { describe, expect, it } from "vitest";
import { notificationHref, notificationLine, notificationTitle } from "@/components/knowledge/notification-href";
import { shareDiscussionHref } from "@/lib/share-paths";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

const view = (overrides: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "e", workspaceId: "w", documentId: "d", sourceId: "s", documentTitle: "Doc", threadId: "t", commentId: "c",
  authorName: "Ann", excerpt: "Looks good", createdAt: new Date(0), readAt: null, threadStatus: "OPEN", ...overrides,
});
const shared = (overrides: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView =>
  view({ kind: "SHARED_WITH_YOU", workspaceId: "", documentId: "", sourceId: "", documentTitle: "Quarterly plan", authorName: "Dana", excerpt: "", href: "/w/me/shares/tok", linkAvailable: true, ...overrides });
const deadShared = (overrides: Partial<ShareCommentNotificationView> = {}) => shared({ linkAvailable: false, href: undefined, documentTitle: "", authorName: undefined, ...overrides });

describe("where an Inbox entry leads, and what it says", () => {
  it("an owner's notice opens the document in its Workspace at the discussion", () => {
    expect(notificationHref(view())).toBe("/w/w/knowledge/s/d?thread=t");
    expect(notificationHref(view({ kind: "OWNER" }))).toBe("/w/w/knowledge/s/d?thread=t");
    expect(notificationLine(view())).toBe("Ann: Looks good");
  });
  it("a followed or mentioning discussion opens where the server says, never a path the client builds", () => {
    for (const kind of ["FOLLOW", "MENTION"] as const) {
      const linked = view({ kind, token: "tok", linkAvailable: true, workspaceId: "", documentId: "", sourceId: "", href: "/s/tok?thread=t" });
      expect(notificationHref(linked)).toBe("/s/tok?thread=t");
      expect(notificationHref({ ...linked, href: "/w/ws/shares/tok?thread=t" })).toBe("/w/ws/shares/tok?thread=t");
      // A token alone is no destination: the server decides whether it is read on /s/ or in the Hub.
      expect(notificationHref({ ...linked, href: undefined })).toBeNull();
    }
    expect(notificationLine(view({ kind: "FOLLOW", token: "tok", linkAvailable: true, replyCount: 1, href: "/s/tok?thread=t" }))).toBe("Ann: Looks good");
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
  it("a named share says who shared it, opens the reader, and never repeats the title", () => {
    expect(notificationTitle(shared())).toBe("Quarterly plan");
    expect(notificationHref(shared())).toBe("/w/me/shares/tok");
    expect(notificationLine(shared())).toBe("Dana shared this with you");
    expect(notificationLine(shared({ authorName: undefined }))).toBe("Someone shared this with you");
    expect(notificationLine(shared({ documentTitle: "" }))).toBe("Dana shared this with you");
  });
  it("a dead named share names a shared document and says it is gone", () => {
    expect(notificationTitle(deadShared())).toBe("A shared document");
    expect(notificationTitle(deadShared({ targetKind: "FOLDER" }))).toBe("A shared folder");
    expect(notificationTitle(deadShared({ targetKind: "SOURCE" }))).toBe("A shared source");
    expect(notificationHref(deadShared())).toBeNull();
    expect(notificationLine(deadShared())).toBe("This link is no longer available.");
  });
  it("no line uses the title's old double angle brackets", () => {
    const lines = [shared(), shared({ authorName: undefined }), deadShared(), view(), view({ kind: "FOLLOW", linkAvailable: false })]
      .map(notificationLine);
    for (const line of lines) expect(line).not.toContain("《");
  });
});

describe("where a discussion read through a share opens (shareDiscussionHref)", () => {
  const d = "0192f3a4-0000-7000-8000-000000000002";
  it("a LINK share opens its anonymous page exactly as before", () => {
    expect(shareDiscussionHref({ audience: "LINK", token: "tok" }, "ws", "t")).toBe("/s/tok?thread=t");
    expect(shareDiscussionHref({ audience: "LINK", token: "tok" }, "ws", "t", d)).toBe(`/s/tok?d=${d}&thread=t`);
    expect(shareDiscussionHref({ audience: "LINK", token: "tok" }, null, "t")).toBe("/s/tok?thread=t");
  });
  it("a NAMED share opens the Hub reader in the reader's own Workspace, at the discussion", () => {
    expect(shareDiscussionHref({ audience: "NAMED", token: "tok" }, "ws", "t")).toBe("/w/ws/shares/tok?thread=t");
    expect(shareDiscussionHref({ audience: "NAMED", token: "tok" }, "ws", "t", d)).toBe(`/w/ws/shares/tok?d=${d}&thread=t`);
  });
  it("a NAMED share has nowhere to open for a reader without a personal Workspace", () => {
    expect(shareDiscussionHref({ audience: "NAMED", token: "tok" }, null, "t")).toBeNull();
  });
});
