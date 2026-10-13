import type { Migration } from "./types";
export const feedbackReportsMigration: Migration = {
  version: 20, name: "feedback-reports", statements: [
    `CREATE TABLE feedback_reports (
      id UUID NOT NULL, user_id UUID NOT NULL,
      emp_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      user_name VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      category ENUM('Sync','Search','Reading','Other') NOT NULL,
      description TEXT NOT NULL, page_path VARCHAR(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id),
      CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      KEY idx_feedback_created (created_at, id),
      KEY idx_feedback_user_created (user_id, created_at),
      KEY idx_feedback_emp (emp_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
