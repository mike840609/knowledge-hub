import { describe, expect, it } from "vitest";
import { notificationHref, notificationLine, notificationTitle } from "@/components/knowledge/notification-href";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";

const view = (overrides: Partial<ShareCommentNotificationView> = {}): ShareCommentNotificationView => ({
  id: "e", workspaceId: "team", documentId: "doc", sourceId: "source", documentTitle: "Team document",
  threadId: "thread", commentId: "comment", authorName: "Ann", excerpt: "Looks good",
  createdAt: new Date(0), readAt: null, threadStatus: "OPEN", ...overrides,
});

describe("team Inbox entries", () => {
  it("a team creator's entry opens the team document at its discussion", () => {
    const entry = view({ kind: "OWNER", access: { kind: "TEAM", available: true } });
    expect(notificationHref(entry)).toBe("/w/team/knowledge/source/doc?thread=thread");
    expect(notificationHref(entry)).not.toContain("/s/");
    expect(notificationTitle(entry)).toBe("Team document");
    expect(notificationLine(entry)).toBe("Ann: Looks good");
  });

  it("a team mention opens the team document and carries no share token", () => {
    const entry = view({ kind: "MENTION", access: { kind: "TEAM", available: true } });
    expect(entry.token).toBeUndefined();
    expect(notificationHref(entry)).toBe("/w/team/knowledge/source/doc?thread=thread");
    expect(notificationHref(entry)).not.toContain("/s/");
    expect(notificationTitle(entry)).toBe("Team document");
  });

  it("an unavailable team entry names nothing and leads nowhere", () => {
    const entry = view({
      kind: "OWNER", workspaceId: "", documentId: "", sourceId: "", documentTitle: "",
      authorName: undefined, excerpt: "", access: { kind: "TEAM", available: false },
    });
    expect(notificationHref(entry)).toBeNull();
    expect(notificationLine(entry)).toBe("This discussion is no longer available.");
    expect(notificationTitle(entry)).toBe("A team discussion");
  });

  it("a team entry that is available but has no ids leads nowhere", () => {
    const entry = view({ kind: "MENTION", workspaceId: "", documentId: "", sourceId: "", access: { kind: "TEAM", available: true } });
    expect(notificationHref(entry)).toBeNull();
  });

  it("an explicit share-link access keeps opening the shared page", () => {
    const entry = view({ kind: "MENTION", token: "tok", linkAvailable: true, documentId: "", access: { kind: "SHARE_LINK" } });
    expect(notificationHref(entry)).toBe("/s/tok?thread=thread");
  });

  it("an old personal entry without access is unchanged", () => {
    expect(notificationHref(view({ kind: "OWNER" }))).toBe("/w/team/knowledge/source/doc?thread=thread");
    expect(notificationHref(view({ kind: "FOLLOW", token: "tok", linkAvailable: true, documentId: "" }))).toBe("/s/tok?thread=thread");
  });
});
