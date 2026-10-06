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

/**
 * The same vendored React commits an *incomplete* tree after error recovery: an error thrown in a
 * Retry lane (a redirect streamed behind `loading.tsx`) starts a synchronous retry over every pending
 * lane; if that retry includes a navigation still loading, Next's Router suspends at the shell
 * (status 6), and React commits the Router with only the hooks it ran before suspending. Its next
 * render throws "Rendered more hooks than during the previous render" (#310) — the whole page
 * becomes "Application error". React fixed it upstream by treating status 6 like an error there
 * (facebook/react#36911); `patches/next+15.5.25.patch` carries that one condition. Investigation:
 * `tests/e2e/router-redirect-during-navigation.spec.ts`.
 *
 * Every build the patch touches is checked, so a re-made patch that misses one fails here.
 */
const RECOVERY_BUILDS = [
  "react-dom-client.production.js",
  "react-dom-client.development.js",
  // `next build --profile`.
  "react-dom-profiling.profiling.js",
  "react-dom-profiling.development.js",
];

/** The condition deciding whether the synchronous error-recovery retry counts as recovered. */
function recoveryCondition(build: string): string {
  const path = join(process.cwd(), "node_modules/next/dist/compiled/react-dom/cjs", build);
  const source = readFileSync(path, "utf8");
  const start = source.indexOf("function performWorkOnRoot(");
  expect(start, `${build} has no performWorkOnRoot — has Next changed how it vendors React?`).toBeGreaterThan(-1);
  // The recovered branch is the only place that checks for a ping listener against a dehydrated root.
  const marker = source.indexOf("!wasRootDehydrated", start);
  expect(marker, `${build}: could not find the error-recovery branch of performWorkOnRoot`).toBeGreaterThan(start);
  const condition = source.lastIndexOf("if (", source.lastIndexOf("if (", marker) - 1);
  return source.slice(condition, marker);
}

describe("the vendored React's error recovery", () => {
  it.each(RECOVERY_BUILDS)("%s does not commit a retry that suspended at the shell", (build) => {
    const condition = recoveryCondition(build);
    expect(condition, `${build}: recovery condition not found`).toMatch(/RootErrored|2 !==/);
    expect(
      /RootSuspendedAtTheShell|6 !==/.test(condition),
      [
        `${build}: the error-recovery retry treats "suspended at the shell" as recovered:`,
        `  ${condition.trim().replace(/\s+/g, " ")}`,
        "Either postinstall did not run — run `npx patch-package` — or Next was upgraded and the patch",
        "no longer applies. If the new Next vendors a React with facebook/react#36911 this passes by",
        "itself; otherwise re-make patches/next+<version>.patch (README, \"Next.js patch\").",
      ].join("\n"),
    ).toBe(true);
  });

  it("covers every react-dom build the patch touches", () => {
    let patch = "";
    try { patch = readFileSync(join(process.cwd(), "patches/next+15.5.25.patch"), "utf8"); } catch { return; }
    const touched = [...patch.matchAll(/^diff --git a\/node_modules\/next\/dist\/compiled\/react-dom\/cjs\/(\S+)/gm)].map((m) => m[1]);
    expect(touched.length).toBeGreaterThan(0);
    for (const build of touched) expect(RECOVERY_BUILDS).toContain(build);
  });
});
