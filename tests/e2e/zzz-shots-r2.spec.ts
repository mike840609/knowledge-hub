import { test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Throwaway: before/after screenshots for the PR descriptions. Never committed.
const DIR = process.env.SHOT_DIR!;
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
test.use({ viewport: { width: 1280, height: 760 } });

async function note(page: Page, title: string, markdown: string) {
  const ws = await mySpace(page);
  const r = await page.request.post(`/api/workspaces/${ws}/documents`, { data: { title, markdown } });
  const c = (await r.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${ws}/knowledge/${c.sourceId}/${c.documentId}`);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await surface.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(900);
  return { ws, c, surface };
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${DIR}/${name}.png` });

test("363 slash list", async ({ page }) => {
  const { surface } = await note(page, unique("Slash"), "Start");
  await surface.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/d", { delay: 40 });
  await page.waitForTimeout(500);
  await shot(page, "363-slash-list");
});

test("363 heading menu", async ({ page }) => {
  const { surface } = await note(page, unique("Menu"), "## A heading\n\nSome text.");
  await surface.locator("h2").first().hover();
  await page.waitForTimeout(500);
  await page.locator(".kh-block-gutter button[aria-label='Move block']").click({ force: true });
  await page.waitForTimeout(500);
  await shot(page, "363-heading-menu");
});

test("364 create page", async ({ page }) => {
  const { surface } = await note(page, unique("Link"), "See");
  await surface.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" [[Quarterly roadmap", { delay: 25 });
  await page.waitForTimeout(900);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(200);
  await shot(page, "364-create-page");
});

test("364 pasted address", async ({ page }) => {
  const { surface } = await note(page, unique("Paste"), "Notes:");
  await surface.locator("p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await surface.evaluate((dom) => {
    const data = new DataTransfer();
    data.setData("text/plain", "Details are at https://example.com/handbook, please read before Monday.");
    dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  await page.mouse.click(1000, 500);
  await shot(page, "364-pasted-address");
});

test("365 block range", async ({ page }) => {
  const { surface } = await note(page, unique("Range"), "# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n\n- item a\n- item b\n\nLast paragraph.");
  await surface.getByText("First paragraph.", { exact: true }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.waitForTimeout(400);
  await shot(page, "365-block-range");
});

test("366 header", async ({ page }) => {
  const { surface } = await note(page, unique("Chrome"), "Some text to count here, and a little more.\n\n## Heading\n\nMore words follow.");
  await surface.getByText("Some text to count here, and a little more.", { exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator("main").screenshot({ path: `${DIR}/366-header-page.png` });
});

test.describe("wide", () => {
  test.use({ viewport: { width: 2200, height: 900 } });
  test("366 full width", async ({ page }) => {
    const { } = await note(page, unique("Wide"), "Some text.\n\n## Heading one\n\ntext\n\n## Heading two\n\ntext");
    const toggle = page.getByRole("button", { name: "Full width" });
    if (await toggle.count()) await toggle.click();
    await page.waitForTimeout(600);
    await shot(page, "366-full-width");
  });
});
