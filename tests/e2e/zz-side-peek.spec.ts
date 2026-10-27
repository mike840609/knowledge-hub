import { expect, test, type Page } from "./fixtures/test";
import { ROUND_TRIP, mySpace, openKnowledge, row, unique } from "./fixtures/organize";

/**
 * Side peek split (Notion-style 50/50): a row's "Open in side peek" action
 * opens the document beside the one being read instead of navigating.
 *
 * Runs at the Desktop Chrome viewport (1280px, >=lg), so the layout shows the
 * split rather than the narrow-screen Drawer. Assumes the PeekPane contract:
 * it renders the peeked document's title text, follows wikilinks inside the
 * peek, and offers a Close button that calls onClose.
 */

async function apiDocument(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, {
    data: { title, markdown },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

async function setUp(page: Page) {
  const workspaceId = await mySpace(page);
  const mainTitle = unique("Peek Main");
  const peekTitle = unique("Peek Target");
  const thirdTitle = unique("Peek Third");
  const main = await apiDocument(page, workspaceId, mainTitle, `Body of ${mainTitle}.`);
  await apiDocument(page, workspaceId, peekTitle, `See [[${thirdTitle}]].`);
  await apiDocument(page, workspaceId, thirdTitle, `Body of ${thirdTitle}.`);
  await openKnowledge(page, workspaceId);
  await row(page, mainTitle).click();
  const mainContent = page.getByRole("region", { name: "Document content" }).first();
  await expect(mainContent).toContainText(mainTitle, ROUND_TRIP);
  expect(page.url()).toContain(main.documentId);
  return { workspaceId, mainTitle, peekTitle, thirdTitle, reading: page.url() };
}

test("right-click row opens the split with the peeked title, main unchanged", async ({ page }) => {
  const { mainTitle, peekTitle, reading } = await setUp(page);
  await row(page, peekTitle).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toBeVisible(ROUND_TRIP);
  await expect(sidePeek).toContainText(peekTitle, ROUND_TRIP);

  const mainContent = page.getByRole("region", { name: "Document content" }).first();
  await expect(mainContent).toContainText(mainTitle);
  await expect(mainContent).not.toContainText(peekTitle);
  expect(page.url()).toBe(reading);
});

test("a wikilink click in the peek changes the peek, main and URL unchanged", async ({
  page,
}) => {
  const { mainTitle, peekTitle, thirdTitle, reading } = await setUp(page);
  await row(page, peekTitle).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toContainText(peekTitle, ROUND_TRIP);
  await sidePeek.getByRole("link", { name: thirdTitle }).click();

  // The third document's body only renders after the peek follows the link:
  // asserting the title alone would pass on the link label itself.
  await expect(sidePeek).toContainText(`Body of ${thirdTitle}.`, ROUND_TRIP);
  const mainContent = page.getByRole("region", { name: "Document content" }).first();
  await expect(mainContent).toContainText(mainTitle);
  await expect(mainContent).not.toContainText(thirdTitle);
  expect(page.url()).toBe(reading);
});

test("closing the peek restores the single column", async ({ page }) => {
  const { peekTitle } = await setUp(page);
  await row(page, peekTitle).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toBeVisible(ROUND_TRIP);
  await sidePeek.getByRole("button", { name: /close/i }).click();
  await expect(page.getByTestId("side-peek")).toHaveCount(0, ROUND_TRIP);
});

test("Open as full page closes the peek and opens the peeked document", async ({ page }) => {
  const { peekTitle, reading } = await setUp(page);
  await row(page, peekTitle).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toContainText(peekTitle, ROUND_TRIP);
  await sidePeek.getByRole("link", { name: "Open as full page" }).click();

  await expect(page.getByTestId("side-peek")).toHaveCount(0, ROUND_TRIP);
  const mainContent = page.getByRole("region", { name: "Document content" }).first();
  await expect(mainContent).toContainText(peekTitle, ROUND_TRIP);
  expect(page.url()).not.toBe(reading);
});

async function homeWithDocument(page: Page) {
  const workspaceId = await mySpace(page);
  const title = unique("Peek Home");
  const created = await apiDocument(page, workspaceId, title, `Body of ${title}.`);
  await page.goto(`/w/${workspaceId}/home`);
  const homeRow = page.getByRole("link", { name: title }).first();
  await expect(homeRow).toBeVisible(ROUND_TRIP);
  return { title, created, homeRow, home: page.url() };
}

test("Home's Open in side peek opens the split beside Home", async ({ page }) => {
  const { title, homeRow, home } = await homeWithDocument(page);
  await homeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toContainText(`Body of ${title}.`, ROUND_TRIP);
  expect(page.url()).toBe(home);
  await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

test("a narrow Home peeks in the drawer, and Open as full page leaves it", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const { title, created, homeRow } = await homeWithDocument(page);
  await homeRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(`Body of ${title}.`, ROUND_TRIP);
  await drawer.getByRole("link", { name: "Open as full page" }).click();
  await expect(page).toHaveURL(new RegExp(created.documentId), ROUND_TRIP);
  await expect(page.getByRole("dialog")).toHaveCount(0, ROUND_TRIP);
});

test("Open as full page on the document already open still closes the peek", async ({ page }) => {
  const { mainTitle, reading } = await setUp(page);
  await row(page, mainTitle).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in side peek" }).click();

  const sidePeek = page.getByTestId("side-peek");
  await expect(sidePeek).toContainText(mainTitle, ROUND_TRIP);
  await sidePeek.getByRole("link", { name: "Open as full page" }).click();

  // The route does not move, so only the finished growth can take the peek away.
  await expect(page.getByTestId("side-peek")).toHaveCount(0, ROUND_TRIP);
  expect(page.url()).toBe(reading);
});
