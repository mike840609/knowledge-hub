import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Next 15.5 vendors a React whose `pingSuspendedRoot` drops a ping that
 * arrives while a render is in progress and the root has already suspended
 * with delay. A same-page navigation then finishes loading and never appears —
 * about 1 in 20, released only by some other re-render
 * (verification record §9, `scripts/diagnostics/router-stuck-transition.ts`).
 *
 * `patches/next+15.5.25.patch` records the missing line, the one React itself
 * has since added. It is applied by `postinstall`, which is easy to skip
 * (`npm ci --ignore-scripts`) and easy to lose (a Next upgrade that leaves the
 * patch behind, or that no longer needs it). This test is what notices either,
 * so the failure shows up here and not as a navigation that sometimes does
 * nothing.
 *
 * It asserts the *behaviour of the source* rather than that a patch file
 * exists: a version whose vendored React already has the fix passes on its
 * own, and the patch can then be deleted.
 */

const CLIENT_BUILDS = [
  // Used by `next build` / `next start`.
  "react-dom-client.production.js",
  // Used by `next dev`.
  "react-dom-client.development.js",
];

function pingSuspendedRoot(build: string): string {
  const path = join(process.cwd(), "node_modules/next/dist/compiled/react-dom/cjs", build);
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("function pingSuspendedRoot(");
  expect(start, `${build} has no pingSuspendedRoot — has Next changed how it vendors React?`).toBeGreaterThan(-1);
  // The function ends with the call that schedules the root.
  const end = source.indexOf("ensureRootIsScheduled(root)", start);
  expect(end, `${build}: could not find the end of pingSuspendedRoot`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the vendored React's ping handling", () => {
  it.each(CLIENT_BUILDS)("%s records a ping that arrives during a render, instead of dropping it", (build) => {
    const body = pingSuspendedRoot(build);
    // Unfixed, the only place the ping is recorded is the branch for a root that is *not* suspended
    // with delay. Fixed, the in-render branch records it as well: two places, not one.
    const recordings = body.match(/workInProgressRootPingedLanes \|= pingedLanes/g) ?? [];
    expect(
      recordings.length,
      [
        `${build}: pingSuspendedRoot records a ping in ${recordings.length} place(s); the fix needs 2.`,
        "Either postinstall did not run (npm ci --ignore-scripts?) — run `npx patch-package` —",
        "or Next was upgraded and the patch no longer applies. If the new Next vendors a React that",
        "already has the fix this test passes by itself; otherwise re-make patches/next+<version>.patch",
        "and check it with scripts/diagnostics/router-stuck-transition.ts (verification record §9).",
      ].join("\n"),
    ).toBeGreaterThanOrEqual(2);
  });

  it("is applied on install", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.postinstall ?? "").toContain("patch-package");
  });
});
