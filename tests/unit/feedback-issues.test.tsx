import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedbackIssues } from "@/components/knowledge/feedback-issues";
import type { FeedbackIssueView } from "@/modules/personal/application/feedback-report-query-service";

function view(overrides: Partial<FeedbackIssueView> = {}): FeedbackIssueView {
  return {
    id: "0199f400-0000-7000-8000-000000000001", empId: "E2E-0909", userName: "E2E Knowledge User",
    category: "Sync", description: "Preview failed", pagePath: "/w/x/sources",
    status: "OPEN", createdAt: "2026-11-03T00:00:00.000Z", isMine: true, ...overrides,
  };
}
function render(items: FeedbackIssueView[], filtered = false): string {
  return renderToStaticMarkup(<FeedbackIssues items={items} filtered={filtered} />);
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

  it("keeps only the uncovered tail inside the disclosure, so the opening is not repeated", () => {
    const opening = "x".repeat(280);
    const marker = "TAIL-MARKER-9F3";
    const html = render([view({ description: `${"x".repeat(400)}${marker}` })]);
    // The preview carries the opening once; the disclosure carries only what is left.
    expect(html.split(opening)).toHaveLength(2);
    expect(html.split(marker)).toHaveLength(2);
    expect(html.slice(html.indexOf("<details"))).toContain(marker);
    expect(html).toContain(">Show the full report</summary>");
  });

  it("previews by code point, so a long emoji run never splits a character", () => {
    const html = render([view({ description: "😀".repeat(300) })]);
    expect(html).not.toContain("\uFFFD");
    expect(html.match(/😀/g)).toHaveLength(300);
    expect(html.split("😀".repeat(280))).toHaveLength(2);
  });

  it("lets a long unbroken path and description wrap inside their column", () => {
    const html = render([view({ pagePath: `/w/x/${"a".repeat(1024)}` })]);
    expect(html.match(/break-words/g)).toHaveLength(2);
  });

  it("renders a hostile reporter name as text", () => {
    const html = render([view({ userName: "<script>alert(1)</script>", empId: "<b>X</b>" })]);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("says when there is nothing to show, filtered or not", () => {
    expect(render([])).toContain("No reports yet");
    expect(render([], true)).toContain("No reports match these filters");
  });
});
