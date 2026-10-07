import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite } from "@playwright/test/reporter";
import type { E2eCounts } from "./e2e-report";

// Deliberate allowlist: Playwright's full JSON includes config and webServer env.
export default class E2eJsonReporter implements Reporter {
  private suite?: Suite;
  private root = process.cwd();
  onBegin(config: FullConfig, suite: Suite): void { this.root = config.rootDir; this.suite = suite; }
  async onEnd(result: FullResult): Promise<void> {
    const directory = process.env.KM_E2E_RUN_REPORT_DIR;
    if (!directory) return;
    const counts: E2eCounts = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
    const tests = (this.suite?.allTests() ?? []).map(test => {
      const outcome = test.outcome();
      const status = outcome === "expected" ? "passed" : outcome === "unexpected" ? "failed" : outcome;
      counts[status]++;
      return {
        id: test.id,
        file: path.relative(this.root, test.location.file), title: test.titlePath().slice(1).join(" › "), status,
        durationMs: test.results.reduce((total, attempt) => total + attempt.duration, 0),
        retry: Math.max(0, ...test.results.map(attempt => attempt.retry)),
      };
    });
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "tests.json"), JSON.stringify({ version: 1, status: result.status, counts, tests }, null, 2) + "\n");
  }
}
