import type { FeedbackCategory, FeedbackStatus } from "../domain/feedback-report";
export type NewFeedbackReport = {
  userId: string; empId: string; userName: string;
  category: FeedbackCategory; description: string; pagePath: string; createdAt: Date;
};
export type FeedbackIssueRecord = {
  id: string; userId: string; empId: string; userName: string;
  category: FeedbackCategory; description: string; pagePath: string; status: FeedbackStatus; createdAt: Date;
};
/** An absent filter field means "any"; `before` is the `(created_at, id)` cursor of the last row read. */
export type FeedbackIssueStoreFilter = {
  status?: FeedbackStatus; category?: FeedbackCategory; userId?: string;
  before?: { createdAt: Date; id: string };
};
export interface FeedbackReportStore {
  /** Appends the report unless the user already sent `limit` reports since `since`; returns its ID, or null when limited. */
  appendWithinLimit(report: NewFeedbackReport, since: Date, limit: number): Promise<string | null>;
  /** Newest first, ordered by `created_at DESC, id DESC`, so a composite cursor never repeats or skips a row. */
  listPage(filter: FeedbackIssueStoreFilter, limit: number): Promise<FeedbackIssueRecord[]>;
}
