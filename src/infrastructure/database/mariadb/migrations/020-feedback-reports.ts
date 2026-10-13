import type { Migration } from "./types";
export const feedbackReportsMigration: Migration = {
  version: 20, name: "feedback-reports", statements: [
    // emp_id never changes for a user (the user repository refuses it), so it is the reporter reference itself.
    `CREATE TABLE feedback_reports (
      id UUID NOT NULL,
      reporter_emp_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      page_path VARCHAR(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      description TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
      created_at DATETIME(6) NOT NULL,
      PRIMARY KEY (id), KEY idx_feedback_reports_created (created_at),
      CONSTRAINT fk_feedback_reports_reporter FOREIGN KEY (reporter_emp_id) REFERENCES users(emp_id) ON UPDATE RESTRICT ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
};
