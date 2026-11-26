import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Find and replace in the rendered editor (2026-11-26 spec): Mod-F from the editor opens the bar, matches are
 * highlighted and counted, Enter steps, Replace all is saved and one Mod-Z takes it back, Escape returns the caret.
 * Outside the editor the browser's own find is left alone.
 *
 * It writes into the E2E user's My Space and sorts last, like the other zz-* editor specs.
 */
const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function createNote(page: Page, title: string, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return { url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`, documentId: created.documentId };
}
async function openEditor(page: Page, url: string) {
  await page.goto(url);
  const surface = page.locator("main").getByRole("textbox", { name: "Content" });
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}
/** Waits for the autosave, then reads what the server holds. */
async function saved(page: Page, documentId: string) {
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  const exported = await page.request.get(`/api/documents/${documentId}/export`);
  expect(exported.ok()).toBe(true);
  return exported.text();
}
const bar = (page: Page) => page.getByRole("search", { name: "Find and replace" });

test.describe("find and replace in the rendered editor", () => {
  test("Mod-F opens the bar, highlights and counts, Enter steps, Replace all saves and one Mod-Z undoes it", async ({ page }) => {
    const word = `zebra${Date.now().toString(36)}`;
    const { url, documentId } = await createNote(page, unique("Find"), `The ${word} runs.\n\nA ${word.toUpperCase()} sleeps and a [[Elsewhere ${word}]] link.\n\n- last ${word}\n`);
    const surface = await openEditor(page, url);

    await surface.locator("p").first().click();
    await page.keyboard.press("ControlOrMeta+Home");
    await expect(bar(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole("textbox", { name: "Find" })).toBeFocused();

    await page.keyboard.type(word);
    const count = bar(page).locator("[aria-live=polite]");
    await expect(count).toHaveText("1 of 3");
    await expect(surface.locator(".kh-find-match")).toHaveCount(3);
    await expect(surface.locator(".kh-find-current")).toHaveCount(1);

    await page.keyboard.press("Enter");
    await expect(count).toHaveText("2 of 3");
    await expect(surface.locator(".kh-find-current")).toHaveText(word.toUpperCase());
    await page.keyboard.press("Shift+Enter");
    await expect(count).toHaveText("1 of 3");

    // Match case narrows it to the lowercase two.
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await expect(count).toHaveText("1 of 2");
    await bar(page).getByRole("button", { name: "Match case" }).click();
    await expect(count).toHaveText("1 of 3");

    await page.keyboard.press("ControlOrMeta+Alt+f");
    await bar(page).getByRole("textbox", { name: "Replace with" }).fill("lion");
    await bar(page).getByRole("button", { name: "Replace all" }).click();
    await expect(count).toHaveText("Replaced 3");
    await expect(surface).toContainText("The lion runs.");

    const replaced = await saved(page, documentId);
    expect(replaced).toContain("The lion runs.");
    expect(replaced).toContain("A lion sleeps");
    expect(replaced).toContain("- last lion");
    // The wikilink is a node: not matched, not replaced, still a link.
    expect(replaced).toContain(`[[Elsewhere ${word}]]`);

    // One undo takes all three back.
    await page.keyboard.press("Escape");
    await expect(surface).toBeFocused();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(surface).toContainText(`The ${word} runs.`);
    const restored = await saved(page, documentId);
    expect(restored).toContain(`The ${word} runs.`);
    expect(restored).toContain(`A ${word.toUpperCase()} sleeps`);
    expect(restored).toContain(`- last ${word}`);
  });

  test("Escape closes the bar and puts the caret in the editor at the current match", async ({ page }) => {
    const word = `quokka${Date.now().toString(36)}`;
    const { url } = await createNote(page, unique("Escape"), `Intro.\n\nOne ${word} two ${word}.\n`);
    const surface = await openEditor(page, url);
    await surface.locator("p").first().click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type(word);
    await page.keyboard.press("Enter");
    await expect(bar(page).locator("[aria-live=polite]")).toHaveText("2 of 2");
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    await expect(surface.locator(".kh-find-match")).toHaveCount(0);
    await expect(surface).toBeFocused();
    // The caret is at the end of the second match: what is typed goes there.
    await page.keyboard.type("!");
    await expect(surface.locator("p", { hasText: "One" })).toHaveText(`One ${word} two ${word}!.`);
  });

  test("Mod-F outside the editor is the browser's: no bar, and the page does not stop the key", async ({ page }) => {
    const { url } = await createNote(page, unique("Outside"), "Some text to find.\n");
    const surface = await openEditor(page, url);
    await surface.locator("p").first().click();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);

    await page.getByRole("textbox", { name: "Title" }).click();
    await page.evaluate(() => {
      const holder = window as unknown as { __findKey: boolean | null };
      holder.__findKey = null;
      window.addEventListener("keydown", (event) => { if (event.key === "f") holder.__findKey = event.defaultPrevented; });
    });
    await page.keyboard.press("ControlOrMeta+f");
    await expect(bar(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __findKey: boolean | null }).__findKey)).toBe(false);
  });

  test("the bar stays inside the screen at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    const { url } = await createNote(page, unique("Phone"), "Phone text.\n");
    const surface = await openEditor(page, url);
    await surface.locator("p").first().click();
    await page.keyboard.press("ControlOrMeta+Alt+f");
    await expect(bar(page)).toBeVisible();
    const box = (await bar(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
