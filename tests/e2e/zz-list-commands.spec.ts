import { expect, test, type Locator, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * `/`, `+` and Turn into answer in a list item as they do in a paragraph
 * (docs/superpowers/specs/2026-11-21-list-commands-and-turn-into-design.md): the audit's three cases at its 1440 × 900,
 * with the real keyboard and pointer, each read back from the saved Markdown. It writes documents into the E2E user's
 * My Space, so it sorts last like zz-block-unit.spec.ts.
 */

test.use({ viewport: { width: 1440, height: 900 } });

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function openNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("List"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`);
  // By its label, not its role: it is a combobox, not a textbox, while the `/` list is open.
  const surface = page.locator('main .ProseMirror[aria-label="Content"]');
  await expect(surface).toBeEditable(ROUND_TRIP);
  await page.waitForTimeout(600);
  return { surface, documentId: created.documentId };
}

const exported = async (page: Page, documentId: string) => (await page.request.get(`/api/documents/${documentId}/export`)).text();
const toolbar = (page: Page) => page.locator('.kh-selection-toolbar[data-show="true"]');

/** Puts the caret at the end of the item whose text is `text`, with the pointer resting on it. */
async function caretAtEnd(page: Page, surface: Locator, text: string) {
  await surface.locator("li p").filter({ hasText: new RegExp(`^${text}$`) }).click();
  await page.keyboard.press("End");
  await page.waitForTimeout(200);
}

test.describe("list commands", () => {
  test("+ on an item opens the list", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "- alpha\n- beta\n- gamma\n");
    await caretAtEnd(page, surface, "beta");
    // The pointer comes onto the item's line, as a hand's does: its controls show beside it.
    const box = (await surface.locator("li p").filter({ hasText: /^beta$/ }).boundingBox())!;
    await page.mouse.move(box.x + 20, box.y - 30);
    await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 4 });
    await page.getByRole("button", { name: "Add block below" }).click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    // The `/` it writes is on the new item, in sight.
    await expect(surface.locator("li")).toHaveCount(4);
    await expect(surface.locator("li").nth(2)).toHaveText("/");
    await page.keyboard.type("h2");
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await page.keyboard.type("Picked");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toContain("Picked");
    expect(await exported(page, documentId)).toMatch(/- alpha\n- beta\n\n## Picked\n\n- gamma/);
  });

  test("/quo in an item makes a quote", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "- alpha\n- beta\n- gamma\n");
    await caretAtEnd(page, surface, "beta");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/quo");
    const list = page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(list).toBeHidden();
    await page.keyboard.type("Said");
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toContain("Said");
    expect(await exported(page, documentId)).toMatch(/- alpha\n\n> Said\n\n- gamma/);
  });

  test("Numbered list from the toolbar in a bulleted item", async ({ page }) => {
    const { surface, documentId } = await openNote(page, "- alpha\n- beta\n- gamma\n\nOne\n\nTwo\n\nThree\n\nFour\n\nFive\n\nSix\n\nSeven\n");
    await caretAtEnd(page, surface, "beta");
    await page.keyboard.press("Shift+Home");
    await expect(toolbar(page)).toBeVisible();
    const turn = toolbar(page).getByRole("button", { name: "Turn into, Bulleted list" });
    await turn.click();
    const menu = toolbar(page).getByRole("menu");
    await expect(menu).toBeVisible();

    // The current kind is checked and disabled. A click on it is a click on nothing: the toolbar and its menu stay.
    const current = menu.getByRole("menuitemradio", { name: "Bulleted list" });
    await expect(current).toHaveAttribute("aria-checked", "true");
    await expect(current).toBeDisabled();
    const box = (await current.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await expect(toolbar(page)).toBeVisible();
    await expect(menu).toBeVisible();

    // Painted above the block controls. The menu hangs over the gutter's column here, so the controls of every line
    // it passes, shown by the pointer on that line, sit under it; where the two meet, the menu is what is on top.
    let overlaps = 0;
    for (const line of await surface.locator("p").all()) {
      const at = (await line.boundingBox())!;
      await page.mouse.move(1000, at.y - 2);
      await page.mouse.move(1000, at.y + at.height / 2, { steps: 3 });
      await page.waitForTimeout(100);
      const top = await page.evaluate(() => {
        const gutter = document.querySelector(".kh-block-gutter:not([hidden])")?.getBoundingClientRect();
        const over = document.querySelector(".kh-selection-toolbar [role=menu]")!.getBoundingClientRect();
        if (!gutter) return null;
        const [left, right, upper, lower] = [Math.max(gutter.left, over.left), Math.min(gutter.right, over.right), Math.max(gutter.top, over.top), Math.min(gutter.bottom, over.bottom)];
        if (left >= right || upper >= lower) return null;
        return !!document.elementFromPoint((left + right) / 2, (upper + lower) / 2)?.closest(".kh-selection-toolbar [role=menu]");
      });
      if (top === null) continue;
      overlaps++;
      expect(top, `the menu is above the controls of "${await line.textContent()}"`).toBe(true);
    }
    expect(overlaps).toBeGreaterThan(0);

    const numbered = menu.getByRole("menuitemradio", { name: "Numbered list" });
    await expect(numbered).toBeEnabled();
    await numbered.click();
    await expect(menu).toBeHidden();
    await expect(toolbar(page).getByRole("button", { name: "Turn into, Numbered list" })).toBeVisible();
    await expect.poll(() => exported(page, documentId), ROUND_TRIP).toMatch(/- alpha\n\n1\. beta\n\n- gamma/);
  });
});
