import type { FeedbackCategory } from "../domain/feedback-report";
export type NewFeedbackReport = {
  userId: string; empId: string; userName: string;
  category: FeedbackCategory; description: string; pagePath: string; createdAt: Date;
};
export interface FeedbackReportStore {
  /** Appends the report unless the user already sent `limit` reports since `since`; returns its ID, or null when limited. */
  appendWithinLimit(report: NewFeedbackReport, since: Date, limit: number): Promise<string | null>;
}
