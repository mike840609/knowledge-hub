import { expect, test, type Page } from './fixtures/test';
import { personalWorkspaceId } from './fixtures/my-space';

// Opening or closing the comments rail keeps the reader's place: the passage commented on, else the
// first block in sight, stays where it was on screen (owner-comments-rail spec, 2026-10-28
// amendment "opening and closing hold the reader's place"). Opening it can move the article: the outline beside it is drawn above it instead, the
// column narrows and its text wraps again, and the column's margin slides for 120ms.
// Paragraphs wrap over several lines, so that rewrapping moves them.
const FILLER = 'words that run on long enough to wrap over several lines of the reading column, '.repeat(4);
const markdownOf = (headings: boolean) => Array.from({ length: 60 }, (_, i) =>
  `${headings && i % 10 === 0 ? `## Section ${i / 10 + 1}\n\n` : ''}Paragraph ${i + 1} ${FILLER}end.`).join('\n\n');

async function createDocument(page: Page, headings: boolean) {
  const workspaceId = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Comment beside ${Date.now()}`, markdown: markdownOf(headings) } });
  expect(response.ok()).toBe(true);
  const doc = await response.json() as { sourceId: string; documentId: string };
  return { ...doc, href: `/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}` };
}

async function openOwnerDocument(page: Page, width: number, headings: boolean) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto((await createDocument(page, headings)).href);
  const editor = page.getByRole('textbox', { name: 'Content', exact: true });
  await expect(editor).toBeEditable({ timeout: 15_000 });
  await expect(page.locator('.kh-review-document')).toHaveAttribute('data-review-ready', '');
  return editor;
}

/** By the pointer, as a person clicks: locator.click() scrolls its target into view again when the page reflows under it, which is a jump the test would make itself. */
async function press(page: Page, target: ReturnType<Page['locator']>) {
  const at = (await target.boundingBox())!;
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
}

/** Past the column's 120ms slide and the hold that follows it. */
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));

/** The index and top of the first block whose bottom is below `from` (the pinned bar's foot, or the pane's top). */
const firstInSight = (page: Page, from: number) => page.locator('[data-review-document]').evaluate((article, top) => {
  const blocks = Array.from(article.querySelectorAll<HTMLElement>('[data-review-path]'));
  const index = blocks.findIndex(block => block.getBoundingClientRect().bottom > top);
  return { index, top: blocks[index].getBoundingClientRect().top };
}, from);
const blockTop = (page: Page, index: number) => page.locator('[data-review-document] [data-review-path]').nth(index).evaluate(block => block.getBoundingClientRect().top);

for (const [width, headings] of [[1280, false], [1366, false], [1600, false], [1280, true], [1366, true], [1600, true]] as const)
  test(`commenting on a selection at ${width}px${headings ? ' beside an outline' : ''} opens the composer beside it without moving the page`, async ({ page }) => {
    const editor = await openOwnerDocument(page, width, headings);
    const paragraph = editor.locator('p').nth(40);
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.dblclick({ position: { x: 40, y: 8 } });
    const before = (await paragraph.boundingBox())!.y;
    const comment = page.locator('.kh-selection-toolbar[data-show="true"]').getByRole('button', { name: 'Comment on selection' });
    await expect(comment).toBeVisible();
    await press(page, comment);
    const draft = page.locator('[data-review-rail] [data-review-draft]');
    await expect(draft.getByRole('textbox', { name: 'Add comment' })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The document saves before the comment can be sent; a late jump is still a jump.
    await expect(page.getByText('Saving document before commenting…')).toHaveCount(0);
    await settle(page);
    const [line, box] = await Promise.all([paragraph.boundingBox(), draft.boundingBox()]);
    expect(Math.abs(line!.y - before)).toBeLessThan(2);
    expect(Math.abs(box!.y - line!.y)).toBeLessThan(40);
    expect(box!.x).toBeGreaterThan(line!.x + line!.width);
  });

test('a paragraph\'s own comment button keeps that paragraph in place, with nothing selected', async ({ page }) => {
  const editor = await openOwnerDocument(page, 1600, true);
  const paragraph = editor.locator('p').nth(40);
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.hover();
  const before = (await paragraph.boundingBox())!.y;
  const button = page.getByRole('button', { name: /^Comment on paragraph: Paragraph 41 / });
  await expect(button).toHaveCSS('opacity', '1');
  await press(page, button);
  const draft = page.locator('[data-review-rail] [data-review-draft]');
  await expect(draft.getByRole('textbox', { name: 'Add comment' })).toBeFocused();
  await expect(page.getByText('Saving document before commenting…')).toHaveCount(0);
  await settle(page);
  const [line, box] = await Promise.all([paragraph.boundingBox(), draft.boundingBox()]);
  expect(Math.abs(line!.y - before)).toBeLessThan(2);
  expect(Math.abs(box!.y - line!.y)).toBeLessThan(40);
});

test('closing the rail keeps the first block in sight where it was', async ({ page }) => {
  const editor = await openOwnerDocument(page, 1600, true);
  const paragraph = editor.locator('p').nth(40);
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.dblclick({ position: { x: 40, y: 8 } });
  await press(page, page.locator('.kh-selection-toolbar[data-show="true"]').getByRole('button', { name: 'Comment on selection' }));
  await expect(page.locator('[data-review-rail] [data-review-draft]').getByRole('textbox', { name: 'Add comment' })).toBeFocused();
  await expect(page.getByText('Saving document before commenting…')).toHaveCount(0);
  await settle(page);
  const paneTop = await page.locator('.kh-document-pane').evaluate(pane => pane.getBoundingClientRect().top);
  const sight = await firstInSight(page, paneTop);
  await press(page, page.getByRole('button', { name: 'Collapse discussions' }));
  await expect(page.locator('.kh-review-document')).not.toHaveAttribute('data-review-open', '');
  await settle(page);
  expect(Math.abs(await blockTop(page, sight.index) - sight.top)).toBeLessThan(2);
});

// A shared page scrolls the window, and its outline moves above the article below 88rem.
async function openSharedPage(page: Page, width: number) {
  const { documentId } = await createDocument(page, true);
  const shared = await page.request.post(`/api/documents/${documentId}/share-links`, { data: { label: 'no jump', expiresInDays: 1 } });
  expect(shared.status()).toBe(201);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(((await shared.json()) as { link: { path: string } }).link.path);
  await expect(page.locator('.kh-review-document')).toHaveAttribute('data-review-ready', '');
}
const PINNED_BAR = 57;
const openDiscussions = (page: Page) => page.getByRole('button', { name: /^Open discussions/ });

for (const width of [1280, 1600])
  test(`on a shared page at ${width}px, commenting on a selection keeps the passage in place`, async ({ page }) => {
    await openSharedPage(page, width);
    const paragraph = page.locator('[data-review-document] p').nth(40);
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.dblclick({ position: { x: 40, y: 8 } });
    const before = (await paragraph.boundingBox())!.y;
    const comment = page.locator('.kh-selection-bubble').getByRole('button', { name: 'Comment on selection' });
    await expect(comment).toBeVisible();
    await press(page, comment);
    const draft = page.locator('[data-review-rail] [data-review-draft]');
    await expect(draft.getByRole('textbox', { name: 'Add comment' })).toBeFocused();
    await settle(page);
    const [line, box] = await Promise.all([paragraph.boundingBox(), draft.boundingBox()]);
    expect(Math.abs(line!.y - before)).toBeLessThan(2);
    expect(Math.abs(box!.y - line!.y)).toBeLessThan(40);
  });

test('on a shared page, opening discussions mid-document keeps the first block in sight where it was', async ({ page }) => {
  await openSharedPage(page, 1280);
  await page.locator('[data-review-document] p').nth(40).scrollIntoViewIfNeeded();
  const sight = await firstInSight(page, PINNED_BAR);
  await press(page, openDiscussions(page));
  await expect(page.locator('.kh-review-document')).toHaveAttribute('data-review-open', '');
  await settle(page);
  expect(Math.abs(await blockTop(page, sight.index) - sight.top)).toBeLessThan(2);
});

test('on a shared page, opening discussions at the top leaves the outline it draws above the article in sight', async ({ page }) => {
  await openSharedPage(page, 1280);
  await press(page, openDiscussions(page));
  const disclosure = page.locator('.kh-share-outline summary', { hasText: 'On this page' });
  await expect(disclosure).toBeVisible();
  await settle(page);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await disclosure.boundingBox())!.y).toBeGreaterThanOrEqual(PINNED_BAR);
});
