import type { Migration } from "./types";
export const readingActivityMigration: Migration = {
  version: 16, name: "reading-activity",
  statements: [
    `CREATE TABLE reading_activity_tracking (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY, started_at DATETIME(6) NOT NULL
    ) ENGINE=InnoDB`,
    "INSERT INTO reading_activity_tracking (id,started_at) VALUES (1,UTC_TIMESTAMP(6))",
    `CREATE TABLE document_read_activity (
      user_id UUID NOT NULL, workspace_id UUID NOT NULL, document_id UUID NOT NULL,
      activity_date DATE NOT NULL, opened_at DATETIME(6) NOT NULL,
      PRIMARY KEY (user_id, workspace_id, activity_date, document_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
