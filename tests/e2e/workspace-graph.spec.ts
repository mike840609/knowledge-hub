import { stageReadingFolder } from "./fixtures/folder-reading";
import { expect, test, type Page } from "@playwright/test";
import { openPalette } from "./fixtures/palette";
import { showMarkdown } from "./composer-helpers";

/**
 * Creates documents in the E2E user's own My Space, and the specs share one
 * database and run in file-name order. phase2.5-routing.spec.ts asserts that a
 * fresh My Space is empty, so this file must sort after it — which is why it is
 * named `reading-…` and not `document-…`. share-link.spec.ts relies on the same
 * ordering for the same reason.
 */

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const RESTRICTED_WORKSPACE = "0199f100-0000-7000-8000-000000000003";

// Same budget and reasoning as phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string; url: string; documentId: string }> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  // The composer opens in rendered editing; exact Markdown is typed in its source view (composer-helpers).
  const form = page.locator("main form").first();
  await form.getByLabel("Title", { exact: true }).fill(title);
  await (await showMarkdown(form)).fill(body);
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.locator("article").first()).toBeVisible(ROUND_TRIP);
  return { workspaceId, url: page.url(), documentId: new URL(page.url()).pathname.split("/").at(-1)! };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A document's node in the drawing, by its title (each carries its link counts in its name). */
const node = (page: Page, title: string) => page.getByRole("link", { name: new RegExp(`^${escape(title)}, \\d+ incoming, \\d+ outgoing$`) });

/**
 * A target nothing answers to: drawn, and named. It has no page to open, so to a reader who may write
 * (My Space, here) it is the way to the form that makes one, and a link; to anyone else it is not a link.
 */
const ghost = (page: Page, title: string) => page.getByRole("link", { name: new RegExp(`^${escape(title)} \\(unresolved; opens the form to create it\\), \\d+ incoming, \\d+ outgoing$`) });

