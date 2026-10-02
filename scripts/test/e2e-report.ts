import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type E2eStage = { name: string; durationMs: number; status: "passed" | "failed" };
export type E2eCounts = { passed: number; failed: number; flaky: number; skipped: number };
export type E2eRunReport = {
  version: 1; runId: string; suite: string; mode: "Team-enabled" | "personal-only";
  startedAt: string; durationMs: number; status: "passed" | "failed" | "cancelled";
  stages: E2eStage[]; counts: E2eCounts | null; error: string | null;
};
export async function createE2eRunDirectory(root: string, suite: string): Promise<string> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(suite)) throw new Error("Invalid E2E suite label.");
  const directory = path.join(root, suite, randomUUID());
  await mkdir(directory, { recursive: true });
  return directory;
}
export async function writeE2eRunReport(directory: string, report: E2eRunReport): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "runner.json"), JSON.stringify(report, null, 2) + "\n");
}
export function assertE2eCounts(counts: E2eCounts, suite: string): void {
  if (Object.values(counts).some(count => !Number.isInteger(count) || count < 0) || Object.values(counts).reduce((sum, count) => sum + count, 0) === 0) {
    throw new Error("No valid E2E test outcomes recorded.");
  }
  if (counts.failed || (suite.endsWith("-smoke") && (counts.flaky || counts.skipped))) {
    throw new Error("E2E outcomes do not satisfy the selected suite: smoke requires zero failures, flaky tests and skips.");
  }
}

export async function recordE2eRun(
  directory: string, suite: string, mode: E2eRunReport["mode"],
  action: (report: E2eRunReport) => Promise<void>, cleanup: (report: E2eRunReport) => Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const started = performance.now();
  const report: E2eRunReport = { version: 1, runId: path.basename(directory), suite, mode, startedAt: new Date().toISOString(), durationMs: 0, status: "passed", stages: [], counts: null, error: null };
  const errors: unknown[] = [];
  try { await action(report); } catch (error) { errors.push(error); }
  try { await cleanup(report); } catch (error) { errors.push(error); }
  report.durationMs = performance.now() - started;
  report.status = isCancelled() ? "cancelled" : errors.length ? "failed" : "passed";
  // Exception text may contain DB credentials. Keep error categories, stage names and all
  // failure locations here; original exceptions still propagate to the caller.
  report.error = errors.length ? errors.map(error => error instanceof AggregateError ? `Cleanup failed (${error.errors.length} errors)` : error instanceof Error ? error.name : "Unknown error").join("; ") : report.status === "cancelled" ? "Run cancelled" : null;
  if (report.status === "cancelled" && !errors.length) errors.push(new Error("E2E run cancelled."));
  try { await writeE2eRunReport(directory, report); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "E2E run and cleanup/report writing failed.");
}

export function e2eReporterArguments(args: string[]): string[] {
  // An additive reporter survives --reporter overrides without changing their output.
  return [...args, "--add-reporter", path.resolve("scripts/test/e2e-json-reporter.ts")];
}
export function e2eHtmlReportDirectory(projectRoot: string): string { return path.join(projectRoot, "playwright-report/html"); }
