import { expect, test } from './fixtures/test';
import { personalWorkspaceId } from './fixtures/my-space';

// A laptop with the explorer open (an 816-902px pane): commenting on a passage far down the document
// opens the composer in the rail beside it, not in a drawer over it, and the page stays where it was
// (owner-comments-rail spec, 2026-10-28 amendment).
for (const width of [1280, 1366, 1600])
  test(`commenting on a selection at ${width}px opens the composer beside it without moving the page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const workspaceId = await personalWorkspaceId(page);
    const markdown = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} with some words to select.`).join('\n\n');
    const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: `Comment beside ${Date.now()}`, markdown } });
    expect(response.ok()).toBe(true);
    const doc = await response.json() as { sourceId: string; documentId: string };
    await page.goto(`/w/${workspaceId}/knowledge/${doc.sourceId}/${doc.documentId}`);
    const editor = page.getByRole('textbox', { name: 'Content', exact: true });
    await expect(editor).toBeEditable({ timeout: 15_000 });
    await expect(page.locator('.kh-review-document')).toHaveAttribute('data-review-ready', '');
    const paragraph = editor.locator('p').nth(40);
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.dblclick({ position: { x: 40, y: 8 } });
    const before = (await paragraph.boundingBox())!.y;
    const comment = page.locator('.kh-selection-toolbar[data-show="true"]').getByRole('button', { name: 'Comment on selection' });
    await expect(comment).toBeVisible();
    // By the pointer, as a person clicks: locator.click() scrolls its target into view again when the
    // page reflows under it, which is a jump the test would make itself.
    const at = (await comment.boundingBox())!;
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    const draft = page.locator('[data-review-rail] [data-review-draft]');
    await expect(draft.getByRole('textbox', { name: 'Add comment' })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The document saves before the comment can be sent; a late jump is still a jump.
    await expect(page.getByText('Saving document before commenting…')).toHaveCount(0);
    const [line, box] = await Promise.all([paragraph.boundingBox(), draft.boundingBox()]);
    expect(Math.abs(line!.y - before)).toBeLessThan(2);
    expect(Math.abs(box!.y - line!.y)).toBeLessThan(40);
    expect(box!.x).toBeGreaterThan(line!.x + line!.width);
  });
