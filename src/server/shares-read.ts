import { cache } from "react";
import { applicationServices } from "./composition";
import { DomainError } from "@/modules/knowledge/domain/errors";
import type { FollowedDiscussionView } from "@/modules/knowledge/domain/review-follow";

/** The caller's personal workspace for Shares; one check per request, shared by the shell and the tab. */
export const requireSharesAccess = cache(async (workspaceId: string): Promise<void> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  await services.shares.requireManagement(caller, workspaceId);
});

/** Full followed discussions for the Discussions tab, request-cached. */
export const getFollowedDiscussions = cache(async (): Promise<FollowedDiscussionView[]> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  return (await services.reviews.listFollowedDiscussions(caller)).items;
});

/** Count unread followed discussions without fetching their revision/title data. */
export const getFollowedUnreadCount = cache(async (): Promise<number> => {
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  return services.reviews.countUnreadFollowedDiscussions(caller);
});

/** The four refusals that mean this route does not exist for this caller. */
export function sharesNotFound(error: unknown): boolean {
  return error instanceof DomainError
    && ["DOCUMENT_NOT_FOUND", "WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code);
}
