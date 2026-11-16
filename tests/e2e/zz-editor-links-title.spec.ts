import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Title, links and the selection toolbar of the rendered editor, driven as a person drives them
 * (docs/superpowers/specs/2026-11-15-editor-notion-parity-design.md, decisions 9-13). It writes into the E2E
 * user's My Space, so it sorts last for the reasons zz-wikilinks-composer.spec.ts gives.
 */

const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const main = (page: Page) => page.locator("main");
const surfaceOf = (page: Page) => main(page).getByRole("textbox", { name: "Content" });
const paletteField = (page: Page) => page.getByRole("combobox", { name: "Search documents and actions" });
const toolbar = (page: Page) => page.locator('.kh-selection-toolbar[data-show="true"]');
const card = (page: Page) => page.locator(".kh-link-card[data-show='true']");

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

async function openEditor(page: Page, documentUrl: string) {
  await page.goto(documentUrl);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}

async function save(page: Page) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const documentId = new URL(page.url()).pathname.split("/").at(-1);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}

/** The caret as ProseMirror learns of it (on `selectionchange`) a task after the browser moves it. */
const settle = (page: Page) => page.waitForTimeout(200);

/** Selects the last word of the document ("gamma") from the keyboard, and waits for the toolbar that follows. */
async function selectLastWord(page: Page, surface: ReturnType<typeof surfaceOf>) {
  await surface.locator("p").first().click();
  await page.keyboard.press("Control+End");
  await settle(page);
  await page.keyboard.press("Control+Shift+ArrowLeft");
  await settle(page);
  await expect(page.locator('.kh-selection-toolbar[data-show="true"]')).toBeVisible();
}

test.describe("title keys (10)", () => {
  test("Enter and ArrowDown in a document's title move the caret to the start of the text, never into the title", async ({ page }) => {
    const title = unique("Title keys");
    const surface = await openEditor(page, await createNote(page, await mySpace(page), title, "First line\n\nSecond line"));
    const field = main(page).getByRole("textbox", { name: "Title", exact: true });
    await field.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue(title);
    await expect(surface).toBeFocused();
    await page.keyboard.type("A");
    await expect(surface.locator("p").first()).toHaveText("AFirst line");

    await field.click();
    await page.keyboard.press("ArrowDown");
    await expect(surface).toBeFocused();
    await page.keyboard.type("B");
    await expect(surface.locator("p").first()).toHaveText("BAFirst line");
    await expect(field).toHaveValue(title);
  });

  test("in a new document's title Enter and ArrowDown reach an empty document's first paragraph", async ({ page }) => {
    await page.goto(`/w/${await mySpace(page)}/knowledge/new?compose`);
    const field = main(page).getByLabel("Title", { exact: true });
    const surface = surfaceOf(page);
    await expect(surface).toBeEditable(ROUND_TRIP);
    await field.fill(unique("New title keys"));
    await field.press("Enter");
    await expect(surface).toBeFocused();
    await page.keyboard.type("first");
    await expect(surface.locator("p").first()).toHaveText("first");
    await field.click();
    await field.press("ArrowDown");
    await expect(surface).toBeFocused();
    await page.keyboard.type(">");
    await expect(surface.locator("p").first()).toHaveText(">first");
  });
});

test.describe("modified Enter in a title keeps its old meaning", () => {
  test("Alt+Enter in a document's title adds no line break", async ({ page }) => {
    const title = unique("Mod enter");
    await openEditor(page, await createNote(page, await mySpace(page), title, "First"));
    const field = main(page).getByRole("textbox", { name: "Title", exact: true });
    await field.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Alt+Enter");
    await expect(field).toHaveValue(title);
  });
  test("Shift+Enter in a new document's title does not submit the form", async ({ page }) => {
    await page.goto(`/w/${await mySpace(page)}/knowledge/new?compose`);
    const field = main(page).getByLabel("Title", { exact: true });
    await expect(surfaceOf(page)).toBeEditable(ROUND_TRIP);
    await field.fill(unique("Shift enter"));
    await field.press("Shift+Enter");
    await expect(surfaceOf(page)).toBeFocused();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/new\?compose$/);
  });
});

test.describe("⌘K over a selection (9)", () => {
  test("opens the link field and not the palette; with no selection it is the palette", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Mod K"), "alpha beta gamma"));
    await selectLastWord(page, surface);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(toolbar(page).getByRole("textbox", { name: "Link address" })).toBeFocused();
    await page.waitForTimeout(500);
    await expect(paletteField(page)).toHaveCount(0);

    await page.keyboard.type("example.com");
    await page.keyboard.press("Enter");
    await expect(surface.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(surface).toBeFocused();

    // A caret and no selection: the palette, as before.
    await surface.getByText("alpha").click();
    await settle(page);
    for (let attempt = 0; attempt < 5 && !(await paletteField(page).isVisible()); attempt++) {
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForTimeout(400);
    }
    await expect(paletteField(page)).toBeVisible();
  });
});

