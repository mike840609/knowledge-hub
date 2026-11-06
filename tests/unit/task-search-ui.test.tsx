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
    expect(html).not.toContain("⌘K");
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
    expect(html).toContain("Fix Task Index");
    expect(html).toContain("Safety and indexing details");
    expect(html).toContain("Agent-reported");
    expect(html).toContain("revision 2");
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

