import { expect, test, type Page } from "@playwright/test";
import { showMarkdown } from "./composer-helpers";
const wait = { timeout: 15000 };
async function note(page: Page, markdown: string) {
  const navigation = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Remediation ${Date.now()}`, markdown } });
  expect(response.ok()).toBe(true);
  const doc = await response.json();
  return { ...doc, workspaceId, href: `/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}` };
}
const longMarkdown = '# Shared reading\n\n' + Array.from({ length: 35 }, (_, i) => `## Section ${i + 1}\n\n${'A readable paragraph with enough content. '.repeat(15)}`).join('\n\n');

test('public long reader scrolls and presents a single opening title', async ({ page }, info) => {
  const doc = await note(page, longMarkdown);
  const response = await page.request.post(`/api/documents/${doc.documentId}/share-links`, { data: { label: 'reader', expiresInDays: 1 } });
  expect(response.ok()).toBe(true);
  const shared = await response.json();
  await page.goto(shared.link.path);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole('heading', { name: 'Section 35', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await page.screenshot({ path: info.outputPath('share-reader.png') });
});

test('reader and composer keep their column and expose commands during long scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 1850, height: 850 });
  const doc = await note(page, longMarkdown);
  await page.goto(doc.href);
  const region = page.getByRole('region', { name: 'Document content', exact: true });
  const breadcrumb = region.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(breadcrumb).toBeVisible(wait);
  const readerX = (await breadcrumb.boundingBox())!.x;
  expect((await page.locator('main').boundingBox())!.x).toBe(160);
  const explorer = page.getByRole('complementary', { name: 'Knowledge explorer' });
  const expandedExplorer = (await explorer.boundingBox())!;
  expect(expandedExplorer.y).toBe((await page.locator('main').boundingBox())!.y);
  expect(expandedExplorer.width).toBe(288);
  // A wide window has no topbar: rail, explorer and content start at its top edge.
  await expect(page.locator('header').first()).toBeHidden();
  expect(expandedExplorer.y).toBe(0);
  // The rail opens with the wordmark, then the workspace switcher, then Search, then the navigation.
  const workspace = page.getByRole('button', { name: /^Workspace:/ });
  const search = page.getByRole('button', { name: 'Quick search', exact: true });
  const primary = page.getByRole('navigation', { name: 'Primary' });
  const inRail = async (rail: number) => {
    for (const control of [workspace, search]) { const box = (await control.boundingBox())!; expect(box.x).toBe(8); expect(box.x + box.width).toBeLessThanOrEqual(rail - 8); }
    expect((await workspace.boundingBox())!.y).toBeLessThan((await search.boundingBox())!.y);
    expect((await search.boundingBox())!.y).toBeLessThan((await primary.boundingBox())!.y);
  };
  await inRail(160);
  expect((await page.getByText('Knowledge Hub', { exact: true }).filter({ visible: true }).boundingBox())!.y).toBeLessThan((await workspace.boundingBox())!.y);
  // With no topbar, the rail's wordmark, the explorer's first row and the breadcrumb share one top line.
  const centre = async (locator: ReturnType<Page['locator']>) => { const box = (await locator.boundingBox())!; return box.y + box.height / 2; };
  const line = await centre(breadcrumb);
  expect(Math.abs(await centre(page.getByText('Knowledge Hub', { exact: true }).filter({ visible: true })) - line)).toBeLessThanOrEqual(1);
  expect(Math.abs(await centre(explorer.getByRole('heading', { name: 'Documents', exact: true })) - line)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('reader-navigation-expanded.png') });
  // Scrolling pins the breadcrumb line — location › title, and its actions — to the top of the reading column.
  const regionBox = (await region.boundingBox())!;
  const restingY = (await breadcrumb.boundingBox())!.y;
  // Its lower edge fades the content in only while it is pinned; at rest there is nothing under it.
  const pinnedLine = region.locator('.lg\\:kh-fade-below');
  await expect(pinnedLine).not.toHaveAttribute('data-pinned');
  await region.evaluate(el => { el.scrollTop = 1500; });
  await expect(breadcrumb).toBeInViewport();
  await expect(breadcrumb.getByText(/^Remediation /)).toBeVisible();
  await expect.poll(async () => (await breadcrumb.boundingBox())!.y).toBeLessThanOrEqual(restingY);
  expect((await breadcrumb.boundingBox())!.y).toBeGreaterThanOrEqual(regionBox.y);
  const details = region.getByRole('button', { name: 'Details', exact: true });
  await expect(details).toBeInViewport();
  await expect(pinnedLine).toHaveAttribute('data-pinned', 'true');
  await expect.poll(() => pinnedLine.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');
  expect(await pinnedLine.evaluate(el => getComputedStyle(el, '::after').pointerEvents)).toBe('none');
  await page.screenshot({ path: info.outputPath('reader-scrolled.png') });
  await page.screenshot({ path: info.outputPath('reader-scrolled-edge.png'), clip: { x: regionBox.x, y: regionBox.y, width: 1000, height: 160 } });
  await details.click();
  await expect(page.getByRole('complementary', { name: 'Document details', exact: true })).toBeVisible();
  await page.keyboard.press('Meta+i');
  await region.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(explorer).toBeVisible();
  expect((await explorer.boundingBox())!.x).toBe(48);
  await inRail(48);
  await search.click();
  await expect(page.getByRole('dialog', { name: 'Search and actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect((await explorer.boundingBox())!.height).toBe(expandedExplorer.height);
  await page.screenshot({ path: info.outputPath('reader-navigation-collapsed.png') });
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await page.goto(`${doc.href}/edit`);
  const form = page.locator('main form').first();
  await expect(form.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible(wait);
  const editorX = (await form.getByRole('navigation', { name: 'Breadcrumb' }).boundingBox())!.x;
  expect(Math.abs(readerX - editorX)).toBeLessThan(2);
  await expect(form.getByRole('textbox', { name: 'Content' })).toBeEditable(wait);
  const source = await showMarkdown(form);
  await source.fill(longMarkdown + '\n\nExtra line');
  await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  // The composer's pinned command line fades the scrolled document in, as the reader's does; not at rest.
  const commands = form.locator('.kh-fade-below');
  await expect(commands).toHaveAttribute('data-pinned', 'true');
  await region.evaluate(el => { el.scrollTop = 0; });
  await expect(commands).not.toHaveAttribute('data-pinned');
  await region.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('composer-commands.png') });
  // Discard this test's local draft when leaving the page.
  page.on('dialog', dialog => void dialog.accept());
});

test('mobile menu contains contextual navigation and closes after selecting a document', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await note(page, longMarkdown);
  await page.goto(doc.href);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: /^Workspace:/ })).toBeVisible();
  await expect(page.locator('header').getByRole('button', { name: /^Workspace:/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('header').getByRole('button', { name: 'Quick search', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Search and actions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await menu.locator('a').filter({ hasText: /Remediation/ }).last().click();
  await expect(menu).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: 'Document content', exact: true }).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: 'Document actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit document', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share link…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-reader.png') });
});

test('Home keeps secondary tools in a menu and document operations on each row', async ({ page }) => {
  const doc = await note(page, 'Home body');
  // Continue reading contains visited articles, so open this test's document first.
  const marked = page.waitForResponse(r => r.url().endsWith(`/documents/${doc.documentId}/read`) && r.request().method() === 'POST');
  await page.goto(doc.href);
  expect((await marked).status()).toBe(204);
  await page.goto(`/w/${doc.workspaceId}/home`);
  await expect(page.getByRole('link', { name: 'Export Markdown ZIP' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Home actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export Markdown ZIP' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Continue reading' }).locator(`[data-list-row][href="${doc.href}"]`)).toBeVisible();
});

test('history presents changed lines before optional full Markdown', async ({ page }) => {
  const doc = await note(page, '# Original\n\nUnchanged\n\nOld line');
  const revised = await page.request.patch(`/api/documents/${doc.documentId}`, { data: { expectedCurrentRevisionId: doc.revisionId, title: 'Revised', markdown: '# Original\n\nUnchanged\n\nNew line', metadata: {} } });
  expect(revised.ok()).toBe(true);
  await page.goto(`${doc.href}?revision=1`);
  const content = page.getByRole("region", { name: "Document content", exact: true });
  await content.getByText('Compare revision 1 with current revision 2', { exact: true }).click();
  await expect(content.getByRole('table', { name: 'Changed lines from revision 1 to 2' })).toBeVisible();
  await expect(content.getByText('1 lines added · 1 lines removed', { exact: true })).toBeVisible();
  await expect(content.getByText('Revision 2 · Revised', { exact: true })).not.toBeVisible();
  await content.getByText('View full Markdown', { exact: true }).click();
  await expect(content.getByText('Revision 2 · Revised', { exact: true })).toBeVisible();
});

test('Sources support row keys and importing uses the shared field and folder trigger', async ({ page }) => {
  const workspace = '0199f100-0000-7000-8000-000000000001';
  await page.goto(`/w/${workspace}/sources`);
  // A page that opens with PageHeader puts its location › title on the rail's top line, as a document does.
  const heading = page.getByRole('heading', { level: 1, name: 'Sources', exact: true });
  await expect(heading).toBeVisible();
  const middle = async (locator: ReturnType<Page['locator']>) => { const box = (await locator.boundingBox())!; return box.y + box.height / 2; };
  expect(Math.abs(await middle(heading) - await middle(page.getByText('Knowledge Hub', { exact: true }).filter({ visible: true })))).toBeLessThanOrEqual(1);
  // The rail marks the current page with a neutral step, not the accent the explorer's selection uses.
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sources', exact: true })).toHaveCSS('background-color', 'rgb(228, 231, 236)');
  const rows = page.locator('[data-list-row]');
  await expect(rows.nth(1)).toBeVisible();
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.goto(`/w/${workspace}/sources/import`);
  const input = page.getByLabel('Source name');
  await expect(input).toBeVisible();
  expect((await input.boundingBox())!.height).toBe(32);
  await expect(page.getByRole('button', { name: 'Choose folder', exact: true })).toBeVisible();
});

test('touch tree controls stay visible, usable and separated in both themes', async ({ page, browser, baseURL }, info) => {
  const doc = await note(page, '# Touch note\n\nBody');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const mobile = await context.newPage();
    await mobile.goto(doc.href);
    await mobile.getByRole('button', { name: 'Open menu', exact: true }).click();
    const menu = mobile.getByRole('dialog', { name: 'Menu', exact: true });
    const row = menu.getByRole('treeitem').filter({ has: mobile.locator(`a[href="${doc.href}"]`) });
    const star = row.getByRole('button', { name: /favorites:/ });
    const actions = row.getByRole('button', { name: /Actions for/ });
    await expect(menu).toHaveCSS('opacity', '1');
    await expect(star).toBeVisible();
    await expect(actions).toBeVisible();
    const starBox = (await star.boundingBox())!, actionsBox = (await actions.boundingBox())!;
    expect(starBox.height).toBeGreaterThanOrEqual(39.99);
    expect(starBox.width).toBeGreaterThanOrEqual(39.99);
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(starBox.x);
    await mobile.screenshot({ path: info.outputPath('mobile-menu-light.png') });
    await mobile.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await expect(menu.getByRole('link', { name: 'Knowledge', exact: true })).toHaveCSS('background-color', 'rgb(43, 46, 53)');
    await mobile.screenshot({ path: info.outputPath('mobile-menu-dark.png') });
  } finally { await context.close(); }
});


test('narrow server-rendered reader reserves no desktop explorer space before hydration', async ({ page, browser, baseURL }) => {
  const doc = await note(page, '# Initial reader\n\nVisible without scripts');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  try {
    const initial = await context.newPage();
    await initial.goto(doc.href);
    // Next's streamed reader stays in its loading fallback without scripts.
    // This check is about initial geometry, not support for JavaScript-free navigation.
    await expect(initial.getByRole('region', { name: 'Document content', exact: true })).toBeVisible();
    expect((await initial.locator('main').first().boundingBox())!.width).toBe(390);
    await expect(initial.getByRole('navigation', { name: 'Primary' })).not.toBeVisible();
  } finally { await context.close(); }
});

test('mobile explorer menus retain focus inside the navigation drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await note(page, '# Mobile operations\n\nBody');
  await page.goto(doc.href);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu', exact: true });
  const display = drawer.getByRole('button', { name: 'Document display options', exact: true });
  await display.click();
  const archived = page.getByRole('menuitemcheckbox', { name: 'Show archived', exact: true });
  await expect(archived).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(archived).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  await expect(display).toBeFocused();
});

