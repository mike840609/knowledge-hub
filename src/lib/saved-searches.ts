import { parseSearchFilters } from "@/modules/knowledge/domain/search-filters";
import { DomainError } from "@/shared/domain/errors";
export const SAVED_SEARCHES_KEY = "prefs:saved-searches";
export type SavedSearchFilters = { q: string; scope: "workspace" | "all"; source: string; path: string; from: string; to: string; offset: string; sort: string; archived: boolean };
export type SavedSearch = { id: string; name: string; filters: SavedSearchFilters };
const fields = ["q", "scope", "source", "path", "from", "to", "offset", "sort", "archived"];
const invalid = () => { throw new DomainError("INVALID_REQUEST", "Provide valid saved searches (up to 20 names, 80 characters each)."); };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !(k in value))) invalid(); }
export function validateSavedSearches(value: unknown): { searches: SavedSearch[] } {
  const root = object(value); exact(root, ["searches"]);
  if (!Array.isArray(root.searches) || root.searches.length > 20) return invalid();
  const ids = new Set<string>();
  const searches = root.searches.map(raw => {
    const item = object(raw); exact(item, ["id", "name", "filters"]);
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) return invalid(); ids.add(item.id);
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || /[\u0000-\u001f\u007f]/.test(item.name)) return invalid();
    const f = object(item.filters); exact(f, fields);
    if (fields.filter(k => k !== "archived").some(k => typeof f[k] !== "string") || typeof f.archived !== "boolean") return invalid();
    const filters = f as SavedSearchFilters;
    if (filters.q.length > 200 || /[\u0000-\u001f\u007f]/.test(filters.q) || !["workspace", "all"].includes(filters.scope) || (filters.source && !/^[a-zA-Z0-9-]{1,80}$/.test(filters.source)) || (filters.scope === "all" && filters.source)) return invalid();
    try { parseSearchFilters(filters); } catch { return invalid(); }
    return { id: item.id, name: item.name.trim(), filters };
  });
  return { searches };
}
export function savedSearchHref(workspaceId: string, filters: SavedSearchFilters): string {
  const validated = validateSavedSearches({ searches: [{ id: "navigation", name: "Navigation", filters }] }).searches[0].filters;
  const params = new URLSearchParams();
  for (const key of fields) { const value = validated[key as keyof SavedSearchFilters]; if (key === "archived") { if(value) params.set(key, "1"); } else if(value) params.set(key, String(value)); }
  return `/w/${encodeURIComponent(workspaceId)}/search?${params}`;
}
