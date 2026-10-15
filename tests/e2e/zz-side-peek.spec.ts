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

  await expect(sidePeek).toContainText(thirdTitle, ROUND_TRIP);
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
