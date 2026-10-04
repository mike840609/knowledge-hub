import { expect, it, vi } from "vitest";
import { parseSearchFilters } from "@/modules/knowledge/domain/search-filters";
import { MariaDbKnowledgeSearchRepository } from "@/infrastructure/database/mariadb/repositories/knowledge-search";
it("treats inclusive calendar dates in the selected UTC offset as a half-open instant range", () => {
  const f = parseSearchFilters({ path: "docs/", from: "2026-10-04", to: "2026-10-04", offset: "480", sort: "newest" });
  expect(f.path).toBe("docs");
  expect(f.updatedFrom?.toISOString()).toBe("2026-10-03T16:00:00.000Z");
  expect(f.updatedBefore?.toISOString()).toBe("2026-10-04T16:00:00.000Z");
});
it.each([{ from: "2026-02-30" }, { path: "../docs" }, { from: "2026-10-04", to: "2026-10-03" }, { offset: "NaN" }, { sort: "injected" }])("rejects invalid filters %j", input => expect(() => parseSearchFilters(input)).toThrow());
it("allows filter-only search and parameterizes literal path metacharacters", async () => {
  const query = vi.fn(async () => []);
  await new MariaDbKnowledgeSearchRepository({ query } as unknown as import("@/infrastructure/database/mariadb/repositories/shared").QueryConnection).search({ terms: [], workspaceIds: ["ws"], sourceId: null, includeArchived: false, limit: 21, offset: 0, filters: parseSearchFilters({ path: "doc%_!", sort: "oldest" }) });
  expect(query).toHaveBeenCalledOnce();
  const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain("r.created_at ASC");
  expect(sql).not.toContain("doc%_!");
  expect(params).toContain("doc!%!_!!/%");
});
