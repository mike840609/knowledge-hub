import { workspaceHttp, type WorkspaceRouteContext } from "@/server/workspace-http";
import { ONBOARDING_KEY, parseOnboardingPreference } from "@/modules/personal/domain/onboarding";
import { DomainError } from "@/shared/domain/errors";
export async function GET(_request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { workspaceId } = await context.params;
    const item = await services.personalPreferences.get(caller, workspaceId, ONBOARDING_KEY);
    return { value: item.value === null ? { schemaVersion: 1, dismissed: false } : parseOnboardingPreference(item.value), version: item.version };
  });
}
export async function PUT(request: Request, context: WorkspaceRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const { workspaceId } = await context.params;
    // Authorize before validating the payload to preserve hidden-resource semantics.
    await services.personalPreferences.get(caller, workspaceId, ONBOARDING_KEY);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "value,version") throw new DomainError("INVALID_REQUEST", "Provide an onboarding value and version.");
    return services.personalPreferences.put(caller, workspaceId, ONBOARDING_KEY, parseOnboardingPreference(body.value), body.version);
  });
}
