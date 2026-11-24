import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions, selectPassage } from "./fixtures/document-review";

// Inline review spec, 2026-11-24 amendment (failures say what to do; Cancel asks before words go).
test("a failed post says so as an error and keeps the text; Cancel asks before discarding it", async ({ page, request }) => {
  const doc = await createReviewDocument(request, "A first passage to review.\n\nA second paragraph here.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await openReviewDiscussions(page);
  await page.route("**/api/share-review/threads", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "Something went wrong." } }) }));
  await selectPassage(page, "first");
  await page.getByRole("button", { name: "Comment on selection" }).click();
  const box = page.getByRole("textbox", { name: "Add comment" });
  await box.fill("Worth keeping");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Couldn't post your comment." });
  await expect(alert).toHaveText("Couldn't post your comment. Something went wrong. Try again.");
  await expect(alert).toHaveClass(/text-kh-danger/);
  await expect(box).toHaveValue("Worth keeping");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const question = page.getByRole("alertdialog", { name: "Discard this comment?" });
  await expect(question).toBeVisible();
  // The safe answer holds focus; Escape answers no, and leaves the rail open.
  await expect(question.getByRole("button", { name: "Keep writing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(box).toHaveValue("Worth keeping");
  await expect(page.getByRole("complementary", { name: "Document comments" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard comment" }).click();
  await expect(box).toHaveCount(0);
});

test("where the document changed, Refresh page reads it again", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The first reading of the discussions names a newer revision than the page shows.
  let changed = true;
  await page.route("**/api/share-review/threads/query", async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: changed ? { ...body, revisionId: "0199f300-0000-7000-8000-00000000ffff" } : body });
  });
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  const refresh = page.getByRole("button", { name: "Refresh page" }).filter({ visible: true });
  await expect(refresh).toHaveCount(1);
  changed = false;
  await Promise.all([page.waitForEvent("load"), refresh.click()]);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await expect(page.getByText("Document changed.", { exact: false })).toHaveCount(0);
});

test("where the discussions could not be read, the open panel offers Retry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  await page.setViewportSize({ width: 1440, height: 900 });
  let failing = true;
  await page.route("**/api/share-review/threads/query", route => failing ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "x" } }) }) : route.fallback());
  await page.goto(`${phase3Origin("viewer")}${doc.links[0].path}`);
  await expect(page.locator(".kh-review-document")).toHaveAttribute("data-review-ready", "");
  await page.getByRole("button", { name: /^Show comments/ }).click();
  const panel = page.getByRole("complementary", { name: "Document comments" });
  await expect(panel).toContainText("Comments are unavailable.");
  failing = false;
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel).not.toContainText("Comments are unavailable.");
  await expect(panel).toContainText("No comments yet.");
});
