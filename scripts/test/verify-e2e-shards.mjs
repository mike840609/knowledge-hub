import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "e2e-shards");
const listing = JSON.parse(execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
  env: { ...process.env, KM_TEAM_WORKSPACES_ENABLED: "true", KM_PHASE3_APP_ROOT: "", KM_E2E_UNCONFIGURED_SERVER: "false", KM_E2E_TEAMS_CLOSED_SERVER: "false", PLAYWRIGHT_JSON_OUTPUT_FILE: "", PLAYWRIGHT_JSON_OUTPUT_DIR: "", PLAYWRIGHT_JSON_OUTPUT_NAME: "" },
}));
if (listing.errors?.length) throw new Error("Full test discovery failed.");
const expected = new Set();
function collect(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) expected.add(spec.id);
    collect(suite.suites ?? []);
  }
}
collect(listing.suites);
if (!expected.size) throw new Error("No tests discovered.");
async function find(directory, name) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await find(file, name));
    else if (entry.name === name) files.push(file);
  }
  return files;
}
const reports = await find(root, "tests.json");
const runners = await find(root, "runner.json");
if (reports.length !== 2 || runners.length !== 2) throw new Error("Expected exactly two completed shard reports.");
const seen = new Set();
const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
const tests = [];
for (const file of reports) {
  const report = JSON.parse(await readFile(file, "utf8"));
  if (report.status !== "passed") throw new Error(`Shard did not pass: ${path.relative(root, file)}`);
  for (const test of report.tests) {
    if (!expected.has(test.id)) throw new Error(`Unexpected test: ${test.title}`);
    if (seen.has(test.id)) throw new Error(`Duplicate test: ${test.title}`);
    if (!(test.status in counts)) throw new Error(`Invalid test status: ${test.status}`);
    seen.add(test.id); counts[test.status]++; tests.push(test);
  }
}
if (seen.size !== expected.size) throw new Error(`Missing ${expected.size - seen.size} tests.`);
if (counts.failed || counts.flaky) throw new Error("Failed or flaky E2E tests recorded.");
const stages = [];
for (const file of runners) {
  const runner = JSON.parse(await readFile(file, "utf8"));
  if (runner.status !== "passed") throw new Error("Shard runner failed or was cancelled.");
  stages.push({ shard: path.relative(root, file), durationMs: runner.durationMs, stages: runner.stages });
}
await writeFile("e2e-summary.json", JSON.stringify({ version: 1, counts, stages, tests }, null, 2) + "\n");
console.log(`Verified ${seen.size} tests across two shards: ${JSON.stringify(counts)}`);
