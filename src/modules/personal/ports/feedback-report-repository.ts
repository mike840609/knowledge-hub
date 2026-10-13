import type { FeedbackReport } from "../domain/feedback-report";
export interface FeedbackReportRepository {
  insert(report: FeedbackReport): Promise<void>;
}
