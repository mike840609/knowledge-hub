import { expect, test, type Locator, type Page } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";

// Hub image upload spec §9. Named zz- for the same reason as the other files that add documents to
// My Space: specs that count or lay out its documents run first.

// A real 1×1 PNG, so `naturalWidth` proves the browser decoded what the server sent.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const EDITOR_READY = { timeout: 30_000 };

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const composer = (page: Page) => page.locator("main form").first();
const surfaceOf = (page: Page) => composer(page).getByRole("textbox", { name: "Content" });
const decoded = (image: Locator) => image.evaluate((element: HTMLImageElement) => element.complete ? element.naturalWidth : 0);

/**
 * Removes the account's unsaved new note. Through the API, after leaving the page: a draft left
 * behind would be restored into the next spec that opens "New note", and the composer writes one
 * back for as long as its page is open.
 */
async function clearNewDraft(page: Page, ws: string) {
  await page.goto(`/w/${ws}/home`);
  const draft = await (await page.request.get(`/api/workspaces/${ws}/personal?key=${encodeURIComponent("draft:new")}`)).json();
  if (draft.value !== null) expect((await page.request.put(`/api/workspaces/${ws}/personal`, { data: { key: "draft:new", value: null, version: draft.version } })).ok()).toBe(true);
}

/** Hands the element an image file the way a paste or a drop does. `seed` makes the bytes, and so the stored image, distinct. */
async function give(target: Locator, how: "paste" | "drop", file: { name: string; type?: string; text?: string; seed?: string }) {
  await target.evaluate((element, input) => {
    const bytes = input.text !== undefined
      ? new TextEncoder().encode(input.text)
      : Uint8Array.from([...Array.from(atob(input.png), (char) => char.charCodeAt(0)), ...new TextEncoder().encode(input.seed ?? "")]);
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], input.name, { type: input.type ?? "image/png" }));
    const box = element.getBoundingClientRect();
    const event = input.how === "paste"
      ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
      : new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.top + 10 });
    element.dispatchEvent(event);
  }, { ...file, how, png: PNG });
}

test("a pasted image goes into a new note and shows in the editor, the reader, its history and a shared page", async ({ page, browser }) => {
  const nav = await (await page.request.get("/api/workspaces")).json();
  const ws = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  const title = unique("Pasted picture");
  const uploads: string[] = [];
  page.on("request", (sent) => { if (sent.method() === "POST" && /\/images$/.test(new URL(sent.url()).pathname)) uploads.push(new URL(sent.url()).pathname); });

  await page.goto(`/w/${ws}/knowledge/new`);
  const form = composer(page);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(EDITOR_READY);
  await form.getByLabel("Title", { exact: true }).fill(title);
  await surface.click();
  await page.keyboard.type("Before the picture.");

  // A screenshot from the clipboard: named "image.png" by the browser.
  await give(surface, "paste", { name: "image.png", seed: title });
  const inEditor = surface.locator("img[data-kh-src]");
  await expect(inEditor).toHaveCount(1);
  expect(uploads).toEqual([`/api/workspaces/${ws}/images`]);
  const written = await inEditor.getAttribute("data-kh-src");
  expect(written).toMatch(/^\/images\/[0-9a-f]{64}\.png$/);
  // The editor loads it through the Source's route, and the browser decodes it.
  expect(await inEditor.getAttribute("src")).toMatch(/^\/api\/sources\/[0-9a-f-]+\/asset\?src=/);
  await expect.poll(() => decoded(inEditor)).toBe(1);

  // What is stored is plain Markdown naming the image by its content.
  const source = await showMarkdown(form);
  await expect(source).toHaveValue(new RegExp(`Before the picture\\.[\\s\\S]*!\\[Pasted image\\]\\(${written!.replace(/[.]/g, "\\.")}\\)`));

  await form.getByRole("button", { name: "Create document", exact: true }).click();
  await expect(page).toHaveURL(/\/knowledge\/[0-9a-f-]+\/[0-9a-f-]+$/);
  const documentUrl = page.url();
  const documentId = documentUrl.split("/").pop()!;
  const inReader = page.getByRole("img", { name: "Pasted image" }).first();
  await expect.poll(() => decoded(inReader)).toBe(1);
  expect(await inReader.getAttribute("src")).toContain(`/api/documents/${documentId}/asset?src=`);

  // Edit: drop a second image, and take the first out of the text.
  await page.goto(`${documentUrl}/edit`);
  const editing = surfaceOf(page);
  await expect(editing).toBeEditable(EDITOR_READY);
  await expect.poll(() => decoded(editing.locator("img[data-kh-src]"))).toBe(1);
  await give(editing, "drop", { name: "Architecture diagram.png", seed: `${title} second` });
  await expect(editing.locator("img[data-kh-src]")).toHaveCount(2);
  const second = await editing.locator('img[alt="Architecture diagram"]').getAttribute("data-kh-src");
  expect(second).not.toBe(written);
  const editForm = composer(page);
  const markdown = await showMarkdown(editForm);
  await markdown.fill(`# ${title}\n\nOnly the second now.\n\n![Architecture diagram](${second})\n`);
  await editForm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(documentUrl);
  await expect.poll(() => decoded(page.getByRole("img", { name: "Architecture diagram" }).first())).toBe(1);
  await expect(page.getByRole("img", { name: "Pasted image" })).toHaveCount(0);

  // The first revision still shows the image it was written with.
  await page.goto(`${documentUrl}?revision=1`);
  await expect.poll(() => decoded(page.getByRole("img", { name: "Pasted image" }).first())).toBe(1);

  // A shared page shows what the current revision draws, signed out, and nothing else from the Source.
  const { link } = await (await page.request.post(`/api/documents/${documentId}/share-links`, { data: { label: "Pictures" } })).json();
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visitor = await anonymous.newPage();
  await visitor.goto(link.path);
  await expect.poll(() => decoded(visitor.getByRole("img", { name: "Architecture diagram" }).first())).toBe(1);
  expect((await anonymous.request.get(`${link.path}/asset?src=${encodeURIComponent(second!)}`)).status()).toBe(200);
  expect((await anonymous.request.get(`${link.path}/asset?src=${encodeURIComponent(written!)}`)).status()).toBe(404);
  await anonymous.close();
});

