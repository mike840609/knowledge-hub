import { beforeEach, describe, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getKnowledgeExplorerModel } from "@/server/knowledge-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const caller = { identity: { id: "u1" } };
const source = {
  id: "s1", workspaceId: "w1", name: "HCM KM", sourceType: "PUBLICATION" as const,
  status: "ACTIVE" as const, ownership: "SOURCE_MANAGED" as const, syncVersion: 0,
};

function services(list: ReturnType<typeof vi.fn>, options: ReturnType<typeof vi.fn>) {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    workspaces: { listWorkspaces: vi.fn(async () => [{ id: "w1", name: "Team", type: "TEAM", lifecycleState: "ACTIVE" }]) },
    queries: {
      getSource: vi.fn(async () => source),
      listSources: vi.fn(async () => [source]),
      listTree: vi.fn(async () => []),
    },
    publications: { list, options },
  } as unknown as Services;
}

describe("team explorer read model", () => {
  beforeEach(() => vi.mocked(applicationServices).mockReset());

  it("keeps per-document metadata for the tree and never reads the join options", async () => {
    const list = vi.fn(async () => []);
    const options = vi.fn(async () => ({ teams: [], folders: [] }));
    vi.mocked(applicationServices).mockReturnValue(services(list, options));

    const model = await getKnowledgeExplorerModel("w1", "s1", { includeArchived: true });

    expect(model?.publications).toEqual([]);
    // The tree needs maintainers, so documents are included; a page load does not
    // enumerate every personal source just to fill a join dialog nobody opened.
    expect(list).toHaveBeenCalledWith(caller, "w1", true, { includeDocuments: true });
    expect(options).not.toHaveBeenCalled();
    expect(model).not.toHaveProperty("publicationFolders");
  });
});
