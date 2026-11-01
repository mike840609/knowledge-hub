import { expect, test } from "./fixtures/test";
import { createReviewDocument } from "./fixtures/document-review";
import { phase3Origin } from "./fixtures/phase3-identities";
import type { Page, Request } from "@playwright/test";

/**
 * Gate Saved shares RSC traffic, regardless of whether Next.js prefetches it
 * or the tab click starts the request. Track terminal network events so the
 * assertions run after a late response is actually completed or canceled.
 */
async function delaySavedShares(page: Page, workspaceId: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Set<Request>();
  const settled = new Set<Request>();
  const markSettled = (request: Request) => {
    if (intercepted.has(request)) settled.add(request);
  };
  page.on("requestfinished", markSettled);
  page.on("requestfailed", markSettled);

  await page.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    const delayed = req.headers()["rsc"] === "1"
      && url.pathname === "/w/" + workspaceId + "/shares"
      && url.searchParams.get("tab") === "saved";
    if (delayed) {
      intercepted.add(req);
      await gate;
    }
    try {
      await route.continue();
    } catch {
      // A newer navigation can abort an intercepted request before continue().
      // That is a terminal cancellation, not a request still in flight.
      if (delayed) settled.add(req);
    }
  });

  return {
    release,
    intercepted: () => intercepted.size,
    async waitForSettled() {
      await expect.poll(
        () => intercepted.size > 0 && [...intercepted].every(request => settled.has(request)),
        { message: "Delayed Saved shares RSC requests should finish or be canceled", timeout: 10_000 },
      ).toBe(true);
      // Allow React to process the delivered RSC payload before inspecting tabs.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    },
    async dispose() {
      release();
      await page.unroute("**/*");
      page.off("requestfinished", markSettled);
      page.off("requestfailed", markSettled);
    },
  };
}


test("keeps one header and one tab bar across tabs and Back", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  await expect(page.getByRole("heading", { name: "Shares", exact: true })).toHaveCount(1);
  const nav = page.getByRole("navigation", { name: "Shares sections" });
  await expect(nav).toHaveCount(1);

  await nav.getByRole("link", { name: "Saved shares", exact: true }).click();
  await expect(page).toHaveURL(/tab=saved/);
  await expect(nav.getByRole("link", { name: "Saved shares", exact: true })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: /^Discussions/ }).click();
  await expect(page).toHaveURL(/tab=discussions/);
  await expect(nav.getByRole("link", { name: /^Discussions/ })).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await page.goBack();
  await expect(nav.getByRole("link", { name: "My shares", exact: true })).toHaveAttribute("aria-current", "page");
});

test("an unknown tab falls back to My shares with the validation alert", async ({ page, request }) => {
  const navigation = await (await request.get(`${phase3Origin("reviewOwner")}/api/workspaces`)).json();
  const ws = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  await page.goto(`${phase3Origin("reviewOwner")}/w/${ws}/shares?tab=nope`);
  await expect(page.getByRole("alert").filter({ hasText: "Choose My shares" })).toHaveText("Choose My shares, Saved shares or Discussions.");
  await expect(page.getByRole("navigation", { name: "Shares sections" }).getByRole("link", { name: "My shares", exact: true }))
    .toHaveAttribute("aria-current", "page");
});

test("live search keeps the toolbar and the input's focus", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const input = page.getByLabel("Find shares", { exact: true });
  await input.fill("guide");
  await expect(page).toHaveURL(/q=guide/);
  await expect(input).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Shares sections" })).toHaveCount(1);
});

test("a row's rule sits below its subtitle, and its actions wait for hover", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const row = page.getByRole("list", { name: "Share links" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Copy link for/ }) }).first();
  const copy = row.getByRole("button", { name: /^Copy link for/ });
  expect(await copy.evaluate(node => getComputedStyle(node).opacity)).toBe("0");
  const sub = row.locator("p").first();
  const rowBox = (await row.boundingBox())!, subBox = (await sub.boundingBox())!;
  expect(subBox.y + subBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height - 1);
  await row.hover();
  await expect.poll(() => copy.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
});

test("a phone keeps the search full width and the page inside the viewport", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const input = page.getByLabel("Find shares", { exact: true });
  const box = (await input.boundingBox())!;
  expect(box.width).toBeGreaterThan(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const count = page.getByRole("status").filter({ hasText: /shares$/ });
  if (await count.count()) {
    const countBox = (await count.boundingBox())!;
    expect(countBox.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
  await page.getByRole("link", { name: "Saved shares", exact: true }).click();
  await expect(page).toHaveURL(/tab=saved/);
  const saved = page.getByLabel("Find saved shares", { exact: true });
  expect((await saved.boundingBox())!.width).toBeGreaterThan(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("rapid tab switches eventually select the URL's current content", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("reviewOwner")}/w/${doc.workspaceId}/shares`);
  const nav = page.getByRole("navigation", { name: "Shares sections" });
  await nav.getByRole("link", { name: "Saved shares", exact: true }).click({ noWaitAfter: true });
  await nav.getByRole("link", { name: /^Discussions/ }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(/tab=discussions/);
  await expect(nav.getByRole("link", { name: /^Discussions/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("list", { name: "Followed discussions" })).toBeVisible();
});


test("late Saved shares RSC responses cannot override the newer Discussions tab", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const delayed = await delaySavedShares(page, doc.workspaceId);
  try {
    await page.goto(phase3Origin("reviewOwner") + "/w/" + doc.workspaceId + "/shares");
    const nav = page.getByRole("navigation", { name: "Shares sections" });
    // A click must cause (or reuse) a held RSC request. Do not assume that
    // speculative prefetch has run before the user interacts.
    await nav.getByRole("link", { name: "Saved shares", exact: true }).click({ noWaitAfter: true });
    await expect.poll(delayed.intercepted).toBeGreaterThan(0);
    await nav.getByRole("link", { name: /^Discussions/ }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/tab=discussions/);
    await expect(page.getByRole("list", { name: "Followed discussions" })).toBeVisible();

    // The old request must reach a terminal finished/failed state, not merely
    // leave our route handler, before we assert the newest navigation survived.
    delayed.release();
    await delayed.waitForSettled();
    await expect(nav.getByRole("link", { name: /^Discussions/ })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/tab=discussions/);
  } finally {
    await delayed.dispose();
  }
});

test("search then tab switch cancels debounce while the destination RSC is delayed", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const delayed = await delaySavedShares(page, doc.workspaceId);
  try {
    await page.goto(phase3Origin("reviewOwner") + "/w/" + doc.workspaceId + "/shares");
    const nav = page.getByRole("navigation", { name: "Shares sections" });
    await page.getByRole("textbox", { name: "Find shares" }).fill("should-not-replace-tabs");
    await nav.getByRole("link", { name: "Saved shares", exact: true }).click({ noWaitAfter: true });
    await expect.poll(delayed.intercepted).toBeGreaterThan(0);

    // The destination is blocked long enough for an uncancelled 250ms debounce
    // to navigate back to My shares. That must never happen.
    await page.waitForTimeout(350);
    expect(page.url()).not.toContain("q=should-not-replace-tabs");
    delayed.release();
    await delayed.waitForSettled();

    await expect(page).toHaveURL(/tab=saved/);
    await expect(page.getByRole("textbox", { name: "Find saved shares" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Saved shares", exact: true }))
      .toHaveAttribute("aria-current", "page");
  } finally {
    await delayed.dispose();
  }
});
