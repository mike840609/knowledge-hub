import { expect, test, type Page } from "./fixtures/test";
import { openPalette } from "./fixtures/palette";
import { showMarkdown } from "./composer-helpers";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
const TEAM_WORKSPACE = "0199f100-0000-7000-8000-000000000001";
const ROUND_TRIP = { timeout: 15_000 };

async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string; url: string; documentId: string }> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  const workspaceId = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/w/${workspaceId}/knowledge/new`);
  const form = page.locator("main");
  await form.getByLabel("Title", { exact: true }).fill(title);
  await (await showMarkdown(form)).fill(body);
  await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.locator("article").first()).toBeVisible(ROUND_TRIP);
  return { workspaceId, url: page.url(), documentId: new URL(page.url()).pathname.split("/").at(-1)! };
}

async function openLinksTab(page: Page) {
  await (await openPalette(page)).fill("backlinks");
  await page.getByRole("option", { name: /Show backlinks/ }).click();
  await expect(page.getByRole("tab", { name: "Links", selected: true })).toBeVisible();
}

const box = (page: Page, title: string) => page.getByRole("checkbox", { name: new RegExp(`Select ${title}`) });

test.describe("Copy for Agent from a document's neighbourhood", () => {
  test("copies a document's neighbourhood with its link map", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const stamp = Date.now();
    const [a, b, c, d] = ["A", "B", "C", "D"].map(letter => `Hood ${letter} ${stamp}`);
    // Created leaf first, so every link resolves when its document is saved.
    const docC = await createMySpaceDocument(page, c, "Leaf.");
    const docB = await createMySpaceDocument(page, b, `Down to [[${c}]].`);
    const docD = await createMySpaceDocument(page, d, "Unlinked.");
    const docA = await createMySpaceDocument(page, a, `To [[${b}]] and [[Missing ${stamp}]].`);

    await page.goto(`${docA.url}?graph=2`);
    await openLinksTab(page);
    await page.locator('[data-links-section="graph"]').getByRole("link", { name: "Copy for Agent with nearby documents" }).click();
    await expect(page).toHaveURL(new RegExp(`around=${docA.documentId}&depth=2`), ROUND_TRIP);
    await expect(page.getByText("Started with 3 nearby documents.")).toBeVisible();
    for (const title of [a, b, c]) await expect(box(page, title)).toBeChecked();
    await expect(box(page, d)).not.toBeChecked();

    await page.getByRole("button", { name: "Prepare context" }).click();
    const preview = page.getByLabel("Markdown preview");
    await expect(preview).toHaveValue(/## Links/);
    const lines = (await preview.inputValue()).split("\n").filter(line => line.startsWith("Link: ")).map(line => JSON.parse(line.slice(6)));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromId: docA.documentId, toId: docB.documentId }),
      expect.objectContaining({ fromId: docB.documentId, toId: docC.documentId }),
      expect.objectContaining({ fromId: docA.documentId, to: `Missing ${stamp}`, toId: null, missing: true }),
    ]));
    expect(lines.some(line => line.toId === docD.documentId)).toBe(false);

    // `around` wins over `document`.
    await page.goto(`/w/${docA.workspaceId}/agent-context?around=${docA.documentId}&document=${docD.documentId}`);
    await expect(box(page, a)).toBeChecked();
    await expect(box(page, d)).not.toBeChecked();
  });

  test("is not offered in a Team workspace, and a Team document preselects nothing in My Space", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`/w/${TEAM_WORKSPACE}/graph?view=list`);
    const href = await page.locator(`a[href*="/w/${TEAM_WORKSPACE}/knowledge/"]`).first().getAttribute("href");
    expect(href).toBeTruthy();
    const teamDocumentId = new URL(href!, page.url()).pathname.split("/").at(-1)!;
    await page.goto(href!);
    await openLinksTab(page);
    await expect(page.locator('[data-links-section="graph"]').getByRole("link", { name: "Copy for Agent" })).toHaveCount(0);

    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    const personal = new URL(page.url()).pathname.split("/")[2];
    await page.goto(`/w/${personal}/agent-context?around=${teamDocumentId}&depth=2`);
    await expect(page.getByRole("heading", { name: /Selected documents/ })).toContainText("0 / 20");
    await expect(page.getByText(/nearby documents\./)).toHaveCount(0);
  });

  test("the graph page offers it for a focused document whatever its filters", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const stamp = Date.now();
    await createMySpaceDocument(page, `Focus T ${stamp}`, "Target.");
    const focus = await createMySpaceDocument(page, `Focus F ${stamp}`, `To [[Focus T ${stamp}]].`);
    await page.goto(`/w/${focus.workspaceId}/graph?focus=${focus.documentId}&unresolved=1`);
    const entry = page.getByRole("link", { name: "Copy for Agent with nearby documents" });
    await expect(entry).toHaveAttribute("href", `/w/${focus.workspaceId}/agent-context?around=${focus.documentId}&depth=1`);
    await page.goto(`/w/${focus.workspaceId}/graph`);
    await expect(page.getByRole("link", { name: "Copy for Agent" })).toHaveCount(0);
  });
});
