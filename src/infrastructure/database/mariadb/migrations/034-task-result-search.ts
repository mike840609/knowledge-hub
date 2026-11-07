import type { Migration } from "./types";

/**
 * Derived latest-revision search projection, never a second source of truth.
 * Every row's authorization is derived from task_results -> task_export_bindings.
 * Uses integer UTC milliseconds because valid Artifact V1 dates can escape
 * the range of MariaDB DATETIME(6).
 */
export const taskResultSearchMigration: Migration = {
  version: 34,
  name: "task-result-search",
  statements: [
    `CREATE TABLE task_result_search (
      task_result_id UUID NOT NULL,
      revision_no INT UNSIGNED NOT NULL,
      completed_at_epoch_ms BIGINT SIGNED NOT NULL,
      agent VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      verification_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      title VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      summary MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      search_body MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      PRIMARY KEY (task_result_id),
      CONSTRAINT fk_task_search_task FOREIGN KEY (task_result_id) REFERENCES task_results(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT ck_task_search_revision CHECK (revision_no >= 1),
      CONSTRAINT ck_task_search_agent CHECK (agent IN ('claude-code', 'opencode')),
      CONSTRAINT ck_task_search_verification CHECK (verification_status IN ('passed', 'failed', 'not_run', 'not_applicable'))
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};

