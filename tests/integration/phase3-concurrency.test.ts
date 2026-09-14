import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { WorkspaceLifecycleError } from "@/modules/workspaces/domain/errors";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { CreateFolderImportService, type ImportManifestEntry } from "@/modules/sources/application/create-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

const owner: UserIdentity = { id: "0199f300-0000-7000-8000-000000000001", emp_id: "P3-LOCK", name: "Lock Owner", org_code: "P3" };
const editor: UserIdentity = { id: "0199f300-0000-7000-8000-000000000002", emp_id: "P3-LOCK-ED", name: "Lock Editor", org_code: "P3" };

let handle: IsolatedDatabaseHandle;
let pool: Pool;
let poolB: Pool;

async function openPool(): Promise<Pool> {
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  try {
    return createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
}

beforeAll(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = await openPool();
  poolB = await openPool();
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
  await poolB.end();
  await disposeIsolatedDatabase(handle);
});

async function setupGovernanceScope(): Promise<{ workspaceId: string }> {
  const workspaceId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.users.upsertIdentity(editor);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: "Lock Scope", createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: editor.id, role: "EDITOR", now }));
  });
  return { workspaceId };
}

describe("Phase 3 workspace governance locking and primitives (Task 5)", () => {
  it("lockById returns the workspace with governance fields inside a transaction", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const locked = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaces.lockById(workspaceId));
    expect(locked?.id).toBe(workspaceId);
    expect(locked?.workspaceType).toBe("TEAM");
    expect(locked?.lifecycleState).toBe("ACTIVE");
  });

  it("lockById returns null for a missing workspace without locking", async () => {
    const locked = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaces.lockById(uuidv7()));
    expect(locked).toBeNull();
  });

  it("concurrent governance transactions serialize on the workspace lock", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const first = new MariaDbUnitOfWork(pool).run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new Error("Workspace must exist for the lock serialization check.");
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: owner.id, actorKind: "USER",
        eventType: "GOVERNANCE_LOCK_CHECK_A", targetType: null, targetId: null,
        payload: null, correlationId: null, createdAt: new Date(),
      });
    });
    const second = new MariaDbUnitOfWork(poolB).run(async (repositories) => {
      const locked = await repositories.workspaces.lockById(workspaceId);
      if (!locked) throw new Error("Workspace must exist for the lock serialization check.");
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: editor.id, actorKind: "USER",
        eventType: "GOVERNANCE_LOCK_CHECK_B", targetType: null, targetId: null,
        payload: null, correlationId: null, createdAt: new Date(),
      });
    });
    await Promise.all([first, second]);
    const events = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.auditEvents.listByWorkspace(workspaceId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["GOVERNANCE_LOCK_CHECK_A", "GOVERNANCE_LOCK_CHECK_B"]);
  });

  it("directOwnerCount counts only DIRECT OWNER memberships", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const count = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.workspaceMemberships.countDirectOwners(workspaceId));
    expect(count).toBe(1);
  });

  it("group mapping exact lookup matches exact bytes only", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const now = new Date();
    const groupId = `sso-group-exact-${uuidv7()}`;
    await new MariaDbUnitOfWork(pool).run((repositories) =>
      repositories.groupMappings.insert({
        id: uuidv7(), workspaceId, externalGroupId: groupId, role: "VIEWER", createdBy: owner.id, createdAt: now, updatedAt: now,
      }),
    );
    const exact = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.groupMappings.findExact(workspaceId, groupId));
    expect(exact?.role).toBe("VIEWER");
    const nearMiss = await new MariaDbUnitOfWork(pool).run((repositories) =>
      repositories.groupMappings.findExact(workspaceId, ` ${groupId} `),
    );
    expect(nearMiss).toBeNull();
  });

  it("audit events are append-only and listable per workspace", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const now = new Date();
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: owner.id, actorKind: "USER",
        eventType: "TEAM_WORKSPACE_CREATED", targetType: null, targetId: null,
        payload: { workspaceId }, correlationId: null, createdAt: now,
      });
      await repositories.auditEvents.append({
        id: uuidv7(), workspaceId, actorUserId: null, actorKind: "SYSTEM",
        eventType: "TEAM_DIRECT_OWNER_GRANTED", targetType: "USER", targetId: editor.id,
        payload: null, correlationId: null, createdAt: now,
      });
    });
    const events = await new MariaDbUnitOfWork(pool).run((repositories) => repositories.auditEvents.listByWorkspace(workspaceId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["TEAM_DIRECT_OWNER_GRANTED", "TEAM_WORKSPACE_CREATED"]);
    expect(events.every((event) => event.workspaceId === workspaceId)).toBe(true);
  });
});

