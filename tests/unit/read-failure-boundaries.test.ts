import { beforeEach, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { getSourceListModel } from "@/server/source-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000005a1";
const OTHER_WORKSPACE_ID = "0199f400-0000-7000-8000-0000000005a0";
const SOURCE_ID = "0199f400-0000-7000-8000-0000000005a2";

const source = {
  id: SOURCE_ID,
  workspaceId: WORKSPACE_ID,
  name: "Source",
  sourceType: "HUB",
  status: "ACTIVE",
  ownership: "HUB_MANAGED",
  syncVersion: 1,
};

type ExplorerReads = {
  listWorkspaces?: () => Promise<unknown>;
  getSource?: () => Promise<unknown>;
  listSources?: () => Promise<unknown>;
  listTree?: () => Promise<unknown>;
};

function services(overrides: ExplorerReads = {}): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller: { identity: { id: "user" } } })),
    workspaces: { listWorkspaces: vi.fn(overrides.listWorkspaces ?? (async () => [{ id: WORKSPACE_ID }])) },
    workspaceAdmin: { workspaceState: vi.fn(async () => ({ actions: { canInspectSources: true } })) },
    queries: {
      getSource: vi.fn(overrides.getSource ?? (async () => source)),
      listSources: vi.fn(overrides.listSources ?? (async () => [source])),
      listTree: vi.fn(overrides.listTree ?? (async () => [])),
    },
  } as unknown as Services;
}

beforeEach(() => vi.mocked(applicationServices).mockReset());

it("rethrows a transient explorer read instead of reporting the source missing", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listSources: async () => { throw new Error("connect ETIMEDOUT"); } }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).rejects.toThrow("connect ETIMEDOUT");
});

it("still returns null for an explorer access denial", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listSources: async () => { throw new WorkspaceAccessDeniedError(); } }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

it("returns null when the workspace is not one the caller can see", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listWorkspaces: async () => [{ id: OTHER_WORKSPACE_ID }] }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

it("returns null when the source belongs to another workspace", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ getSource: async () => ({ ...source, workspaceId: OTHER_WORKSPACE_ID }) }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

it("returns null when the source is not in the workspace's source list", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listSources: async () => [] }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

const HIDDEN_READ = [
  ["workspace list", { listWorkspaces: async () => { throw new WorkspaceAccessDeniedError(); } }],
  ["source", { getSource: async () => { throw new WorkspaceAccessDeniedError(); } }],
  ["source list", { listSources: async () => { throw new WorkspaceAccessDeniedError(); } }],
  ["tree", { listTree: async () => { throw new WorkspaceAccessDeniedError(); } }],
] satisfies [string, ExplorerReads][];

it.each(HIDDEN_READ)("returns null when the %s read is hidden", async (_name, overrides) => {
  vi.mocked(applicationServices).mockReturnValue(services(overrides));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

const TRANSIENT_READ = [
  ["workspace list", { listWorkspaces: async () => { throw new Error("connect ETIMEDOUT"); } }],
  ["source", { getSource: async () => { throw new Error("connect ETIMEDOUT"); } }],
  ["source list", { listSources: async () => { throw new Error("connect ETIMEDOUT"); } }],
  ["tree", { listTree: async () => { throw new Error("connect ETIMEDOUT"); } }],
] satisfies [string, ExplorerReads][];

it.each(TRANSIENT_READ)("rethrows a transient %s read", async (_name, overrides) => {
  vi.mocked(applicationServices).mockReturnValue(services(overrides));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).rejects.toThrow("connect ETIMEDOUT");
});

it("returns the explorer model on the happy path", async () => {
  vi.mocked(applicationServices).mockReturnValue(services());
  const model = await getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID);
  expect(model).toMatchObject({
    source: { id: SOURCE_ID, workspaceId: WORKSPACE_ID },
    includeArchived: false,
    tree: [],
    collections: [{ source: { id: SOURCE_ID }, tree: [] }],
  });
  expect(model?.sources.map((candidate) => candidate.id)).toEqual([SOURCE_ID]);
});

it("rethrows a transient source-list read instead of reporting the workspace missing", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listSources: async () => { throw new Error("connect ETIMEDOUT"); } }));
  await expect(getSourceListModel(WORKSPACE_ID)).rejects.toThrow("connect ETIMEDOUT");
});

it("still returns null for a source-list access denial", async () => {
  vi.mocked(applicationServices).mockReturnValue(services({ listSources: async () => { throw new WorkspaceAccessDeniedError(); } }));
  await expect(getSourceListModel(WORKSPACE_ID)).resolves.toBeNull();
});
