import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { SearchTimeoutError } from "@/modules/knowledge/domain/errors";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getSearchPageModel } from "@/server/search-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000004b1";
const caller = callerFromIdentity({ id: "0199f400-0000-7000-8000-0000000004b2", emp_id: "P4-READ", name: "Reader", org_code: "HRSD" });
const navigationItem = { id: WORKSPACE_ID, name: "Workspace", type: "TEAM" as const, lifecycleState: "ACTIVE" as const };
const baseInput = { q: "needle", scope: "workspace" as const, sourceId: null, includeArchived: false, page: 1 };

function fakeServices(overrides: {
  workspaceState?: () => Promise<unknown>;
  search?: () => Promise<unknown>;
}): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    workspaceAdmin: {
      navigation: vi.fn(async () => ({ canCreateTeam: false, items: [navigationItem] })),
      workspaceState: overrides.workspaceState ?? vi.fn(async () => ({ workspace: navigationItem, effectiveCapabilities: [], actions: { canSearch: true } })),
    },
    queries: { listSources: vi.fn(async () => []) },
    search: { search: overrides.search ?? vi.fn(async () => { throw new Error("not configured"); }) },
  } as unknown as Services;
}

async function notFoundDigest(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
}

describe("getSearchPageModel timeout handling (§6.6, §11)", () => {
  it("returns timedOut: true instead of throwing when the search repository times out", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices({
      search: vi.fn(async () => { throw new SearchTimeoutError(); }),
    }));

    const model = await getSearchPageModel(WORKSPACE_ID, baseInput);

    expect(model.timedOut).toBe(true);
    expect(model.result).toBeNull();
  });

  it("returns a real result and timedOut: false on the non-timeout path", async () => {
    const result = { terms: ["needle"], hits: [], page: 1, hasNext: false, tooLong: false };
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ search: vi.fn(async () => result) }));

    const model = await getSearchPageModel(WORKSPACE_ID, baseInput);

    expect(model.timedOut).toBe(false);
    expect(model.result).toEqual(result);
  });
});

describe("getSearchPageModel authorization (§7.1, §8)", () => {
  it("resolves WORKSPACE_NOT_FOUND from workspaceState to a 404, not a raw throw", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices({
      workspaceState: vi.fn(async () => { throw new WorkspaceNotFoundError(); }),
    }));

    const digest = await notFoundDigest(getSearchPageModel(WORKSPACE_ID, baseInput));

    expect(digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("does not swallow an unrelated error from workspaceState", async () => {
    const boom = new Error("boom");
    vi.mocked(applicationServices).mockReturnValue(fakeServices({
      workspaceState: vi.fn(async () => { throw boom; }),
    }));

    await expect(getSearchPageModel(WORKSPACE_ID, baseInput)).rejects.toBe(boom);
  });

  it("still lets SearchTimeoutError reach the timeout branch rather than being caught as a 404", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices({
      search: vi.fn(async () => { throw new SearchTimeoutError(); }),
    }));

    const model = await getSearchPageModel(WORKSPACE_ID, baseInput);

    expect(model.timedOut).toBe(true);
  });
});
