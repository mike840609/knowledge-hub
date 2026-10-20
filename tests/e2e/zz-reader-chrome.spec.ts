import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

/**
 * The editable document page, read rather than written: an external link says it leaves, as the
 * reader's does; the Markdown toggle sits with the page's actions instead of on a row of its own
 * above the title; and a code block's Edit code shows when it is wanted, not under every block.
 * Sorted last for the reason zz-reading-code.spec.ts gives.
 */

const MARKDOWN = [
  "# Chrome probe", "",
  "See [the site](https://example.com/page) and [[Chrome probe]] and [a doc](./other.md).", "",
  "```ts", "const a = 1;", "```", "",
  "After.",
].join("\n");

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const workspaceId = await mySpace(page);
  const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Chrome ${Date.now().toString(36)}`, markdown: MARKDOWN } });
  expect(created.ok()).toBe(true);
  const { sourceId, documentId } = (await created.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeEditable({ timeout: 15_000 });
}

/** The mask an anchor's ::after paints, or "none". */
const afterMask = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => {
  const style = getComputedStyle(element, "::after");
  return style.content === "none" ? "none" : style.maskImage || style.webkitMaskImage;
});

test("an external link in the editor is marked as one, and only an external link", async ({ page }) => {
  await open(page);
  const editor = '[role="textbox"][aria-label="Content"]';
  expect(await afterMask(page, `${editor} a[href="https://example.com/page"]`)).toContain("external-link.svg");
  expect(await afterMask(page, `${editor} a[href="./other.md"]`)).toBe("none");
  // The mark is drawn, not written: the link's text is still only its text.
  await expect(page.locator(`${editor} a[href="https://example.com/page"]`)).toHaveText("the site");
});

test("the Markdown toggle is one of the page's actions, and the title is not pushed down for it", async ({ page }) => {
  await open(page);
  const toggle = page.getByRole("button", { name: "Markdown", exact: true });
  await expect(toggle).toBeVisible();
  // Beside Share, in the pinned line, not in the article.
  expect(await toggle.evaluate((element) => element.closest("article") === null)).toBe(true);
  const share = page.getByRole("button", { name: "Share link…" });
  const [a, b] = await Promise.all([toggle.boundingBox(), share.boundingBox()]);
  expect(Math.abs(a!.y + a!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(4);
  // Still a toggle, and still pinned after scrolling.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Markdown", { exact: true })).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // The title is the article's first line.
  const [title, editor] = await Promise.all([
    page.locator('[role="textbox"][aria-label="Content"] h1').boundingBox(),
    page.getByRole("textbox", { name: "Content", exact: true }).boundingBox(),
  ]);
  expect(title!.y - editor!.y).toBeLessThan(8);
});

test("Edit code shows on hover and on keyboard focus, and stays while the code is being edited", async ({ page }) => {
  await open(page);
  const edit = page.getByRole("button", { name: "Edit code", exact: true });
  const opacity = () => edit.evaluate((element) => getComputedStyle(element).opacity);
  await page.mouse.move(5, 5);
  await expect.poll(opacity).toBe("0");
  await page.locator("[data-inline-code-preview]").first().hover();
  await expect.poll(opacity).toBe("1");
  await page.mouse.move(5, 5);
  await expect.poll(opacity).toBe("0");
  await edit.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(edit).toBeFocused();
  await expect.poll(opacity).toBe("1");
  await page.keyboard.press("Enter");
  const done = page.getByRole("button", { name: "Done editing code", exact: true });
  await page.mouse.move(5, 5);
  await expect.poll(() => done.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
});
