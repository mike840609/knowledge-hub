import { DomainError } from "@/shared/domain/errors";
import { isUuid } from "@/shared/ids/uuid";

export const FEEDBACK_CATEGORIES = ["Sync", "Search", "Reading", "Other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "DUPLICATE"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_DESCRIPTION_MAX = 5000;
export const FEEDBACK_PAGE_PATH_MAX = 1024;
export const FEEDBACK_HOURLY_LIMIT = 20;
export const FEEDBACK_ISSUE_PAGE_SIZE = 20;

/** What the reporter wrote. Who sent it never comes from here: the service takes that from the trusted caller. */
export type FeedbackReportInput = { category: FeedbackCategory; description: string; pagePath: string };

export function parseFeedbackReport(body: unknown): FeedbackReportInput {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "category,description,pagePath")
    throw new DomainError("INVALID_REQUEST", "Provide exactly category, description and pagePath.");
  const { category, description, pagePath } = body as Record<string, unknown>;
  if (typeof category !== "string" || !(FEEDBACK_CATEGORIES as readonly string[]).includes(category))
    throw new DomainError("INVALID_REQUEST", "Choose a category: Sync, Search, Reading or Other.");
  const text = typeof description === "string" ? description.trim() : "";
  if (!text || text.length > FEEDBACK_DESCRIPTION_MAX)
    throw new DomainError("INVALID_REQUEST", `Describe what happened in 1 to ${FEEDBACK_DESCRIPTION_MAX} characters.`);
  // A pathname only: a query or fragment can carry tokens the report has no need to keep.
  if (typeof pagePath !== "string" || !pagePath.startsWith("/") || pagePath.length > FEEDBACK_PAGE_PATH_MAX || /[?#\s]/.test(pagePath))
    throw new DomainError("INVALID_REQUEST", "Provide the page path the report was made on.");
  return { category: category as FeedbackCategory, description: text, pagePath };
}

/** Which reports the issues list asks for: an absent field means "any", newest page first. */
export type FeedbackIssueFilter = {
  status?: FeedbackStatus;
  category?: FeedbackCategory;
  mineOnly: boolean;
  before?: { createdAt: Date; id: string };
};

// A query string gives "" for an empty parameter and null for a missing one; both mean "not asked for".
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], message: string): T | undefined {
  if (isAbsent(value)) return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    throw new DomainError("INVALID_REQUEST", message);
  return value as T;
}

function parseBefore(beforeAt: unknown, beforeId: unknown): FeedbackIssueFilter["before"] {
  if (isAbsent(beforeAt) && isAbsent(beforeId)) return undefined;
  // A cursor travels as time plus id: either part alone could repeat or skip a report sharing its timestamp.
  if (typeof beforeAt !== "string" || typeof beforeId !== "string")
    throw new DomainError("INVALID_REQUEST", "Pass both beforeAt and beforeId to load the next page.");
  const createdAt = new Date(beforeAt);
  if (Number.isNaN(createdAt.getTime()))
    throw new DomainError("INVALID_REQUEST", "beforeAt must be a date.");
  if (!isUuid(beforeId))
    throw new DomainError("INVALID_REQUEST", "beforeId must be a report id.");
  return { createdAt, id: beforeId };
}

export function parseFeedbackIssueFilter(input: {
  status?: unknown;
  category?: unknown;
  mine?: unknown;
  beforeAt?: unknown;
  beforeId?: unknown;
}): FeedbackIssueFilter {
  const status = parseEnum(input.status, FEEDBACK_STATUSES, "Choose a status: OPEN, IN_PROGRESS, RESOLVED or DUPLICATE.");
  const category = parseEnum(input.category, FEEDBACK_CATEGORIES, "Choose a category: Sync, Search, Reading or Other.");
  const filter: FeedbackIssueFilter = { mineOnly: input.mine === true || input.mine === "true" };
  if (status) filter.status = status;
  if (category) filter.category = category;
  const before = parseBefore(input.beforeAt, input.beforeId);
  if (before) filter.before = before;
  return filter;
}
