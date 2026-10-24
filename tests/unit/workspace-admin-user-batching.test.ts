import { describe, expect, it, vi } from "vitest";
import { WorkspaceAdminService } from "@/server/workspace-admin";
import type { WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { WorkspaceAuditEvent } from "@/modules/workspaces/domain/workspace-audit-event";

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000008a1";
const CALLER_ID = "0199f400-0000-7000-8000-0000000008a2";
const EDITOR_ID = "0199f400-0000-7000-8000-0000000008a3";
const VIEWER_ID = "0199f400-0000-7000-8000-0000000008a4";

const caller: CallerContext = {
  identity: { id: CALLER_ID, emp_id: "caller", name: "Caller", org_code: "TEST" },
  validatedExternalGroupIds: [],
  platformCapabilities: [],
};

function auditEvent(id: string, actorUserId: string | null): WorkspaceAuditEvent {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    actorUserId,
    actorKind: actorUserId ? "USER" : "SYSTEM",
    eventType: "MEMBER_ADDED",
    targetType: "WORKSPACE",
    targetId: WORKSPACE_ID,
    payload: { afterRole: "EDITOR" },
    correlationId: null,
    createdAt: new Date("2026-10-24T09:00:00Z"),
  };
}

function fakeUnitOfWork() {
  const findByIds = vi.fn(async (ids: readonly string[]) =>
    ids.map((id) => ({ id, emp_id: `emp-${id}`, name: `Name ${id}`, org_code: "TEST" })),
  );
  const findById = vi.fn(async () => null);
  const repositories = {
    workspaces: { findById: vi.fn(async () => ({ id: WORKSPACE_ID, name: "Team", workspaceType: "TEAM", lifecycleState: "ACTIVE", createdAt: new Date(), updatedAt: new Date() })) },
    workspaceMemberships: {
      find: vi.fn(async () => ({ role: "OWNER" })),
      listByWorkspace: vi.fn(async () => [
        { workspaceId: WORKSPACE_ID, userId: EDITOR_ID, role: "EDITOR" },
        { workspaceId: WORKSPACE_ID, userId: CALLER_ID, role: "OWNER" },
        { workspaceId: WORKSPACE_ID, userId: VIEWER_ID, role: "VIEWER" },
      ]),
      countDirectOwners: vi.fn(async () => 1),
    },
    groupMappings: { listByWorkspace: vi.fn(async () => []) },
    users: { findByIds, findById },
    auditEvents: {
      listPage: vi.fn(async () => [
        auditEvent("event-1", VIEWER_ID),
        auditEvent("event-2", EDITOR_ID),
        auditEvent("event-3", EDITOR_ID),
        auditEvent("event-4", null),
      ]),
    },
  };
  const uow = { run: async (work: (repositories: unknown) => unknown) => work(repositories) } as unknown as WorkspaceUnitOfWork;
  return { uow, findByIds, findById };
}

describe("workspace admin user batching", () => {
  it("resolves every member name with one batch and no per-row lookup", async () => {
    const calls = fakeUnitOfWork();
    const members = await new WorkspaceAdminService(calls.uow).listMembers(caller, WORKSPACE_ID);

    expect(members.map((member) => member.user.id)).toEqual([CALLER_ID, EDITOR_ID, VIEWER_ID]);
    expect(calls.findByIds).toHaveBeenCalledTimes(1);
    expect([...calls.findByIds.mock.calls[0]![0]].sort()).toEqual([EDITOR_ID, CALLER_ID, VIEWER_ID].sort());
    expect(calls.findById).not.toHaveBeenCalled();
  });

  it("resolves every audit actor with one batch and no per-event lookup", async () => {
    const calls = fakeUnitOfWork();
    const page = await new WorkspaceAdminService(calls.uow).listAudit(caller, WORKSPACE_ID);

    expect(page.items.map((item) => item.actorName)).toEqual([
      `Name ${VIEWER_ID}`,
      `Name ${EDITOR_ID}`,
      `Name ${EDITOR_ID}`,
      null,
    ]);
    expect(calls.findByIds).toHaveBeenCalledTimes(1);
    expect([...calls.findByIds.mock.calls[0]![0]].sort()).toEqual([EDITOR_ID, VIEWER_ID].sort());
    expect(calls.findById).not.toHaveBeenCalled();
  });
});
