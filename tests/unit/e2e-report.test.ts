import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertE2eCounts, createE2eRunDirectory, recordE2eRun, writeE2eRunReport, type E2eRunReport } from "../../scripts/test/e2e-report";

const temporary: string[] = [];
async function directory() { const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-report-test-")); temporary.push(dir); return dir; }
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const report = (): E2eRunReport => ({ version: 1, runId: randomUUID(), suite: "full", mode: "Team-enabled", startedAt: new Date().toISOString(), durationMs: 1250, status: "passed", stages: [{ name: "build", durationMs: 1100, status: "passed" }], counts: { passed: 1, failed: 0, flaky: 0, skipped: 0 }, error: null });

describe("E2E result artifacts", () => {
  test("unique runs survive each other and retain millisecond timings without environment", async () => {
    const root = await directory();
    const first = await createE2eRunDirectory(root, "team-smoke");
    const second = await createE2eRunDirectory(root, "team-smoke");
    expect(first).not.toBe(second);
    await writeE2eRunReport(first, report()); await writeE2eRunReport(second, report());
    const saved = JSON.parse(await readFile(path.join(first, "runner.json"), "utf8"));
    expect(saved.durationMs).toBe(1250); expect(saved.stages[0].durationMs).toBe(1100);
    expect(saved).not.toHaveProperty("environment"); expect(saved).not.toHaveProperty("config");
    expect(JSON.parse(await readFile(path.join(second, "runner.json"), "utf8")).runId).not.toBe(saved.runId);
  });
  test("suite labels cannot escape artifact root", async () => {
    await expect(createE2eRunDirectory(await directory(), "../outside")).rejects.toThrow("suite");
  });
  test.each(["failed", "cancelled"] as const)("pre-browser %s preserves outcome and null counts", async status => {
    const dir = await directory();
    const failed = { ...report(), status, counts: null, error: "build failed; cleanup failed", stages: [{ name: "build", durationMs: 10, status: "failed" as const }, { name: "cleanup", durationMs: 2, status: "failed" as const }] };
    await writeE2eRunReport(dir, failed);
    expect(JSON.parse(await readFile(path.join(dir, "runner.json"), "utf8"))).toEqual(failed);
  });
  test("browser failure survives successful cleanup and original plus cleanup failures both propagate", async () => {
    const dir = await directory(); const original = new Error("browser failed with secret-password");
    let cleaned = false;
    await expect(recordE2eRun(dir, "full", "Team-enabled", async r => { r.counts = {passed:0,failed:1,flaky:0,skipped:0}; throw original; }, async () => { cleaned = true; })).rejects.toBe(original);
    expect(cleaned).toBe(true);
    const saved = JSON.parse(await readFile(path.join(dir,"runner.json"),"utf8"));
    expect(saved.status).toBe("failed"); expect(saved.counts.failed).toBe(1); expect(saved.error).not.toContain("secret-password");
    const cleanup = new Error("cleanup failed");
    await expect(recordE2eRun(dir, "full", "Team-enabled", async () => { throw original; }, async () => { throw cleanup; })).rejects.toMatchObject({errors:[original,cleanup]});
    expect(JSON.parse(await readFile(path.join(dir,"runner.json"),"utf8")).error).toBe("Error; Error");
  });
  test("cancelled orchestration records cancellation and rejects", async () => {
    const dir = await directory();
    await expect(recordE2eRun(dir,"full","Team-enabled",async () => {throw new Error("cancelled");},async () => {},() => true)).rejects.toThrow("cancelled");
    expect(JSON.parse(await readFile(path.join(dir,"runner.json"),"utf8")).status).toBe("cancelled");
  });
  test("a late cancellation cannot exit successfully", async () => {
    const dir = await directory();
    await expect(recordE2eRun(dir,"full","Team-enabled",async () => {},async () => {},() => true)).rejects.toThrow("cancelled");
  });
  test("empty or incomplete smoke outcomes cannot pass", () => {
    expect(() => assertE2eCounts({ passed: 0, failed: 0, flaky: 0, skipped: 0 }, "full")).toThrow();
    expect(() => assertE2eCounts({ passed: 1, failed: 0, flaky: 0, skipped: 1 }, "team-smoke")).toThrow();
    expect(() => assertE2eCounts({ passed: 1, failed: 0, flaky: 1, skipped: 0 }, "personal-smoke")).toThrow();
    expect(() => assertE2eCounts({ passed: 219, failed: 0, flaky: 0, skipped: 2 }, "full")).not.toThrow();
  });
  test("real Playwright callbacks report all outcomes, retries and nonzero failure", async () => {
    const dir = await directory();
    const packagePath = path.resolve("node_modules/@playwright/test");
    await writeFile(path.join(dir, "fixture.spec.cjs"), `const {test,expect}=require(${JSON.stringify(packagePath)});\ntest('pass',()=>{});\ntest.skip('skip',()=>{});\ntest('fail',()=>expect(1).toBe(2));\ntest('flaky',({},info)=>expect(info.retry).toBe(1));\n`);
    const config = path.join(dir, "playwright.config.cjs");
    await writeFile(config, `module.exports={testDir:${JSON.stringify(dir)},retries:1,workers:1,reporter:[[${JSON.stringify(path.resolve("scripts/test/e2e-json-reporter.ts"))}]],outputDir:${JSON.stringify(path.join(dir,"output"))}};`);
    const result = spawnSync(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", "--config", config], { encoding: "utf8", env: { ...process.env, KM_E2E_RUN_REPORT_DIR: dir, E2E_REPORT_SECRET: "do-not-copy-secret" } });
    expect(result.status, result.stderr).not.toBe(0);
    const raw = await readFile(path.join(dir, "tests.json"), "utf8");
    const saved = JSON.parse(raw);
    expect(saved.counts).toEqual({ passed: 1, failed: 1, flaky: 1, skipped: 1 });
    expect(saved.tests.find((t: {title: string}) => t.title.endsWith("flaky")).retry).toBe(1);
    expect(raw).not.toContain("do-not-copy-secret"); expect(saved).not.toHaveProperty("config");
    expect(saved.tests.every((t: {durationMs: number}) => t.durationMs >= 0)).toBe(true);
  }, 15000);
  test("successful real Playwright fixture exits zero and records a pass", async () => {
    const dir = await directory();
    await writeFile(path.join(dir, "fixture.spec.cjs"), `const {test}=require(${JSON.stringify(path.resolve("node_modules/@playwright/test"))});test('pass',()=>{});`);
    await writeFile(path.join(dir, "config.cjs"), `module.exports={testDir:${JSON.stringify(dir)},reporter:[[${JSON.stringify(path.resolve("scripts/test/e2e-json-reporter.ts"))}]]};`);
    execFileSync(process.execPath, [path.resolve("node_modules/@playwright/test/cli.js"), "test", "--config", path.join(dir, "config.cjs")], { env: { ...process.env, KM_E2E_RUN_REPORT_DIR: dir }, stdio: "pipe" });
    expect(JSON.parse(await readFile(path.join(dir,"tests.json"),"utf8")).counts).toEqual({passed:1,failed:0,flaky:0,skipped:0});
  }, 15000);
});
