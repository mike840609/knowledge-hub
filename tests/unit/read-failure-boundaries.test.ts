import { beforeEach, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { getSourceListModel } from "@/server/source-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000005a1";
const SOURCE_ID = "0199f400-0000-7000-8000-0000000005a2";

function services(listSources: () => Promise<unknown>): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller: { identity: { id: "user" } } })),
    workspaces: { listWorkspaces: vi.fn(async () => [{ id: WORKSPACE_ID }]) },
    workspaceAdmin: { workspaceState: vi.fn(async () => ({ actions: { canInspectSources: true } })) },
    queries: {
      getSource: vi.fn(async () => ({ id: SOURCE_ID, workspaceId: WORKSPACE_ID, name: "Source", sourceType: "HUB", status: "ACTIVE", ownership: "HUB_MANAGED", syncVersion: 1 })),
      listSources,
      listTree: vi.fn(async () => []),
    },
  } as unknown as Services;
}

beforeEach(() => vi.mocked(applicationServices).mockReset());

it("rethrows a transient explorer read instead of reporting the source missing", async () => {
  vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new Error("connect ETIMEDOUT"); }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).rejects.toThrow("connect ETIMEDOUT");
});

it("still returns null for an explorer access denial", async () => {
  vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new WorkspaceAccessDeniedError(); }));
  await expect(getKnowledgeExplorerModel(WORKSPACE_ID, SOURCE_ID)).resolves.toBeNull();
});

it("rethrows a transient source-list read instead of reporting the workspace missing", async () => {
  vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new Error("connect ETIMEDOUT"); }));
  await expect(getSourceListModel(WORKSPACE_ID)).rejects.toThrow("connect ETIMEDOUT");
});

it("still returns null for a source-list access denial", async () => {
  vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new WorkspaceAccessDeniedError(); }));
  await expect(getSourceListModel(WORKSPACE_ID)).resolves.toBeNull();
});
