import type { Migration } from "./types";

/**
 * Task Knowledge Export (2026-11-04 design §6). Foreign keys only to rows that
 * never take part in Folder Sync writes: credential → binding, binding →
 * Source, task → binding, revision → task, reference → task. The resolved
 * document id has none: documents are never hard-deleted and availability is
 * re-checked on every read. Workspace and owner are derived through the
 * binding, never stored on task rows.
 */
export const taskKnowledgeExportMigration: Migration = {
  version: 32,
  name: "task-knowledge-export",
  statements: [
    `CREATE TABLE task_export_bindings (
      id UUID NOT NULL,
      owner_user_id UUID NOT NULL,
      workspace_id UUID NOT NULL,
      label VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      revoked_at DATETIME(6) NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_task_bindings_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_bindings_label_nonempty CHECK (CHAR_LENGTH(label) > 0),
      CONSTRAINT ck_task_bindings_status CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL)),
      KEY idx_task_bindings_owner (owner_user_id, created_at, id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE task_export_credentials (
      id UUID NOT NULL,
      binding_id UUID NOT NULL,
      token_hash BINARY(32) NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      revoked_at DATETIME(6) NULL,
      active_binding_id UUID AS (IF(status = 'ACTIVE', binding_id, NULL)) PERSISTENT,
      PRIMARY KEY (id),
      CONSTRAINT uq_task_credentials_hash UNIQUE (token_hash),
      CONSTRAINT uq_task_credentials_active UNIQUE (active_binding_id),
      CONSTRAINT fk_task_credentials_binding FOREIGN KEY (binding_id) REFERENCES task_export_bindings(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_credentials_status CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE task_results (
      id UUID NOT NULL,
      binding_id UUID NOT NULL,
      task_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      lifecycle VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
      archived_by UUID NULL,
      archived_at DATETIME(6) NULL,
      latest_revision_no INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_task_results_binding_task UNIQUE (binding_id, task_id),
      CONSTRAINT fk_task_results_binding FOREIGN KEY (binding_id) REFERENCES task_export_bindings(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_results_lifecycle CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
      CONSTRAINT ck_task_results_lifecycle_provenance CHECK ((lifecycle = 'ACTIVE' AND archived_by IS NULL AND archived_at IS NULL) OR (lifecycle = 'ARCHIVED' AND archived_by IS NOT NULL AND archived_at IS NOT NULL)),
      KEY idx_task_results_binding_list (binding_id, lifecycle, updated_at, id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE task_result_revisions (
      id UUID NOT NULL,
      task_result_id UUID NOT NULL,
      revision_no INT UNSIGNED NOT NULL,
      artifact_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id),
      CONSTRAINT uq_task_revisions_task_revision UNIQUE (task_result_id, revision_no),
      CONSTRAINT fk_task_revisions_task FOREIGN KEY (task_result_id) REFERENCES task_results(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_revisions_positive CHECK (revision_no > 0),
      CONSTRAINT ck_task_revisions_json CHECK (JSON_VALID(artifact_json))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE task_result_references (
      id UUID NOT NULL,
      task_result_id UUID NOT NULL,
      revision_no INT UNSIGNED NOT NULL,
      ordinal SMALLINT UNSIGNED NOT NULL,
      reference_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      locator TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      resolution VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
      resolved_document_id UUID NULL,
      PRIMARY KEY (id),
      CONSTRAINT uq_task_references_position UNIQUE (task_result_id, revision_no, ordinal),
      CONSTRAINT fk_task_references_task FOREIGN KEY (task_result_id) REFERENCES task_results(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_references_type CHECK (reference_type IN ('WIKI_PATH', 'WIKI_DOCUMENT', 'CODE_FILE', 'COMMIT', 'PR_URL')),
      CONSTRAINT ck_task_references_resolution CHECK (
        (reference_type IN ('WIKI_PATH', 'WIKI_DOCUMENT') AND resolution IN ('RESOLVED', 'UNRESOLVED', 'AMBIGUOUS', 'UNAVAILABLE')
          AND ((resolution = 'RESOLVED') = (resolved_document_id IS NOT NULL)))
        OR (reference_type IN ('CODE_FILE', 'COMMIT', 'PR_URL') AND resolution IS NULL AND resolved_document_id IS NULL)
      )
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
