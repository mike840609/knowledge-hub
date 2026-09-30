import { expect, test, type Browser, type Page } from "@playwright/test";
import { phase3Origin, phase3UserId, type Phase3Persona } from "./fixtures/phase3-identities";
import { openPalette } from "./fixtures/palette";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Making the document a broken `[[link]]` names (daily-driver spec §6.2), from the reader, the
 * inspector's Links tab and the graph: the way in is there for someone who may write, it arrives at
 * the new-document page with the title already in the field, Cancel goes back to the document the
 * link is in, and once the document is made the link resolves without anything having been written
 * to the document that has it.
 *
 * Nothing here types Markdown through the source view. It creates documents in the E2E user's own
 * My Space, and sorts where zz-wikilinks-composer.spec.ts does, for the same two reasons.
 */

function unique(label: string) {
  return `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const composer = (page: Page) => page.locator("main form").first();

async function mySpace(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForURL(/\/w\/[^/]+\/knowledge/);
  return new URL(page.url()).pathname.split("/")[2];
}

async function createNote(page: Page, workspaceId: string, title: string, markdown: string) {
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The inspector's Links tab, opened as reading-links.spec.ts opens it: from the command palette. */
async function openLinksTab(page: Page) {
  await (await openPalette(page)).fill("backlinks");
  await page.getByRole("option", { name: /Show backlinks/ }).click();
  await expect(page.getByRole("tab", { name: "Links", selected: true })).toBeVisible({ timeout: 15_000 });
}

test.describe("creating the document a broken link names", () => {
  test("the reader's broken link opens the form with its title, Cancel goes back, and Create makes the link resolve", async ({ page }) => {
    const stamp = unique("Ghost");
    const workspaceId = await mySpace(page);
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Needs [[${stamp} Notes]] and [[${stamp} Other|another]].`);
    await page.goto(sourceUrl);
    const article = page.locator("article").first();
    const creates = article.locator("a[data-create-link]");
    await expect(creates).toHaveCount(2, ROUND_TRIP);
    // Still marked as going nowhere yet, in words as well as in style; and a real link.
    await expect(creates.first()).toHaveAttribute("data-unresolved-link", "true");
    await expect(creates.first()).toContainText("(no matching document; create it)");
    await expect(article.getByRole("link", { name: `${stamp} Notes` })).toHaveAttribute("href", /\/knowledge\/new\?title=/);

    await creates.first().click();
    await expect(page).toHaveURL(/\/knowledge\/new\?/, ROUND_TRIP);
    const title = composer(page).getByLabel("Title", { exact: true });
    await expect(title).toHaveValue(`${stamp} Notes`, ROUND_TRIP);

    // Cancel goes back to the document the link is in, not to the list; nothing was asked, nothing was made.
    await composer(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(new RegExp(`${escape(sourceUrl)}$`), ROUND_TRIP);

    await creates.first().click();
    await expect(title).toHaveValue(`${stamp} Notes`, ROUND_TRIP);
    const surface = composer(page).getByRole("textbox", { name: "Content" });
    await expect(surface).toBeEditable(ROUND_TRIP);
    await surface.click();
    await page.keyboard.type("Started from a broken link.");
    await composer(page).getByRole("button", { name: "Create document" }).click();
    await expect(page).not.toHaveURL(/\/knowledge\/new/, ROUND_TRIP);
    const createdUrl = page.url();
    await expect(page.getByRole("heading", { name: `${stamp} Notes` }).first()).toBeVisible(ROUND_TRIP);

    // Back in the document that has the link: it resolves, with nothing having been written to it.
    await page.goto(sourceUrl);
    await expect(article.getByRole("link", { name: `${stamp} Notes`, exact: true })).toHaveAttribute("href", new RegExp(`${escape(new URL(createdUrl).pathname)}$`), ROUND_TRIP);
    await expect(article.locator("a[data-create-link]")).toHaveCount(1);
    await expect(article.locator("a[data-create-link]")).toContainText("another");
    // And the new document lists it as a backlink.
    await page.goto(createdUrl);
    await expect(page.locator("[data-backlinks]").getByRole("heading", { name: "Linked from 1 document" })).toBeVisible(ROUND_TRIP);
  });

  test("the Links tab lists the same broken link with a Create beside it, which goes to the same form", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    const stamp = unique("Tab");
    const workspaceId = await mySpace(page);
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Needs [[${stamp} Wanted]] and [gone](gone.md).`);
    await page.goto(sourceUrl);
    await openLinksTab(page);
    const unresolved = page.locator('[data-links-section="unresolved"]');
    await expect(unresolved).toContainText(`${stamp} Wanted`, ROUND_TRIP);
    // Only the wikilink can be made: a relative path names a place in a source.
    await expect(unresolved.locator("a[data-create-link]")).toHaveCount(1);
    await unresolved.getByRole("link", { name: `Create a document for “${stamp} Wanted”` }).click();
    await expect(page).toHaveURL(/\/knowledge\/new\?/, ROUND_TRIP);
    await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(`${stamp} Wanted`, ROUND_TRIP);
  });

  test("the graph's unresolved node, in the drawing and in the table, opens the form; Cancel goes to the list", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const stamp = unique("Node");
    const workspaceId = await mySpace(page);
    await createNote(page, workspaceId, `Source ${stamp}`, `Needs [[${stamp} Missing]].`);

    await page.goto(`/w/${workspaceId}/graph?unresolved=1`);
    const ghost = page.getByRole("link", { name: new RegExp(`^${escape(`${stamp} Missing`)} \\(unresolved; opens the form to create it\\)`) });
    await expect(ghost).toBeVisible(ROUND_TRIP);
    // The node's own circle: the link's box also holds its label, which does not take the pointer, so the
    // box's middle can be off the circle (workspace-graph.spec.ts has the same note about the drawing).
    await ghost.locator("circle").last().hover();
    await expect(page.locator("[data-graph-card]")).toContainText("Click to create");
    await ghost.locator("circle").last().click();
    await expect(page).toHaveURL(/\/knowledge\/new\?/, ROUND_TRIP);
    await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(`${stamp} Missing`, ROUND_TRIP);
    // Several documents may write it, so there is no one to go back to.
    await composer(page).getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/knowledge$`), ROUND_TRIP);

    await page.goto(`/w/${workspaceId}/graph?unresolved=1&view=list`);
    const row = page.getByRole("row", { name: new RegExp(`${escape(`${stamp} Missing`)}.*Unresolved`) });
    await expect(row.getByRole("link", { name: `Create a document for “${stamp} Missing”` })).toBeVisible(ROUND_TRIP);
  });

  test("a title that could not be resolved to is not offered, and a malicious `from` leads nowhere", async ({ page }) => {
    const stamp = unique("Odd");
    const workspaceId = await mySpace(page);
    const sourceUrl = await createNote(page, workspaceId, `Source ${stamp}`, `Path style [[folder/${stamp}]] here.`);
    await page.goto(sourceUrl);
    await expect(page.locator("article").first().locator("[data-unresolved-link]")).toHaveCount(1, ROUND_TRIP);
    await expect(page.locator("article").first().locator("a[data-create-link]")).toHaveCount(0);

    // Addresses anyone can write: `from` is followed only when it is a readable document of this workspace.
    for (const from of ["javascript:alert(1)", "https://example.com/", "../../etc/passwd", "0199f500-0000-7000-8000-00000000dead"]) {
      await page.goto(`/w/${workspaceId}/knowledge/new?title=${encodeURIComponent(`${stamp} T`)}&from=${encodeURIComponent(from)}`);
      await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue(`${stamp} T`, ROUND_TRIP);
      await composer(page).getByRole("button", { name: "Cancel" }).click();
      await expect(page, from).toHaveURL(new RegExp(`/w/${workspaceId}/knowledge$`), ROUND_TRIP);
    }
    // A title the create request would refuse is left out rather than cut.
    await page.goto(`/w/${workspaceId}/knowledge/new?title=${"x".repeat(600)}`);
    await expect(composer(page).getByLabel("Title", { exact: true })).toHaveValue("", ROUND_TRIP);
  });
});

