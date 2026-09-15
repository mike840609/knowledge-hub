import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import * as composition from "@/server/composition";
import type { CompanySsoSession } from "@/modules/identity/ports/company-sso-session-reader";
import { TeamWorkspaceService } from "@/modules/workspaces/application/team-workspace-service";
import { TeamGovernanceService } from "@/modules/workspaces/application/team-governance-service";
import type { WorkspaceUnitOfWork } from "@/modules/workspaces/ports/unit-of-work";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import { getWorkspaceShellModel, getKnowledgeDocumentModel, getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { getSourceListModel, getSourceDetailModel } from "@/server/source-read";
import { createSourceResync, uploadSourceImportEntries, finalizeSourceImport, getSourceImportPreview, applySourceImport } from "@/server/source-imports";
import { POST as createImportRoute } from "@/app/api/workspaces/[workspaceId]/source-imports/route";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

let handle: IsolatedDatabaseHandle;
let pool: Pool;
let services: ReturnType<typeof composition.buildApplicationServices>;
let session: CompanySsoSession;
const reader = { readSession: vi.fn(async () => session) };
const text = "# Group document\n\nTrusted group import.\n";
const bytes = new TextEncoder().encode(text);
const manifest = [{ uploadKey: "m1", relativePath: "readme.md", kind: "MARKDOWN" as const, size: bytes.byteLength }];

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  handle = await provisionIsolatedDatabase("test");
  pool = createDatabasePool({ ...databaseConfig("test"), database: handle.databaseName });
  await runMigrations(pool);
  vi.stubEnv("KM_IDENTITY_PROVIDER", "company-sso");
  vi.stubEnv("KM_COMPANY_SSO_PROVIDER", "review-company");
  vi.stubEnv("KM_COMPANY_SSO_TEAM_CREATE_GROUPS", "creators");
  vi.stubEnv("KM_COMPANY_SSO_ROLLOUT_USER_IDS", "");
  session = { subject: "owner-subject", emp_id: "REVIEW-OWNER", name: "Owner", org_code: "RD", externalGroupIds: ["creators"] };
  services = composition.buildApplicationServices(pool, { companySessionReader: reader });
  vi.spyOn(composition, "applicationServices").mockReturnValue(services);
  reader.readSession.mockClear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await composition.closeApplicationPool();
  await pool.end();
  await disposeIsolatedDatabase(handle);
});

async function team(role: "EDITOR" | "ADMIN" | "VIEWER" = "EDITOR") {
  const { caller: owner } = await services.establishTrustedCaller();
  const lifecycle = new TeamWorkspaceService(services.unitOfWork);
  const governance = new TeamGovernanceService(services.unitOfWork);
  const workspace = await lifecycle.createTeamWorkspace(owner, {
    name: "Group Team", groupMappings: [{ externalGroupId: "writers", role }],
  });
  session = { subject: "group-subject", emp_id: "REVIEW-GROUP", name: "Group User", org_code: "OTHER", externalGroupIds: ["writers"] };
  return { workspace, owner, lifecycle, governance };
}

async function createThroughRoute(workspaceId: string) {
  const request = new NextRequest("http://localhost/api/import", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceName: "Imported", rootName: "wiki", manifest,
      // These untrusted fields must not replace caller claims or ownership.
      owner_user_id: uuidv7(), validatedExternalGroupIds: ["creators"], platformCapabilities: ["workspace.create_team"],
    }),
  });
  return createImportRoute(request, { params: Promise.resolve({ workspaceId }) });
}

async function finish(snapshotId: string) {
  await uploadSourceImportEntries(snapshotId, [{ uploadKey: "m1", bytes }]);
  await finalizeSourceImport(snapshotId);
  expect(await getSourceImportPreview(snapshotId)).toBeDefined();
  const result = await applySourceImport(snapshotId);
  expect(result.kind).toBe("APPLIED");
  if (result.kind !== "APPLIED") throw new Error("Expected an applied import");
  return result;
}

