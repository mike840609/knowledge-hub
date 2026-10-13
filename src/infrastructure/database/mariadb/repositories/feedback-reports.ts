import type { FeedbackReport } from "@/modules/personal/domain/feedback-report";
import type { FeedbackReportRepository } from "@/modules/personal/ports/feedback-report-repository";
import type { QueryConnection } from "./shared";
export class MariaDbFeedbackReportRepository implements FeedbackReportRepository {
  constructor(private readonly connection: QueryConnection) {}
  async insert(report: FeedbackReport): Promise<void> {
    await this.connection.query(
      "INSERT INTO feedback_reports (id,reporter_emp_id,category,page_path,description,created_at) VALUES (?,?,?,?,?,?)",
      [report.id, report.reporterEmpId, report.category, report.pagePath, report.description, report.createdAt],
    );
  }
}
