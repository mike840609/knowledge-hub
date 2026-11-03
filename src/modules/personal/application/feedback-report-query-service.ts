import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  FEEDBACK_ISSUE_PAGE_SIZE,
  parseFeedbackIssueFilter,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/modules/personal/domain/feedback-report";
import type {
  FeedbackIssueRecord,
  FeedbackIssueStoreFilter,
  FeedbackReportStore,
} from "@/modules/personal/ports/feedback-report-store";

/** One report as the issues board shows it; `isMine` stands in for the reporter's id. */
export type FeedbackIssueView = {
  id: string;
  empId: string;
  userName: string;
  category: FeedbackCategory;
  description: string;
  pagePath: string;
  status: FeedbackStatus;
  createdAt: string;
  isMine: boolean;
};

export type FeedbackIssuePage = {
  items: FeedbackIssueView[];
  nextCursor: { createdAt: string; id: string } | null;
};

function toView(row: FeedbackIssueRecord, callerId: string): FeedbackIssueView {
  return {
    id: row.id,
    empId: row.empId,
    userName: row.userName,
    category: row.category,
    description: row.description,
    pagePath: row.pagePath,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    // The reporter's id never leaves the application boundary.
    isMine: row.userId === callerId,
  };
}

/** Serves the reported-issues board: any trusted caller sees every report, one newest page at a time. */
export class FeedbackReportQueryService {
  constructor(private readonly store: FeedbackReportStore) {}

  async list(
    caller: CallerContext,
    input: Parameters<typeof parseFeedbackIssueFilter>[0],
  ): Promise<FeedbackIssuePage> {
    const filter = parseFeedbackIssueFilter(input);
    const storeFilter: FeedbackIssueStoreFilter = {};
    if (filter.status) storeFilter.status = filter.status;
    if (filter.category) storeFilter.category = filter.category;
    if (filter.mineOnly) storeFilter.userId = caller.identity.id;
    if (filter.before) storeFilter.before = filter.before;
    // One row beyond the page tells us whether another page exists.
    const rows = await this.store.listPage(storeFilter, FEEDBACK_ISSUE_PAGE_SIZE + 1);
    const items = rows.slice(0, FEEDBACK_ISSUE_PAGE_SIZE).map((row) => toView(row, caller.identity.id));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: rows.length > FEEDBACK_ISSUE_PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
}
