/**
 * Reproduces — and recognises — the "click did nothing" navigation on a
 * document page: a same-page navigation (`?graph=2`) whose response arrives,
 * and whose page never changes.
 *
 * Why this exists. The cause is a hole in React's ping handling that the
 * vendored copy inside Next 15.5 still has (verification record §9). It hits
 * about 1–5% of these navigations, which is too rare for an end-to-end test to
 * tell a fix from luck: 400 clean runs are needed to say anything. This script
 * makes those runs cheap, and says *why* a run failed rather than only that it
 * did, so it can be pointed at a Next upgrade or a patch and answer the
 * question directly.
 *
 * It needs a running production build (`make start`, or `next start`) and a
 * document that links to others, so the inspector's Links tab shows a
 * "2 links" control. The demo dataset's "Kubernetes" does.
 *
 *   npx tsx scripts/diagnostics/router-stuck-transition.ts 100
 *   DOC_TITLE="My linked note" NUDGE=focus npx tsx scripts/diagnostics/router-stuck-transition.ts 60
 *
 * Run several in parallel (a little CPU load makes it likelier). Exit code is
 * 1 if any iteration failed.
 *
 * Environment:
 *   BASE_URL   where the app is served            (default http://127.0.0.1:3000)
 *   DOC_TITLE  a document with links, by title    (default "Kubernetes")
 *   NUDGE      focus | tab — after a failure, cause an unrelated React update
 *              and report whether the stuck navigation then commits. It does,
 *              within ~200ms, which is what marks this failure as a lost
 *              wake-up rather than a slow or failed request.
 */
import { chromium, type Page } from "@playwright/test";

const iterations = Number(process.argv[2] ?? 40);
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const docTitle = process.env.DOC_TITLE ?? "Kubernetes";
const nudge = process.env.NUDGE;
/** How long a healthy navigation is given. It normally lands in well under a second. */
const PATIENCE_MS = 6_000;

type RootState = {
  pendingLanes: number;
  suspendedLanes: number;
  pingedLanes: number;
  idle: boolean;
};

/**
 * What React itself says about the stuck state, read from the root the page
 * was hydrated into. Works on any production build — nothing is patched.
 *
 * The signature of the lost ping: work is pending and suspended, nothing is
 * marked as pinged, and nothing is scheduled to run. React is waiting for a
 * wake-up that has already come and gone.
 */
async function readRoot(page: Page): Promise<RootState | null> {
  return page.evaluate(() => {
    const doc = document as unknown as Record<string, { stateNode?: Record<string, unknown> } | undefined>;
    const key = Object.getOwnPropertyNames(document).find((name) => name.startsWith("__reactContainer$"));
    const root = key ? doc[key]?.stateNode : undefined;
    if (!root) return null;
    const pendingLanes = Number(root.pendingLanes);
    const suspendedLanes = Number(root.suspendedLanes);
    const pingedLanes = Number(root.pingedLanes);
    return {
      pendingLanes,
      suspendedLanes,
      pingedLanes,
      idle: root.callbackNode == null && pendingLanes !== 0 && suspendedLanes !== 0 && pingedLanes === 0,
    };
  });
}

async function findDocumentUrl(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<string> {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`);
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`${baseUrl}/w/${workspaceId}/graph?view=list`);
  await page.getByRole("link", { name: docTitle, exact: true }).first().click();
  await page.locator("article").first().waitFor();
  const url = page.url();
  await context.close();
  return url;
}

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const url = await findDocumentUrl(browser);
  console.log(`document: ${url}`);

  let failures = 0;
  let lostPings = 0;
  for (let i = 1; i <= iterations; i++) {
    // A fresh context each time: nothing remembered, nothing cached.
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole("button", { name: "Details" }).first().click();
    await page.getByRole("tab", { name: "Links" }).click();
    const local = page.locator('[data-links-section="graph"]');
    await local.getByRole("group", { name: /^Local graph/ }).waitFor();
    // As fast as a test does it: no pause between the tab and the control.
    await local.getByRole("link", { name: "2 links" }).click();

    let committed = true;
    try {
      await page.waitForURL(/graph=2/, { timeout: PATIENCE_MS });
    } catch {
      committed = false;
    }

    if (!committed) {
      failures++;
      const root = await readRoot(page);
      if (root?.idle) lostPings++;
      console.log(`#${i} FAILED: the URL is still ${new URL(page.url()).search || "(no query)"} after ${PATIENCE_MS}ms`);
      console.log(`    React root: ${JSON.stringify(root)}${root?.idle ? "  <- pending, suspended, not pinged, nothing scheduled: a lost ping" : ""}`);
      if (nudge) {
        const started = Date.now();
        if (nudge === "focus") await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        else if (nudge === "tab") await page.getByRole("tab", { name: "History" }).click();
        let released = false;
        try {
          await page.waitForURL(/graph=2/, { timeout: 5_000 });
          released = true;
        } catch {
          /* still stuck */
        }
        console.log(`    after an unrelated update (${nudge}): ${released ? `committed in ${Date.now() - started}ms` : "still stuck"}`);
      }
    } else if (i % 10 === 0) {
      console.log(`#${i} ok (${failures} failed so far)`);
    }
    await context.close();
  }

  console.log(`\n${iterations} iterations, ${failures} failed${failures > 0 ? `, ${lostPings} of them with React idle on a lost ping` : ""}`);
  await browser.close();
  if (failures > 0) process.exitCode = 1;
}

void main();
