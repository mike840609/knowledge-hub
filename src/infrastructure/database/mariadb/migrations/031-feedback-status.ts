import type { Migration } from "./types";

/** Status is operator-owned: the application only reads it, and a new report always starts OPEN. */
export const feedbackStatusMigration: Migration = {
  version: 31,
  name: "feedback-status",
  statements: [
    `ALTER TABLE feedback_reports
      ADD COLUMN status ENUM('OPEN','IN_PROGRESS','RESOLVED','DUPLICATE') NOT NULL DEFAULT 'OPEN' AFTER page_path,
      ADD KEY idx_feedback_status_created (status, created_at, id)`,
  ],
};
