import history from "./e2e-durations.json";
import { requiredE2eServices } from "./e2e-services";

export const E2E_GROUP_COUNT = 4;
// Group 1 alone builds the SSO application: its build, compiler-cache copies and extra servers, measured in CI.
export const SSO_GROUP_ALLOWANCE_MS = 120_000;
const durations: Record<string, number> = history.durationsMs;

/** Keep whole files and their alphabetical order; only placement changes. */
export function balancedE2eGroups(files: readonly { file: string; source: string }[]): Map<string, number> {
  const groups = new Map<string, number>();
  const loads = Array.from({ length: E2E_GROUP_COUNT }, (_, index): number => (index === 0 ? SSO_GROUP_ALLOWANCE_MS : 0));
  const weight = (file: string) => durations[file] ?? 5_000;
  const remaining = [];
  for (const item of files) {
    if (requiredE2eServices([item.source]).personas) {
      groups.set(item.file, 1);
      loads[0] += weight(item.file);
    } else remaining.push(item);
  }
  remaining.sort((a, b) => weight(b.file) - weight(a.file) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const { file } of remaining) {
    const index = loads.indexOf(Math.min(...loads));
    groups.set(file, index + 1);
    loads[index] += weight(file);
  }
  return groups;
}
