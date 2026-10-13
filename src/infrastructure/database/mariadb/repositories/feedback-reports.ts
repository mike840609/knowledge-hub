import { randomUUID } from "node:crypto";
import type { Pool } from "mariadb";
import type { FeedbackReportStore, NewFeedbackReport } from "@/modules/personal/ports/feedback-report-store";
export class MariaDbFeedbackReportStore implements FeedbackReportStore {
  constructor(private readonly pool: Pool) {}
  async appendWithinLimit(report: NewFeedbackReport, since: Date, limit: number) {
    // A plain read, not a locking one: the limit only has to stop a runaway loop, and an
    // INSERT … SELECT over the same rows would take gap locks two concurrent sends could deadlock on.
    const [{ n }] = await this.pool.query("SELECT COUNT(*) AS n FROM feedback_reports WHERE user_id=? AND created_at>?", [report.userId, since]);
    if (Number(n) >= limit) return null;
    const id = randomUUID();
    await this.pool.query(
      "INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [id, report.userId, report.empId, report.userName, report.category, report.description, report.pagePath, report.createdAt],
    );
    return id;
  }
}
