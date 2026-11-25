import { expect, test, type Page } from "./fixtures/test";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The `@` list in the rendered editor (2026-11-25 spec), in a real browser: a page pick is saved as a wikilink the
 * target then lists as a backlink, a date is saved as plain text, and Escape leaves what was typed. As in
 * zz-composer-autocomplete.spec.ts, nothing here types Markdown through the source view, which never runs the editor.
 * Titles start with a per-run stamp so that the query narrows the list to this test's own documents.
 */

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const composer = (page: Page) => page.locator("main");
const surfaceOf = (page: Page) => composer(page).getByRole("textbox", { name: "Content" });
const listboxOf = (page: Page) => page.getByRole("listbox", { name: "Mentions" });
const optionsOf = (page: Page) => listboxOf(page).getByRole("option");

async function mySpace(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  return new URL(page.url()).pathname.split("/")[2];
}

async function createNote(page: Page, workspaceId: string, title: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown: "A document to link to." } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

async function startWriting(page: Page, workspaceId: string, title: string) {
  await page.goto(`/w/${workspaceId}/knowledge/new?compose`);
  await composer(page).getByLabel("Title", { exact: true }).fill(title);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  await surface.click();
  return surface;
}

function nextWrite(page: Page, method: "PATCH" | "POST") {
  return page.waitForRequest((request) => request.method() === method && /\/api\/(documents\/|workspaces\/[^/]+\/documents$)/.test(request.url()), ROUND_TRIP);
}
const sentMarkdown = (request: Awaited<ReturnType<typeof nextWrite>>) => (JSON.parse(request.postData() ?? "{}") as { markdown?: string }).markdown ?? "";

/** A day in the browser's own time zone, the way the editor writes it. */
const dayIn = (page: Page, offset: number) => page.evaluate((days) => {
  const day = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + days);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}, offset);

test.describe("the `@` list", () => {
  test("a page pick is saved as a wikilink, and the target lists it as a backlink", async ({ page }) => {
    const stamp = unique("At");
    const workspaceId = await mySpace(page);
    const targetUrl = await createNote(page, workspaceId, `${stamp} Runbook`);
    const surface = await startWriting(page, workspaceId, `Source ${stamp}`);

    await page.keyboard.type("Read @");
    await expect(listboxOf(page)).toBeVisible();
    await expect(listboxOf(page).getByRole("group", { name: "Pages" })).toBeVisible();
    await expect(listboxOf(page).getByRole("group", { name: "Dates" })).toBeVisible();
    await page.keyboard.type(`${stamp} run`);
    await expect(optionsOf(page)).toHaveCount(1);
    const editor = composer(page).locator('.ProseMirror[aria-label="Content"]');
    await expect(editor).toHaveAttribute("role", "combobox");
    await expect(editor).toHaveAttribute("aria-activedescendant", (await optionsOf(page).first().getAttribute("id"))!);

    await page.keyboard.press("Enter");
    await expect(listboxOf(page)).toBeHidden();
    await expect(surface.locator("span.kh-wikilink")).toHaveText(`${stamp} Runbook`);
    await page.keyboard.type(" first.");

    const created = nextWrite(page, "POST");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    const markdown = sentMarkdown(await created);
    expect(markdown).toContain(`Read [[${stamp} Runbook]] first.`);
    expect(markdown).not.toContain("\\[");
    expect(markdown).not.toContain("@");

    await expect(page).not.toHaveURL(/\/new(?:\?.*)?$/, ROUND_TRIP);
    await page.goto(targetUrl);
    await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
  });

  test("a date is saved as plain text in the format /Today's date writes", async ({ page }) => {
    const stamp = unique("Day");
    const workspaceId = await mySpace(page);
    const surface = await startWriting(page, workspaceId, `Dates ${stamp}`);

    await page.keyboard.type("Due @tomo");
    await expect(optionsOf(page)).toHaveText([/Tomorrow/]);
    await page.keyboard.press("Tab");
    await expect(listboxOf(page)).toBeHidden();
    await page.keyboard.type(", done @2026-12-01");
    await expect(optionsOf(page)).toHaveCount(1);
    await page.keyboard.press("Enter");
    await page.keyboard.type(".");
    const tomorrow = await dayIn(page, 1);
    await expect(surface.locator("p").first()).toHaveText(`Due ${tomorrow}, done 2026-12-01.`);

    const created = nextWrite(page, "POST");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    const markdown = sentMarkdown(await created);
    expect(markdown).toContain(`Due ${tomorrow}, done 2026-12-01.`);
    expect(markdown).not.toContain("[[");
  });

  test("Escape closes the list and leaves the typed text; an address does not open it", async ({ page }) => {
    const stamp = unique("Esc");
    const workspaceId = await mySpace(page);
    const surface = await startWriting(page, workspaceId, `Escape ${stamp}`);

    await page.keyboard.type("mail ana@example.com then @tod");
    await expect(listboxOf(page)).toBeVisible();
    await expect(optionsOf(page).first()).toContainText("Today");
    await page.keyboard.press("Escape");
    await expect(listboxOf(page)).toBeHidden();
    await expect(surface.locator("p").first()).toHaveText("mail ana@example.com then @tod");
    // The Escape went to the list, not the composer: the editor is still here and still takes typing.
    await page.keyboard.type("ay");
    await expect(surface.locator("p").first()).toHaveText("mail ana@example.com then @today");
    await expect(listboxOf(page)).toBeHidden();
  });
});
