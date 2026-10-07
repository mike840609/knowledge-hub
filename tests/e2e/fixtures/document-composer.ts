import { expect, type Dialog, type Locator, type Page } from "@playwright/test";

// Mirrors scripts/db/seed.ts BROWSER_FIXTURE_IDS (Playwright cannot resolve `@/` aliases).
export const EMPTY_WORKSPACE = "0199f100-0000-7000-8000-000000000004";
// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
export const ROUND_TRIP = { timeout: 15_000 };

/** Unique per call: the workspace is shared across tests and repeats. */
export function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** main form + first(): the duplicate-DOM quirk phase5-authoring.spec.ts documents. */
export function composer(page: Page) {
  return page.locator("main form").first();
}

/** The rendered editing surface. */
export function surfaceOf(page: Page) {
  return composer(page).getByRole("textbox", { name: "Content" });
}

/**
 * Creates a note through the API and returns its URL. Not through the
 * new-document page: these tests are about editing, and must not depend on
 * how that page looks.
 */
export async function createNote(page: Page, title: string, markdown = "") {
  const response = await page.request.post(`/api/workspaces/${EMPTY_WORKSPACE}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${EMPTY_WORKSPACE}/knowledge/${created.sourceId}/${created.documentId}`;
}

/**
 * Leaves a dirty editor for the document page by a full load, accepting the
 * `beforeunload` prompt the dirty editor raises. Not by clicking the sidebar:
 * a client navigation from `/edit` to its document is sometimes dropped by the
 * router after its response arrives — on `main` too, with the old editor (see
 * the composer verification record). These tests are about the draft, which
 * survives any way of leaving; that defect is tracked on its own.
 */
export async function leaveEditor(page: Page, documentUrl: string) {
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", accept);
  await page.goto(documentUrl);
  page.off("dialog", accept);
  await expect(page).not.toHaveURL(/\/edit$/, ROUND_TRIP);
}

/**
 * The title the reader shows for the document: its breadcrumb's last segment, which is the
 * stored title. Not the sidebar: its refresh after a save is dropped now and then, a known
 * defect on main (composer verification record).
 */
export function readerTitle(page: Page) {
  return page.getByRole("region", { name: "Document content" }).getByRole("navigation", { name: "Breadcrumb" }).getByRole("listitem").last();
}

/** The rendered editor's code: the app's only lazily loaded chunks (`<id>.<hash>.js`; first-load chunks are `<id>-<hash>.js`). */
export const EDITOR_CODE = /\/_next\/static\/chunks\/[^/-]+\.[0-9a-f]+\.js$/;

/** Holds the editor's code back until released, so the page can be used while the editor is still loading. */
export async function holdEditorCode(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(EDITOR_CODE, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/** Opens the editor and returns the rendered surface once it can be typed into. */
export async function openEditor(page: Page, documentUrl: string) {
  await page.goto(`${documentUrl}/edit`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(ROUND_TRIP);
  return surface;
}

/** The next save's PATCH, as the page sends it. */
export function nextSave(page: Page) {
  return page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/api/documents/"), ROUND_TRIP);
}

export function sentBody(request: Awaited<ReturnType<typeof nextSave>>) {
  return JSON.parse(request.postData() ?? "{}") as { title?: string; markdown?: string };
}

/** Types into a note's body, then into its H1: the editor's last output is the one that renames it. */
export async function editBodyThenHeading(page: Page, surface: Locator) {
  await surface.locator("p").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" typed");
  await surface.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" renamed");
}

/**
 * An init script. Presses ⌘/Ctrl Enter where a real key press queued behind the editor's debounced
 * output is handled: after that output has run (it writes the draft) and React has scheduled the
 * render it asks for, but before that render. A person lands there only now and then (the window is
 * about as long as the output task, longer for a longer document); wrapping `setTimeout` lands there
 * every time. Only an output that carries every one of `words` sets it off, never one delivered
 * mid-typing. It records the Markdown React last rendered, to show the press did land before it.
 */
export function pressSaveBeforeOutputRenders(words: string[]) {
  let draftWrites = 0;
  let pressed = false;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    if (key.startsWith("kh:draft:")) draftWrites += 1;
    setItem.call(this, key, value);
  };
  const schedule = window.setTimeout;
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (typeof handler !== "function") return schedule(handler, delay, ...args);
    return schedule((...callArgs: unknown[]) => {
      const writesBefore = draftWrites;
      handler(...callArgs);
      const shown = document.querySelector(".ProseMirror")?.textContent ?? "";
      if (pressed || draftWrites === writesBefore || !words.every((word) => shown.includes(word))) return;
      pressed = true;
      // React schedules its render from a microtask queued while `handler` ran; these two run after it.
      queueMicrotask(() => queueMicrotask(() => {
        const source = document.querySelector<HTMLTextAreaElement>('main form textarea[aria-label="Markdown"]');
        (window as unknown as { renderedAtPress?: string }).renderedAtPress = source?.value;
        const save = { key: "Enter", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true };
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", save));
      }));
    }, delay, ...args);
  }) as typeof window.setTimeout;
}
