import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

const anchor = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." };

test("⌘Enter sends a comment, a reply and an edit; Esc leaves an edit nothing was changed in", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await selectPassage(page); await page.getByRole("button", { name: "Comment on selection" }).first().click();
  const thread = page.locator("[data-review-thread]").filter({ visible: true });

  // An empty form's button is disabled, and the key does what the button would: nothing.
  const composer = page.getByRole("textbox", { name: "Add comment" });
  await composer.press("ControlOrMeta+Enter");
  await expect(thread).toHaveCount(0);
  await composer.fill("Sent by key"); await composer.press("ControlOrMeta+Enter");
  await expect(thread.getByText("Sent by key", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment", exact: true })).toHaveCount(0);

  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("textbox", { name: "Reply", exact: true });
  // Enter alone is a line of the comment, as it was.
  await reply.fill("Reply line one"); await reply.press("Enter"); await reply.pressSequentially("line two");
  await expect(reply).toHaveValue("Reply line one\nline two");
  await expect(page.getByRole("button", { name: "Reply", exact: true })).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
  await reply.press("ControlOrMeta+Enter");
  await expect(thread.getByText("Reply line one\nline two", { exact: true })).toBeVisible();

  const edit = async () => { await thread.getByRole("button", { name: "Comment options", exact: true }).click(); await page.getByRole("menuitem", { name: "Edit", exact: true }).click(); };
  const editor = page.getByRole("textbox", { name: "Edit comment", exact: true });
  // Nothing changed: Esc leaves the edit, and only the edit — the rail stays.
  await edit(); await expect(editor).toBeFocused();
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(thread.getByText("Sent by key", { exact: true })).toBeVisible();
  // Something changed: Esc discards nothing.
  await edit(); await editor.fill("Sent by key, revised"); await editor.press("Escape");
  await expect(editor).toHaveValue("Sent by key, revised");
  await editor.press("ControlOrMeta+Enter");
  await expect(thread.getByText("Sent by key, revised", { exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
});

test("D leaves discussions unchanged; explicit buttons open and close them", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const token = doc.links[0].path.split("/").pop();
  const viewer = phase3Origin("viewer");
  expect((await request.post(`${viewer}/api/share-review/threads`, { headers: { Origin: viewer }, data: { token, expectedRevisionId: doc.revisionId, anchor, body: "Reader question", idempotencyKey: crypto.randomUUID() } })).status()).toBe(201);

  await page.goto(`${viewer}${doc.links[0].path}`);
  const entry = page.getByRole("button", { name: /^(Open|Hide) discussions/ });
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(entry).not.toHaveAttribute("aria-keyshortcuts");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  await page.locator("body").press("d"); await expect(entry).toHaveAttribute("aria-expanded", "false");
  await entry.click();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  // In a field it is the letter.
  await page.locator("[data-review-thread]").filter({ visible: true }).getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("textbox", { name: "Reply", exact: true });
  await reply.pressSequentially("added"); await expect(reply).toHaveValue("added");
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await page.locator("[data-review-document]").click();
  await page.keyboard.press("d"); await expect(entry).toHaveAttribute("aria-expanded", "true");
  await entry.click();
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  // With a modifier it is the browser's own key, not this one.
  await page.keyboard.press("Shift+D"); await expect(entry).toHaveAttribute("aria-expanded", "false");

  await page.goto(doc.href);
  const owner = page.getByRole("button", { name: /^(Open|Hide) discussions/ });
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(owner).not.toHaveAttribute("aria-keyshortcuts");
  await expect(owner).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-review-document]").click();
  await page.keyboard.press("d");
  await expect(owner).toHaveAttribute("aria-expanded", "false");
  await owner.click();
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-open", "");
});