test("what is not an image is refused in words, the note is untouched, and the Markdown view takes a paste too", async ({ page }) => {
  const nav = await (await page.request.get("/api/workspaces")).json();
  const ws = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  await page.goto(`/w/${ws}/knowledge/new`);
  const form = composer(page);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(EDITOR_READY);
  await surface.click();
  await page.keyboard.type("Text stays.");

  // The browser calls it an image; the server reads its content and disagrees.
  await give(surface, "paste", { name: "page.svg", type: "image/svg+xml", text: '<!doctype html><html><body><svg></svg><script>alert(1)</script></body></html>' });
  await expect(form.getByText("Only PNG, JPEG, GIF, WebP and AVIF images, and SVG up to 2 MiB, can be added.")).toBeVisible();
  await expect(surface.locator("img[data-kh-src]")).toHaveCount(0);
  await expect(surface).toContainText("Text stays.");

  // A real SVG is taken, drawn, and cannot run its script: in the page it is an <img>, and opened
  // on its own it is served sandboxed.
  await give(surface, "paste", { name: "Flow chart.svg", type: "image/svg+xml", text: `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6"><!-- ${unique("svg")} --><script>document.title="pwned"</script><rect width="6" height="6"/></svg>` });
  const vector = surface.locator('img[alt="Flow chart"]');
  await expect(vector).toHaveCount(1);
  expect(await vector.getAttribute("data-kh-src")).toMatch(/^\/images\/[0-9a-f]{64}\.svg$/);
  await expect.poll(() => decoded(vector)).toBe(6);
  const served = await page.request.get((await vector.getAttribute("src"))!);
  expect(served.headers()).toMatchObject({ "content-type": "image/svg+xml", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
  const alone = await page.context().newPage();
  await alone.goto((await vector.getAttribute("src"))!);
  expect(await alone.title()).not.toBe("pwned");
  await alone.close();

  // A paste with no image file is the editor's own business.
  await surface.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", " Pasted words.");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(surface).toContainText("Pasted words.");

  const source = await showMarkdown(form);
  await source.click();
  await give(source, "paste", { name: "from source.png", seed: unique("source view") });
  await expect(source).toHaveValue(/!\[from source\]\(\/images\/[0-9a-f]{64}\.png\)/);
  await expect(source).toHaveValue(/Text stays\./);
  await clearNewDraft(page, ws);
});

test("a draft reopened later still shows the image pasted into it", async ({ page }) => {
  const nav = await (await page.request.get("/api/workspaces")).json();
  const ws = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  await clearNewDraft(page, ws);
  await page.goto(`/w/${ws}/knowledge/new`);
  const surface = surfaceOf(page);
  await expect(surface).toBeEditable(EDITOR_READY);
  await surface.click();
  await give(surface, "paste", { name: "image.png", seed: unique("draft") });
  await expect(surface.locator("img[data-kh-src]")).toHaveCount(1);
  await expect(composer(page).getByText("Draft saved to your account")).toBeVisible({ timeout: 15_000 });

  // Nothing is saved as a document yet. The page finds the Workspace's Notes and asks it for the image.
  await page.reload();
  const again = surfaceOf(page);
  await expect(again).toBeEditable(EDITOR_READY);
  await expect.poll(() => decoded(again.locator("img[data-kh-src]"))).toBe(1);

  await clearNewDraft(page, ws);
});
