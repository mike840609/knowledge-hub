import { expect, test } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";
import { ROUND_TRIP, HELD, unique, composer, createNote, leaveEditor, openEditor, holdEditorCode, surfaceOf } from "./fixtures/document-composer";

const recovered = "Your unsaved changes were recovered";

test("rendered edits survive leaving and only save after recovery is accepted", async ({ page }) => {
  const url = await createNote(page, unique("Draft"), "start\n");
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("draft text");
  await leaveEditor(page, url);

  const back = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: recovered })).toBeVisible();
  await expect(back).toContainText("draft text");
  // Wait beyond the normal autosave delay: simply opening recovery cannot publish it.
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "PATCH" && request.url().includes("/api/documents/")) writes.push(request.url());
  });
  await page.waitForTimeout(3500);
  expect(writes).toHaveLength(0);
  await composer(page).getByRole("button", { name: "Resume saving" }).click();
  await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  expect(writes).toHaveLength(1);
  await page.reload();
  await expect(back).toBeEditable(ROUND_TRIP);
  await expect(back).toContainText("draft text");
  await expect(composer(page).getByRole("button", { name: "Resume saving" })).toHaveCount(0);
});

test("recovery can be discarded while rendered editing is still loading", async ({ page }) => {
  const url = await createNote(page, unique("Discard Early"), "start\n");
  await openEditor(page, url);
  await (await showMarkdown(composer(page))).fill("draft text");
  await leaveEditor(page, url);

  const release = await holdEditorCode(page);
  try {
    await page.goto(url, HELD);
    await expect(composer(page).getByRole("status").filter({ hasText: recovered })).toBeVisible(ROUND_TRIP);
    await expect(surfaceOf(page)).toHaveCount(0);
    await composer(page).getByRole("button", { name: "Discard recovered changes" }).click();
    page.on("dialog", dialog => void dialog.accept());
    await page.getByRole("alertdialog").getByRole("button", { name: "Discard and load latest" }).click();
    await expect(composer(page).getByRole("button", { name: "Discard recovered changes" })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(surfaceOf(page)).toBeEditable(ROUND_TRIP);
  await expect(surfaceOf(page)).toHaveText("start");
});

test("discarding recovered edits clears changes typed immediately before confirmation", async ({ page }) => {
  const url = await createNote(page, unique("Discard Late"), "start\n");
  await openEditor(page, url);
  await (await showMarkdown(composer(page))).fill("draft text");
  await leaveEditor(page, url);
  const surface = await openEditor(page, url);
  await surface.click();
  await page.keyboard.type("typed ");
  await composer(page).getByRole("button", { name: "Discard recovered changes" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Discard your unsaved changes?" });
  await expect(dialog).toBeVisible();
  // Let the editor's delayed Markdown output land before confirming the discard.
  await page.waitForTimeout(400);
  page.on("dialog", dialog => void dialog.accept());
  await dialog.getByRole("button", { name: "Discard and load latest" }).click();
  await expect(surface).toHaveText("start", ROUND_TRIP);
  await page.reload();
  await expect(surface).toBeEditable(ROUND_TRIP);
  await expect(surface).toHaveText("start");
  await expect(composer(page).getByRole("status").filter({ hasText: recovered })).toHaveCount(0);
});

test("stale recovery stays paused and can be downloaded before loading the latest version", async ({ page }) => {
  const url = await createNote(page, unique("Stale Draft"));
  await openEditor(page, url);
  await (await showMarkdown(composer(page))).fill("mine");
  await leaveEditor(page, url);

  // A new tab has its own sessionStorage and can save a newer revision.
  const other = await page.context().newPage();
  await openEditor(other, url);
  await (await showMarkdown(composer(other))).fill("theirs");
  await expect(other.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
  await other.close();

  const surface = await openEditor(page, url);
  await expect(composer(page).getByRole("status").filter({ hasText: "changed while you were away" })).toBeVisible();
  await expect(surface).toContainText("mine");
  await expect(composer(page).getByRole("button", { name: "Resume saving" })).toHaveCount(0);
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "PATCH" && request.url().includes("/api/documents/")) writes.push(request.url());
  });
  await surface.press("ControlOrMeta+s");
  await page.waitForTimeout(3500);
  expect(writes).toHaveLength(0);
  const downloading = page.waitForEvent("download");
  await composer(page).getByRole("button", { name: "Download my changes" }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("mine");

  await composer(page).getByRole("button", { name: "Discard recovered changes" }).click();
  page.on("dialog", dialog => void dialog.accept());
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard and load latest" }).click();
  await expect(surface).toContainText("theirs", ROUND_TRIP);
  await expect(composer(page).getByRole("button", { name: "Discard recovered changes" })).toHaveCount(0);
});

test("discard recovery asks for confirmation and Keep editing or Escape preserves it", async ({ page }) => {
  const url = await createNote(page, unique("Keep Recovery"));
  await openEditor(page, url);
  await (await showMarkdown(composer(page))).fill("changed");
  await leaveEditor(page, url);
  await openEditor(page, url);
  const source = await showMarkdown(composer(page));
  const discard = composer(page).getByRole("button", { name: "Discard recovered changes" });

  await discard.click();
  const dialog = page.getByRole("alertdialog", { name: "Discard your unsaved changes?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(source).toHaveValue("changed");

  await discard.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(source).toHaveValue("changed");
  await expect(discard).toBeVisible();

  await discard.click();
  page.on("dialog", dialog => void dialog.accept());
  await dialog.getByRole("button", { name: "Discard and load latest" }).click();
  await expect(surfaceOf(page)).toBeEditable(ROUND_TRIP);
  await expect(surfaceOf(page)).not.toContainText("changed");
  await expect(composer(page).getByRole("status").filter({ hasText: recovered })).toHaveCount(0);
});
