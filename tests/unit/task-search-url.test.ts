import { describe, expect, it } from "vitest";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { taskSearchHref } from "@/components/task-knowledge/task-search-url";

const base = "/w/workspace/tasks";
const filters = parseTaskSearchQuery({
  q: "安全 Login", agent: "opencode", verification: "passed", from: "2026-11-01",
  to: "2026-11-06", offset: "480", archived: "1",
});
describe("Task search URL behavior", () => {
  it("removes only the requested criterion and invalidates the cursor", () => {
    const href = taskSearchHref(base, filters, { remove: "agent" });
    expect(href).toContain("archived=1");
    expect(href).toContain("q=%E5%AE%89%E5%85%A8+Login");
    expect(href).toContain("verification=passed");
    expect(href).not.toContain("agent=");
    expect(href).not.toContain("cursor=");
  });
  it("clear all filters preserves Archived and removes UTC offset", () => {
    expect(taskSearchHref(base, filters, { clear: true })).toBe(base + "?archived=1");
  });
  it("tabs preserve filters but discard cursor", () => {
    const href = taskSearchHref(base, filters, { lifecycle: "ACTIVE" });
    expect(href).toContain("agent=opencode");
    expect(href).not.toContain("archived=1");
    expect(href).not.toContain("cursor=");
  });
  it("Older tasks retains every filter and the offset", () => {
    const href = taskSearchHref(base, filters, { cursor: "encoded" });
    expect(href).toContain("cursor=encoded");
    expect(href).toContain("offset=480");
  });
  it("removing the final date constraint also removes its offset", () => {
    const href = taskSearchHref(base, parseTaskSearchQuery({ from: "2026-11-01", offset: "480" }), { remove: "from" });
    expect(href).toBe(base);
  });
});

