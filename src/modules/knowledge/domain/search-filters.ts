import { ValidationError } from "./errors";
export type SearchFilterInput = { path?: string; from?: string; to?: string; offset?: string; sort?: string };
export type SearchFilters = { path: string | null; updatedFrom: Date | null; updatedBefore: Date | null; sort: "relevance" | "newest" | "oldest" };
function date(value: string | undefined): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError("Use dates in YYYY-MM-DD format.");
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 1000 || Number(value.slice(0, 4)) > 9998) throw new ValidationError("Provide a valid calendar date between 1000 and 9998.");
  return instant;
}
export function parseSearchFilters(input: SearchFilterInput): SearchFilters {
  const rawPath = input.path?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  if (rawPath.length > 1024 || rawPath.startsWith("/") || /[:\u0000-\u001f\u007f]/.test(rawPath) || rawPath.split("/").some(part => part === "." || part === ".." || (rawPath !== "" && part === ""))) throw new ValidationError("Use a root-relative file or folder path without .. segments.");
  const rawOffset = input.offset || "0";
  if (!/^-?\d+$/.test(rawOffset) || Math.abs(Number(rawOffset)) > 840) throw new ValidationError("Invalid search UTC offset.");
  const offset = Number(rawOffset) * 60000;
  const from = date(input.from), to = date(input.to);
  if (from !== null && to !== null && from > to) throw new ValidationError("From date must be on or before To date.");
  const sort = input.sort || "relevance";
  if (sort !== "relevance" && sort !== "newest" && sort !== "oldest") throw new ValidationError("Invalid search sort order.");
  return { path: rawPath || null, updatedFrom: from === null ? null : new Date(from - offset), updatedBefore: to === null ? null : new Date(to + 86400000 - offset), sort };
}
export function hasSearchFilters(filters: SearchFilters): boolean { return !!(filters.path || filters.updatedFrom || filters.updatedBefore); }
