import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { contentFingerprint } from "@/modules/knowledge/domain/content";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { SourceRepositories } from "@/modules/sources/ports/unit-of-work";
import { localIdentityConfig } from "@/server/config";

export const DEV_FIXTURE_IDS = {
  workspace: "0199f000-0000-7000-8000-000000000001",
  source: "0199f000-0000-7000-8000-000000000101",
  folder: "0199f000-0000-7000-8000-000000000201",
};

/** Task 9 read-only browser fixtures: Query Master + SWFP plus a no-membership workspace for direct-URL denial checks. */
export const BROWSER_FIXTURE_IDS = {
  queryMasterWorkspace: "0199f100-0000-7000-8000-000000000001",
  swfpWorkspace: "0199f100-0000-7000-8000-000000000002",
  restrictedWorkspace: "0199f100-0000-7000-8000-000000000003",
  obsidianWikiSource: "0199f100-0000-7000-8000-000000000101",
  swfpSource: "0199f100-0000-7000-8000-000000000102",
  restrictedSource: "0199f100-0000-7000-8000-000000000103",
  secretDocument: "0199f100-0000-7000-8000-000000000201",
  secretRevision: "0199f100-0000-7000-8000-000000000202",
  secretNode: "0199f100-0000-7000-8000-000000000203",
};

/** Mirrored literally in tests/e2e/knowledge-browser.spec.ts (Playwright cannot resolve `@/` aliases). */
export const BROWSER_FIXTURES = {
  architectureTitle: "Architecture",
  architectureBodyV1: "The Query Master architecture notes, first revision.",
  architectureBodyV2: "The Query Master architecture notes, second revision.",
  runbooksTitle: "Runbooks",
  runbooksBody: "Team runbooks for Query Master operations.",
  retiredTitle: "Retired Notes",
  retiredBody: "Deprecated notes kept for history.",
  swfpTitle: "SWFP Onboarding",
  swfpBody: "Onboarding notes for the SWFP workspace.",
  secretTitle: "Restricted Secret Plan",
  secretBody: "restricted-secret-body-9f31",
};

async function ensureWorkspace(repositories: SourceRepositories, id: string, name: string, now: Date): Promise<void> {
  if (!(await repositories.workspaces.findById(id))) {
    await repositories.workspaces.insert({ id, name, createdAt: now, updatedAt: now });
  }
}

async function ensureSource(repositories: SourceRepositories, options: { id: string; name: string; workspaceId: string; createdBy: string; now: Date }): Promise<void> {
  if (!(await repositories.sources.findById(options.id))) {
    await repositories.sources.insert({
      id: options.id, name: options.name, workspaceId: options.workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: options.createdBy, updatedBy: options.createdBy, archivedBy: null, archivedAt: null, createdAt: options.now, updatedAt: options.now,
    });
  }
}

