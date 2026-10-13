import { describe, it, expect } from "vitest";
import { projectShareCommentNotification } from "@/modules/knowledge/domain/share-comment-event";
describe("projectShareCommentNotification", () => {
  it("truncates the body excerpt to 80 characters", () => {
    const view = projectShareCommentNotification({
      id: "e1", workspaceId: "w1", documentId: "d1", documentTitle: "Doc",
      threadId: "t1", commentId: "c1", authorName: "Reviewer",
      body: "x".repeat(200), createdAt: new Date("2026-10-13T00:00:00Z"),
    });
    expect(view.excerpt).toBe("x".repeat(80));
    expect(view.excerpt.length).toBe(80);
  });
  it("keeps short bodies intact", () => {
    const view = projectShareCommentNotification({
      id: "e1", workspaceId: "w1", documentId: "d1", documentTitle: "Doc",
      threadId: "t1", commentId: "c1", authorName: "Reviewer",
      body: "hello", createdAt: new Date("2026-10-13T00:00:00Z"),
    });
    expect(view.excerpt).toBe("hello");
  });
});
