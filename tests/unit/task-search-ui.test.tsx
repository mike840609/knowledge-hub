import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { TaskSearchForm } from "@/components/task-knowledge/task-search-form";
import { TaskSearchResults } from "@/components/task-knowledge/task-search-results";

describe("Tasks-only compact search UI", () => {
  it("keeps a native accessible GET form and selected filter chips", () => {
    const query = parseTaskSearchQuery({ q: "安全", agent: "opencode", verification: "passed", archived: "1" });
    const html = renderToStaticMarkup(<TaskSearchForm workspaceId="ws" query={query} />);
    expect(html).toContain('method="get"');
    expect(html).toContain('type="search"');
    expect(html).toContain('name="agent"');
    expect(html).toContain('name="verification"');
    expect(html).toContain('name="from"');
    expect(html).toContain('name="to"');
    expect(html).toContain("Clear all");
    expect(html).toContain("Search tasks");
    expect(html).toContain("kh-search-field");
    expect(html).toContain("kh-select"); // native form controls work without JS
    expect(html).toContain("border-kh-border-strong");
    expect(html).toContain("bg-kh-bg-selected"); // shared lavender chip
    expect(html).not.toContain("⌘K");
  });
  it("expands Completed dates when either date filter is already active", () => {
    for (const input of [{ from: "2026-11-01" }, { to: "2026-11-06" }]) {
      const html = renderToStaticMarkup(
        <TaskSearchForm workspaceId="ws" query={parseTaskSearchQuery(input)} />,
      );
      expect(html).toMatch(/<details\s+open=""/);
    }
    const empty = renderToStaticMarkup(
      <TaskSearchForm workspaceId="ws" query={parseTaskSearchQuery({})} />,
    );
    expect(empty).not.toMatch(/<details\s+open/);
  });

  it("safely ignores empty and whitespace terms when highlighting", () => {
    const query = { ...parseTaskSearchQuery({ q: "安全" }), terms: ["", "   ", "安全"] };
    const html = renderToStaticMarkup(
      <TaskSearchResults workspaceId="ws" query={query}
        items={[{
          taskResultId: "task-1", title: "安全 update", summary: "安全 review summary",
          agent: "opencode", completedAt: "2026-11-06T08:00:00Z",
          verificationStatus: "passed", latestRevisionNo: 1, bindingLabel: "laptop", bindingStatus: "ACTIVE",
        }]} nextCursor={null} hasTasksInLifecycle={true} />,
    );
    expect(html).toContain("<mark");
    expect(html).toContain("安全");
    expect(html).toContain("review summary");
    expect(html).not.toContain("<mark></mark>");
  });

  it("shows no chips when no criteria are selected", () => {
    const html = renderToStaticMarkup(<TaskSearchForm workspaceId="ws" query={parseTaskSearchQuery({})} />);
    expect(html).not.toContain("Clear all");
  });
  it("renders a compact two-line summary and truthful page count", () => {
    const html = renderToStaticMarkup(
      <TaskSearchResults workspaceId="ws" query={parseTaskSearchQuery({})}
        items={[{
          taskResultId: "task-1", title: "Fix Task Index", summary: "Safety and indexing details",
          agent: "opencode", completedAt: "2026-11-06T08:00:00Z",
          verificationStatus: "passed", latestRevisionNo: 2, bindingLabel: "laptop", bindingStatus: "ACTIVE",
        }]} nextCursor={null} hasTasksInLifecycle={true} />,
    );
    expect(html).toContain("Showing 1 task");
    expect(html).toContain("kh-tab-list");
    expect(html).toContain("border-kh-primary");
    expect(html).toContain("data-list-row");
    expect(html).toContain('data-status-kind="success"');
    expect(html).toContain("Fix Task Index");
    expect(html).toContain("Safety and indexing details");
    expect(html).toContain("Agent-reported");
    expect(html).toContain("revision 2");
  });
  it("renders the server's preview without trimming its leading context again", () => {
    const html = renderToStaticMarkup(
      <TaskSearchResults workspaceId="ws" query={parseTaskSearchQuery({ q: "security" })}
        items={[{
          taskResultId: "task-1", title: "Security review", summary: "…Checked the security audit",
          agent: "opencode", completedAt: "2026-11-06T08:00:00Z",
          verificationStatus: "passed", latestRevisionNo: 1, bindingLabel: "laptop", bindingStatus: "ACTIVE",
        }]} nextCursor={null} hasTasksInLifecycle={true} />,
    );
    expect(html).toContain("Checked the");
    expect(html).toContain("<mark");
  });
  it("shows a retryable timeout instead of an incorrect empty-state claim", () => {
    const html = renderToStaticMarkup(
      <TaskSearchResults workspaceId="ws" query={parseTaskSearchQuery({q: "安全"})}
        items={[]} nextCursor={null} hasTasksInLifecycle={true}
        error="Task search timed out. Try again or narrow the filters." />,
    );
    expect(html).toContain("Task search timed out");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No matching tasks");
  });

  it("distinguishes no matches from a genuinely empty My Space", () => {
    const query = parseTaskSearchQuery({ q: "none" });
    const props = { workspaceId: "ws", query, items: [], nextCursor: null };
    const noMatches = renderToStaticMarkup(<TaskSearchResults {...props} hasTasksInLifecycle={true} />);
    const neverExported = renderToStaticMarkup(<TaskSearchResults {...props} hasTasksInLifecycle={false} />);
    expect(noMatches).toContain("No matching tasks");
    expect(noMatches).toContain("Clear filters");
    expect(neverExported).toContain("No tasks yet");
    expect(neverExported).toContain("Set up task export");
  });
});

