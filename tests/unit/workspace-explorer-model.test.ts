import { beforeEach, describe, expect, it, vi } from "vitest";

const services = {
  workspaces: { listWorkspaces: vi.fn() },
  queries: { listSources: vi.fn(), listTree: vi.fn() },
};
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...services, establishTrustedCaller: async () => ({ caller: "caller" }) }),
}));

import { getWorkspaceExplorerModel } from "@/server/knowledge-read";

const source = (id: string, name: string) => ({ id, workspaceId: "w1", name, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0 });

beforeEach(() => {
  services.workspaces.listWorkspaces.mockReset().mockResolvedValue([{ id: "w1" }]);
  services.queries.listSources.mockReset().mockResolvedValue([source("b", "Wiki"), source("a", "Notes")]);
  services.queries.listTree.mockReset().mockImplementation(async (_caller: unknown, sourceId: string) => [{ type: "folder", id: `${sourceId}-f`, parentId: null, label: "F", position: 0, status: "ACTIVE" }]);
});

describe("getWorkspaceExplorerModel", () => {
  it("lists every source by name, each with its tree, archived included", async () => {
    const model = await getWorkspaceExplorerModel("w1");
    expect(model?.collections.map((collection) => collection.source.name)).toEqual(["Notes", "Wiki"]);
    expect(model?.collections[0].tree[0].id).toBe("a-f");
    expect(services.queries.listSources).toHaveBeenCalledWith("caller", "w1", { includeArchived: true });
    expect(services.queries.listTree).toHaveBeenCalledWith("caller", "a", { includeArchived: true });
    expect(services.queries.listTree).toHaveBeenCalledWith("caller", "b", { includeArchived: true });
  });

  it("is an empty list for a workspace with no sources", async () => {
    services.queries.listSources.mockResolvedValue([]);
    expect(await getWorkspaceExplorerModel("w1")).toEqual({ collections: [] });
    expect(services.queries.listTree).not.toHaveBeenCalled();
  });

  it("is null for a workspace the caller is not in, and reads nothing of it", async () => {
    expect(await getWorkspaceExplorerModel("other")).toBeNull();
    expect(services.queries.listSources).not.toHaveBeenCalled();
  });

  it("is null when a read is refused", async () => {
    services.queries.listTree.mockRejectedValue(new Error("denied"));
    expect(await getWorkspaceExplorerModel("w1")).toBeNull();
  });
});
