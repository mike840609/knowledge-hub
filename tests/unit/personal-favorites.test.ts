import { expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "@/modules/knowledge/domain/errors";
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
const favorite = (id: string) => ({ key: `favorite:${id}`, value: { favorite: true }, version: 1, updatedAt: "2026-10-24T00:00:00.000Z" });

it("reads each favorite document instead of every document in the workspace", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("doc1")]), list: vi.fn() };
  const queries = {
    getDocument: vi.fn(async (_caller: unknown, id: string) => ({ documentId: id, sourceId: "src1", workspaceId, status: "ACTIVE" })),
    listDocumentSummaries: vi.fn(),
  };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([{ key: "favorite:doc1", sourceId: "src1" }]);
  expect(store.list).not.toHaveBeenCalled();
  expect(queries.listDocumentSummaries).not.toHaveBeenCalled();
  expect(queries.getDocument).toHaveBeenCalledWith(caller, "doc1", { includeArchived: true });
});

it("keeps a favorite for an archived document", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("archived")]) };
  const queries = { getDocument: vi.fn(async () => ({ documentId: "archived", sourceId: "src1", workspaceId, status: "ARCHIVED" })) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([{ key: "favorite:archived", sourceId: "src1" }]);
});

it("drops a favorite whose document is gone", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("missing")]) };
  const queries = { getDocument: vi.fn(async () => { throw new DocumentNotFoundError(); }) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
});

it("drops a favorite whose document belongs to another workspace", async () => {
  const store = { listFavorites: vi.fn(async () => [favorite("foreign")]) };
  const queries = { getDocument: vi.fn(async () => ({ documentId: "foreign", sourceId: "src2", workspaceId: "other", status: "ACTIVE" })) };
  const service = new PersonalService(store as never, queries as never, uow as never);
  await expect(service.listFavorites(caller, workspaceId)).resolves.toEqual([]);
});