test.describe("who is offered it", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Use the isolated HTTP harness via npm run test:e2e.");

  async function session(browser: Browser, persona: Phase3Persona) {
    const context = await browser.newContext({ baseURL: phase3Origin(persona) });
    return { context, page: await context.newPage() };
  }

  test("an editor is; a viewer sees the broken link as it always was, and cannot reach the form", async ({ browser }) => {
    test.setTimeout(90_000);
    const owner = await session(browser, "owner");
    const editor = await session(browser, "editor");
    const viewer = await session(browser, "viewer");
    try {
      const created = await owner.context.request.post("/api/workspaces", { data: { name: `Create from link ${Date.now()}` } });
      expect(created.status()).toBe(201);
      const workspaceId = (await created.json()).id as string;
      for (const [persona, role] of [["editor", "EDITOR"], ["viewer", "VIEWER"]] as const) {
        expect((await owner.context.request.post(`/api/workspaces/${workspaceId}/members`, { data: { userId: phase3UserId(persona), role } })).ok()).toBe(true);
      }
      const stamp = unique("Who");
      const note = await owner.context.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Source ${stamp}`, markdown: `Needs [[${stamp} Wanted]].` } });
      expect(note.status()).toBe(201);
      const { sourceId, documentId } = (await note.json()) as { sourceId: string; documentId: string };
      const url = `/w/${workspaceId}/knowledge/${sourceId}/${documentId}`;

      await editor.page.goto(url);
      await expect(editor.page.locator("article").first().locator("a[data-create-link]")).toHaveCount(1, ROUND_TRIP);

      await viewer.page.setViewportSize({ width: 1500, height: 900 });
      await viewer.page.goto(url);
      const article = viewer.page.locator("article").first();
      await expect(article.locator("[data-unresolved-link]")).toHaveCount(1, ROUND_TRIP);
      await expect(article.locator("a[data-create-link]")).toHaveCount(0);
      await openLinksTab(viewer.page);
      await expect(viewer.page.locator('[data-links-section="unresolved"]')).toContainText(`${stamp} Wanted`, ROUND_TRIP);
      await expect(viewer.page.locator("a[data-create-link]")).toHaveCount(0);
      // The graph's node is not a link for them either.
      await viewer.page.goto(`/w/${workspaceId}/graph?unresolved=1`);
      await expect(viewer.page.getByRole("img", { name: new RegExp(`^${escape(`${stamp} Wanted`)} \\(unresolved\\), `) })).toBeVisible(ROUND_TRIP);
      // And the form itself is not there to be reached: a viewer is not someone who can write.
      const form = await viewer.page.goto(`/w/${workspaceId}/knowledge/new?title=${encodeURIComponent(`${stamp} Wanted`)}`);
      expect(form?.status()).toBe(404);
    } finally {
      await owner.context.close();
      await editor.context.close();
      await viewer.context.close();
    }
  });
});
