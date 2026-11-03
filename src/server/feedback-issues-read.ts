import { firstSearchParam } from "@/lib/search-params";
import type { FeedbackIssuePage } from "@/modules/personal/application/feedback-report-query-service";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  parseFeedbackIssueFilter,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/modules/personal/domain/feedback-report";
import { isUuid } from "@/shared/ids/uuid";
import { DomainError } from "@/shared/domain/errors";
import { applicationServices } from "./composition";

export type FeedbackIssuesModel = {
  page: FeedbackIssuePage;
  filters: { status?: FeedbackStatus; category?: FeedbackCategory; mineOnly: boolean };
};

/** The Workspace failures that mean "this page is not yours", not "the read broke". */
const HIDDEN_WORKSPACE_CODES = new Set([
  "WORKSPACE_NOT_FOUND",
  "WORKSPACE_ACCESS_DENIED",
  "INSUFFICIENT_WORKSPACE_CAPABILITY",
]);

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * The URL is a user-typed surface: an unknown status or a half-formed cursor is a
 * typo, not a request to fail. Values the page does not recognise are dropped here
 * so the service's parser (the backstop for other callers) never sees them.
 */
function normaliseQuery(query: Record<string, string | string[] | undefined>) {
  const beforeAt = firstSearchParam(query.beforeAt);
  const beforeId = firstSearchParam(query.beforeId);
  // A cursor travels as time plus id: either half alone could repeat or skip a report sharing its timestamp.
  const cursorValid = Boolean(beforeAt && beforeId && !Number.isNaN(Date.parse(beforeAt)) && isUuid(beforeId));
  return {
    status: pick(firstSearchParam(query.status), FEEDBACK_STATUSES),
    category: pick(firstSearchParam(query.category), FEEDBACK_CATEGORIES),
    mine: firstSearchParam(query.mine) === "true" ? "true" : undefined,
    beforeAt: cursorValid ? beforeAt : undefined,
    beforeId: cursorValid ? beforeId : undefined,
  };
}

/**
 * The read model behind the personal reported-issues board. Any trusted caller may
 * read every report; the page is personal-workspace only, like /inbox. Workspace
 * visibility and access failures resolve to null so the page can call notFound();
 * anything else must reach the route error boundary.
 */
export async function getFeedbackIssues(
  workspaceId: string,
  query: Record<string, string | string[] | undefined>,
): Promise<FeedbackIssuesModel | null> {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  try {
    const state = await services.workspaceAdmin.workspaceState(caller, workspaceId);
    if (state.workspace.type !== "PERSONAL") return null;
  } catch (error) {
    if (error instanceof DomainError && HIDDEN_WORKSPACE_CODES.has(error.code)) return null;
    throw error;
  }

  const input = normaliseQuery(query);
  const filter = parseFeedbackIssueFilter(input);
  const page = await services.feedbackIssues.list(caller, input);
  return {
    page,
    filters: { status: filter.status, category: filter.category, mineOnly: filter.mineOnly },
  };
}
