import { test as base, type Page } from "@playwright/test";

export * from "@playwright/test";

const PATCHED = Symbol.for("km.e2e.streaming-settled");
const SETTLE_TIMEOUT_MS = 2_000;

/**
 * A page that streams in is, for a moment, in the DOM twice. React parks a late Suspense segment in a
 * hidden `<div id="S:n">` and may hold it there for some 300ms before swapping it in; if hydration gets
 * there first it draws the content itself, and until the parked copy is dropped every element in it
 * exists twice. A reader never sees the hidden one, but a strict locator does, and fails.
 *
 * So a full load is not over until no parked segment is left. Patched on the Page prototype, once per
 * worker, so pages a spec opens itself (`browser.newContext()`) are covered like the `page` fixture's.
 */
async function streamingSettled(page: Page): Promise<void> {
  // Bounded, and never a failure of its own. A page without JavaScript keeps its parked segments for
  // good, and a redirect or the spec's next navigation destroys the context this runs in; either way
  // the spec goes on as it would have without this.
  await page
    .waitForFunction(() => document.querySelector('body > div[hidden][id^="S:"]') === null, undefined, { timeout: SETTLE_TIMEOUT_MS })
    .catch(() => undefined);
}

function settleAfterLoad(prototype: Page & { [PATCHED]?: true }): void {
  if (prototype[PATCHED]) return;
  prototype[PATCHED] = true;
  for (const method of ["goto", "reload"] as const) {
    const load = prototype[method] as (this: Page, ...args: unknown[]) => Promise<unknown>;
    (prototype as unknown as Record<string, unknown>)[method] = async function (this: Page, ...args: unknown[]) {
      const response = await load.apply(this, args);
      await streamingSettled(this);
      return response;
    };
  }
}

export const test = base.extend<object, { streamingSettles: void }>({
  streamingSettles: [async ({ browser }, use) => {
    const page = await browser.newPage();
    settleAfterLoad(Object.getPrototypeOf(page) as Page);
    await page.close();
    await use();
  }, { scope: "worker", auto: true }],
});
