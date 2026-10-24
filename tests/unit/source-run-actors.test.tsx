import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportHistory } from "@/components/sources/import-history";
import type { SyncRun } from "@/modules/sources/domain/sync-run";

const injected = vi.hoisted(() => ({ services: null as unknown }));
vi.mock("@/server/composition", () => ({ applicationServices: () => injected.services }));
const { getSourceDetailModel, resolveRunActors, UNKNOWN_RUN_ACTOR } = await import("@/server/source-read");

const CALLER = "0199f000-0000-7000-8000-000000000001";
const TEAMMATE = "0199f000-0000-7000-8000-000000000002";
const GONE = "0199f000-0000-7000-8000-000000000003";

function run(id: string, triggeredBy: string): SyncRun {
  return { id, sourceId: "s", triggeredBy, basedOnVersion: 0, resultVersion: 1, status: "APPLIED", summary: {}, startedAt: new Date("2026-10-02T15:11:00Z"), completedAt: new Date("2026-10-02T15:11:00Z") };
}

describe("who started a sync run", () => {
  it("names the caller 'you', a teammate by name, and a missing user neutrally, looking each up once", async () => {
    const findName = vi.fn(async (id: string) => (id === TEAMMATE ? "Mei Lin" : null));
    const actors = await resolveRunActors([run("1", CALLER), run("2", TEAMMATE), run("3", TEAMMATE), run("4", GONE)], CALLER, findName);

    expect(actors).toEqual({ [CALLER]: "you", [TEAMMATE]: "Mei Lin", [GONE]: UNKNOWN_RUN_ACTOR });
    expect(findName).toHaveBeenCalledTimes(2);
    expect(findName).not.toHaveBeenCalledWith(CALLER);
  });

  it("prefetches every run actor in one batch and no longer re-lists the workspace sources", async () => {
    const findByIds = vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => id === TEAMMATE).map((id) => ({ id, emp_id: "e", name: "Mei Lin", org_code: "TEST" })),
    );
    const findById = vi.fn(async () => null);
    const listSources = vi.fn(() => { throw new Error("getSourceDetailModel must not re-list sources"); });
    injected.services = {
      establishTrustedCaller: async () => ({ caller: { identity: { id: CALLER, emp_id: "c", name: "Caller", org_code: "TEST" }, validatedExternalGroupIds: [], platformCapabilities: [] } }),
      workspaces: { listWorkspaces: async () => [{ id: "w" }] },
      workspaceAdmin: { workspaceState: async () => ({ actions: { canInspectSources: true } }) },
      queries: { getSource: async () => ({ id: "s", workspaceId: "w" }), listSources },
      unitOfWork: {
        run: async (work: (repositories: unknown) => unknown) => work({
          syncRuns: { listBySourceId: async () => [run("1", CALLER), run("2", TEAMMATE), run("3", TEAMMATE), run("4", GONE)] },
          users: { findByIds, findById },
        }),
      },
    };

    const model = await getSourceDetailModel("w", "s");

    expect(model?.runActors).toEqual({ [CALLER]: "you", [TEAMMATE]: "Mei Lin", [GONE]: UNKNOWN_RUN_ACTOR });
    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(new Set(findByIds.mock.calls[0]![0])).toEqual(new Set([TEAMMATE, GONE]));
    expect(findById).not.toHaveBeenCalled();
    expect(listSources).not.toHaveBeenCalled();
  });

  it("shows those names in the history and never the raw identity id", () => {
    const html = renderToStaticMarkup(
      <ImportHistory runs={[run("1", CALLER), run("2", TEAMMATE), run("3", GONE)]} workspaceId="w" actors={{ [CALLER]: "you", [TEAMMATE]: "Mei Lin" }} />,
    );
    expect(html).toContain("started by you");
    expect(html).toContain("started by Mei Lin");
    expect(html).toContain("started by an unknown user");
    for (const id of [CALLER, TEAMMATE, GONE]) expect(html).not.toContain(id);
  });
});