test.describe("the workspace graph", () => {
  test("draws documents and their links, and the filters, find box and views work", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = Date.now();
    const a = `Graph A ${stamp}`;
    const b = `Graph B ${stamp}`;
    const c = `Graph C ${stamp}`;
    const missing = `Graph Missing ${stamp}`;
    await createMySpaceDocument(page, b, `Back to [[${a}]].`);
    const docA = await createMySpaceDocument(page, a, `Links to [[${b}]] and [[${missing}]].`);
    await createMySpaceDocument(page, c, "Nothing links here and it links nowhere.");
    const { workspaceId } = docA;

    // Reached from the primary navigation.
    await page.goto(`/w/${workspaceId}/knowledge`);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Graph" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/graph$`), ROUND_TRIP);
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Graph" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("group", { name: /^Knowledge graph, \d+ nodes?, \d+ links?$/ })).toBeVisible(ROUND_TRIP);

    // A and B link to each other; C is an orphan, and shown by default.
    await expect(node(page, a)).toHaveAttribute("aria-label", `${a}, 1 incoming, 1 outgoing`);
    await expect(node(page, b)).toHaveAttribute("aria-label", `${b}, 1 incoming, 1 outgoing`);
    await expect(node(page, c)).toHaveAttribute("aria-label", `${c}, 0 incoming, 0 outgoing`);
    // C is on the shelf under the drawing rather than adrift in it, and says so.
    await expect(page.getByText(/^Not linked · \d+$/)).toBeVisible();
    // The SVG link bounds also include its pointer-disabled label. Target the painted
    // node circle rather than the bounding-box centre, which can fall in empty space.
    // Pointing at a node opens a card with what the drawing can only suggest.
    await node(page, a).locator("circle").last().hover();
    await expect(page.locator("[data-graph-card]")).toContainText(`${a}`);
    await expect(page.locator("[data-graph-card]")).toContainText("1 in");
    // The missing target is hidden until asked for.
    await expect(ghost(page, missing)).toHaveCount(0);

    await page.getByLabel("Unresolved").check();
    await expect(page).toHaveURL(/unresolved=1/, ROUND_TRIP);
    await expect(ghost(page, missing)).toHaveAttribute("aria-label", `${missing} (unresolved; opens the form to create it), 1 incoming, 0 outgoing`, ROUND_TRIP);
    await expect(node(page, a)).toHaveAttribute("aria-label", `${a}, 1 incoming, 2 outgoing`, ROUND_TRIP);

    await page.getByLabel("Orphans").uncheck();
    await expect(page).toHaveURL(/orphans=0/, ROUND_TRIP);
    await expect(node(page, c)).toHaveCount(0);
    await expect(node(page, a)).toBeVisible();

    // The find box only highlights: what does not match is dimmed, and nothing moves.
    await page.getByRole("searchbox", { name: "Find a document" }).fill(`Graph B ${stamp}`);
    await expect(node(page, a)).toHaveClass(/opacity-25/);
    await expect(node(page, b)).not.toHaveClass(/opacity-25/);
    await page.getByRole("searchbox", { name: "Find a document" }).fill("");

    // Zooming changes the view, and Reset brings it back.
    const transform = () => page.locator("svg[role='group'] > g").first().getAttribute("transform");
    expect(await transform()).toBe("translate(0 0) scale(1)");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(transform).toMatch(/scale\(1\.3\)/);
    await page.getByRole("button", { name: "Reset view" }).click();
    await expect.poll(transform).toBe("translate(0 0) scale(1)");

    // The same nodes, as a table with exact counts.
    await page.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/view=list/, ROUND_TRIP);
    const row = page.getByRole("row", { name: new RegExp(a) });
    await expect(row.getByRole("cell").nth(1)).toHaveText("1");
    await expect(row.getByRole("cell").nth(2)).toHaveText("2");
    await expect(page.getByRole("row", { name: new RegExp(`${missing}.*Unresolved`) })).toBeVisible();

    // A node is a real link: it opens its document.
    await page.getByRole("link", { name: "Graph", exact: true }).first().click();
    await page.goto(`/w/${workspaceId}/graph?unresolved=1`);
    await node(page, a).locator("circle").last().click();
    await expect(page).toHaveURL(docA.url, ROUND_TRIP);
  });

  test("the document's own Links tab draws its neighbourhood and opens the full graph on it", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const stamp = Date.now();
    const centre = `Local Centre ${stamp}`;
    const near = `Local Near ${stamp}`;
    const far = `Local Far ${stamp}`;
    await createMySpaceDocument(page, far, "the far one");
    await createMySpaceDocument(page, near, `Points at [[${far}]].`);
    const doc = await createMySpaceDocument(page, centre, `Links to [[${near}]].`);
    await page.goto(doc.url);

    await page.getByRole("button", { name: "Details" }).first().click();
    await page.getByRole("tab", { name: "Links" }).click();
    const local = page.locator('[data-links-section="graph"]');
    await expect(local.getByRole("group", { name: /^Local graph, 2 documents$/ })).toBeVisible(ROUND_TRIP);
    await expect(local.getByRole("link", { name: new RegExp(`^${near}`) })).toBeVisible();
    // One link out from the centre does not reach the far document.
    await expect(local.getByRole("link", { name: new RegExp(`^${far}`) })).toHaveCount(0);

    await local.getByRole("link", { name: "2 links" }).click();
    await expect(page).toHaveURL(/graph=2/, ROUND_TRIP);
    await page.getByRole("tab", { name: "Links" }).click();
    await expect(page.locator('[data-links-section="graph"]').getByRole("link", { name: new RegExp(`^${far}`) })).toBeVisible(ROUND_TRIP);

    await page.locator('[data-links-section="graph"]').getByRole("link", { name: "Open in graph" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/graph\\?focus=${doc.documentId}$`), ROUND_TRIP);
    await expect(page.getByRole("link", { name: new RegExp(`^${centre}`) }).first()).toBeVisible(ROUND_TRIP);
  });

  test("explains documents without links independently of other test data", async ({ page, request }) => {
    const nav = await (await request.get("/api/workspaces")).json();
    const workspaceId = nav.items.find((item: { type: string }) => item.type === "PERSONAL").id;
    const snapshot = await stageReadingFolder(request, { workspaceId, sourceName: "Graph without links", fixture: "wrong-folder" });
    const applied = await (await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} })).json();
    expect(applied.kind).toBe("APPLIED");
    await page.goto(`/w/${workspaceId}/graph?source=${applied.sourceId}`);
    const empty = page.locator("[data-graph-empty]").filter({ visible: true });
    await expect(empty.getByText("No links between documents yet")).toBeVisible(ROUND_TRIP);
    await expect(empty.getByText("[[Document title]]")).toBeVisible();
    await expect(empty.getByRole("link", { name: "Open a document", exact: true })).toBeVisible();
    await page.goto(`/w/${workspaceId}/graph?source=${applied.sourceId}&orphans=0`);
    await expect(page.getByRole("heading", { name: "No documents match these filters", exact: true })).toBeVisible(ROUND_TRIP);
    await page.getByRole("button", { name: "Show all documents", exact: true }).click();
    await expect(page).toHaveURL(`/w/${workspaceId}/graph`);
  });

  test("is the command palette's Open graph", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    const workspaceId = new URL(page.url()).pathname.split("/")[2];
    await (await openPalette(page)).fill("graph");
    await page.getByRole("option", { name: /Open graph/ }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/graph$`), ROUND_TRIP);
  });

  test("is not available for a workspace the caller is not a member of", async ({ page }) => {
    // The same answer as the workspace's other routes give a non-member: 404, with nothing drawn.
    const response = await page.goto(`/w/${RESTRICTED_WORKSPACE}/graph`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("svg[role='group']")).toHaveCount(0);
  });
});

test("the source filter stays inside its slot and clear of the toggles beside it", async ({ page }) => {
  // Query Master has two sources, so the filter is offered. A native select sizes itself to its longest
  // option; drawn wider than its 176px slot, it lay over the Orphans toggle.
  await page.goto("/w/0199f100-0000-7000-8000-000000000001/graph");
  const select = page.locator("#graph-source");
  await expect(select).toBeVisible(ROUND_TRIP);
  const box = (await select.boundingBox())!;
  const slot = (await select.locator("..").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(slot.x + slot.width + 0.5);
  const orphans = (await page.getByText("Orphans", { exact: true }).boundingBox())!;
  const sameRow = Math.abs((box.y + box.height / 2) - (orphans.y + orphans.height / 2)) < 8;
  if (sameRow) expect(box.x + box.width).toBeLessThanOrEqual(orphans.x);
});
