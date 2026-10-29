import { expect, test, type Page } from "./fixtures/test";
import { ROUND_TRIP, mySpace, openKnowledge, row, unique } from "./fixtures/organize";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";
import { phase3Origin, phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

/**
 * Folder share link spec, end to end. The owner is the E2E user working in their own My Space on the
 * local server; the anonymous reader is a fresh context on phase3UnconfiguredOrigin() (no sign-in
 * exists there at all); the signed-in reader is the `viewer` persona. All share one database. Names
 * are unique per run, so nothing depends on what an earlier spec left in My Space. Sorts last (zz-)
 * like the other specs that arrange the tree.
 */
test.describe("folder share link", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT && process.env.KM_E2E_UNCONFIGURED_SERVER !== "true", "Run npm run test:e2e to provision the no-sign-in origin.");

  const NOT_AVAILABLE = "This link is not available";

  async function apiFolder(page: Page, workspaceId: string, name: string, parentId: string | null = null) {
    const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, parentId } });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { treeNodeId: string }).treeNodeId;
  }

  async function apiDocument(page: Page, workspaceId: string, title: string, markdown: string, parentId: string | null = null) {
    const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown, parentId } });
    expect(response.status()).toBe(201);
    return (await response.json()) as { documentId: string; sourceId: string };
  }

  /** A folder with a document, a subfolder holding a deep document, and a document outside it that both link to. */
  async function arrange(page: Page) {
    const workspaceId = await mySpace(page);
    const names = { folder: unique("Shared F"), sub: unique("Sub S"), intro: unique("Intro"), deep: unique("Deep"), outside: unique("Outside") };
    const outside = await apiDocument(page, workspaceId, names.outside, "Not in the folder.");
    const folderId = await apiFolder(page, workspaceId, names.folder);
    const subId = await apiFolder(page, workspaceId, names.sub, folderId);
    const intro = await apiDocument(page, workspaceId, names.intro, `Intro body text with [[${names.deep}]] and [[${names.outside}]] inside.`, folderId);
    const deep = await apiDocument(page, workspaceId, names.deep, `Deep body text with [[${names.intro}]] and [[${names.outside}]] inside.`, subId);
    return { workspaceId, names, ids: { folder: folderId, intro: intro.documentId, deep: deep.documentId, outside: outside.documentId }, sourceId: deep.sourceId };
  }

  async function notAvailable(page: Page, url: string) {
    await page.goto(url);
    await expect(page.getByText(NOT_AVAILABLE, { exact: true })).toBeVisible(ROUND_TRIP);
    // Nothing of the folder is on the page: no tree, no bar.
    await expect(page.getByRole("navigation")).toHaveCount(0);
    return (await page.locator("main").innerText()).trim();
  }

  test("owner shares a folder, readers walk it, a signed-in reader comments and saves, the owner revokes", async ({ page, browser, context }) => {
    test.setTimeout(90_000); // one story across three browsers
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { workspaceId, names, ids, sourceId } = await arrange(page);
    await openKnowledge(page, workspaceId);
    const owner = new URL(page.url()).origin;

    // Share from the folder's menu: "Share link…" leads it, and the dialog is for the folder.
    const menu = page.getByRole("menu");
    // An open folder's treeitem holds its children, so its centre is a child row: click its own row, at the top.
    await row(page, names.folder).click({ button: "right", position: { x: 60, y: 10 } });
    await expect(menu.getByRole("menuitem").first()).toHaveAccessibleName("Share link…");
    await menu.getByRole("menuitem", { name: "Share link…" }).click();
    const dialog = page.getByRole("dialog", { name: `Share folder ${names.folder}` });
    await expect(dialog.getByText("every document in this folder and its subfolders")).toBeVisible();
    await dialog.getByLabel(/Label/).fill("for readers");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const item = dialog.locator("[data-share-link]").first();
    await expect(item).toContainText("for readers", ROUND_TRIP);
    const path = (await item.getAttribute("data-share-link"))!;
    expect(path).toMatch(/^\/s\/[0-9a-f-]{36}$/);
    await item.getByRole("button", { name: "Copy link" }).click();
    await expect(item.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${owner}${path}`);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(row(page, names.folder).getByRole("img", { name: "Shared" })).toBeVisible(ROUND_TRIP);

    // An anonymous visitor: the landing document, the tree, a deep document, and links.
    const anonymous = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const reader = await anonymous.newPage();
    const base = phase3UnconfiguredOrigin();
    try {
      await reader.goto(`${base}${path}`);
      const tree = reader.getByRole("navigation", { name: names.folder });
      await expect(tree).toBeVisible(ROUND_TRIP);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`^(${names.intro}|${names.deep})$`));
      await expect(tree.locator('a[aria-current="page"]')).toHaveCount(1);

      const sub = tree.getByRole("button", { name: names.sub, exact: true });
      if ((await sub.getAttribute("aria-expanded")) === "false") await sub.click();
      await expect(sub).toHaveAttribute("aria-expanded", "true");
      await tree.getByRole("link", { name: names.deep, exact: true }).click();
      await expect(reader).toHaveURL(`${base}${path}?d=${ids.deep}`);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(names.deep);
      await expect(tree.getByRole("link", { name: names.deep, exact: true })).toHaveAttribute("aria-current", "page");

      // Out of the folder, a link is its text and carries nothing, not even the title.
      const article = reader.locator("article").first();
      await expect(article.getByText(names.outside, { exact: true })).toBeVisible();
      await expect(article.locator("span", { hasText: new RegExp(`^${names.outside}$`) })).not.toHaveAttribute("title", /.*/);
      await expect(article.getByRole("link", { name: names.outside })).toHaveCount(0);
      expect(await article.getByText(names.outside, { exact: true }).evaluate((element) => element.closest("a"))).toBeNull();

      // In the folder, it is an anchor into the same link.
      const inFolder = article.getByRole("link", { name: names.intro, exact: true });
      await expect(inFolder).toHaveAttribute("href", `${path}?d=${ids.intro}`);
      await inFolder.click();
      await expect(reader).toHaveURL(`${base}${path}?d=${ids.intro}`);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(names.intro);

      // The bar: comments, save and open are there for a reader who is not signed in.
      await expect(reader.getByRole("button", { name: "Save share", exact: true })).toBeVisible();
      await expect(reader.getByRole("link", { name: "Open in Knowledge Hub" })).toBeVisible();
      await expect(reader.getByRole("button", { name: /^(Open|Hide) discussions/ })).toBeVisible();

      // Hostile URLs read as an unknown token reads.
      const unknown = await notAvailable(reader, `${base}/s/${crypto.randomUUID()}`);
      const foreign = await createReviewDocument(page.request);
      for (const d of [ids.outside, foreign.documentId, "junk", crypto.randomUUID()]) {
        expect(await notAvailable(reader, `${base}${path}?d=${d}`)).toBe(unknown);
      }

      // A phone: the tree is behind the bar's button, opens over the page, and navigates.
      await reader.setViewportSize({ width: 390, height: 844 });
      await reader.goto(`${base}${path}?d=${ids.intro}`);
      const disclosure = reader.getByRole("button", { name: "Folder contents" });
      await expect(disclosure).toBeVisible(ROUND_TRIP);
      await expect(tree).toBeHidden();
      await disclosure.click();
      await expect(tree).toBeVisible();
      const phoneSub = tree.getByRole("button", { name: names.sub, exact: true });
      if ((await phoneSub.getAttribute("aria-expanded")) === "false") await phoneSub.click();
      await tree.getByRole("link", { name: names.deep, exact: true }).click();
      await expect(reader).toHaveURL(`${base}${path}?d=${ids.deep}`);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(names.deep);
      await expect(tree).toBeHidden();
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await anonymous.close();
    }

    // A signed-in reader comments on the deep document through the folder link, and saves the folder.
    const viewer = phase3Origin("viewer");
    const signedIn = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const commenter = await signedIn.newPage();
    try {
      await commenter.goto(`${viewer}${path}?d=${ids.deep}`);
      await openReviewDiscussions(commenter);
      await selectPassage(commenter, "body text");
      await commenter.getByRole("button", { name: "Comment on selection" }).focus({ timeout: 5000 });
      await commenter.keyboard.press("Enter");
      await commenter.getByRole("textbox", { name: "Add comment" }).fill("Folder reader question");
      await commenter.getByRole("button", { name: "Add comment", exact: true }).click();
      await expect(commenter.locator("[data-review-thread]").getByText("Folder reader question", { exact: true })).toBeVisible(ROUND_TRIP);

      const save = commenter.getByRole("button", { name: "Save share", exact: true });
      await expect(save).toBeEnabled(ROUND_TRIP);
      await save.click();
      await expect(commenter.getByRole("button", { name: "Saved", exact: true })).toHaveAttribute("aria-pressed", "true", ROUND_TRIP);
      await commenter.getByRole("link", { name: "View saved shares", exact: true }).click();
      await expect(commenter).toHaveURL(/\/shares\?tab=saved$/);
      const saved = commenter.getByRole("list", { name: "Saved shares", exact: true });
      const entry = saved.getByRole("link", { name: `Folder ${names.folder}`, exact: true });
      await expect(entry).toBeVisible(ROUND_TRIP);
      await expect(entry.locator("svg.lucide-folder")).toHaveCount(1);
    } finally {
      await signedIn.close();
    }

    // The owner finds the comment in the Inbox, the count on the folder's row in My shares,
    // and, on the deep document, the reminder that the folder shows it too.
    await page.goto(`/w/${workspaceId}/inbox`);
    await expect(page.getByRole("list", { name: "Inbox discussions" }).getByText("Folder reader question")).toBeVisible(ROUND_TRIP);

    await page.goto(`/w/${workspaceId}/shares`);
    const shares = page.getByRole("list", { name: "Share links" });
    const folderRow = shares.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Folder ${names.folder}`, exact: true }) });
    await expect(folderRow).toHaveCount(1, ROUND_TRIP);
    await expect(folderRow.locator("svg.lucide-folder")).toHaveCount(1);
    await expect(folderRow.getByRole("link", { name: /unread comments for/ })).toContainText("1 new");

    await page.goto(`/w/${workspaceId}/knowledge/${sourceId}/${ids.deep}`);
    await page.locator("main").getByRole("button", { name: "Share link…" }).click();
    const documentDialog = page.getByRole("dialog", { name: "Share link" });
    const also = documentDialog.getByRole("list", { name: "Also shared through folders" });
    await expect(also).toContainText("Also visible through the shared folder", ROUND_TRIP);
    await also.getByRole("button", { name: `Open share links for folder ${names.folder}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Share folder ${names.folder}` })).toBeVisible(ROUND_TRIP);
    await page.keyboard.press("Escape");

    // Revoking ends the landing page and every document of it.
    await page.goto(`/w/${workspaceId}/shares`);
    const target = shares.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Folder ${names.folder}`, exact: true }) });
    await target.getByRole("button", { name: `Share actions for ${names.folder} · for readers`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Revoke share link?" }).getByRole("button", { name: "Confirm revoke" }).click();
    await expect(target).toHaveCount(0, ROUND_TRIP);

    const after = await browser.newContext();
    try {
      const gone = await after.newPage();
      await notAvailable(gone, `${base}${path}`);
      await notAvailable(gone, `${base}${path}?d=${ids.deep}`);
    } finally {
      await after.close();
    }
  });

  test("an empty shared folder says so", async ({ page, browser }) => {
    const workspaceId = await mySpace(page);
    const name = unique("Empty F");
    const folderId = await apiFolder(page, workspaceId, name);
    const created = await page.request.post(`/api/tree-nodes/${folderId}/share-links`, { data: {} });
    expect(created.status()).toBe(201);
    const { link } = (await created.json()) as { link: { path: string } };
    const anonymous = await browser.newContext();
    try {
      const reader = await anonymous.newPage();
      await reader.goto(`${phase3UnconfiguredOrigin()}${link.path}`);
      await expect(reader.getByRole("heading", { level: 1 })).toHaveText(name, ROUND_TRIP);
      await expect(reader.getByText("This folder has no documents yet.", { exact: true })).toBeVisible();
    } finally {
      await anonymous.close();
    }
  });
});
