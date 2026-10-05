import { beforeEach, expect, it, vi } from "vitest";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import type { applicationServices as ApplicationServices } from "@/server/composition";
vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
import { applicationServices } from "@/server/composition";
import { getSearchPageModel } from "@/server/search-read";
const listDocuments = vi.fn(), search = vi.fn();
const input = { q: "needle", scope: "workspace" as const, sourceId: null, includeArchived: false, page: 1 };
const emptyResult = { terms: ["needle"], hits: [], page: 1, hasNext: false, tooLong: false };
beforeEach(() => {
  vi.clearAllMocks(); listDocuments.mockResolvedValue([]); search.mockResolvedValue(emptyResult);
  const workspace = { id: "ws", name: "My Space", type: "PERSONAL" };
  vi.mocked(applicationServices).mockReturnValue({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner" } } }),
    workspaceAdmin: { navigation: async () => ({ items: [workspace] }), workspaceState: async () => ({ actions: { canSearch: true } }) },
    queries: { listSources: async () => [], listDocumentSummaries: listDocuments },
    search: { search }, personalPreferences: { get: async () => ({ value: { completed: true } }) },
    unitOfWork: { run: async (work: (repositories: unknown) => unknown) => work({ entries: { findByDocumentIds: async () => [] } }) },
  } as unknown as ReturnType<typeof ApplicationServices>);
});
it("detects an empty workspace before the first query without executing search", async () => {
  expect(await getSearchPageModel("ws", { ...input, q: "" })).toMatchObject({ hasDocuments: false, result: null });
  expect(search).not.toHaveBeenCalled(); expect(listDocuments).toHaveBeenCalledOnce();
});
it("uses document presence to distinguish a no-hit query from missing content", async () => {
  listDocuments.mockResolvedValue([{ documentId: "doc" }]);
  expect(await getSearchPageModel("ws", input)).toMatchObject({ hasDocuments: true });
});
it("avoids an extra document-list query for successful live search results", async () => {
  search.mockResolvedValue({ ...emptyResult, hits: [{ documentId: "doc" }] });
  await getSearchPageModel("ws", input); expect(listDocuments).not.toHaveBeenCalled();
});
it("does not inspect local content for all-workspace queries or search errors", async () => {
  await getSearchPageModel("ws", { ...input, scope: "all" });
  expect(listDocuments).not.toHaveBeenCalled();
  search.mockRejectedValueOnce(new SearchTimeoutError());
  expect(await getSearchPageModel("ws", input)).toMatchObject({ timedOut: true });
  expect(listDocuments).not.toHaveBeenCalled();
});