async function seedBrowserFixtures(pool: ReturnType<typeof createDatabasePool>, identity: UserIdentity): Promise<void> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(identity);
    await ensureWorkspace(repositories, BROWSER_FIXTURE_IDS.queryMasterWorkspace, "Query Master", now);
    await ensureWorkspace(repositories, BROWSER_FIXTURE_IDS.swfpWorkspace, "SWFP", now);
    await ensureWorkspace(repositories, BROWSER_FIXTURE_IDS.restrictedWorkspace, "Restricted Vault", now);
    for (const workspaceId of [BROWSER_FIXTURE_IDS.queryMasterWorkspace, BROWSER_FIXTURE_IDS.swfpWorkspace]) {
      if (!(await repositories.workspaceMemberships.find(workspaceId, identity.id))) {
        await repositories.workspaceMemberships.insert({ workspaceId, userId: identity.id, createdAt: now });
      }
    }
    await ensureSource(repositories, { id: BROWSER_FIXTURE_IDS.obsidianWikiSource, name: "Obsidian Wiki", workspaceId: BROWSER_FIXTURE_IDS.queryMasterWorkspace, createdBy: identity.id, now });
    await ensureSource(repositories, { id: BROWSER_FIXTURE_IDS.swfpSource, name: "SWFP Handbook", workspaceId: BROWSER_FIXTURE_IDS.swfpWorkspace, createdBy: identity.id, now });
    await ensureSource(repositories, { id: BROWSER_FIXTURE_IDS.restrictedSource, name: "Restricted Vault", workspaceId: BROWSER_FIXTURE_IDS.restrictedWorkspace, createdBy: identity.id, now });
    if (!(await repositories.documents.findById(BROWSER_FIXTURE_IDS.secretDocument))) {
      const content = { title: BROWSER_FIXTURES.secretTitle, markdown: BROWSER_FIXTURES.secretBody, metadata: {} };
      await repositories.documents.insertDraft({
        id: BROWSER_FIXTURE_IDS.secretDocument, sourceId: BROWSER_FIXTURE_IDS.restrictedSource, currentRevisionId: null,
        status: "ACTIVE", createdBy: identity.id, updatedBy: identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: BROWSER_FIXTURE_IDS.secretRevision, documentId: BROWSER_FIXTURE_IDS.secretDocument, revisionNo: 1,
        ...content, contentHash: contentFingerprint(content), createdBy: identity.id, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(BROWSER_FIXTURE_IDS.secretDocument, BROWSER_FIXTURE_IDS.secretRevision, identity.id);
      await repositories.tree.insert({
        id: BROWSER_FIXTURE_IDS.secretNode, sourceId: BROWSER_FIXTURE_IDS.restrictedSource, parentId: null,
        nodeType: "DOCUMENT", name: null, documentId: BROWSER_FIXTURE_IDS.secretDocument, position: 0,
        status: "ACTIVE", updatedBy: identity.id, archivedBy: null, archivedAt: null,
      });
      await repositories.documents.assertComplete(BROWSER_FIXTURE_IDS.secretDocument);
    }
  });
  const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
  const caller = callerFromIdentity(identity);
  const treeCount = await unitOfWork.run((repositories) => repositories.tree.listBySource(BROWSER_FIXTURE_IDS.obsidianWikiSource));
  if (treeCount.length === 0) {
    const architecture = await hub.createDocument(caller, {
      sourceId: BROWSER_FIXTURE_IDS.obsidianWikiSource, parentId: null,
      title: BROWSER_FIXTURES.architectureTitle, markdown: BROWSER_FIXTURES.architectureBodyV1, metadata: {},
    });
    await hub.createRevision(caller, {
      documentId: architecture.documentId, expectedCurrentRevisionId: architecture.revisionId,
      title: BROWSER_FIXTURES.architectureTitle, markdown: BROWSER_FIXTURES.architectureBodyV2, metadata: {},
    });
    await hub.createDocument(caller, {
      sourceId: BROWSER_FIXTURE_IDS.obsidianWikiSource, parentId: null,
      title: BROWSER_FIXTURES.runbooksTitle, markdown: BROWSER_FIXTURES.runbooksBody, metadata: {},
    });
    const retired = await hub.createDocument(caller, {
      sourceId: BROWSER_FIXTURE_IDS.obsidianWikiSource, parentId: null,
      title: BROWSER_FIXTURES.retiredTitle, markdown: BROWSER_FIXTURES.retiredBody, metadata: {},
    });
    await hub.archiveDocument(caller, retired.documentId);
  }
  const swfpTree = await unitOfWork.run((repositories) => repositories.tree.listBySource(BROWSER_FIXTURE_IDS.swfpSource));
  if (swfpTree.length === 0) {
    await hub.createDocument(caller, {
      sourceId: BROWSER_FIXTURE_IDS.swfpSource, parentId: null,
      title: BROWSER_FIXTURES.swfpTitle, markdown: BROWSER_FIXTURES.swfpBody, metadata: {},
    });
  }
}

export async function seedDevelopmentDatabase(): Promise<void> {
  const pool = createDatabasePool(databaseConfig("dev"));
  try {
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const identity = localIdentityConfig();
    await unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(identity);
      const now = new Date();
      const workspace = await repositories.workspaces.findById(DEV_FIXTURE_IDS.workspace);
      if (!workspace) await repositories.workspaces.insert({ id: DEV_FIXTURE_IDS.workspace, name: "Local Knowledge", createdAt: now, updatedAt: now });
      if (!(await repositories.workspaceMemberships.find(DEV_FIXTURE_IDS.workspace, identity.id))) await repositories.workspaceMemberships.insert({ workspaceId: DEV_FIXTURE_IDS.workspace, userId: identity.id, createdAt: now });
      const existing = await repositories.sources.findById(DEV_FIXTURE_IDS.source);
      if (!existing) {
        await repositories.sources.insert({
          id: DEV_FIXTURE_IDS.source, name: "Local Hub", workspaceId: DEV_FIXTURE_IDS.workspace, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
          createdBy: identity.id, updatedBy: identity.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
        });
      }
      const folder = await repositories.tree.findById(DEV_FIXTURE_IDS.folder);
      if (!folder) await repositories.tree.insert({ id: DEV_FIXTURE_IDS.folder, sourceId: DEV_FIXTURE_IDS.source, parentId: null, nodeType: "FOLDER", name: "Getting Started", documentId: null, position: 0, status: "ACTIVE", updatedBy: identity.id, archivedBy: null, archivedAt: null });
    });
    await seedBrowserFixtures(pool, identity);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDevelopmentDatabase().then(() => console.log("Development fixtures are ready.")).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
