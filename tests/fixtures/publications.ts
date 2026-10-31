import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { bindSourceProjection } from "@/modules/sources/application/source-knowledge-projection-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import type { Publication, PublicationDocument, PublishOrigin } from "@/modules/sources/domain/publication";
import { createPersonalWorkspaceInsert, createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { disposeIsolatedDatabase, provisionIsolatedDatabase } from "../../scripts/db/test-database";
import { runMigrations, type IsolatedDatabaseHandle } from "../../scripts/db/migrate";

export const mikeIdentity: UserIdentity = {
  id: "0199f600-0000-7000-8000-000000000001",
  emp_id: "PUB-MIKE",
  name: "Mike",
  org_code: "HRSD",
};
export const annIdentity: UserIdentity = {
  id: "0199f600-0000-7000-8000-000000000002",
  emp_id: "PUB-ANN",
  name: "Ann",
  org_code: "HRSD",
};

const ANN_EXTERNAL_GROUP_ID = "pub-team-editors";

export type PublicationFixture = Awaited<ReturnType<typeof createPublicationFixture>>;

/**
 * One isolated database with two personal workspaces (Mike, Ann), a team where
 * both are direct members, and a second team where Ann is only in an SSO group.
 * Originals are written through the same application services a person uses
 * (Hub commands and the Source projection), so a fixture never fabricates a
 * document the product could not create.
 */
export async function createPublicationFixture() {
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

  const uow = new MariaDbUnitOfWork(pool);
  const now = new Date();
  const mike = callerFromIdentity(mikeIdentity);
  const ann: CallerContext = {
    ...callerFromIdentity(annIdentity),
    validatedExternalGroupIds: [ANN_EXTERNAL_GROUP_ID],
  };

  const mikePersonalWorkspaceId = uuidv7();
  const annPersonalWorkspaceId = uuidv7();
  const teamWorkspaceId = uuidv7();
  const groupTeamWorkspaceId = uuidv7();
  const mikeFolderSourceId = uuidv7();
  const annFolderSourceId = uuidv7();

  await uow.run(async (repositories) => {
    await repositories.users.upsertIdentity(mikeIdentity);
    await repositories.users.upsertIdentity(annIdentity);
    await repositories.workspaces.insert(createPersonalWorkspaceInsert({ id: mikePersonalWorkspaceId, name: "My Space", ownerUserId: mikeIdentity.id, now }));
    await repositories.workspaces.insert(createPersonalWorkspaceInsert({ id: annPersonalWorkspaceId, name: "My Space", ownerUserId: annIdentity.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: mikePersonalWorkspaceId, userId: mikeIdentity.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: annPersonalWorkspaceId, userId: annIdentity.id, role: "OWNER", now }));

    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: teamWorkspaceId, name: "Direct Team", createdBy: mikeIdentity.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: teamWorkspaceId, userId: mikeIdentity.id, role: "OWNER", now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: teamWorkspaceId, userId: annIdentity.id, role: "EDITOR", now }));

    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: groupTeamWorkspaceId, name: "Group Team", createdBy: mikeIdentity.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: groupTeamWorkspaceId, userId: mikeIdentity.id, role: "OWNER", now }));
    await repositories.groupMappings.insert({
      id: uuidv7(), workspaceId: groupTeamWorkspaceId, externalGroupId: ANN_EXTERNAL_GROUP_ID,
      role: "EDITOR", createdBy: mikeIdentity.id, createdAt: now, updatedAt: now,
    });

    for (const source of [
      { id: mikeFolderSourceId, name: "Mike Repo", workspaceId: mikePersonalWorkspaceId, actor: mikeIdentity.id },
      { id: annFolderSourceId, name: "Ann Repo", workspaceId: annPersonalWorkspaceId, actor: annIdentity.id },
    ]) {
      await repositories.sources.insert({
        id: source.id, name: source.name, workspaceId: source.workspaceId,
        sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
        createdBy: source.actor, updatedBy: source.actor, archivedBy: null, archivedAt: null,
        createdAt: now, updatedAt: now,
      });
    }
  });

  const mikeHubSourceId = await ensureDefaultHubSource(uow, mike, mikePersonalWorkspaceId);
  const annHubSourceId = await ensureDefaultHubSource(uow, ann, annPersonalWorkspaceId);

  function hubSourceOf(caller: CallerContext): string {
    return caller.identity.id === mikeIdentity.id ? mikeHubSourceId : annHubSourceId;
  }

  function folderSourceOf(caller: CallerContext): string {
    return caller.identity.id === mikeIdentity.id ? mikeFolderSourceId : annFolderSourceId;
  }

  /** A Hub original, written through the Hub command service. */
  async function createHubOriginal(caller: CallerContext, title: string, markdown: string) {
    const hub = new HubKnowledgeCommandServiceImpl(uow);
    return hub.createDocument(caller, { sourceId: hubSourceOf(caller), parentId: null, title, markdown, metadata: {} });
  }

  /** A Folder Sync folder, written through the source projection. */
  async function createFolder(caller: CallerContext, sourcePath: string, name: string): Promise<{ treeNodeId: string }> {
    return uow.run(async (repositories) => {
      const sourceId = folderSourceOf(caller);
      const source = await repositories.sources.findById(sourceId);
      if (!source) throw new Error("Fixture folder source is missing.");
      const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId: source.workspaceId });
      return projection.projectFolder(caller, {
        sourceId,
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath },
        parentId: null,
        name,
      });
    });
  }

  /** A synced original at `sourcePath`, written through the source projection. */
  async function createSyncedOriginal(
    caller: CallerContext,
    input: { parentId: string | null; sourcePath: string; title: string; markdown: string; metadata?: KnowledgeMetadata },
  ) {
    return uow.run(async (repositories) => {
      const sourceId = folderSourceOf(caller);
      const source = await repositories.sources.findById(sourceId);
      if (!source) throw new Error("Fixture folder source is missing.");
      const projection = bindSourceProjection(repositories, { id: sourceId, workspaceId: source.workspaceId });
      return projection.projectDocument(caller, {
        sourceId,
        parentId: input.parentId,
        title: input.title,
        markdown: input.markdown,
        metadata: input.metadata ?? {},
        mapping: { sourceEntryId: uuidv7(), externalId: null, sourcePath: input.sourcePath },
      });
    });
  }

  /**
   * A publication source plus its publication row and first contribution. The
   * publish service arrives in a later task; everything here is the same shape
   * it will write.
   */
  async function createPublication(input: {
    teamWorkspaceId?: string;
    name: string;
    kind: "FOLDER" | "DOCUMENT";
    creator: CallerContext;
    origin: PublishOrigin;
  }): Promise<{ publication: Publication; sourceId: string; contributionId: string }> {
    const sourceId = uuidv7();
    const publicationId = uuidv7();
    const contributionId = uuidv7();
    const teamId = input.teamWorkspaceId ?? teamWorkspaceId;
    await uow.run(async (repositories) => {
      await repositories.sources.insert({
        id: sourceId, name: input.name, workspaceId: teamId,
        sourceType: "PUBLICATION", ownership: "SOURCE_MANAGED", status: "ACTIVE", syncVersion: 0,
        createdBy: input.creator.identity.id, updatedBy: input.creator.identity.id,
        archivedBy: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const publication: Publication = {
        id: publicationId, sourceId, teamWorkspaceId: teamId, name: input.name,
        kind: input.kind, creatorUserId: input.creator.identity.id, status: "ACTIVE",
      };
      await repositories.publications.insert(publication);
      await repositories.publications.insertContribution({
        id: contributionId, publicationId, userId: input.creator.identity.id, origin: input.origin,
        leftAt: null, rightsFrozenAt: null, pendingCatchUp: false,
      });
    });
    const publication: Publication = {
      id: publicationId, sourceId, teamWorkspaceId: teamId, name: input.name,
      kind: input.kind, creatorUserId: input.creator.identity.id, status: "ACTIVE",
    };
    return { publication, sourceId, contributionId };
  }

  async function addContribution(input: {
    publicationId: string;
    user: CallerContext;
    origin: PublishOrigin;
  }): Promise<string> {
    const id = uuidv7();
    await uow.run((repositories) => repositories.publications.insertContribution({
      id, publicationId: input.publicationId, userId: input.user.identity.id, origin: input.origin,
      leftAt: null, rightsFrozenAt: null, pendingCatchUp: false,
    }));
    return id;
  }

  /**
   * A team copy in the publication's source, with its own first revision and a
   * root tree node. `sourcePath` is the publication-relative path, or null for
   * a Hub-written original.
   */
  async function createTeamDocument(input: {
    publication: { publication: Publication; sourceId: string };
    creatorContributionId: string;
    originalDocumentId: string;
    sourcePath: string | null;
    title?: string;
    markdown?: string;
    status?: "ACTIVE" | "ARCHIVED";
  }): Promise<PublicationDocument> {
    const documentId = uuidv7();
    const revisionId = uuidv7();
    const treeNodeId = uuidv7();
    const actor = mikeIdentity.id;
    const now = new Date();
    await uow.run(async (repositories) => {
      await repositories.documents.insertDraft({
        id: documentId, sourceId: input.publication.sourceId, currentRevisionId: null,
        status: input.status ?? "ACTIVE", createdBy: actor, updatedBy: actor,
        archivedBy: input.status === "ARCHIVED" ? actor : null,
        archivedAt: input.status === "ARCHIVED" ? now : null,
        createdAt: now, updatedAt: now,
      });
      await repositories.revisions.insert({
        id: revisionId, documentId, revisionNo: 1,
        title: input.title ?? "Team copy", markdown: input.markdown ?? "body", metadata: {},
        contentHash: "a".repeat(64), createdBy: actor, createdAt: now,
      });
      await repositories.documents.setCurrentRevision(documentId, revisionId, actor);
      await repositories.tree.insert({
        id: treeNodeId, sourceId: input.publication.sourceId, parentId: null, nodeType: "DOCUMENT",
        name: null, documentId, position: 0, status: input.status ?? "ACTIVE",
        updatedBy: actor, archivedBy: input.status === "ARCHIVED" ? actor : null,
        archivedAt: input.status === "ARCHIVED" ? now : null,
      });
      await repositories.publications.insertDocument({
        teamDocumentId: documentId, publicationId: input.publication.publication.id,
        creatorContributionId: input.creatorContributionId,
        currentOriginalDocumentId: input.originalDocumentId,
        sourcePath: input.sourcePath, status: input.status ?? "ACTIVE",
      });
    });
    return {
      teamDocumentId: documentId, publicationId: input.publication.publication.id,
      creatorContributionId: input.creatorContributionId,
      currentOriginalDocumentId: input.originalDocumentId,
      sourcePath: input.sourcePath, status: input.status ?? "ACTIVE",
    };
  }

  /** A visible review thread and one comment, needed by notification tables. */
  async function createDiscussion(input: {
    workspaceId: string;
    documentId: string;
    revisionId: string;
    authorId: string;
  }): Promise<{ threadId: string; commentId: string }> {
    const threadId = uuidv7();
    const commentId = uuidv7();
    const now = new Date();
    await pool.query(
      `INSERT INTO document_review_threads
         (id, document_id, created_revision_id, created_by, creation_idempotency_key, creation_request_hash,
          origin_share_link_id, anchor_json, status, visibility, hidden_by, hidden_at, hidden_reason,
          resolved_by, resolved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'OPEN', 'VISIBLE', NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      [threadId, input.documentId, input.revisionId, input.authorId, uuidv7(), "b".repeat(64), JSON.stringify({}), now, now],
    );
    await pool.query(
      `INSERT INTO document_review_comments
         (id, thread_id, author_user_id, body, visibility, hidden_by, hidden_at, hidden_reason, created_at, idempotency_key, request_hash)
       VALUES (?, ?, ?, ?, 'VISIBLE', NULL, NULL, NULL, ?, ?, ?)`,
      [commentId, threadId, input.authorId, "hello", now, uuidv7(), "c".repeat(64)],
    );
    return { threadId, commentId };
  }

  async function revisionIdOf(documentId: string): Promise<string> {
    const rows = await pool.query<{ current_revision_id: string }[]>(
      "SELECT current_revision_id FROM knowledge_documents WHERE id = ?",
      [documentId],
    );
    return String(rows[0]?.current_revision_id);
  }

  return {
    pool,
    uow,
    mike,
    ann,
    mikePersonalWorkspaceId,
    annPersonalWorkspaceId,
    teamWorkspaceId,
    groupTeamWorkspaceId,
    annExternalGroupId: ANN_EXTERNAL_GROUP_ID,
    mikeHubSourceId,
    annHubSourceId,
    mikeFolderSourceId,
    annFolderSourceId,
    createHubOriginal,
    createFolder,
    createSyncedOriginal,
    createPublication,
    addContribution,
    createTeamDocument,
    createDiscussion,
    revisionIdOf,
    dispose: async () => {
      await pool.end();
      await disposeIsolatedDatabase(handle);
    },
  };
}