function ownerCaller(): CallerContext {
  return callerFromIdentity(owner);
}

function importServices(target: Pool) {
  const uow = new MariaDbUnitOfWork(target);
  return {
    create: new CreateFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    upload: new UploadFolderImportEntriesService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    finalize: new FinalizeFolderImportService(uow, { limits: DEFAULT_IMPORT_LIMITS }),
    apply: new ApplyFolderImportService(uow, {}),
  };
}

function markdownEntry(uploadKey: string, path: string, text: string): { manifest: ImportManifestEntry; bytes: Uint8Array } {
  const bytes = new TextEncoder().encode(text);
  return { manifest: { uploadKey, relativePath: path, kind: "MARKDOWN", size: bytes.byteLength }, bytes };
}

async function readyInitialSnapshot(target: Pool, workspaceId: string, text = "# Readme\n\nbody\n"): Promise<string> {
  const services = importServices(target);
  const caller = ownerCaller();
  const entry = markdownEntry(`m-${uuidv7().slice(0, 8)}`, "docs/readme.md", text);
  const session = await services.create.createInitial(caller, {
    workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: [entry.manifest],
  });
  await services.upload.upload(caller, { snapshotId: session.snapshotId, entries: [{ uploadKey: entry.manifest.uploadKey, bytes: entry.bytes }] });
  await services.finalize.finalize(caller, session.snapshotId);
  return session.snapshotId;
}

async function readyResyncSnapshot(target: Pool, sourceId: string, text = "# Readme\n\nbody\n"): Promise<string> {
  const services = importServices(target);
  const caller = ownerCaller();
  const entry = markdownEntry(`m-${uuidv7().slice(0, 8)}`, "docs/readme.md", text);
  const session = await services.create.createResync(caller, { sourceId, rootName: "wiki", manifest: [entry.manifest] });
  await services.upload.upload(caller, { snapshotId: session.snapshotId, entries: [{ uploadKey: entry.manifest.uploadKey, bytes: entry.bytes }] });
  await services.finalize.finalize(caller, session.snapshotId);
  return session.snapshotId;
}

async function appliedInitialSource(target: Pool, workspaceId: string): Promise<string> {
  const snapshotId = await readyInitialSnapshot(target, workspaceId);
  const result = await importServices(target).apply.apply(ownerCaller(), snapshotId);
  if (result.kind !== "APPLIED") throw new Error("expected initial APPLIED");
  return result.sourceId;
}

async function archiveWorkspace(target: Pool, workspaceId: string): Promise<void> {
  await new TeamWorkspaceService(new MariaDbUnitOfWork(target)).archiveTeamWorkspace(ownerCaller(), workspaceId);
}

async function countSnapshots(workspaceId: string): Promise<number> {
  const rows = await pool.query<{ count: unknown }[]>("SELECT COUNT(*) AS count FROM source_import_snapshots WHERE workspace_id = ?", [workspaceId]);
  return Number(rows[0]?.count ?? 0);
}