test('mobile explorer row actions and folder dialog remain operable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const doc = await note(page, '# Mobile dialog operations\n\nBody');
  await page.goto(doc.href);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu', exact: true });
  const row = drawer.getByRole('treeitem').filter({ has: page.locator(`a[href="${doc.href}"]`) });
  await row.getByRole('button', { name: /Actions for/ }).click();
  const favorite = page.getByRole('menuitem', { name: 'Add to favorites', exact: true });
  await expect(favorite).toBeVisible();
  await favorite.click();
  await expect(row.getByRole('button', { name: /Remove from favorites:/ })).toBeVisible();
  await expect(page.getByRole('menu')).not.toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from favorites', exact: true }).click();
  await expect(row.getByRole('button', { name: /Add to favorites:/ })).toBeVisible();
  await drawer.getByRole('button', { name: 'Create folder', exact: true }).first().click();
  const folder = page.getByRole('dialog', { name: 'New folder', exact: true });
  await expect(folder).toBeVisible();
  const field = folder.getByRole('textbox');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(folder).not.toBeVisible();
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Create folder', exact: true }).first().click();
  await expect(field).toBeFocused();
  await field.fill(`Reviewed folder ${Date.now()}`);
  await folder.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(folder).not.toBeVisible(wait);
});

test('long explorer reveals the selected document after portal layout settles', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  let selected = await note(page, 'Long explorer seed');
  const favorites: { key: string; sourceId: string }[] = [];
  for (let index = 0; index < 35; index++) {
    const response = await page.request.post(`/api/workspaces/${selected.workspaceId}/documents`, { data: { title: `Long explorer ${index}`, markdown: 'Body' } });
    expect(response.ok()).toBe(true);
    const document = await response.json();
    if (index < 4) favorites.push({ key: `favorite:${document.documentId}`, sourceId: document.sourceId });
    selected = { ...document, workspaceId: selected.workspaceId, href: `/w/${selected.workspaceId}/knowledge/${document.sourceId}/${document.documentId}` };
  }
  let releaseFavorites!: () => void;
  const loadedFavorites = new Promise<void>(resolve => { releaseFavorites = resolve; });
  await page.route(`**/api/workspaces/${selected.workspaceId}/personal`, async route => {
    await loadedFavorites;
    await route.fulfill({ json: favorites });
  });
  await page.goto(selected.href);
  const row = page.getByRole('treeitem', { name: 'Long explorer 34', exact: true });
  try {
    await expect(row).toHaveAttribute('aria-current', 'page');
    await expect(row).toBeInViewport();
  } finally { releaseFavorites(); }
  await expect(page.getByRole('region', { name: 'Favorites' }).getByRole('link')).toHaveCount(4);
  await expect(row).toBeInViewport();
  expect(await page.getByRole('region', { name: 'Document content', exact: true }).evaluate(el => el.scrollTop)).toBe(0);
  // Opening or closing Favorites or Recent is the reader's own layout change: the explorer stays where they
  // left it rather than scrolling back to the document being read.
  const scroller = page.getByRole('navigation', { name: 'Document tree', exact: true });
  await scroller.evaluate(el => { el.scrollTop = 0; });
  await expect(row).not.toBeInViewport();
  for (const name of ['Favorites', 'Recent']) {
    const toggle = page.getByRole('button', { name, exact: true });
    if (await toggle.count() === 0) continue;
    for (let i = 0; i < 2; i++) {
      await toggle.click();
      await page.waitForTimeout(150);
      expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
    }
  }
});
