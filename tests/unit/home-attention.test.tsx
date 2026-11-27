import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionList, UnreadDiscussions, type HomeNotice } from "@/components/knowledge/home-attention";
import type { FreshnessReminder } from "@/modules/personal/application/knowledge-freshness";

const reminder = (status: FreshnessReminder["status"], sourceId = "s1"): FreshnessReminder => ({ sourceId, sourceName: `Folder ${sourceId}`, status, previewId: status === "pending" ? "p1" : null, lastImportedAt: null });
const notice = { id: "n1", workspaceId: "ws", sourceId: "s", documentId: "d", threadId: "t1", documentTitle: "Plan", authorName: "Ana", excerpt: "Looks good", createdAt: "2026-10-18T00:00:00.000Z" } as unknown as HomeNotice;
const render = (reminders: FreshnessReminder[]) =>
  renderToStaticMarkup(<AttentionList workspaceId="ws" reminders={reminders} />);

describe("AttentionList", () => {
  it("renders nothing when nothing needs the user", () => {
    expect(render([])).toBe("");
  });

  it("names the region and links to all updates when it has items", () => {
    const html = render([reminder("old")]);
    expect(html).toContain('aria-label="Needs attention"');
    expect(html).toContain('href="/w/ws/updates"');
    expect(html).toContain("View all updates");
  });

  it("marks a failed import with the warning colour in its icon only, not the accent", () => {
    const html = render([reminder("failed")]);
    expect(html).toContain(">Import failed<");
    expect(html).toContain("Retry");
    expect(html).toMatch(/<svg[^>]*class="[^"]*text-kh-warning/);
    expect(html.match(/text-kh-warning/g)).toHaveLength(1);
    expect(html).not.toContain("bg-kh-primary");
  });

  it("is rows under a label, not a bordered panel, and a stale source stays neutral", () => {
    const html = render([reminder("old")]);
    expect(html).not.toContain("border-kh-border");
    expect(html).toContain(">Check for folder updates<");
    expect(html).not.toContain("text-kh-warning");
  });

  it("sends several reminders to the sources list", () => {
    const html = render([reminder("old", "a"), reminder("never", "b")]);
    expect(html).toContain("2 sources need attention");
    expect(html).toContain('href="/w/ws/sources"');
  });
});

describe("UnreadDiscussions", () => {
  it("renders nothing without unread comments", () => {
    expect(renderToStaticMarkup(<UnreadDiscussions notices={[]} />)).toBe("");
  });

  it("lists unread comments with an accent dot and a link to the thread", () => {
    const html = renderToStaticMarkup(<UnreadDiscussions notices={[notice]} />);
    expect(html).toContain('aria-label="Unread discussions"');
    expect(html).toContain('href="/w/ws/knowledge/s/d?thread=t1"');
    expect(html).toContain("bg-kh-primary");
    expect(html).toContain("Ana: Looks good");
    expect(html).toContain("data-list-row");
  });

  it("shows at most five comments", () => {
    const many = Array.from({ length: 7 }, (_, n) => ({ ...notice, id: `n${n}` }));
    expect(renderToStaticMarkup(<UnreadDiscussions notices={many} />).match(/data-list-row/g)).toHaveLength(5);
  });
});

// Launcher audit (WCAG 2.5.8, target size): the caption link was 16px tall — smaller than a
// pointer can reliably hit. It is not inside a sentence, so the inline exception does not apply.
describe("the all-updates link's target", () => {
  it("is at least 24px tall", () => {
    expect(render([reminder("old")])).toMatch(/<a[^>]*class="[^"]*min-h-6[^"]*"[^>]*>View all updates</);
  });
});
