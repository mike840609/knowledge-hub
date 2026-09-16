import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeSearchService } from "@/modules/knowledge/application/knowledge-search-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { WorkspaceQueryService } from "@/modules/workspaces/application/workspace-query-service";
import { WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const member: UserIdentity = { id: "00000000-0000-0000-0000-000000000411", emp_id: "P4-MEMBER", name: "Member", org_code: "HRSD" };
const outsider: UserIdentity = { id: "00000000-0000-0000-0000-000000000412", emp_id: "P4-OUTSIDER", name: "Outsider", org_code: "HRSD" };
const grouped: UserIdentity = { id: "00000000-0000-0000-0000-000000000413", emp_id: "P4-GROUPED", name: "Grouped", org_code: "RD" };

function service(): KnowledgeSearchService {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return new KnowledgeSearchService(unitOfWork, new WorkspaceQueryService(unitOfWork));
}

function groupCaller(identity: UserIdentity, groupIds: string[]): CallerContext {
  return { identity: { ...identity }, validatedExternalGroupIds: groupIds, platformCapabilities: [] };
}

/** A workspace with one document containing `needle`. */
async function createWorkspaceWithDocument(options: { owner: UserIdentity; needle: string; archivedWorkspace?: boolean }): Promise<string> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    for (const identity of [member, outsider, grouped]) await repositories.users.upsertIdentity(identity);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `WS ${workspaceId}`, createdBy: options.owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: options.owner.id, role: "OWNER", createdBy: options.owner.id, now }));
    await repositories.sources.insert({
      id: sourceId, name: "Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: options.owner.id, updatedBy: options.owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
  });
  await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(callerFromIdentity(options.owner), {
    sourceId, parentId: null, title: "Shared 文件", markdown: `${options.needle} 內容`, metadata: {},
  });
  if (options.archivedWorkspace) {
    await unitOfWork.run(async (repositories) => {
      await repositories.workspaces.setWorkspaceLifecycle(workspaceId, "ARCHIVED", options.owner.id, new Date(), new Date());
    });
  }
  return workspaceId;
}

describe("Phase 4 search authorization", () => {
  it("returns hits from a workspace the caller can read", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const result = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].workspaceId).toBe(workspaceId);
  });

  it("hides a non-member's workspace behind a non-enumerating not-found", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    await expect(service().search(callerFromIdentity(outsider), { q: needle, scope: { kind: "workspace", workspaceId } }))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("never leaks content of unreadable workspaces in an all-scope search", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    await createWorkspaceWithDocument({ owner: member, needle });
    const result = await service().search(callerFromIdentity(outsider), { q: needle, scope: { kind: "all" } });
    expect(result.hits).toEqual([]);
  });

  it("includes workspaces granted through a validated SSO group mapping", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const externalGroupId = `p4-group-${uuidv7().slice(0, 8)}`;
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.groupMappings.insert({
        id: uuidv7(), workspaceId, externalGroupId, role: "VIEWER",
        createdBy: member.id, createdAt: new Date(), updatedAt: new Date(),
      });
    });
    const result = await service().search(groupCaller(grouped, [externalGroupId]), { q: needle, scope: { kind: "all" } });
    expect(result.hits.map((hit) => hit.workspaceId)).toEqual([workspaceId]);
  });

  it("keeps an archived Team searchable when scoped to it, but out of all-scope by default", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle, archivedWorkspace: true });
    const scoped = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(scoped.hits).toHaveLength(1);

    const all = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "all" } });
    expect(all.hits.map((hit) => hit.workspaceId)).not.toContain(workspaceId);

    const allArchived = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "all" }, includeArchived: true });
    expect(allArchived.hits.map((hit) => hit.workspaceId)).toContain(workspaceId);
  });

  it("reports an over-long query without touching the database", async () => {
    const result = await service().search(callerFromIdentity(member), { q: "x".repeat(201), scope: { kind: "all" } });
    expect(result).toMatchObject({ tooLong: true, hits: [], hasNext: false });
  });

  it("reports hasNext using one extra row beyond the page size", async () => {
    const needle = `needle${uuidv7().slice(0, 8)}`;
    const workspaceId = await createWorkspaceWithDocument({ owner: member, needle });
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const sourceId = (await unitOfWork.run((repositories) => repositories.sourcePolicy.listByWorkspaceId(workspaceId)))[0].id;
    const hub = new HubKnowledgeCommandServiceImpl(unitOfWork);
    for (let index = 0; index < 20; index += 1) {
      await hub.createDocument(callerFromIdentity(member), {
        sourceId, parentId: null, title: `Extra ${index}`, markdown: `${needle} 內容`, metadata: {},
      });
    }
    const first = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId } });
    expect(first.hits).toHaveLength(20);
    expect(first.hasNext).toBe(true);
    const second = await service().search(callerFromIdentity(member), { q: needle, scope: { kind: "workspace", workspaceId }, page: 2 });
    expect(second.hits).toHaveLength(1);
    expect(second.hasNext).toBe(false);
  });
});
