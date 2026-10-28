import { expect, it, vi } from "vitest";
import { PersonalService } from "@/modules/personal/application/personal-service";

const userId = "0199f500-0000-7000-8000-0000000005a2";
const workspaceId = "0199f500-0000-7000-8000-0000000005a1";
const caller = { identity: { id: userId }, validatedExternalGroupIds: [] } as never;
const uow = {
  run: async (work: (repositories: unknown) => unknown) => work({
    workspaceMemberships: { find: async () => ({ role: "OWNER" }) },
    workspaces: { findById: async () => ({ personalOwnerUserId: userId }) },
  }),
};
const item = (key: string) => ({ key, value: { favorite: true }, version: 1, updatedAt: "2026-10-24T00:00:00.000Z" });
const favorite = (id: string) => item(`favorite:${id}`);
/** `locateDocuments` as the query service answers it: unreadable IDs are simply absent. */
const locating = (where: Record<string, { sourceId: string; workspaceId: string }>) =>
  vi.fn(async (_caller: unknown, ids: readonly string[]) => new Map(ids.filter(id => id in where).map(id => [id, where[id]])));

it("locates every favorite in one call instead of reading each document", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("doc1"), favorite("doc2")]), list: vi.fn() };
  const queries = {
    locateDocuments: locating({ doc1: { sourceId: "src1", workspaceId }, doc2: { sourceId: "src2", workspaceId } }),
    getDocument: vi.fn(),
    listDocumentSummaries: vi.fn(),
  };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([
    { key: "favorite:doc1", sourceId: "src1" },
    { key: "favorite:doc2", sourceId: "src2" },
  ]);
  expect(store.list).not.toHaveBeenCalled();
  expect(queries.getDocument).not.toHaveBeenCalled();
  expect(queries.listDocumentSummaries).not.toHaveBeenCalled();
  expect(queries.locateDocuments).toHaveBeenCalledTimes(1);
  expect(queries.locateDocuments).toHaveBeenCalledWith(caller, ["doc1", "doc2"], { includeArchived: true });
});

it("keeps a favorite for an archived document", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("archived")]) };
  const queries = { locateDocuments: locating({ archived: { sourceId: "src1", workspaceId } }) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([{ key: "favorite:archived", sourceId: "src1" }]);
  expect(queries.locateDocuments).toHaveBeenCalledWith(caller, ["archived"], { includeArchived: true });
});

it("drops a favorite whose document is gone or unreadable", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("missing")]) };
  const queries = { locateDocuments: locating({}) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
});

it("drops a favorite whose document belongs to another workspace", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("foreign")]) };
  const queries = { locateDocuments: locating({ foreign: { sourceId: "src2", workspaceId: "other" } }) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
});

it("asks nothing of the query service when there are no favorites", async () => {
  const store = { listFavorites: vi.fn(async () => []) };
  const queries = { locateDocuments: vi.fn() };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
  expect(queries.locateDocuments).not.toHaveBeenCalled();
});

it("lists drafts and favorites in their stored order, with new-draft kept and preferences left out", async () => {
  const store = { list: vi.fn(async () => [item("draft:new"), item("prefs:sidebar"), item("draft:doc1"), item("favorite:gone"), item("favorite:doc2"), item("draft:foreign")]) };
  const queries = {
    locateDocuments: locating({ doc1: { sourceId: "src1", workspaceId }, doc2: { sourceId: "src2", workspaceId }, foreign: { sourceId: "src3", workspaceId: "other" } }),
    getDocument: vi.fn(),
  };
  const service = new PersonalService(store as never, queries as never, uow as never);
  const listed = await service.list(caller, workspaceId);
  expect(listed.map(entry => [entry.key, "sourceId" in entry ? entry.sourceId : undefined])).toEqual([
    ["draft:new", undefined],
    ["draft:doc1", "src1"],
    ["favorite:doc2", "src2"],
  ]);
  expect(queries.locateDocuments).toHaveBeenCalledTimes(1);
  expect(queries.locateDocuments).toHaveBeenCalledWith(caller, ["doc1", "gone", "doc2", "foreign"], { includeArchived: true });
  expect(queries.getDocument).not.toHaveBeenCalled();
});
