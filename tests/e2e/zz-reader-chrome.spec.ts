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

test("a code block in the editor is drawn as the reader draws it: one box, and the reader's height", async ({ page }) => {
  await open(page);
  const preview = page.locator("[data-inline-code-preview]").first();
  await expect(preview.locator("pre")).toBeVisible();
  // The editor's rule for the raw code it edits must not reach the reader's block it shows: that drew a second
  // box inside the first, and its margins, so the editor's page ran longer than the page it saves.
  const inner = await preview.locator("pre").evaluate((pre) => {
    const style = getComputedStyle(pre);
    return { border: style.borderTopWidth, margin: style.marginTop, background: style.backgroundColor };
  });
  expect(inner).toEqual({ border: "0px", margin: "0px", background: "rgba(0, 0, 0, 0)" });
  // Where the block and the paragraph after it sit, from the top of the document's first heading.
  const layout = (root: string) => page.evaluate((selector) => {
    const scope = document.querySelector(selector)!;
    const top = scope.querySelector("h1")!.getBoundingClientRect().top;
    const box = scope.querySelector("[data-code-block]")!.getBoundingClientRect();
    const code = getComputedStyle(scope.querySelector("[data-code-block] pre code")!);
    const after = Array.from(scope.querySelectorAll("p")).find((p) => p.textContent === "After.")!.getBoundingClientRect();
    // An inline-code chip's padding on a block's <code> indents only its first line.
    return { block: Math.round(box.top - top), height: Math.round(box.height), after: Math.round(after.top - top), codePadding: code.paddingLeft };
  }, root);
  const editor = await layout('[role="textbox"][aria-label="Content"]');

  await page.goto(`${page.url()}?revision=1`);
  await expect(page.locator("article [data-code-block]")).toBeVisible();
  // Edit code takes no room of its own until the code is being edited: the editor's page is the reader's page.
  expect(editor).toEqual(await layout("article"));
  expect(editor.codePadding).toBe("0px");
});
