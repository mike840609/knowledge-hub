import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "e2e-shards");
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
const discoveries = await find(root, "discovery.json");
if (reports.length !== 2 || runners.length !== 2 || discoveries.length !== 2) throw new Error("Expected exactly two completed shard reports and discovery manifests.");
const manifests = await Promise.all(discoveries.map(async file => JSON.parse(await readFile(file, "utf8"))));
const locked = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8")).packages["node_modules/@playwright/test"].version;
const reportingVersion = JSON.parse(await readFile(new URL("./reporting/package-lock.json", import.meta.url), "utf8")).packages["node_modules/@playwright/test"].version;
if (reportingVersion !== locked) throw new Error("Report merger's Playwright version differs from application lockfile.");
for (const manifest of manifests) {
  if (manifest.version !== 1 || !Array.isArray(manifest.ids) || !manifest.ids.length || manifest.ids.some(id => typeof id !== "string" || !id)) throw new Error("Invalid discovery manifest.");
  if (new Set(manifest.ids).size !== manifest.ids.length) throw new Error("Duplicate discovery IDs.");
  if (manifest.playwrightVersion !== locked) throw new Error("Discovery used an unexpected Playwright version.");
  if (process.env.GITHUB_SHA && manifest.commit !== process.env.GITHUB_SHA) throw new Error("Discovery is from a different commit.");
}
if (manifests[0].commit !== manifests[1].commit || JSON.stringify([...manifests[0].ids].sort()) !== JSON.stringify([...manifests[1].ids].sort())) throw new Error("Shards disagree about complete test discovery.");
const expected = new Set(manifests[0].ids);
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
