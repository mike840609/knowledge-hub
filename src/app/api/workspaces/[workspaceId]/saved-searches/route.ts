import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { SAVED_SEARCHES_KEY, validateSavedSearches } from "@/lib/saved-searches";
import { DomainError } from "@/shared/domain/errors";
export async function GET(_request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const { workspaceId } = await context.params;
    const stored = await s.personalPreferences.get(c, workspaceId, SAVED_SEARCHES_KEY);
    return { version: stored.version, ...validateSavedSearches(stored.value ?? { searches: [] }) };
  });
}
export async function PUT(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const { workspaceId } = await context.params;
    // Authorization precedes parsing and source reads; preferences are personal owner only.
    await s.personalPreferences.get(c, workspaceId, SAVED_SEARCHES_KEY);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => !["version", "searches"].includes(k))) throw new DomainError("INVALID_REQUEST", "Provide saved searches and version.");
    const value = validateSavedSearches({ searches: body.searches });
    const sources = await s.queries.listSources(c, workspaceId, { includeArchived: true });
    for (const search of value.searches) if (search.filters.source && !sources.some(source => source.id === search.filters.source)) throw new DomainError("INVALID_REQUEST", "Saved search source is unavailable in this workspace.");
    const stored = await s.personalPreferences.put(c, workspaceId, SAVED_SEARCHES_KEY, value, body.version);
    return { version: stored.version, ...value };
  });
}
