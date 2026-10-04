import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { FRESHNESS_KEY, freshnessThreshold, validateFreshnessValue } from "@/modules/personal/application/knowledge-freshness";
export async function GET(_request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const {workspaceId} = await context.params;
    const preference = await s.personalPreferences.get(c, workspaceId, FRESHNESS_KEY);
    return {thresholdDays:freshnessThreshold(preference.value),version:preference.version};
  });
}
export async function PUT(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (s, c) => {
    const {workspaceId} = await context.params;
    // Authorization precedes schema validation; workspace ownership is never inferred from the payload.
    await s.personalPreferences.get(c, workspaceId, FRESHNESS_KEY);
    const body = await request.json().catch(() => null);
    const value = validateFreshnessValue(body?.value);
    return s.personalPreferences.put(c, workspaceId, FRESHNESS_KEY, value, body?.version);
  });
}
