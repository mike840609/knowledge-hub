import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
import { applicationServices } from "@/server/composition";
import { getFeedbackIssues } from "@/server/feedback-issues-read";

type Services = ReturnType<typeof ApplicationServicesFn>;
const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000004b1";
const caller = callerFromIdentity({ id: "0199f400-0000-7000-8000-0000000004b2", emp_id: "P4-READ", name: "Reader", org_code: "HRSD" });
const personal = { id: WORKSPACE_ID, name: "My Space", type: "PERSONAL" as const, lifecycleState: "ACTIVE" as const };
const emptyPage = { items: [], nextCursor: null };

function fakeServices(overrides: { type?: "PERSONAL" | "TEAM"; workspaceState?: () => Promise<unknown>; list?: ReturnType<typeof vi.fn> } = {}): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    workspaceAdmin: { workspaceState: overrides.workspaceState ?? vi.fn(async () => ({ workspace: { ...personal, type: overrides.type ?? "PERSONAL" }, effectiveCapabilities: [], actions: {} })) },
    feedbackIssues: { list: overrides.list ?? vi.fn(async () => emptyPage) },
  } as unknown as Services;
}

describe("getFeedbackIssues", () => {
  it("drops values the page does not recognise and still renders the newest page", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices());
    const model = await getFeedbackIssues(WORKSPACE_ID, { status: "CLOSED", category: "Billing", beforeAt: "yesterday", beforeId: "1" });
    expect(model?.filters).toEqual({ status: undefined, category: undefined, mineOnly: false });
    expect(applicationServices().feedbackIssues.list).toHaveBeenCalledWith(caller, { status: undefined, category: undefined, mine: undefined, beforeAt: undefined, beforeId: undefined });
  });

  it("passes a recognised filter and cursor through", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices());
    const model = await getFeedbackIssues(WORKSPACE_ID, { status: "RESOLVED", category: "Search", mine: "true", beforeAt: "2026-11-03T01:02:03.000Z", beforeId: "0199f400-0000-7000-8000-000000000001" });
    expect(model?.filters).toEqual({ status: "RESOLVED", category: "Search", mineOnly: true });
  });

  it("returns null outside a personal workspace and when access is denied", async () => {
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ type: "TEAM" }));
    await expect(getFeedbackIssues(WORKSPACE_ID, {})).resolves.toBeNull();
    vi.mocked(applicationServices).mockReturnValue(fakeServices({ workspaceState: vi.fn(async () => { throw new WorkspaceNotFoundError(); }) }));
    await expect(getFeedbackIssues(WORKSPACE_ID, {})).resolves.toBeNull();
  });
});
