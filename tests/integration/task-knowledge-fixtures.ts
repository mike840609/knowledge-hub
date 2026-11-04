import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

export function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `TASK-EXPORT-${id}`, name, org_code: "TASK" };
}

export const tokenHash = (token: string) => createHash("sha256").update(token, "utf8").digest();
export const newToken = () => randomBytes(32).toString("base64url");

/** A My Space with one ACTIVE FOLDER_SYNC Source, as a binding needs. */
export async function seedMySpaceWithFolderSource(pool: Pool, name = "Task Owner") {
  const owner = newIdentity(name);
  const uow = new MariaDbUnitOfWork(pool);
  await uow.run((r) => r.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const sourceId = await insertFolderSource(pool, workspace.id, owner.id);
  return { owner, workspaceId: workspace.id, sourceId };
}

export async function insertFolderSource(pool: Pool, workspaceId: string, actorId: string, status: "ACTIVE" | "ARCHIVED" = "ACTIVE") {
  const sourceId = uuidv7();
  const now = new Date();
  await new MariaDbUnitOfWork(pool).run((r) =>
    r.sources.insert({
      id: sourceId, name: `Synced ${sourceId.slice(-6)}`, workspaceId, sourceType: "FOLDER_SYNC", ownership: "SOURCE_MANAGED",
      status, syncVersion: 0, createdBy: actorId, updatedBy: actorId,
      archivedBy: status === "ARCHIVED" ? actorId : null, archivedAt: status === "ARCHIVED" ? now : null, createdAt: now, updatedAt: now,
    }),
  );
  return sourceId;
}

/** A synced document as Folder Sync leaves it: a document row and an entry at its normalized source path. */
export async function insertSyncedDocument(
  pool: Pool,
  sourceId: string,
  actorId: string,
  sourcePath: string,
  options: { documentStatus?: "ACTIVE" | "ARCHIVED"; entryStatus?: "ACTIVE" | "ARCHIVED" } = {},
) {
  const documentId = uuidv7();
  const documentStatus = options.documentStatus ?? "ACTIVE";
  const entryStatus = options.entryStatus ?? "ACTIVE";
  const archived = (status: string) => (status === "ARCHIVED" ? [actorId, new Date()] : [null, null]);
  await pool.query(
    "INSERT INTO knowledge_documents (id, source_id, current_revision_id, status, created_by, updated_by, archived_by, archived_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
    [documentId, sourceId, documentStatus, actorId, actorId, ...archived(documentStatus)],
  );
  const treeNodeId = uuidv7();
  await pool.query(
    "INSERT INTO knowledge_tree_nodes (id, source_id, parent_id, node_type, name, document_id, position, status, updated_by, archived_by, archived_at) VALUES (?, ?, NULL, 'DOCUMENT', NULL, ?, 0, ?, ?, ?, ?)",
    [treeNodeId, sourceId, documentId, entryStatus, actorId, ...archived(entryStatus)],
  );
  await pool.query(
    "INSERT INTO source_entries (id, source_id, external_id, source_path, entry_type, content_hash, document_id, tree_node_id, status, updated_by, archived_by, archived_at) VALUES (?, ?, ?, ?, 'DOCUMENT', NULL, ?, ?, ?, ?, ?, ?)",
    [uuidv7(), sourceId, `ext-${documentId}`, sourcePath, documentId, treeNodeId, entryStatus, actorId, ...archived(entryStatus)],
  );
  return documentId;
}
