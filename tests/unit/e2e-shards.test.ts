import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import history from "../../scripts/test/e2e-durations.json";
import { balancedE2eGroups, E2E_GROUP_COUNT, SSO_GROUP_ALLOWANCE_MS } from "../../scripts/test/e2e-shards";
import { e2eSpecSource, requiredE2eServices } from "../../scripts/test/e2e-services";

const root = new URL("../../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const e2eRoot = new URL("e2e/", new URL("../", import.meta.url)).pathname;
const specs = readdirSync(e2eRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => {
    const absolute = path.join(entry.parentPath, entry.name);
    return { file: path.relative(e2eRoot, absolute).replaceAll(path.sep, "/"), source: e2eSpecSource(absolute) };
  });
const weights: Record<string, number> = history.durationsMs;
const weight = (file: string) => weights[file] ?? 5_000;
const personas = { source: "phase3Origin(\"owner\")" };
const local = { source: "test()" };

describe("E2E shard allocation", () => {
  test("places every spec in exactly one group within range", () => {
    const groups = balancedE2eGroups(specs);
    expect([...groups.keys()].sort()).toEqual(specs.map(({ file }) => file).sort());
    for (const group of groups.values()) expect(group >= 1 && group <= E2E_GROUP_COUNT).toBe(true);
  });

  test("keeps every SSO-persona spec in group 1, the only group that builds SSO", () => {
    const groups = balancedE2eGroups(specs);
    const persona = specs.filter(({ source }) => requiredE2eServices([source]).personas);
    expect(persona.length).toBeGreaterThan(0);
    for (const { file } of persona) expect(groups.get(file)).toBe(1);
  });

  test("is independent of the order files are discovered in", () => {
    const forward = balancedE2eGroups(specs);
    const reversed = balancedE2eGroups([...specs].reverse());
    expect(Object.fromEntries(reversed)).toEqual(Object.fromEntries(forward));
  });

  test("balances local-only groups to within one file of each other", () => {
    const groups = balancedE2eGroups(specs);
    const loads = Array.from({ length: E2E_GROUP_COUNT }, () => 0);
    loads[0] = SSO_GROUP_ALLOWANCE_MS;
    for (const { file } of specs) loads[groups.get(file)! - 1] += weight(file);
    const heaviestFile = Math.max(...specs.map(({ file }) => weight(file)));
    const localLoads = loads.slice(1);
    expect(Math.max(...localLoads) - Math.min(...localLoads)).toBeLessThanOrEqual(heaviestFile);
  });

  test("gives an unmeasured file the fallback weight and still places it", () => {
    const groups = balancedE2eGroups([{ file: "not-yet-measured.spec.ts", ...local }]);
    expect(groups.get("not-yet-measured.spec.ts")).toBe(2);
  });

  test("returns no placements for no files", () => {
    expect(balancedE2eGroups([]).size).toBe(0);
  });

  test("never moves a persona spec out of group 1, however heavy group 1 gets", () => {
    const heavy = Array.from({ length: 10 }, (_, index) => ({ file: `persona-${index}.spec.ts`, ...personas }));
    const groups = balancedE2eGroups(heavy);
    expect(new Set(groups.values())).toEqual(new Set([1]));
  });
});

describe("E2E shard count", () => {
  test("the workflow matrix, Playwright config and shard verifier agree with the allocator", () => {
    const matrix = /shard: \[([\d, ]+)\]/.exec(read(".github/workflows/phase2-dev-gate.yml"))?.[1].split(",").map(Number);
    expect(matrix).toEqual(Array.from({ length: E2E_GROUP_COUNT }, (_, index) => index + 1));
    expect(Number(/const SHARD_COUNT = (\d+);/.exec(read("scripts/test/verify-e2e-shards.mjs"))?.[1])).toBe(E2E_GROUP_COUNT);
    expect(read("playwright.config.ts")).toContain("Number(group) <= E2E_GROUP_COUNT");
  });
});
