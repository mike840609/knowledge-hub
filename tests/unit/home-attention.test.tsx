import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionList, type HomeNotice } from "@/components/knowledge/home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

const reminder = (status: FreshnessReminder["status"], sourceId = "s1"): FreshnessReminder => ({ sourceId, sourceName: `Folder ${sourceId}`, status, previewId: status === "pending" ? "p1" : null, lastImportedAt: null });
const notice = { id: "n1", workspaceId: "ws", sourceId: "s", documentId: "d", threadId: "t1", documentTitle: "Plan", authorName: "Ana", excerpt: "Looks good", createdAt: "2026-10-18T00:00:00.000Z" } as unknown as HomeNotice;
const render = (reminders: FreshnessReminder[], notices: HomeNotice[]) =>
  renderToStaticMarkup(<AttentionList workspaceId="ws" reminders={reminders} notices={notices} />);

describe("AttentionList", () => {
  it("renders nothing when nothing needs the user", () => {
    expect(render([], [])).toBe("");
  });

  it("names the region and links to all updates when it has items", () => {
    const html = render([reminder("old")], []);
    expect(html).toContain('aria-label="Needs attention"');
    expect(html).toContain('href="/w/ws/updates"');
    expect(html).toContain("View all updates");
  });

  it("lists unread comments with an accent dot and a link to the thread", () => {
    const html = render([], [notice]);
    expect(html).toContain('aria-label="Unread discussions"');
    expect(html).toContain('href="/w/ws/knowledge/s/d?thread=t1"');
    expect(html).toContain("bg-kh-primary");
    expect(html).toContain("Ana: Looks good");
    expect(html).toContain("data-list-row");
  });

  it("keeps a failed import in warning tokens, not the accent", () => {
    const html = render([reminder("failed")], []);
    expect(html).toContain("Import failed · Retry import");
    expect(html).toContain("text-kh-warning");
    expect(html).not.toContain("bg-kh-primary");
  });

  it("sends several reminders to the sources list", () => {
    const html = render([reminder("old", "a"), reminder("never", "b")], []);
    expect(html).toContain("2 sources need attention");
    expect(html).toContain('href="/w/ws/sources"');
  });
});
