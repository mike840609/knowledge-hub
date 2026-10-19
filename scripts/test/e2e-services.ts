import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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

// The modules that define the origin helpers: importing one is not calling it.
const ORIGIN_MODULES = new Set(["phase3-identities.ts", "teams-closed.ts"]);

/** A spec's source with the local helpers it imports, so an origin a helper calls counts as the spec's. */
export function e2eSpecSource(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return "";
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const helpers = [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)]
    .map(([, specifier]) => path.resolve(path.dirname(file), path.extname(specifier) ? specifier : `${specifier}.ts`))
    .filter((helper) => existsSync(helper) && !ORIGIN_MODULES.has(path.basename(helper)));
  return [source, ...helpers.map((helper) => e2eSpecSource(helper, seen))].join("\n");
}
