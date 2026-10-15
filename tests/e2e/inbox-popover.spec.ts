import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("desktop Inbox fits the 176px sidebar header as a popover, not a navigation row", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.locator("aside").first();
  await expect(sidebar).toBeVisible();
  const bounds = await sidebar.boundingBox();
  expect(bounds?.width).toBe(176);
  await expect(sidebar.getByText("Knowledge Hub", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Inbox" })).toHaveCount(0);

  const icon = sidebar.getByRole("button", { name: /Inbox/ });
  const brand = sidebar.getByText("Knowledge Hub", { exact: true });
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation" });
  const [brandBox, inboxBox, collapseBox] = await Promise.all([brand.boundingBox(), icon.boundingBox(), collapse.boundingBox()]);
  expect(brandBox && inboxBox && collapseBox).toBeTruthy();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(inboxBox!.x + 1);
  expect(inboxBox!.x + inboxBox!.width).toBeLessThanOrEqual(collapseBox!.x + 1);
  expect(collapseBox!.x + collapseBox!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  await icon.click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/home$`));
  await expect(page.getByRole("link", { name: "View all activity" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toHaveCount(0);

  await icon.click();
  await page.getByRole("link", { name: "View all activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
});

test("mobile has the same Inbox popover in topbar", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  const icon = page.getByRole("banner").getByRole("button", { name: /Inbox/ });
  await icon.click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/home$`));
});
