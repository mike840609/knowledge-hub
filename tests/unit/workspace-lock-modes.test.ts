import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

/**
 * Workspace shared write lock design: writers take the Workspace row shared; only
 * governance takes it FOR UPDATE. Two writers that each held it shared and then asked
 * for FOR UPDATE would deadlock, so the exclusive lock must stay out of writer paths.
 * Read from the source so a new call site has to be added here on purpose.
 */
const ROOT = join(__dirname, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function callers(pattern: RegExp): string[] {
  return files(ROOT).filter((path) => pattern.test(readFileSync(path, "utf8"))).map((path) => relative(ROOT, path)).sort();
}

it("takes the Workspace row exclusively only in governance and in the guard's exclusive branch", () => {
  expect(callers(/workspaces\.lockById\(/)).toEqual([
    "modules/workspaces/application/team-governance-service.ts",
    "modules/workspaces/application/team-workspace-service.ts",
    "modules/workspaces/application/workspace-mutation-guard.ts",
  ]);
});

it("asks the guard for an exclusive lock only where a check-then-insert has no unique key", () => {
  expect(callers(/\{\s*exclusive:\s*true\s*\}/)).toEqual([
    "modules/sources/application/ensure-default-hub-source.ts",
  ]);
});
