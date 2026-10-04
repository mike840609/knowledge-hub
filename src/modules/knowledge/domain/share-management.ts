import { ValidationError } from "./errors";
export const SHARE_MANAGEMENT_PAGE_SIZE = 50;
export type ShareManagementStatus = "active" | "expired" | "revoked" | "unavailable";
export type ShareManagementInput = { q?: string; status?: string; page?: string };
export type ShareManagementQuery = { q: string; status: ShareManagementStatus | "all"; page: number };
export type ManagedShareLink = {
  id: string; documentId: string; sourceId: string; title: string; sourceName: string;
  label: string | null; path: string; status: ShareManagementStatus;
  createdAt: Date; expiresAt: Date; revokedAt: Date | null;
  totalViews: number; lastViewedAt: Date | null;
};
export function parseShareManagementQuery(input: ShareManagementInput): ShareManagementQuery {
  const q = (input.q ?? "").trim();
  const status = input.status || "active";
  const page = input.page || "1";
  if (q.length > 200) throw new ValidationError("Search must be at most 200 characters.");
  if (!["all", "active", "expired", "revoked", "unavailable"].includes(status)) throw new ValidationError("Choose a valid share status.");
  if (!/^[1-9]\d*$/.test(page) || Number(page) > 100000) throw new ValidationError("Choose a valid page.");
  return { q, status: status as ShareManagementQuery["status"], page: Number(page) };
}
