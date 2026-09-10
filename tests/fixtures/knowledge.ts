import type { Pool } from "mariadb";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { KnowledgeApplicationService } from "@/modules/knowledge/application/service";
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import type { KnowledgeSource } from "@/modules/sources/domain/source";
import { uuidv7 } from "@/shared/ids/uuidv7";

export const fixtureIdentity: UserIdentity = { id: "0199f000-0000-7000-8000-000000000011", emp_id: "FIXTURE-0011", name: "Fixture User", org_code: "FIXTURE" };
export const secondFixtureIdentity: UserIdentity = { id: "0199f000-0000-7000-8000-000000000012", emp_id: "FIXTURE-0012", name: "Fixture User Two", org_code: "FIXTURE" };

export function fixtureCaller(identity = fixtureIdentity) {
  return callerFromIdentity(identity);
}

export async function ensureUser(pool: Pool, identity: UserIdentity): Promise<void> {
  const uow = new MariaDbUnitOfWork(pool);
  await uow.run(async ({ users }) => users.upsertIdentity(identity));
}

export async function createSourceFixture(pool: Pool, options: { managed?: boolean; orgCode?: string; workspaceId?: string } = {}): Promise<{ source: KnowledgeSource; folderId: string; workspaceId: string }> {
  const uow = new MariaDbUnitOfWork(pool);
  const sourceId = uuidv7();
  const folderId = uuidv7();
  const workspaceId = options.workspaceId ?? uuidv7();
  const now = new Date();
  const source: KnowledgeSource = {
    id: sourceId, name: options.managed ? "Managed Fixture Source" : "Hub Fixture Source", workspaceId,
    sourceType: options.managed ? "FOLDER_SYNC" : "HUB", ownership: options.managed ? "SOURCE_MANAGED" : "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
    createdBy: fixtureIdentity.id, updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
  };
  await uow.run(async (repositories) => {
    await repositories.users.upsertIdentity(fixtureIdentity);
    await repositories.users.upsertIdentity(secondFixtureIdentity);
    await repositories.workspaces.insert({ id: workspaceId, name: options.orgCode ? `Fixture ${options.orgCode}` : "Fixture Workspace", createdAt: now, updatedAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: fixtureIdentity.id, createdAt: now });
    await repositories.workspaceMemberships.insert({ workspaceId, userId: secondFixtureIdentity.id, createdAt: now });
    await repositories.sources.insert(source);
    await repositories.tree.insert({ id: folderId, sourceId, parentId: null, nodeType: "FOLDER", name: "Fixture Folder", documentId: null, position: 0, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null });
  });
  return { source, folderId, workspaceId };
}

export async function createDocumentFixture(pool: Pool, sourceId: string, folderId: string, identity = fixtureIdentity) {
  await ensureUser(pool, identity);
  const service = new KnowledgeApplicationService(new MariaDbUnitOfWork(pool));
  return service.createHubManagedDocument(callerFromIdentity(identity), { sourceId, parentId: folderId, title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } });
}

export async function createDocumentForAnySource(pool: Pool, sourceId: string, folderId: string, identity = fixtureIdentity) {
  await ensureUser(pool, identity);
  const documentId = uuidv7();
  const revisionId = uuidv7();
  const now = new Date();
  const content = { title: "Fixture Document", markdown: "fixture body", metadata: { fixture: true } };
  const uow = new MariaDbUnitOfWork(pool);
  await uow.run(async (repositories) => {
    await repositories.documents.insertDraft({ id: documentId, sourceId, currentRevisionId: null, status: "ACTIVE", createdBy: identity.id, updatedBy: identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now });
    await repositories.revisions.insert({ id: revisionId, documentId, revisionNo: 1, ...content, contentHash: contentFingerprint(content), createdBy: identity.id, createdAt: now });
    await repositories.documents.setCurrentRevision(documentId, revisionId, identity.id);
    await repositories.tree.insert({ id: uuidv7(), sourceId, parentId: folderId, nodeType: "DOCUMENT", name: null, documentId, position: 0, status: "ACTIVE", updatedBy: identity.id, archivedBy: null, archivedAt: null });
    await repositories.documents.assertComplete(documentId);
  });
  return { documentId, revisionId };
}

export async function createEntryFixture(pool: Pool, sourceId: string, documentId: string, externalId = `external-${uuidv7()}`, contentHash: string | null = null) {
  const entryId = uuidv7();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    const nodes = await pool.query<{ id: unknown }[]>("SELECT id FROM knowledge_tree_nodes WHERE source_id = ? AND document_id = ?", [sourceId, documentId]);
    if (nodes.length !== 1) throw new Error(`Cannot create a mapped DOCUMENT entry without exactly one tree node for document ${documentId}.`);
    await repositories.entries.insert({ id: entryId, sourceId, externalId, sourcePath: "docs/fixture.md", entryType: "DOCUMENT", contentHash, documentId, treeNodeId: String(nodes[0].id), status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, firstSeenAt: new Date(), lastSeenAt: new Date() });
  });
  return { entryId, externalId };
}

export async function createFolderEntryFixture(pool: Pool, sourceId: string, treeNodeId: string, sourcePath = `docs/folder-${uuidv7()}`) {
  const entryId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run(async (repositories) => {
    await repositories.entries.insert({ id: entryId, sourceId, externalId: null, sourcePath, entryType: "FOLDER", contentHash: null, documentId: null, treeNodeId, status: "ACTIVE", updatedBy: fixtureIdentity.id, archivedBy: null, archivedAt: null, firstSeenAt: now, lastSeenAt: now });
  });
  return { entryId };
}
