import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import type { KnowledgeSearchCriteria } from "@/modules/knowledge/ports/knowledge-search-repository";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "@/modules/knowledge/ports/unit-of-work";
import type { Workspace } from "@/modules/workspaces/domain/workspace";
import type { WorkspaceCapability } from "@/modules/workspaces/domain/workspace-capability";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import type { WorkspaceRepositories, WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";

// Spec §5.2/§9 U5: the caller's readable-workspace filter (knowledge-search-service.ts
// readableWorkspaces, which calls evaluateWorkspaceCapabilities per candidate) must
// drop any Workspace where the caller lacks document.read, even though it was
// discoverable enough to appear in WorkspaceQueryService.listWorkspaces(). The four
// currently assignable roles always bundle document.read with document.discover
// (locked by the U3 tripwire in phase4-search-capability.test.ts), so there is no way
// to reach a real "discover but not read" membership row through genuine role data.
// evaluateWorkspaceCapabilities is mocked to supply that otherwise-unreachable
// capability set directly; everything else (WorkspaceQueryService.listWorkspaces,
// KnowledgeSearchService.search, and the readableWorkspaces filter itself) runs for
// real. No production seam was needed for this.
vi.mock("@/modules/workspaces/application/workspace-authorization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/workspaces/application/workspace-authorization")>();
  return { ...actual, evaluateWorkspaceCapabilities: vi.fn() };
});

import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";

const caller = callerFromIdentity({
  id: "00000000-0000-0000-0000-0000000004a1", emp_id: "P4-U5", name: "U5 Caller", org_code: "HRSD",
} satisfies UserIdentity);

const READABLE_WORKSPACE_ID = "00000000-0000-0000-0000-0000000004a2";
const DISCOVER_ONLY_WORKSPACE_ID = "00000000-0000-0000-0000-0000000004a3";

function fakeWorkspace(id: string): Workspace {
  return { id, name: `WS ${id}`, createdAt: new Date(), updatedAt: new Date(), workspaceType: "TEAM", personalOwnerUserId: null, lifecycleState: "ACTIVE" };
}

/** listWorkspaces() only needs to enumerate both candidates; membership/group
 * checks it performs itself (PERSONAL ownership, group role allow-list) don't
 * apply to TEAM workspaces returned from listForUser, so both pass through. */
function fakeWorkspaceUnitOfWork(): WorkspaceUnitOfWork {
  const repositories = {
    users: { upsertIdentity: vi.fn(async () => {}) },
    workspaces: {
      listForUser: vi.fn(async () => [fakeWorkspace(READABLE_WORKSPACE_ID), fakeWorkspace(DISCOVER_ONLY_WORKSPACE_ID)]),
      findById: vi.fn(async () => null),
    },
    workspaceMemberships: { find: vi.fn(async () => null) },
    groupMappings: { listByExternalGroupIds: vi.fn(async () => []) },
    auditEvents: {},
    identityLinks: {},
  } as unknown as WorkspaceRepositories;
  return { run: (work) => work(repositories) };
}

function fakeKnowledgeUnitOfWork(searchSpy: (criteria: KnowledgeSearchCriteria) => void): KnowledgeUnitOfWork {
  const repositories = {
    users: { upsertIdentity: vi.fn(async () => {}) },
    workspaceMemberships: { find: vi.fn() },
    groupMappings: { listByWorkspace: vi.fn() },
    search: {
      search: vi.fn(async (criteria: KnowledgeSearchCriteria) => {
        searchSpy(criteria);
        return [];
      }),
    },
  } as unknown as KnowledgeRepositories;
  return { run: (work) => work(repositories) };
}

describe("KnowledgeSearchService all-scope authorization filter (U5)", () => {
  it("excludes a discover-only Workspace from the workspaceIds handed to the repository", async () => {
    vi.mocked(evaluateWorkspaceCapabilities).mockImplementation(async (_repositories, _caller, workspaceId: string) => {
      const capabilities = new Set<WorkspaceCapability>(["workspace.discover", "source.discover", "document.discover"]);
      if (workspaceId === READABLE_WORKSPACE_ID) capabilities.add("document.read");
      return capabilities;
    });

    let seenCriteria: KnowledgeSearchCriteria | undefined;
    const service = new KnowledgeSearchService(
      fakeKnowledgeUnitOfWork((criteria) => { seenCriteria = criteria; }),
      new WorkspaceQueryService(fakeWorkspaceUnitOfWork()),
    );

    const result = await service.search(caller, { q: "needle", scope: { kind: "all" } });

    expect(seenCriteria?.workspaceIds).toEqual([READABLE_WORKSPACE_ID]);
    expect(seenCriteria?.workspaceIds).not.toContain(DISCOVER_ONLY_WORKSPACE_ID);
    expect(result.hits).toEqual([]);
  });
});