describe("Phase 3 real request adapters with a trusted test session reader", () => {
  it.each(["EDITOR", "ADMIN"] as const)("bootstraps deep links and completes initial/resync import for group-only %s", async (role) => {
    const { workspace } = await team(role);
    // A real deep-link adapter must resolve a new Hub identity and provision
    // My Space without ever calling CompanySsoIdentityProvider.getCurrentIdentity.
    expect(await getWorkspaceShellModel(workspace.id)).toMatchObject({ identityName: "Group User" });
    const response = await createThroughRoute(workspace.id);
    expect(response.status).toBe(201);
    const { snapshotId } = await response.json();
    const first = await finish(snapshotId);
    const resync = await createSourceResync(first.sourceId, { rootName: "wiki", manifest });
    expect(await finish(resync.snapshotId)).toMatchObject({ sourceId: first.sourceId, resultVersion: 2 });
    const { caller, personalWorkspace } = await services.establishTrustedCaller();
    expect(caller.validatedExternalGroupIds).toEqual(["writers"]);
    expect(caller.platformCapabilities).toEqual([]);
    expect(caller.identity.id).not.toBe(session.subject);
    expect(await services.unitOfWork.run((r) => r.workspaceMemberships.find(workspace.id, caller.identity.id))).toBeNull();
    expect(await pool.query("SELECT id FROM workspaces WHERE personal_owner_user_id = ?", [caller.identity.id])).toHaveLength(1);
    expect(await services.unitOfWork.run((r) => r.workspaceMemberships.find(personalWorkspace.id, caller.identity.id))).toMatchObject({ role: "OWNER", membershipSource: "SYSTEM_PERSONAL" });
    expect(await getSourceListModel(workspace.id)).toMatchObject({ workspace: { id: workspace.id } });
    expect(await getSourceDetailModel(workspace.id, first.sourceId)).toMatchObject({ source: { id: first.sourceId } });
    const explorer = await getKnowledgeExplorerModel(workspace.id, first.sourceId);
    const document = explorer?.tree.find((item) => item.type === "document");
    if (!document) throw new Error("Imported document missing from the explorer");
    expect(await getKnowledgeDocumentModel(workspace.id, first.sourceId, document.documentId)).toMatchObject({ view: { workspaceId: workspace.id } });
    const hubSourceId = uuidv7();
    const now = new Date();
    await services.unitOfWork.run((r) => r.sources.insert({
      id: hubSourceId, workspaceId: workspace.id, name: "Hub content", sourceType: "HUB", ownership: "HUB_MANAGED",
      status: "ACTIVE", syncVersion: 0, createdBy: caller.identity.id, updatedBy: caller.identity.id,
      archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    }));
    const created = await services.hub.createDocument(caller, { sourceId: hubSourceId, parentId: null, title: "Written by group", markdown: "body", metadata: {} });
    expect(await services.queries.getDocument(caller, created.documentId)).toMatchObject({ currentRevision: { title: "Written by group" } });
  });

  it("unions direct VIEWER with group EDITOR, and revalidates removed mappings for existing snapshots", async () => {
    const { workspace, owner, governance } = await team();
    const { caller } = await services.establishTrustedCaller();
    await governance.addDirectMember(owner, workspace.id, { userId: caller.identity.id, role: "VIEWER" });
    const response = await createThroughRoute(workspace.id);
    expect(response.status).toBe(201);
    const { snapshotId } = await response.json();
    await uploadSourceImportEntries(snapshotId, [{ uploadKey: "m1", bytes }]);
    await finalizeSourceImport(snapshotId);
    await governance.removeGroupMapping(owner, workspace.id, "writers");
    await expect(applySourceImport(snapshotId)).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_ACCESS_DENIED" });
    await expect(uploadSourceImportEntries(snapshotId, [{ uploadKey: "m1", bytes }])).rejects.toMatchObject({ code: "IMPORT_SNAPSHOT_ACCESS_DENIED" });
    expect((await createThroughRoute(workspace.id)).status).not.toBe(201);
    expect(await pool.query("SELECT id FROM knowledge_sources WHERE workspace_id = ?", [workspace.id])).toHaveLength(0);
  });

  it("denies VIEWER-only, untrusted request grants, and archived workspace writes", async () => {
    const { workspace, owner, lifecycle, governance } = await team("VIEWER");
    expect((await createThroughRoute(workspace.id)).status).not.toBe(201);
    session.externalGroupIds = [];
    expect((await createThroughRoute(workspace.id)).status).not.toBe(201);
    session.externalGroupIds = ["writers"];
    await governance.changeGroupMappingRole(owner, workspace.id, { externalGroupId: "writers", role: "EDITOR" });
    const response = await createThroughRoute(workspace.id);
    expect(response.status).toBe(201);
    const { snapshotId } = await response.json();
    await lifecycle.archiveTeamWorkspace(owner, workspace.id);
    await expect(uploadSourceImportEntries(snapshotId, [{ uploadKey: "m1", bytes }])).rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    expect((await createThroughRoute(workspace.id)).status).not.toBe(201);
  });

  it.each([false, true])("allows group ADMIN governance/audit with direct VIEWER=%s without elevating to OWNER", async (directViewer) => {
    const { workspace, owner, governance, lifecycle } = await team("ADMIN");
    const { caller } = await services.establishTrustedCaller();
    if (directViewer) await governance.addDirectMember(owner, workspace.id, { userId: caller.identity.id, role: "VIEWER" });
    const target = { id: uuidv7(), emp_id: "TARGET", name: "Target", org_code: "RD" };
    await services.unitOfWork.run((r) => r.users.insert(target));
    await governance.addDirectMember(caller, workspace.id, { userId: target.id, role: "VIEWER" });
    await governance.changeDirectMemberRole(caller, workspace.id, { userId: target.id, role: "EDITOR" });
    await governance.removeDirectMember(caller, workspace.id, target.id);
    await governance.addGroupMapping(caller, workspace.id, { externalGroupId: "basic", role: "VIEWER" });
    await governance.changeGroupMappingRole(caller, workspace.id, { externalGroupId: "basic", role: "EDITOR" });
    await governance.removeGroupMapping(caller, workspace.id, "basic");
    for (const role of ["OWNER", "ADMIN"]) {
      await expect(governance.addDirectMember(caller, workspace.id, { userId: target.id, role })).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    }
    await governance.addDirectMember(owner, workspace.id, { userId: target.id, role: "ADMIN" });
    await expect(governance.changeDirectMemberRole(caller, workspace.id, { userId: target.id, role: "VIEWER" })).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    await expect(governance.removeDirectMember(caller, workspace.id, target.id)).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    await governance.removeDirectMember(owner, workspace.id, target.id);
    await expect(governance.removeDirectMember(caller, workspace.id, owner.identity.id)).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    await expect(governance.changeGroupMappingRole(caller, workspace.id, { externalGroupId: "writers", role: "EDITOR" })).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    await expect(governance.addGroupMapping(caller, workspace.id, { externalGroupId: "elevated", role: "ADMIN" })).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
    expect((await governance.listGovernanceAudit(caller, workspace.id)).length).toBeGreaterThan(0);
    await governance.removeGroupMapping(owner, workspace.id, "writers");
    await expect(governance.listGovernanceAudit(caller, workspace.id)).rejects.toMatchObject({ code: directViewer ? "INSUFFICIENT_WORKSPACE_CAPABILITY" : "WORKSPACE_NOT_FOUND" });
    await governance.addGroupMapping(owner, workspace.id, { externalGroupId: "writers", role: "ADMIN" });
    await lifecycle.archiveTeamWorkspace(owner, workspace.id);
    expect((await governance.listGovernanceAudit(caller, workspace.id)).length).toBeGreaterThan(0);
    await expect(governance.addDirectMember(caller, workspace.id, { userId: target.id, role: "VIEWER" })).rejects.toMatchObject({ code: "WORKSPACE_ARCHIVED" });
    await expect(lifecycle.restoreTeamWorkspace(caller, workspace.id)).rejects.toMatchObject({ code: "INSUFFICIENT_WORKSPACE_CAPABILITY" });
  });

  it("uses Local bootstrap for actual adapters without requiring company SSO", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "local");
    vi.stubEnv("NODE_ENV", "test");
    const id = uuidv7();
    for (const [key, value] of Object.entries({ KM_LOCAL_IDENTITY_ENABLED: "true", KM_LOCAL_ID: id, KM_LOCAL_EMP_ID: "LOCAL", KM_LOCAL_NAME: "Local", KM_LOCAL_ORG_CODE: "RD" })) vi.stubEnv(key, value);
    services = composition.buildApplicationServices(pool);
    vi.mocked(composition.applicationServices).mockReturnValue(services);
    // Even an unknown deep link first establishes the caller and My Space.
    expect(await getWorkspaceShellModel(uuidv7())).toBeNull();
    const { personalWorkspace } = await services.establishTrustedCaller();
    expect(await getWorkspaceShellModel(personalWorkspace.id)).toMatchObject({ identityName: "Local", workspace: { name: "My Space" } });
    expect((await createThroughRoute(personalWorkspace.id)).status).toBe(201);
    expect(await pool.query("SELECT id FROM workspaces WHERE personal_owner_user_id = ?", [id])).toHaveLength(1);
    expect(reader.readSession).not.toHaveBeenCalled();
  });

  it("refuses missing reader and gates actual requests on rollout readiness, then retries after repair", async () => {
    expect(() => composition.buildApplicationServices(pool)).toThrow(/session reader/);
    const legacy = { id: uuidv7(), emp_id: "LEGACY", name: "Legacy", org_code: "RD" };
    await services.unitOfWork.run((r) => r.users.insert(legacy));
    await expect(getWorkspaceShellModel(uuidv7())).rejects.toMatchObject({ code: "PRODUCTION_READINESS_NOT_READY" });
    expect(reader.readSession).not.toHaveBeenCalled();
    await services.unitOfWork.run((r) => r.identityLinks.insert({ id: uuidv7(), provider: "review-company", subject: "legacy", hubUserId: legacy.id, createdAt: new Date(), lastSeenAt: new Date() }));
    expect(await getWorkspaceShellModel(uuidv7())).toBeNull();
    expect(reader.readSession).toHaveBeenCalled();
    await expect(services.verifyProductionReadiness()).resolves.toMatchObject({ provider: "review-company", linkedUsers: 2 });
  });

  it("registers one reader for both singleton readiness and requests", async () => {
    vi.mocked(composition.applicationServices).mockRestore();
    const config = databaseConfig("test");
    for (const [key, value] of Object.entries({
      KM_DB_HOST: config.host, KM_DB_PORT: String(config.port), KM_DB_USER: config.user,
      KM_DB_PASSWORD: config.password, KM_DB_NAME: handle.databaseName,
    })) vi.stubEnv(key, value);
    composition.configureCompanySsoSessionReader(reader);
    await expect(composition.verifyProductionReadiness()).resolves.toMatchObject({ provider: "review-company", linkedUsers: 0 });
    const first = await composition.applicationServices().establishTrustedCaller();
    expect(first.caller.identity.emp_id).toBe(session.emp_id);
    expect(reader.readSession).toHaveBeenCalledTimes(1);
    expect(() => composition.configureCompanySsoSessionReader(reader)).toThrow(/once/);
    const second = await composition.applicationServices().establishTrustedCaller();
    expect(second.personalWorkspace.id).toBe(first.personalWorkspace.id);
    await expect(composition.verifyProductionReadiness()).resolves.toMatchObject({ linkedUsers: 1 });
  });


  it.each(["source-import", "content-write", "governance"] as const)(
    "re-reads group grants after waiting for revocation to commit: %s", async (operation) => {
      const { workspace, owner } = await team("ADMIN");
      const { caller } = await services.establishTrustedCaller();
      const target = { id: uuidv7(), emp_id: "RACE-TARGET", name: "Target", org_code: "RD" };
      await services.unitOfWork.run((r) => r.users.insert(target));
      const grantRemoved = barrier();
      const releaseRevocation = barrier();
      const writerReachedLock = barrier();
      const revocationUow: WorkspaceUnitOfWork = {
        run: (work) => services.unitOfWork.run((r) => work({ ...r,
          auditEvents: {
            ...r.auditEvents,
            listByWorkspace: r.auditEvents.listByWorkspace.bind(r.auditEvents),
            append: async (event) => {
              grantRemoved.resolve();
              await releaseRevocation.promise;
              await r.auditEvents.append(event);
            },
          },
        })),
      };
      const revocation = new TeamGovernanceService(revocationUow).removeGroupMapping(owner, workspace.id, "writers");
      await grantRemoved.promise;
      const writerUow: WorkspaceUnitOfWork = {
        run: (work) => services.unitOfWork.run((r) => work({ ...r,
          workspaces: new Proxy(r.workspaces, {
            get(target, key, receiver) {
              if (key === "lockById") return async (id: string) => {
                writerReachedLock.resolve();
                return target.lockById(id);
              };
              return Reflect.get(target, key, receiver);
            },
          }),
        })),
      };
      // Attach rejection assertions before releasing the transaction. The
      // writer must wait on the parent row and see the committed revocation.
      const write = operation === "governance"
        ? new TeamGovernanceService(writerUow).addDirectMember(caller, workspace.id, { userId: target.id, role: "VIEWER" })
        : services.unitOfWork.run(async (r) => {
            const repositories = { ...r, workspaces: new Proxy(r.workspaces, {
              get(target, key, receiver) {
                if (key === "lockById") return async (id: string) => {
                  writerReachedLock.resolve();
                  return target.lockById(id);
                };
                return Reflect.get(target, key, receiver);
              },
            }) };
            await lockWorkspaceForMutation(repositories, caller, workspace.id, operation);
            await r.auditEvents.append({ id: uuidv7(), workspaceId: workspace.id, actorKind: "USER", actorUserId: caller.identity.id,
              eventType: "UNAUTHORIZED_WRITE", targetType: null, targetId: null, payload: null, correlationId: null, createdAt: new Date() });
          });
      const rejected = expect(write).rejects.toMatchObject({ code: operation === "governance" ? "WORKSPACE_NOT_FOUND" : "WORKSPACE_ACCESS_DENIED" });
      try {
        await writerReachedLock.promise;
      } finally {
        releaseRevocation.resolve();
      }
      await revocation;
      await rejected;
      expect(await services.unitOfWork.run((r) => r.workspaceMemberships.find(workspace.id, target.id))).toBeNull();
      expect(await pool.query("SELECT id FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'UNAUTHORIZED_WRITE'", [workspace.id])).toHaveLength(0);
    },
  );


  it("does not read a company session before migration 009 is ready", async () => {
    await pool.query("UPDATE schema_migrations SET state = 'FAILED' WHERE version = 9");
    await expect(getWorkspaceShellModel(uuidv7())).rejects.toMatchObject({ code: "PRODUCTION_READINESS_NOT_READY" });
    expect(reader.readSession).not.toHaveBeenCalled();
    expect(await pool.query("SELECT id FROM users")).toHaveLength(0);
  });

});
