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

it("reads only favorites and returns identifiers, not draft bodies", async () => {
  const store = {
    listFavorites: vi.fn(async () => [
      { key: "favorite:doc1", value: { favorite: true }, version: 1, updatedAt: "2026-10-24T00:00:00.000Z" },
    ]),
    list: vi.fn(),
  };
  const queries = { listDocumentSummaries: vi.fn(async () => [{ documentId: "doc1", sourceId: "src1" }]) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([{ key: "favorite:doc1", sourceId: "src1" }]);
  expect(store.list).not.toHaveBeenCalled();
  expect(queries.listDocumentSummaries).toHaveBeenCalledWith(caller, workspaceId, { includeArchived: true });
});

it("drops a favorite whose document is gone", async () => {
  const store = {
    listFavorites: vi.fn(async () => [
      { key: "favorite:missing", value: { favorite: true }, version: 1, updatedAt: "2026-10-24T00:00:00.000Z" },
    ]),
  };
  const queries = { listDocumentSummaries: vi.fn(async () => []) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
});
