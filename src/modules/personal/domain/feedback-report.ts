import { DomainError } from "@/shared/domain/errors";

export const FEEDBACK_CATEGORIES = ["Sync", "Search", "Reading", "Other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_DESCRIPTION_MAX = 5000;
export const FEEDBACK_PAGE_PATH_MAX = 1024;
export const FEEDBACK_HOURLY_LIMIT = 20;

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
