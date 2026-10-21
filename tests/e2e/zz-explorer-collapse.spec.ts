import { expect, test } from "./fixtures/test";
import { personalWorkspaceId } from "./fixtures/my-space";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import { projectReviewBlocks } from "../../src/modules/knowledge/domain/review-anchor";

// explorer-collapse spec, Acceptance.
test("the explorer hides to a strip and comes back, focus following, and is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/w/${await personalWorkspaceId(page)}/knowledge`);
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  const hide = page.getByRole("button", { name: "Hide documents" });
  const show = page.getByRole("button", { name: "Show documents" });
  await expect(explorer).toBeVisible();
  await expect(show).toHaveCount(0);
  const before = (await explorer.boundingBox())!.width;

  await hide.click();
  await expect(explorer).toBeHidden();
  await expect(show).toBeVisible();
  await expect(show).toBeFocused();
  // The strip keeps 40px of the explorer's place; the rest goes to the content.
  const strip = (await show.locator("xpath=../..").boundingBox())!;
  expect(Math.round(strip.width)).toBe(40);
  expect(before).toBeGreaterThan(strip.width + 200);

  await page.reload();
  await expect(show).toBeVisible();
  await expect(explorer).toBeHidden();

  await show.click();
  await expect(explorer).toBeVisible();
  await expect(hide).toBeFocused();
  await expect(show).toHaveCount(0);
  await page.reload();
  await expect(explorer).toBeVisible();
});

test("the explorer keeps its tree while hidden: an open filter is still open when it is shown", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/w/${await personalWorkspaceId(page)}/knowledge`);
  await page.getByRole("button", { name: "Filter documents and sources" }).click();
  const filter = page.locator("#tree-filter");
  await expect(filter).toBeVisible();
  await page.getByRole("button", { name: "Hide documents" }).click();
  await expect(filter).toBeHidden();
  await page.getByRole("button", { name: "Show documents" }).click();
  await expect(filter).toBeVisible();
});

test("at 1512px, with the primary rail and the explorer collapsed, outline, article and discussions stand side by side", async ({ page, request }) => {
  const paragraphs = (from: number) => Array.from({ length: 12 }, (_, i) => `Paragraph ${from + i}: a clear recommendation with enough context for a colleague to review.`).join("\n\n");
  const markdown = `## Alpha\n\n${paragraphs(1)}\n\n## Beta\n\n${paragraphs(13)}\n`;
  const doc = await createReviewDocument(request, markdown);
  const viewer = phase3Origin("viewer");
  const block = projectReviewBlocks(markdown).find((candidate) => candidate.text.startsWith("Paragraph 3:"))!;
  const created = await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: {
    token: doc.links[0].path.split("/").pop(), expectedRevisionId: doc.revisionId, idempotencyKey: crypto.randomUUID(), body: "A reviewer's remark",
    anchor: { schemaVersion: 1, blockPath: block.path, blockKind: block.kind, startUtf16: 0, endUtf16: 11, exact: block.text.slice(0, 11), prefix: "", suffix: block.text.slice(11, 75) },
  } });
  expect(created.status()).toBe(201);

  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto(doc.href);
  const rail = page.getByRole("complementary", { name: "Document discussions" });
  const outline = page.getByRole("complementary", { name: "On this page" });
  await expect(rail).toBeVisible();
  // With both open the pane is too narrow: the outline gives the discussions its place.
  await expect(outline).toBeHidden();

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await page.getByRole("button", { name: "Hide documents" }).click();
  const pane = page.getByRole("region", { name: "Document content" });
  await expect.poll(() => pane.evaluate((element) => element.clientWidth)).toBeGreaterThanOrEqual(1408);
  await expect(rail).toBeVisible();
  await expect(outline).toBeVisible();
  const article = page.locator("[data-review-document]");
  await expect.poll(async () => {
    const [outlineBox, articleBox, railBox] = [(await outline.boundingBox())!, (await article.boundingBox())!, (await rail.boundingBox())!];
    return outlineBox.x >= 0 && outlineBox.x + outlineBox.width <= articleBox.x + 1 && railBox.x >= articleBox.x + articleBox.width - 1;
  }).toBe(true);
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("the narrow window's menu shows the explorer with no way to hide it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/w/${await personalWorkspaceId(page)}/knowledge`);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Knowledge explorer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide documents" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show documents" })).toBeHidden();
});
