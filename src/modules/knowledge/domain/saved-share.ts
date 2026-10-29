import type { DocumentShareLink } from "./document-share-link";
import type { WorkspaceRole } from "@/modules/workspaces/domain/workspace-membership";
import { ValidationError } from "./errors";
export const SAVED_SHARE_PAGE_SIZE = 50;
export type SavedShareInput = { q?: string; status?: string; page?: string };
export type SavedShareQuery = { q: string; status: "all" | "available" | "unavailable"; page: number };
/** Validity inputs and public metadata captured by one consistent read. */
export type SavedShareSnapshot = {
  link: DocumentShareLink;
  validity: { documentStatus: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED"; workspaceLifecycle: "ACTIVE" | "ARCHIVED" | null; workspaceOwnerUserId: string | null; creatorDirectRole: WorkspaceRole | null | undefined };
  title: string | null; sharedByName: string | null;
};
export type SavedShareRecord = { id: string; userId: string; shareLinkId: string; savedTitle: string; savedSharedByName: string; savedExpiresAt: Date; savedAt: Date; updatedAt: Date; removedAt: Date | null };
export type SavedShareView = { id: string; title: string; sharedByName: string; savedAt: Date; expiresAt: Date; updatedAt: Date | null; status: "available" | "expired" | "unavailable"; path: string | null };
export type SavedShareState = { saved: boolean; id: string | null; workspaceId: string };
export type SavedShareList = { query: SavedShareQuery; items: SavedShareView[]; hasNext: boolean };
export function parseSavedShareQuery(input: SavedShareInput): SavedShareQuery {
  const q = (input.q ?? "").trim(), status = input.status || "all", page = input.page || "1";
  if (q.length > 200) throw new ValidationError("Search must be at most 200 characters.");
  if (!["all", "available", "unavailable"].includes(status)) throw new ValidationError("Choose a valid saved share status.");
  if (!/^[1-9]\d*$/.test(page) || Number(page) > 100000) throw new ValidationError("Choose a valid page.");
  return { q, status: status as SavedShareQuery["status"], page: Number(page) };
}
