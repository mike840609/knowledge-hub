import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { PersonalPreferencesService } from "@/modules/personal/application/personal-preferences-service";
import { ONBOARDING_KEY, parseOnboardingPreference } from "@/modules/personal/domain/onboarding";
import { DomainError } from "@/shared/domain/errors";

/** Enrol an empty workspace once; existing content never opts an owner in. */
export async function getHomeOnboardingState(
  preferences: Pick<PersonalPreferencesService, "get" | "put">,
  caller: CallerContext,
  workspaceId: string,
  hasContent: boolean,
) {
  const current = await preferences.get(caller, workspaceId, ONBOARDING_KEY);
  if (current.value !== null) return { value: parseOnboardingPreference(current.value), version: current.version };
  const hidden = { value: { schemaVersion: 1 as const, dismissed: true }, version: current.version };
  if (hasContent) return hidden;
  try {
    const saved = await preferences.put(caller, workspaceId, ONBOARDING_KEY, { schemaVersion: 1, dismissed: false }, current.version);
    return { value: parseOnboardingPreference(saved.value), version: saved.version };
  } catch (error) {
    if (error instanceof DomainError && error.code === "PERSONAL_ITEM_CONFLICT") {
      const latest = await preferences.get(caller, workspaceId, ONBOARDING_KEY);
      return { value: latest.value === null ? hidden.value : parseOnboardingPreference(latest.value), version: latest.version };
    }
    // This auxiliary preference must not prevent Home from loading.
    console.warn("Unable to initialise onboarding", "PERSISTENCE_FAILURE");
    return hidden;
  }
}
