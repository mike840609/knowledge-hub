import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

type Suite = { specs: { file: string; title: string; tags: string[] }[]; suites: Suite[] };
const environment = { ...process.env, KM_PHASE3_APP_ROOT: "", KM_E2E_UNCONFIGURED_SERVER: "false", KM_E2E_TEAMS_CLOSED_SERVER: "false", PLAYWRIGHT_JSON_OUTPUT_FILE: "", PLAYWRIGHT_JSON_OUTPUT_DIR: "", PLAYWRIGHT_JSON_OUTPUT_NAME: "" };
function catalog(grep?: string): { file: string; title: string; tags: string[] }[] {
  const args = ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json", ...(grep ? ["--grep", grep] : [])];
  const report = JSON.parse(execFileSync(process.execPath, args, { env: environment, encoding: "utf8" }));
  const collect = (suites: Suite[]): { file: string; title: string; tags: string[] }[] => suites.flatMap(s => [...(s.specs ?? []), ...collect(s.suites ?? [])]);
  return collect(report.suites);
}
const teamTitles = [
  "root resolves deterministically into My Space",
  "the rendered editor mounts without hydration or page errors",
  "typing Markdown syntax writes a heading and a list, and Create saves it",
  "⌘Enter saves from inside the rendered editor",
  "ordinary production entry cannot enable a fixture reader with environment variables",
  "server persona controls Team creation; browser claims cannot elevate a noncreator",
  "real grant changes propagate between independent fixed server sessions",
  "owner shares, an anonymous reader follows the edits, and revoking ends it",
];
describe("smoke catalog", () => {
  test("Team smoke selects exactly the eight approved flows", () => {
    expect(catalog("@smoke-team").map(t => t.title).sort()).toEqual([...teamTitles].sort());
  });
  test("Personal smoke selects routing and both rollout cases", () => {
    expect(catalog("@smoke-personal").map(t => t.title).sort()).toEqual([
      "root resolves deterministically into My Space",
      "personal rollout: disabled teams, drafts across browsers, organize, export, restore and favorites",
      "a new-note draft survives closing its tab and can be resumed from Home",
    ].sort());
  });
  test("unknown smoke tag is rejected rather than passing without tests", () => {
    const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list", "--grep", "@smoke-missing"], { env: environment });
    expect(result.status).not.toBe(0);
  });
  test("scripts explicitly select mode and tags", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["test:e2e:smoke"]).toBe("KM_E2E_SUITE=team-smoke tsx scripts/test/e2e.ts --grep @smoke-team");
    expect(scripts["test:e2e:smoke:personal"]).toBe("KM_E2E_SUITE=personal-smoke KM_E2E_PERSONAL_ONLY=true tsx scripts/test/e2e.ts --grep @smoke-personal");
    expect(scripts["test:e2e"]).toBe("tsx scripts/test/e2e.ts");
  });
});