describe("Phase 3 canonical import/content lock hierarchy (Task 10)", () => {
  beforeEach(async () => {
    await pool.query("DELETE FROM source_import_snapshot_entries");
    await pool.query("DELETE FROM source_import_snapshots");
  });

  it("createInitial vs archive: no post-archive snapshot commit", async () => {
    const { workspaceId } = await setupGovernanceScope();
    await archiveWorkspace(pool, workspaceId);
    const entry = markdownEntry("m1", "docs/readme.md", "# Readme\n\nbody\n");
    await expect(importServices(pool).create.createInitial(ownerCaller(), {
      workspaceId, sourceName: "Late Wiki", rootName: "wiki", manifest: [entry.manifest],
    })).rejects.toThrow(WorkspaceLifecycleError);
    expect(await countSnapshots(workspaceId)).toBe(0);
  });

  it("createResync vs archive: no post-archive snapshot commit", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    await archiveWorkspace(pool, workspaceId);
    const entry = markdownEntry("m1", "docs/readme.md", "# Readme\n\nbody\n");
    await expect(importServices(pool).create.createResync(ownerCaller(), {
      sourceId, rootName: "wiki", manifest: [entry.manifest],
    })).rejects.toThrow(WorkspaceLifecycleError);
    expect(await countSnapshots(workspaceId)).toBe(1);
  });

  it("createResync binds the Source version and inserts the snapshot in a single transaction", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    const base = new MariaDbUnitOfWork(pool);
    let plainTransactions = 0;
    let quotaTransactions = 0;
    const countingUow: SourceUnitOfWork = {
      run: (work) => { plainTransactions += 1; return base.run(work); },
      runWithCreatorQuotaLock: (creatorId, timeoutSeconds, work) => {
        quotaTransactions += 1;
        return base.runWithCreatorQuotaLock(creatorId, timeoutSeconds, work);
      },
    };
    const entry = markdownEntry("m1", "docs/readme.md", "# Readme\n\nbody\n");
    const result = await new CreateFolderImportService(countingUow, { limits: DEFAULT_IMPORT_LIMITS }).createResync(ownerCaller(), {
      sourceId, rootName: "wiki", manifest: [entry.manifest],
    });
    expect(result.state).toBe("BUILDING");
    expect(plainTransactions).toBe(0);
    expect(quotaTransactions).toBe(1);
    const rows = await pool.query<{ based_on_version: number; state: string }[]>(
      "SELECT based_on_version, state FROM source_import_snapshots WHERE id = ?", [result.snapshotId],
    );
    expect(rows[0]).toMatchObject({ based_on_version: 1, state: "BUILDING" });
  });

  it("concurrent createResync calls on one source both commit without deadlock", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    const caller = ownerCaller();
    const first = markdownEntry("m1", "docs/a.md", "# A\n\nbody\n");
    const second = markdownEntry("m1", "docs/b.md", "# B\n\nbody\n");
    const [left, right] = await Promise.all([
      importServices(pool).create.createResync(caller, { sourceId, rootName: "a", manifest: [first.manifest] }),
      importServices(poolB).create.createResync(caller, { sourceId, rootName: "b", manifest: [second.manifest] }),
    ]);
    expect(left.state).toBe("BUILDING");
    expect(right.state).toBe("BUILDING");
  });

  it("concurrent createInitial calls on one workspace both commit without deadlock", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const caller = ownerCaller();
    const first = markdownEntry("m1", "docs/a.md", "# A\n\nbody\n");
    const second = markdownEntry("m1", "docs/b.md", "# B\n\nbody\n");
    const [left, right] = await Promise.all([
      importServices(pool).create.createInitial(caller, { workspaceId, sourceName: "Wiki A", rootName: "a", manifest: [first.manifest] }),
      importServices(poolB).create.createInitial({ ...caller, identity: { ...editor } }, { workspaceId, sourceName: "Wiki B", rootName: "b", manifest: [second.manifest] }),
    ]);
    expect(left.state).toBe("BUILDING");
    expect(right.state).toBe("BUILDING");
    expect(await countSnapshots(workspaceId)).toBe(2);
  });

  it("initial apply vs archive: no post-archive Source commit", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const snapshotId = await readyInitialSnapshot(pool, workspaceId);
    await archiveWorkspace(pool, workspaceId);
    await expect(importServices(pool).apply.apply(ownerCaller(), snapshotId)).rejects.toThrow(WorkspaceLifecycleError);
    const rows = await pool.query<{ state: string; result_source_id: unknown }[]>(
      "SELECT state, result_source_id FROM source_import_snapshots WHERE id = ?", [snapshotId],
    );
    expect(rows[0]).toMatchObject({ state: "READY", result_source_id: null });
  });

  it("resync apply vs archive: no post-archive version advance", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    const snapshotId = await readyResyncSnapshot(pool, sourceId);
    await archiveWorkspace(pool, workspaceId);
    await expect(importServices(pool).apply.apply(ownerCaller(), snapshotId)).rejects.toThrow(WorkspaceLifecycleError);
    const source = await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [sourceId]);
    expect(source[0]?.sync_version).toBe(1);
    const snapshot = await pool.query<{ state: string }[]>("SELECT state FROM source_import_snapshots WHERE id = ?", [snapshotId]);
    expect(snapshot[0]?.state).toBe("READY");
  });

  it("upload vs archive: no post-archive staging write", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const services = importServices(pool);
    const caller = ownerCaller();
    const entry = markdownEntry("m1", "docs/readme.md", "# Readme\n\nbody\n");
    const session = await services.create.createInitial(caller, {
      workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: [entry.manifest],
    });
    await archiveWorkspace(pool, workspaceId);
    await expect(services.upload.upload(caller, {
      snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes: entry.bytes }],
    })).rejects.toThrow(WorkspaceLifecycleError);
    const rows = await pool.query<{ upload_status: string }[]>(
      "SELECT upload_status FROM source_import_snapshot_entries WHERE snapshot_id = ?", [session.snapshotId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.upload_status).toBe("PENDING");
  });

  it("finalize vs archive: no post-archive READY transition", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const services = importServices(pool);
    const caller = ownerCaller();
    const entry = markdownEntry("m1", "docs/readme.md", "# Readme\n\nbody\n");
    const session = await services.create.createInitial(caller, {
      workspaceId, sourceName: "Imported Wiki", rootName: "wiki", manifest: [entry.manifest],
    });
    await services.upload.upload(caller, { snapshotId: session.snapshotId, entries: [{ uploadKey: "m1", bytes: entry.bytes }] });
    await archiveWorkspace(pool, workspaceId);
    await expect(services.finalize.finalize(caller, session.snapshotId)).rejects.toThrow(WorkspaceLifecycleError);
    const rows = await pool.query<{ state: string }[]>("SELECT state FROM source_import_snapshots WHERE id = ?", [session.snapshotId]);
    expect(rows[0]?.state).toBe("BUILDING");
  });

  it("non-import Source mutation vs archive: archiveSource is blocked", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    await archiveWorkspace(pool, workspaceId);
    await expect(new SourceApplicationService(new MariaDbUnitOfWork(pool)).archiveSource(ownerCaller(), sourceId))
      .rejects.toThrow(WorkspaceLifecycleError);
    const rows = await pool.query<{ status: string }[]>("SELECT status FROM knowledge_sources WHERE id = ?", [sourceId]);
    expect(rows[0]?.status).toBe("ACTIVE");
  });

  it("hub content mutation vs archive: createDocument is blocked", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = uuidv7();
    const now = new Date();
    const hubSource: KnowledgeSource = {
      id: sourceId, name: "Hub Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: owner.id, updatedBy: owner.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    };
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.insert(hubSource));
    await archiveWorkspace(pool, workspaceId);
    await expect(new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool)).createDocument(ownerCaller(), {
      sourceId, parentId: null, title: "Late Doc", markdown: "late body", metadata: {},
    })).rejects.toThrow(WorkspaceLifecycleError);
    expect(await pool.query("SELECT id FROM knowledge_documents WHERE source_id = ?", [sourceId])).toHaveLength(0);
  });

  it("membership mutation vs archive: addDirectMember is blocked", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const newcomer: UserIdentity = { id: uuidv7(), emp_id: "P3-LOCK-NEW", name: "Lock Newcomer", org_code: "P3" };
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.users.upsertIdentity(newcomer));
    await archiveWorkspace(pool, workspaceId);
    await expect(new TeamGovernanceService(new MariaDbUnitOfWork(pool)).addDirectMember(ownerCaller(), workspaceId, {
      userId: newcomer.id, role: "VIEWER",
    })).rejects.toThrow(WorkspaceLifecycleError);
    const rows = await pool.query("SELECT user_id FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?", [workspaceId, newcomer.id]);
    expect(rows).toHaveLength(0);
  });

  it("lock-inversion regression: concurrent resync apply and archive settle without deadlock", async () => {
    const { workspaceId } = await setupGovernanceScope();
    const sourceId = await appliedInitialSource(pool, workspaceId);
    const snapshotId = await readyResyncSnapshot(pool, sourceId);
    const settled = await Promise.allSettled([
      importServices(pool).apply.apply(ownerCaller(), snapshotId),
      new TeamWorkspaceService(new MariaDbUnitOfWork(poolB)).archiveTeamWorkspace(ownerCaller(), workspaceId),
    ]);
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        const code = (outcome.reason as { code?: unknown })?.code;
        expect(code).not.toBe("ER_LOCK_DEADLOCK");
        expect(code).not.toBe("ER_LOCK_WAIT_TIMEOUT");
      }
    }
    const workspace = await pool.query<{ lifecycle_state: string }[]>("SELECT lifecycle_state FROM workspaces WHERE id = ?", [workspaceId]);
    expect(workspace[0]?.lifecycle_state).toBe("ARCHIVED");
    const snapshot = await pool.query<{ state: string; result_version: number | null }[]>(
      "SELECT state, result_version FROM source_import_snapshots WHERE id = ?", [snapshotId],
    );
    const source = await pool.query<{ sync_version: number }[]>("SELECT sync_version FROM knowledge_sources WHERE id = ?", [sourceId]);
    if (snapshot[0]?.state === "APPLIED") {
      expect(snapshot[0]?.result_version).toBe(2);
      expect(source[0]?.sync_version).toBe(2);
    } else {
      expect(snapshot[0]?.state).toBe("READY");
      expect(source[0]?.sync_version).toBe(1);
      const applyOutcome = settled[0];
      expect(applyOutcome.status).toBe("rejected");
      if (applyOutcome.status === "rejected") {
        expect(applyOutcome.reason).toBeInstanceOf(WorkspaceLifecycleError);
      }
    }
  });
});
