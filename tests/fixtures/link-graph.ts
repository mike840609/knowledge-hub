import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

export const linkOwner: UserIdentity = { id: "0199f500-0000-7000-8000-000000000001", emp_id: "LINK-OWNER", name: "Link Owner", org_code: "HRSD" };
export const linkOutsider: UserIdentity = { id: "0199f500-0000-7000-8000-000000000002", emp_id: "LINK-OUT", name: "Link Outsider", org_code: "HRSD" };

/** An isolated, migrated database for one test file, and the pool onto it. */
export async function provisionLinkDatabase(): Promise<{ pool: Pool; dispose: () => Promise<void> }> {
  const handle: IsolatedDatabaseHandle = await provisionIsolatedDatabase("test");
  const previous = process.env.KM_TEST_DB_NAME;
  process.env.KM_TEST_DB_NAME = handle.databaseName;
  let pool: Pool;
  try {
    pool = createDatabasePool(databaseConfig("test"));
  } finally {
    if (previous === undefined) delete process.env.KM_TEST_DB_NAME;
    else process.env.KM_TEST_DB_NAME = previous;
  }
  await runMigrations(pool);
  return {
    pool,
    dispose: async () => {
      await pool.end();
      await disposeIsolatedDatabase(handle);
    },
  };
}

export type LinkScope = {
  workspaceId: string;
  hubSourceId: string;
  hubFolderId: string;
  managedSourceId: string;
  managedFolderId: string;
};

/** One Workspace the owner belongs to, with a Hub source and a folder-sync source, each with a root folder. */
export async function setupLinkScope(pool: Pool, options: { name?: string } = {}): Promise<LinkScope> {
  const workspaceId = uuidv7();
  const hubSourceId = uuidv7();
  const hubFolderId = uuidv7();
  const managedSourceId = uuidv7();
  const managedFolderId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.users.upsertIdentity(linkOwner);
    await repositories.users.upsertIdentity(linkOutsider);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: options.name ?? `Link Workspace ${workspaceId.slice(-6)}`, createdBy: linkOwner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: linkOwner.id, role: "OWNER", now }));
    const sources = [
      { id: hubSourceId, name: "Hub Notes", sourceType: "HUB" as const, ownership: "HUB_MANAGED" as const, folderId: hubFolderId },
      { id: managedSourceId, name: "Vault", sourceType: "FOLDER_SYNC" as const, ownership: "SOURCE_MANAGED" as const, folderId: managedFolderId },
    ];
    for (const source of sources) {
      await repositories.sources.insert({
        id: source.id, name: source.name, workspaceId, sourceType: source.sourceType, ownership: source.ownership,
        status: "ACTIVE", syncVersion: 0, createdBy: linkOwner.id, updatedBy: linkOwner.id,
        archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.tree.insert({
        id: source.folderId, sourceId: source.id, parentId: null, nodeType: "FOLDER", name: "Root",
        documentId: null, position: 0, status: "ACTIVE", updatedBy: linkOwner.id, archivedBy: null, archivedAt: null,
      });
    }
  });
  return { workspaceId, hubSourceId, hubFolderId, managedSourceId, managedFolderId };
}

/** A Hub document, written the way a user writes one — through the command service, so the index hook runs. */
export async function hubDocument(pool: Pool, scope: LinkScope, title: string, markdown: string): Promise<{ documentId: string; revisionId: string }> {
  const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
  const created = await hub.createDocument(callerFromIdentity(linkOwner), { sourceId: scope.hubSourceId, parentId: scope.hubFolderId, title, markdown, metadata: {} });
  return { documentId: created.documentId, revisionId: created.revisionId };
}

/** A document of a folder-sync source at `sourcePath`, written through the projection the importer uses. */
export async function managedDocument(pool: Pool, scope: LinkScope, sourcePath: string, title: string, markdown: string): Promise<{ documentId: string; revisionId: string }> {
  return new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const projection = bindSourceProjection(repositories, { id: scope.managedSourceId, workspaceId: scope.workspaceId });
    const created = await projection.projectDocument(callerFromIdentity(linkOwner), {
      sourceId: scope.managedSourceId, parentId: scope.managedFolderId, title, markdown, metadata: {},
      mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath },
    });
    return { documentId: created.documentId, revisionId: created.revisionId };
  });
}

export async function reviseHubDocument(pool: Pool, documentId: string, expectedCurrentRevisionId: string, title: string, markdown: string) {
  const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
  return hub.createRevision(callerFromIdentity(linkOwner), { documentId, expectedCurrentRevisionId, title, markdown, metadata: {} });
}
