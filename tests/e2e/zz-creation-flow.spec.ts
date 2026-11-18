import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";
import { HELD, holdEditorCode } from "./fixtures/document-composer";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/** The 2026-11-19 creation-flow pass: making a document should feel like making a Notion page. */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function knowledge(page: Page, loadOptions?: Parameters<Page["goto"]>[1]) {
  const workspaceId = await mySpace(page);
  // A document makes the Notes source exist, so its row (and `+`) is in the tree.
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Seed"), markdown: "Seed.\n" } });
  expect(response.ok()).toBe(true);
  // The workspace landing page redirects late, possibly into another Source's tree (fixtures/organize.ts):
  // open the seed itself, so the Notes tree is the one shown.
  const seed = (await response.json()) as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${seed.sourceId}/${seed.documentId}`, loadOptions);
  const create = page.getByRole("complementary", { name: "Knowledge explorer" }).getByRole("link", { name: "Create document" });
  await expect(create).toBeVisible(ROUND_TRIP);
  return { workspaceId, create };
}

/** Opacity as drawn, every ancestor included: Playwright counts `opacity: 0` as visible. */
const drawnOpacity = (page: Page, selector: Parameters<Page["locator"]>[0]) =>
  page.locator(selector).first().evaluate((element) => {
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  });

test.describe("creation flow", () => {
  test("shows the Notes row's + at rest, without a hover", async ({ page }) => {
    await knowledge(page);
    await page.mouse.move(1000, 700);
    expect(await drawnOpacity(page, '[aria-label="Knowledge explorer"] a[aria-label="Create document"]')).toBe(1);
  });

  test("keeps what is typed straight after pressing + as the title", async ({ page }) => {
    const { create } = await knowledge(page);
    const title = unique("Typed right away");
    await create.click();
    await page.keyboard.type(title);
    const field = page.locator("main").getByRole("textbox", { name: "Title" });
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(field).toHaveValue(title, ROUND_TRIP);
    await page.keyboard.type("!");
    await expect(field).toHaveValue(`${title}!`);
  });

  test("Enter straight after the title, before the note opens, puts the caret in the body", async ({ page }) => {
    const { create } = await knowledge(page);
    const title = unique("Entered");
    await create.click();
    await page.keyboard.type(`${title} `);
    await page.keyboard.press("Enter");
    const content = page.locator("main").getByRole("textbox", { name: "Content" });
    await expect(content).toBeFocused(ROUND_TRIP);
    await page.keyboard.type("Body.");
    await expect(content).toHaveText("Body.");
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(`${title} `);
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    await expect(page.getByRole("treeitem", { name: title })).toBeVisible({ timeout: 10_000 });
  });

  test("keeps writing in the body while the create request is pending", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    const title = unique("While creating");
    const target = unique("Linked note");
    const body = `See [[${target}]]. `;
    const post = `/api/workspaces/${workspaceId}/documents`;
    const requestStarted = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(post));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(post, async route => { await gate; await route.continue(); });
    try {
      await create.click();
      await requestStarted;
      await page.keyboard.type(title);
      await page.keyboard.press("Enter");
      await page.keyboard.type(body);
      await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toHaveValue(body);
    } finally { release(); }
    const content = page.locator("main .ProseMirror[aria-label='Content']");
    await expect(content).toBeFocused(ROUND_TRIP);
    await page.keyboard.type("More.");
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(title);
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    const documentId = new URL(page.url()).pathname.split("/").at(-1);
    const saved = await page.request.get(`/api/documents/${documentId}/peek?brief`);
    expect(saved.ok()).toBe(true);
    expect(await saved.json()).toMatchObject({ title, markdown: expect.stringContaining(`${body}More.`) });
  });

  test("keeps the draft visible and editable when creating fails, then retries it", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    const title = unique("Retry draft");
    const post = `/api/workspaces/${workspaceId}/documents`;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(post, async route => {
      await gate;
      await route.fulfill({ status: 503, json: { error: { code: "REQUEST_FAILED", message: "Creation is temporarily unavailable." } } });
    }, { times: 1 });
    const main = page.locator("main");
    const titleField = main.getByRole("textbox", { name: "Title" });
    const body = main.getByRole("textbox", { name: "Content" });
    try {
      await create.click();
      await expect(main.getByText("Creating a new note…")).toBeVisible(ROUND_TRIP);
      await page.keyboard.type(title);
      await page.keyboard.press("Enter");
      await page.keyboard.type("First sentence.");
    } finally { release(); }
    await expect(main.getByRole("alert")).toHaveText("Creation is temporarily unavailable.");
    await expect(titleField).toHaveValue(title);
    await expect(body).toHaveValue("First sentence.");
    await expect(main.getByRole("link", { name: "Write it in the new-document form instead" })).toBeVisible();
    await page.keyboard.type(" Still here.");
    await main.getByRole("button", { name: "Retry creation" }).click();
    await expect(main.locator(".ProseMirror[aria-label='Content']")).toHaveText("First sentence. Still here.", ROUND_TRIP);
    await expect(titleField).toHaveValue(title);
  });

  test("keeps the starter focused until an active title composition finishes", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    const post = `/api/workspaces/${workspaceId}/documents`;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(post, async route => { await gate; await route.continue(); });
    const cdp = await page.context().newCDPSession(page);
    const main = page.locator("main");
    const title = main.getByRole("textbox", { name: "Title" });
    try {
      await create.click();
      await expect(main.getByText("Creating a new note…")).toBeVisible(ROUND_TRIP);
      await cdp.send("Input.imeSetComposition", { text: "設", selectionStart: 1, selectionEnd: 1 });
      await expect(title).toHaveValue("設");
    } finally { release(); }
    await expect(main.getByText("Opening the note…")).toBeVisible(ROUND_TRIP);
    await expect(title).toBeFocused();
    await cdp.send("Input.insertText", { text: "設計" });
    await expect(main.locator(".ProseMirror[aria-label='Content']")).toBeEditable(ROUND_TRIP);
    await expect(title).toHaveValue("設計");
  });

  test("carries visible IME text when navigation was already in flight", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    let started!: () => void;
    const navigating = new Promise<void>(resolve => { started = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`/api/workspaces/${workspaceId}/documents`, async route => {
      const response = await route.fetch();
      const { sourceId, documentId } = await response.json() as { sourceId: string; documentId: string };
      const pathname = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;
      await page.route(url => url.pathname === pathname, async navigation => {
        started();
        await gate;
        await navigation.continue();
      }, { times: 1 });
      await route.fulfill({ response });
    });
    const title = page.locator("main").getByRole("textbox", { name: "Title" });
    const cdp = await page.context().newCDPSession(page);
    try {
      await create.click();
      await navigating;
      await expect(title).toBeFocused();
      await cdp.send("Input.imeSetComposition", { text: "編", selectionStart: 1, selectionEnd: 1 });
      await expect(title).toHaveValue("編");
    } finally { release(); }
    await expect(page.locator("main .ProseMirror[aria-label='Content']")).toBeEditable(ROUND_TRIP);
    await expect(title).toHaveValue("編");
  });

  test("opens the new-document form with the draft after creating fails", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    const title = unique("Fallback draft");
    const post = `/api/workspaces/${workspaceId}/documents`;
    await page.route(post, route => route.fulfill({ status: 503, json: { error: { code: "REQUEST_FAILED", message: "Creation is temporarily unavailable." } } }), { times: 1 });
    const main = page.locator("main");
    await create.click();
    await expect(main.getByRole("alert")).toHaveText("Creation is temporarily unavailable.", ROUND_TRIP);
    await main.getByRole("textbox", { name: "Title" }).fill(title);
    await main.getByRole("textbox", { name: "Content" }).fill("Keep my [[draft body]].");
    await main.getByRole("link", { name: "Write it in the new-document form instead" }).click();
    await expect(main.locator(".ProseMirror[aria-label='Content']")).toHaveText("Keep my draft body.", ROUND_TRIP);
    await expect(main.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  });

  test("keeps typing in the destination title buffer until its editor loads", async ({ page }) => {
    const release = await holdEditorCode(page);
    const title = unique("While loading");
    try {
      const { create, workspaceId } = await knowledge(page, HELD);
      const creating = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/api/workspaces/${workspaceId}/documents`));
      await create.click();
      await page.keyboard.type(title);
      const created = await (await creating).json() as { documentId: string };
      await expect(page).toHaveURL(new RegExp(`/${created.documentId}$`), ROUND_TRIP);
      await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toBeDisabled();
      await page.keyboard.type(" continued");
    } finally { release(); }
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(`${title} continued`, ROUND_TRIP);
  });

  test("opens a separate new document for each creation after the previous one opens", async ({ page }) => {
    const { create, workspaceId } = await knowledge(page);
    // Hold the wall clock fixed so both clicks happen within any URL-based deduplication window.
    await page.clock.setFixedTime(new Date());
    const post = `/api/workspaces/${workspaceId}/documents`;
    const waitForCreate = () => page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(post));
    const firstRequest = waitForCreate();
    await create.click();
    const first = await (await firstRequest).json() as { documentId: string };
    await expect(page).toHaveURL(new RegExp(`/${first.documentId}$`), ROUND_TRIP);
    const secondRequest = waitForCreate();
    await create.click();
    const second = await (await secondRequest).json() as { documentId: string };
    expect(second.documentId).not.toBe(first.documentId);
    await expect(page).toHaveURL(new RegExp(`/${second.documentId}$`), ROUND_TRIP);
  });

  test("keeps a space typed last before the note opens, so the next word stays apart", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    await page.keyboard.type("Weekly ");
    const field = page.locator("main").getByRole("textbox", { name: "Title" });
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(field).toBeFocused();
    await page.keyboard.type("plan");
    await expect(field).toHaveValue("Weekly plan");
  });

  test("from the palette opened in a document, keys typed after Create document are the new title", async ({ page }) => {
    await knowledge(page);
    await page.locator("main").getByRole("textbox", { name: "Content" }).click();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Search and actions" });
    await expect(palette).toBeVisible();
    await page.keyboard.type("Create document");
    await expect(palette.getByRole("option", { name: /Create document/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    const title = unique("From palette");
    await page.keyboard.type(title);
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toHaveValue(title, ROUND_TRIP);
  });

  test("names the new document in the tree as soon as its title is saved", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    const title = unique("Named");
    await expect(page.locator("main").getByRole("textbox", { name: "Title" })).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Body.");
    await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
    // Well inside the 30-second refresh that used to be the only one.
    await expect(page.getByRole("treeitem", { name: title })).toBeVisible({ timeout: 10_000 });
  });

  test("makes a document inside a folder from the folder's own +", async ({ page }) => {
    const { workspaceId } = await knowledge(page);
    const name = unique("Folder");
    const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, parentId: null } });
    expect(response.status()).toBe(201);
    await page.reload();
    const folder = page.getByRole("treeitem", { name });
    await expect(folder).toBeVisible(ROUND_TRIP);
    await folder.hover();
    await folder.getByRole("button", { name: `New document in ${name}` }).click();
    await expect(page.locator("main").getByRole("textbox", { name: "Content" })).toBeEditable(ROUND_TRIP);
    await expect(page.locator("main nav").first()).toContainText(name);
  });

  test("says how to start in an empty document", async ({ page }) => {
    const { create } = await knowledge(page);
    await create.click();
    const content = page.locator("main").getByRole("textbox", { name: "Content" });
    // The seed's editor stays editable until the new note's page replaces it.
    await expect(content).toHaveText("", ROUND_TRIP);
    await expect(content).toBeEditable(ROUND_TRIP);
    const hint = await page.locator('main [aria-label="Content"] > p').first().evaluate((element) => getComputedStyle(element, "::before").content);
    expect(hint).toBe('"Write, or press / for commands"');
  });
});
