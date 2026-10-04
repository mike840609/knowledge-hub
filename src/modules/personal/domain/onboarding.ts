import { DomainError } from "@/shared/domain/errors";
export const ONBOARDING_KEY = "prefs:onboarding";
export type OnboardingPreference = { schemaVersion: 1; dismissed: boolean };
export function parseOnboardingPreference(value: unknown): OnboardingPreference {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "dismissed,schemaVersion" || (value as OnboardingPreference).schemaVersion !== 1 || typeof (value as OnboardingPreference).dismissed !== "boolean")
    throw new DomainError("INVALID_REQUEST", "Provide a valid onboarding preference.");
  return value as OnboardingPreference;
}
