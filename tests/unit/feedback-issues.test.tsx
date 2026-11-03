import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedbackIssues } from "@/components/knowledge/feedback-issues";
import type { FeedbackIssuePage, FeedbackIssueView } from "@/modules/personal/application/feedback-report-query-service";

function view(overrides: Partial<FeedbackIssueView> = {}): FeedbackIssueView {
  return {
    id: "0199f400-0000-7000-8000-000000000001", empId: "E2E-0909", userName: "E2E Knowledge User",
    category: "Sync", description: "Preview failed", pagePath: "/w/x/sources",
    status: "OPEN", createdAt: "2026-11-03T00:00:00.000Z", isMine: true, ...overrides,
  };
}
function render(items: FeedbackIssueView[], filtered = false): string {
  const page: FeedbackIssuePage = { items, nextCursor: null };
  return renderToStaticMarkup(<FeedbackIssues page={page} filtered={filtered} />);
}

describe("FeedbackIssues", () => {
  it("shows status, category, reporter, employee id, path and the reader's own marker", () => {
    const html = render([view()]);
    expect(html).toContain("Open");
    expect(html).toContain("Sync");
    expect(html).toContain("E2E Knowledge User");
    expect(html).toContain("E2E-0909");
    expect(html).toContain("/w/x/sources");
    expect(html).toContain("You");
  });

  it("collapses a long, multi-line description behind a disclosure", () => {
    const long = render([view({ description: `${"step one\nstep two\n".repeat(60)}`.slice(0, 5000) })]);
    expect(long).toContain("<details");
    expect(long).toContain("Show the full report");
    expect(render([view()])).not.toContain("<details");
  });

  it("renders a hostile reporter name as text", () => {
    const html = render([view({ userName: "<script>alert(1)</script>", empId: "<b>X</b>" })]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("says when there is nothing to show, filtered or not", () => {
    expect(render([], false)).toContain("No reports yet");
    expect(render([], true)).toContain("No reports match these filters");
  });
});
