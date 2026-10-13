import { DomainError } from "@/shared/domain/errors";

export const FEEDBACK_CATEGORIES = ["Sync", "Search", "Reading", "Other"] as const;
export const FEEDBACK_DESCRIPTION_MAX = 5000;
const PAGE_PATH_MAX = 2048;

export type FeedbackReport = {
  id: string;
  reporterEmpId: string;
  category: (typeof FEEDBACK_CATEGORIES)[number];
  pagePath: string;
  description: string;
  createdAt: Date;
};

export type FeedbackReportInput = { category: string; description: string; pagePath: string };

export function validateFeedbackReport(input: FeedbackReportInput): Pick<FeedbackReport, "category" | "description" | "pagePath"> {
  const category = FEEDBACK_CATEGORIES.find((value) => value === input.category);
  if (!category) throw new DomainError("INVALID_REQUEST", "Choose a feedback category.");
  const description = input.description.trim();
  if (!description || description.length > FEEDBACK_DESCRIPTION_MAX)
    throw new DomainError("INVALID_REQUEST", `Describe the problem in at most ${FEEDBACK_DESCRIPTION_MAX} characters.`);
  if (!input.pagePath.startsWith("/") || input.pagePath.length > PAGE_PATH_MAX)
    throw new DomainError("INVALID_REQUEST", "Provide the page path the report was sent from.");
  return { category, description, pagePath: input.pagePath };
}
