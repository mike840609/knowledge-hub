import { expect, test } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";
import { ROUND_TRIP, unique, composer, createNote, leaveEditor, openEditor } from "./fixtures/document-composer";

test("what was typed in the rendered editor survives leaving and is offered back on return", async ({ page }) => {
  const url = await createNote(page, unique("Draft"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text");

  await leaveEditor(page, url);

  const back = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "Your unsaved changes were restored" })).toBeVisible();
  await expect(back).toContainText("draft text");
  await expect(back).toBeFocused(ROUND_TRIP);

  await composer(page).getByRole("button", { name: "Discard draft" }).click();
  await expect(back).not.toContainText("draft text");
  await page.reload();
  await expect(back).toBeEditable(ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "unsaved changes were restored" })).toHaveCount(0);
});

test("a draft discarded while the editor is still loading is not what the editor shows", async ({ page }) => {
  const url = await createNote(page, unique("Discard Early"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text ");
  await leaveEditor(page, url);

  // Press Discard draft the moment the editor's host joins the page, while the editor in it is being built.
  await page.addInitScript(() => {
    new MutationObserver((records, observer) => {
      for (const record of records) {
        const host = [...record.addedNodes].find((node) => node instanceof HTMLDivElement && node.attributes.length === 0 && !node.firstChild);
        if (!host || !(record.target instanceof HTMLElement) || !record.target.parentElement?.hasAttribute("hidden")) continue;
        const discard = [...document.querySelectorAll<HTMLButtonElement>("main form button")].find((button) => button.textContent === "Discard draft");
        if (!discard) continue;
        (window as unknown as { discardedWhileBuilding?: boolean }).discardedWhileBuilding = !document.querySelector(".ProseMirror");
        discard.click();
        observer.disconnect();
        return;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const back = await openEditor(page, url);
  expect(await page.evaluate(() => (window as unknown as { discardedWhileBuilding?: boolean }).discardedWhileBuilding)).toBe(true);
  await expect(composer(page).getByRole("status").filter({ hasText: "unsaved changes were restored" })).toHaveCount(0);
  await expect(back).not.toContainText("draft text");
  await expect(back).toHaveText("start");
});

test("Cancel right after typing leaves no draft, even when the editor's output lands after it", async ({ page }) => {
  const url = await createNote(page, unique("Cancel Late"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("typed ");
  const cancel = composer(page).getByRole("button", { name: "Cancel" });
  await cancel.click();
  const dialog = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(dialog).toBeVisible();
  // Answering after the editor's 200 ms output debounce has passed: whatever that output wrote,
  // discarding clears it, so no draft is left to be restored.
  await page.waitForTimeout(400);
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "unsaved changes were restored" })).toHaveCount(0);
});

test("a restored draft on a document someone changed meanwhile conflicts instead of overwriting", async ({ page }) => {
  const url = await createNote(page, unique("Stale Draft"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("mine");
  await leaveEditor(page, url);

  // A new page is a new tab, with its own sessionStorage.
  const other = await page.context().newPage();
  await openEditor(other, url);
  const theirSource = await showMarkdown(composer(other));
  await theirSource.fill("theirs");
  await composer(other).getByRole("button", { name: "Save" }).click();
  await expect(other).not.toHaveURL(/\/edit$/, ROUND_TRIP);
  await expect(other.locator("article").first().getByText("theirs")).toBeVisible(ROUND_TRIP);
  await other.close();

  const surface = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "changed while you were away" })).toBeVisible();
  await expect(surface).toContainText("mine");
  await composer(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Someone updated this document" })).toBeVisible(ROUND_TRIP);
  await expect(surface).toContainText("mine");

  await composer(page).getByRole("button", { name: "Load latest version (discard your changes)" }).click();
  await expect(surface).toContainText("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("status").filter({ hasText: "unsaved changes were restored" })).toHaveCount(0);
});

test("Cancel asks before discarding changes, and discarding clears the draft", async ({ page }) => {
  const url = await createNote(page, unique("Cancel"));
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  await source.fill("changed");
  const cancel = composer(page).getByRole("button", { name: "Cancel" });

  // The question is the app's own dialog, not the browser's: it is in the page, so a click does not
  // block on it. Asserting the Markdown field is still there with its typed value after answering
  // "Keep editing" is the positive signal that no navigation happened (router.push is async, so a
  // URL check alone would pass even if the dialog had never appeared).
  await cancel.click();
  const dialog = page.getByRole("alertdialog", { name: "Discard changes?" });
  await expect(dialog).toBeVisible();
  // The safe answer holds focus, so Enter on a freshly opened dialog never discards by reflex.
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(source).toBeVisible();
  await expect(source).toHaveValue("changed");

  // Escape means no, too.
  await cancel.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(source).toHaveValue("changed");

  await cancel.click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);

  const surface = await openEditor(page, url);
  await expect(surface).not.toContainText("changed");
  await expect(composer(page).getByRole("status").filter({ hasText: "unsaved changes were restored" })).toHaveCount(0);
});
