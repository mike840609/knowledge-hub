/**
 * Rendered Markdown without the review paths on its blocks (`remark-review-paths.ts`): for a test
 * about what a block is drawn as, where what it is drawn *with* would only be noise in the string.
 */
export const withoutReviewPaths = (html: string) => html.replace(/ data-review-(?:path|para)="[\d.]*"/g, "");
