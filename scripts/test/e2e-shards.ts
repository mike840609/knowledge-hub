import history from "./e2e-durations.json";
import { requiredE2eServices } from "./e2e-services";

export const E2E_GROUP_COUNT = 2;
const durations: Record<string, number> = history.durationsMs;

/** Keep whole files and their alphabetical order; only placement changes. */
export function balancedE2eGroups(files: readonly { file: string; source: string }[]): Map<string, number> {
  const groups = new Map<string, number>();
  // Group 1 owns the SSO build. Include its measured warm build cost in balancing.
  const loads = [25_000, 0];
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
    const index = loads[0] <= loads[1] ? 0 : 1;
    groups.set(file, index + 1);
    loads[index] += weight(file);
  }
  return groups;
}
