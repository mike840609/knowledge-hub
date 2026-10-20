import path from "node:path";

/**
 * Where a spec's comparison screenshots go. By default the ignored `test-results/ui-comparisons/<name>`, so a
 * test run never rewrites the before/after evidence tracked in `docs/ui-comparisons/<name>`; set
 * `KM_UPDATE_UI_COMPARISONS=1` to refresh that evidence on purpose (`tests/unit/e2e-ui-comparisons.test.ts`).
 */
export function comparisonDir(name: string, env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env.KM_UPDATE_UI_COMPARISONS === "1" ? "docs/ui-comparisons" : "test-results/ui-comparisons", name);
}