test.describe("the link card (11)", () => {
  const MARKDOWN = "Before the [site](https://example.com/path) after.";

  test("shows on a click in a link, hides on Escape without selecting a block, and shows again on a new entry", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Card"), MARKDOWN));
    await surface.locator("p").first().click({ position: { x: 4, y: 8 } });
    await settle(page);
    await expect(card(page)).toHaveCount(0);

    await surface.locator("a").click();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText("https://example.com/path");
    await expect(page).toHaveURL(/knowledge/);

    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveCount(0);
    await expect(surface.locator(".ProseMirror-selectednode")).toHaveCount(0);
    await expect(surface).toBeFocused();

    // By keyboard: out of the link and back in.
    await page.keyboard.press("Home");
    await settle(page);
    await expect(card(page)).toHaveCount(0);
    for (let step = 0; step < 12; step++) await page.keyboard.press("ArrowRight");
    await settle(page);
    await expect(card(page)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await settle(page);
    await expect(card(page)).toHaveCount(0);
  });

  test("a long address truncates at about 15rem, and the card stays inside a narrow window", async ({ page }) => {
    const href = `https://example.com/${"long-segment-".repeat(30)}end`;
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Long"), `Before the [site](${href}) after.`));
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 800 });
      // Out of the link first: the card shows on an entry into it.
      await surface.locator("p").first().click({ position: { x: 4, y: 8 } });
      await settle(page);
      await surface.locator("a").click();
      await expect(card(page)).toBeVisible();
      const address = card(page).locator(".kh-link-card-address");
      await expect(address).toHaveAttribute("title", href);
      const box = (await address.boundingBox())!;
      expect(box.width, `address at ${width}px`).toBeLessThanOrEqual(241);
      expect(await address.evaluate(element => element.scrollWidth > element.clientWidth), `truncated at ${width}px`).toBe(true);
      const outer = (await card(page).boundingBox())!;
      expect(outer.width, `card at ${width}px`).toBeLessThanOrEqual(width - 16);
      await page.keyboard.press("Escape");
      await expect(card(page)).toHaveCount(0);
    }
  });

  test("Open uses a new tab; Mod-click does the same", async ({ page, context }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Open"), "Before the [site](/open-target) after."));
    await surface.locator("a").click();
    await expect(card(page)).toBeVisible();
    const opened = context.waitForEvent("page");
    await card(page).getByRole("button", { name: "Open link" }).click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toContain("/open-target");
    await tab.close();

    const viaModifier = context.waitForEvent("page");
    await surface.locator("a").click({ modifiers: ["ControlOrMeta"] });
    const second = await viaModifier;
    await second.waitForLoadState();
    expect(second.url()).toContain("/open-target");
    await second.close();
  });

  test("Edit changes the address through the toolbar's field; Remove unlinks and keeps the text", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Edit"), MARKDOWN));
    await surface.locator("a").click();
    await card(page).getByRole("button", { name: "Edit link" }).click();
    const field = toolbar(page).getByRole("textbox", { name: "Link address" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("https://example.com/path");
    await field.fill("https://example.org/new");
    await page.keyboard.press("Enter");
    await expect(surface.locator("a")).toHaveAttribute("href", "https://example.org/new");

    await surface.locator("a").click();
    await expect(card(page)).toBeVisible();
    await card(page).getByRole("button", { name: "Remove link" }).click();
    await expect(surface.locator("a")).toHaveCount(0);
    const markdown = await save(page);
    expect(markdown).toContain("Before the site after.");
  });
});

test.describe("pasting a URL over a selection (12)", () => {
  test("links the selection; a sentence, or no selection, pastes as text", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Paste"), "alpha beta gamma"));
    const paste = (text: string) => surface.evaluate((element, value) => {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
    await selectLastWord(page, surface);
    await paste("https://example.com/p");
    await expect(surface.locator("a")).toHaveText("gamma");
    await expect(surface.locator("a")).toHaveAttribute("href", "https://example.com/p");
    await expect(surface.locator("p").first()).toHaveText("alpha beta gamma");
    expect(await save(page)).toContain("alpha beta [gamma](https://example.com/p)");
  });
});

test.describe("the toolbar's new buttons (13)", () => {
  test("Strikethrough, Inline code and Heading 3 write Markdown, and show as active", async ({ page }) => {
    const surface = await openEditor(page, await createNote(page, await mySpace(page), unique("Buttons"), "alpha beta gamma"));
    await selectLastWord(page, surface);
    await toolbar(page).getByRole("button", { name: "Strikethrough" }).click();
    await expect(toolbar(page).getByRole("button", { name: "Strikethrough" })).toHaveAttribute("aria-pressed", "true");
    await expect(surface.locator("del, s")).toHaveText("gamma");
    await toolbar(page).getByRole("button", { name: "Strikethrough" }).click();
    await toolbar(page).getByRole("button", { name: "Inline code" }).click();
    await expect(surface.locator("code")).toHaveText("gamma");
    await toolbar(page).getByRole("button", { name: "Heading 3" }).click();
    await expect(surface.locator("h3")).toBeVisible();
    const markdown = await save(page);
    expect(markdown).toContain("### alpha beta `gamma`");
  });
});
