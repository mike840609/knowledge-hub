// Test modes must not inherit the product's personal-only .env default.
export function e2eTeamWorkspacesEnabled(environment: Record<string, string | undefined>): string {
  return environment.KM_E2E_PERSONAL_ONLY === "true" ? "false" : "true";
}

// Infer dependencies from selected specs' origin helpers, not their filenames.
// Keep all personas together for governance tests with dynamic roles.
export function requiredE2eServices(sources: readonly string[]) {
  return {
    personas: sources.some((source) => /\bphase3(?:Origin|NoSessionOrigin)\b/.test(source)),
    noSession: sources.some((source) => /\bphase3NoSessionOrigin\b/.test(source)),
    unconfigured: sources.some((source) => /\bphase3UnconfiguredOrigin\b/.test(source)),
    teamsClosed: sources.some((source) => /\bteamsClosedOrigin\b/.test(source)),
  };
}
