import { expect, test, type Browser, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS.
const WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const SOURCE = "0199f100-0000-7000-8000-000000000101";

/**
 * Timestamps follow the reader's browser, which the server cannot know.
 *
 * These are written without knowing what the fixtures' instants are. Each one
 * reads the `datetime` attribute — the instant itself, which must never move —
 * and checks the text against what that instant reads as in the zone the
 * browser was given.
 */

const ZONES = { east: "Asia/Taipei", west: "America/Los_Angeles" };

function inZone(instant: string, timeZone: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone,
  }).format(new Date(instant));
}

async function times(page: Page, within = "main") {
  const locator = page.locator(within).locator("time");
  await expect(locator.first()).toBeVisible();
  // The effect that swaps the agreed zone for the browser's runs after mount.
  await page.waitForTimeout(300);
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: (node.textContent ?? "").trim(),
      title: node.getAttribute("title"),
      instant: node.getAttribute("datetime") ?? "",
    })),
  );
}

async function visit(browser: Browser, timezoneId: string, path: string) {
  const context = await browser.newContext({ timezoneId });
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
}

/**
 * The search row is a server component, which is the case that was broken:
 * the server formatted in its own zone and that string stayed on the page.
 */
test("a server-rendered timestamp ends up in the reader's zone", async ({ browser }) => {
  const { context, page } = await visit(browser, ZONES.east, `/w/${WORKSPACE}/search?q=architecture`);
  try {
    const rendered = await times(page);
    expect(rendered.length).toBeGreaterThan(0);
    for (const entry of rendered) {
      expect(entry.text).toBe(inZone(entry.instant, ZONES.east, false));
      // The column drops the time, so the full moment lives in the tooltip.
      expect(entry.title).toBe(inZone(entry.instant, ZONES.east));
    }
  } finally {
    await context.close();
  }
});

test("a document's revision history is read in the browser's zone", async ({ browser }) => {
  const { context, page } = await visit(browser, ZONES.east, `/w/${WORKSPACE}/knowledge/${SOURCE}`);
  try {
    await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
    await page.locator("main").getByRole("button", { name: "Details" }).click();
    await page.getByRole("tab", { name: "History" }).click();
    const panel = page.getByRole("tabpanel", { name: "History" });
    const entries = await panel.locator("time").evaluateAll((nodes) =>
      nodes.map((node) => ({
        text: (node.textContent ?? "").trim(),
        instant: node.getAttribute("datetime") ?? "",
      })),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(entry.text).toBe(inZone(entry.instant, ZONES.east));
  } finally {
    await context.close();
  }
});

test("the same instant reads differently in two zones, and is still the same instant", async ({ browser }) => {
  const path = `/w/${WORKSPACE}/search?q=architecture`;
  const east = await visit(browser, ZONES.east, path);
  const west = await visit(browser, ZONES.west, path);
  try {
    const there = await times(east.page);
    const here = await times(west.page);

    expect(there.map((entry) => entry.instant)).toEqual(here.map((entry) => entry.instant));
    // Sixteen hours apart: the full moment cannot read the same in both.
    expect(there.map((entry) => entry.title)).not.toEqual(here.map((entry) => entry.title));
  } finally {
    await east.context.close();
    await west.context.close();
  }
});
