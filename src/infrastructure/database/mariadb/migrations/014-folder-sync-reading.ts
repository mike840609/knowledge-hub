import type { Migration } from "./types";
export const folderSyncReadingMigration: Migration = {
  version: 14,
  name: "folder-sync-reading",
  statements: [
    `CREATE TABLE sync_run_changes (
      id UUID NOT NULL PRIMARY KEY, run_id UUID NOT NULL, source_id UUID NOT NULL, workspace_id UUID NOT NULL,
      ordinal INT UNSIGNED NOT NULL, kind ENUM('DOCUMENT','FOLDER','ASSET') NOT NULL,
      labels JSON NOT NULL, source_path TEXT NOT NULL, previous_path TEXT NULL, title TEXT NOT NULL,
      document_id UUID NULL, before_revision_id UUID NULL, after_revision_id UUID NULL,
      before_revision_no INT UNSIGNED NULL, after_revision_no INT UNSIGNED NULL, diagnostics JSON NOT NULL,
      UNIQUE KEY run_ordinal (run_id, ordinal), KEY workspace_source_run (workspace_id, source_id, run_id), KEY document_changes (document_id),
      FOREIGN KEY (run_id) REFERENCES sync_runs(id), FOREIGN KEY (source_id) REFERENCES knowledge_sources(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id), FOREIGN KEY (document_id) REFERENCES knowledge_documents(id),
      FOREIGN KEY (before_revision_id) REFERENCES knowledge_revisions(id), FOREIGN KEY (after_revision_id) REFERENCES knowledge_revisions(id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE document_read_progress (
      user_id UUID NOT NULL, workspace_id UUID NOT NULL, document_id UUID NOT NULL,
      revision_id UUID NOT NULL, revision_no INT UNSIGNED NOT NULL, read_at DATETIME(6) NOT NULL,
      PRIMARY KEY (user_id, workspace_id, document_id),
      FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (document_id) REFERENCES knowledge_documents(id), FOREIGN KEY (revision_id) REFERENCES knowledge_revisions(id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    "CREATE INDEX sync_runs_applied_cursor ON sync_runs(status, completed_at, id)",
  ],
};
