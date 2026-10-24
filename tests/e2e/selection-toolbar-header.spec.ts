import { expect, test, type Locator, type Page } from './fixtures/test';
import { personalWorkspaceId } from './fixtures/my-space';

// The selection toolbar opens above the selection. Above the first line is the document's header, not
// free space: the toolbar must not land on "Updated …" there, and must still open above when there is room.
async function openDocument(page: Page, markdown: string): Promise<Locator> {
  const workspaceId = await personalWorkspaceId(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Toolbar header ${Date.now()}`, markdown } });
  expect(response.ok()).toBe(true);
  const doc = await response.json() as { sourceId: string; documentId: string };
  await page.goto(`/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}`);
  const editor = page.getByRole('textbox', { name: 'Content', exact: true });
  await expect(editor).toBeEditable({ timeout: 15_000 });
  return editor;
}

async function selectWordIn(paragraph: Locator) {
  await paragraph.dblclick({ position: { x: 40, y: 8 } });
}

test('the selection toolbar on the first line leaves the Updated line visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await openDocument(page, 'First paragraph you are editing.\n\nSecond paragraph.');
  const paragraph = editor.locator('p').first();
  await selectWordIn(paragraph);
  const toolbar = page.locator('.kh-selection-toolbar[data-show="true"]');
  await expect(toolbar).toBeVisible();
  const updated = page.locator('main header time').filter({ hasText: /^Updated/ });
  const [bar, time, line] = await Promise.all([toolbar.boundingBox(), updated.boundingBox(), paragraph.boundingBox()]);
  expect(bar && time && line).toBeTruthy();
  expect(bar!.y).toBeGreaterThanOrEqual(time!.y + time!.height);
  expect(bar!.y).toBeGreaterThanOrEqual(line!.y);
});

test('the selection toolbar stays inside the scrolled pane when the selection is at its top', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 }); // narrow: the topbar sits above the pane
  const editor = await openDocument(page, Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} with some words.`).join('\n\n'));
  const paragraph = editor.locator('p').nth(20);
  const pane = page.getByRole('region', { name: 'Document content' });
  await editor.locator('p').nth(30).click();
  // Scroll the paragraph to 10px below the pane's top, under the pinned line, and select a word in it
  // as the keyboard would (no pointer reaches it there). The editor runs on above it, out of sight.
  await paragraph.evaluate((element) => {
    const scroller = element.closest('[role="region"][aria-label="Document content"]')!;
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 10;
    const text = element.firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 0, text, 9);
  });
  const toolbar = page.locator('.kh-selection-toolbar[data-show="true"]');
  await expect(toolbar).toBeVisible();
  const [bar, box] = await Promise.all([toolbar.boundingBox(), pane.boundingBox()]);
  expect(bar!.y).toBeGreaterThanOrEqual(box!.y);
});

test('the selection toolbar still opens above a selection with room above it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = await openDocument(page, ['One.', 'Two.', 'Three.', 'Four.', 'Five paragraph with room above.'].join('\n\n'));
  const paragraph = editor.locator('p').nth(4);
  await selectWordIn(paragraph);
  const toolbar = page.locator('.kh-selection-toolbar[data-show="true"]');
  await expect(toolbar).toBeVisible();
  const [bar, line] = await Promise.all([toolbar.boundingBox(), paragraph.boundingBox()]);
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(line!.y);
});
