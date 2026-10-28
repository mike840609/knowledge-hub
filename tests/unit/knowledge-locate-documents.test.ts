import { expect, it, vi } from "vitest";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { DomainError } from "@/modules/knowledge/domain/errors";

const caller = { identity: { id: "user" }, identitySynced: true, validatedExternalGroupIds: [] } as never;
const documents: Record<string, { id: string; sourceId: string; status: "ACTIVE" | "ARCHIVED" }> = {
  mine: { id: "mine", sourceId: "srcA", status: "ACTIVE" },
  archived: { id: "archived", sourceId: "srcA", status: "ARCHIVED" },
  foreign: { id: "foreign", sourceId: "srcB", status: "ACTIVE" },
};
const policies: Record<string, { id: string; workspaceId: string; status: "ACTIVE" }> = {
  srcA: { id: "srcA", workspaceId: "wsA", status: "ACTIVE" },
  srcB: { id: "srcB", workspaceId: "wsB", status: "ACTIVE" },
};

function service(overrides: { findDocument?: (id: string) => Promise<unknown> } = {}) {
  const revisions = { findCurrent: vi.fn() };
  const repositories = {
    users: { upsertIdentity: vi.fn() },
    documents: { findById: vi.fn(overrides.findDocument ?? (async (id: string) => documents[id] ?? null)) },
    sourcePolicy: { findById: async (id: string) => policies[id] ?? null },
    workspaceAccess: {
      requireMembership: async (_caller: unknown, workspaceId: string) => {
        if (workspaceId !== "wsA") throw new DomainError("WORKSPACE_NOT_FOUND", "Not a member.");
      },
    },
    revisions,
  };
  const uow = { run: vi.fn(async (work: (r: unknown) => unknown) => work(repositories)) };
  return { queries: new KnowledgeQueryServiceImpl(uow as never), uow, revisions, repositories };
}

it("locates readable documents in one transaction without reading a revision", async () => {
  const { queries, uow, revisions } = service();
  const found = await queries.locateDocuments(caller, ["mine", "archived"], { includeArchived: true });
  expect([...found]).toEqual([
    ["mine", { sourceId: "srcA", workspaceId: "wsA" }],
    ["archived", { sourceId: "srcA", workspaceId: "wsA" }],
  ]);
  expect(uow.run).toHaveBeenCalledTimes(1);
  expect(revisions.findCurrent).not.toHaveBeenCalled();
});

it("leaves out documents the caller cannot read: missing, another workspace's, or archived unless asked", async () => {
  const { queries } = service();
  const found = await queries.locateDocuments(caller, ["mine", "missing", "foreign", "archived"]);
  expect([...found.keys()]).toEqual(["mine"]);
});

it("looks each ID up once and answers nothing for an empty list", async () => {
  const { queries, repositories } = service();
  await queries.locateDocuments(caller, ["mine", "mine"]);
  expect(repositories.documents.findById).toHaveBeenCalledTimes(1);
  await expect(queries.locateDocuments(caller, [])).resolves.toEqual(new Map());
});

it("fails instead of hiding a database failure as an unreadable document", async () => {
  const { queries } = service({ findDocument: async () => { throw new Error("connection lost"); } });
  await expect(queries.locateDocuments(caller, ["mine"])).rejects.toThrow("connection lost");
});
