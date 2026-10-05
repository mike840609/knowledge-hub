import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { PersonalPreferencesService } from "@/modules/personal/application/personal-preferences-service";
import { DomainError } from "@/shared/domain/errors";

export const onboardingSteps = ["read", "search", "context"] as const;
export type OnboardingStep = typeof onboardingSteps[number];
export type OnboardingProgress = Record<OnboardingStep, boolean>;
type Preferences = Pick<PersonalPreferencesService, "get" | "put">;
const key = (step: OnboardingStep) => `prefs:onboarding-${step}`;

export async function getOnboardingProgress(preferences: Preferences, caller: CallerContext, workspaceId: string): Promise<OnboardingProgress> {
  const values = await Promise.all(onboardingSteps.map(step => preferences.get(caller, workspaceId, key(step))));
  return { read: values[0].value?.completed === true, search: values[1].value?.completed === true, context: values[2].value?.completed === true };
}

/** Called only after a successful trusted operation. Each step has its own CAS key. */
export async function recordOnboardingStep(preferences: Preferences, caller: CallerContext, workspaceId: string, step: OnboardingStep): Promise<void> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await preferences.get(caller, workspaceId, key(step));
      if (current.value?.completed === true) return;
      try {
        await preferences.put(caller, workspaceId, key(step), { completed: true }, current.version);
        return;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "PERSONAL_ITEM_CONFLICT") throw error;
      }
    }
    throw new Error("Onboarding progress conflict retry exhausted");
  } catch (error) {
    // Team and inaccessible workspaces have no personal onboarding. A failed
    // auxiliary write must not turn a successful read/search/build into a failure.
    if (error instanceof DomainError && ["WORKSPACE_NOT_FOUND", "WORKSPACE_ACCESS_DENIED", "INSUFFICIENT_WORKSPACE_CAPABILITY"].includes(error.code)) return;
    console.warn("Unable to save onboarding progress", error instanceof DomainError ? error.code : "PERSISTENCE_FAILURE");
  }
}
