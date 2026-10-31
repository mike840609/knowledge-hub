import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("the primary rail carries the only Inbox entry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.locator("aside").first();
  const inbox = sidebar.getByRole("link", { name: /^Inbox/ });
  await expect(inbox).toHaveCount(1);
  await expect(sidebar.getByRole("button", { name: /Inbox/ })).toHaveCount(0);

  const brand = sidebar.getByText("Knowledge Hub", { exact: true });
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation" });
  const [brandBox, collapseBox, sidebarBox] = await Promise.all([brand.boundingBox(), collapse.boundingBox(), sidebar.boundingBox()]);
  expect(brandBox && collapseBox && sidebarBox).toBeTruthy();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(collapseBox!.x + 1);
  expect(collapseBox!.x + collapseBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);

  await inbox.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
});

test("the collapsed rail and the narrow topbar keep one Inbox entry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await page.getByRole("button", { name: "Collapse navigation" }).click();

  const rail = page.locator("aside").first();
  await expect(rail.getByRole("link", { name: /^Inbox/ })).toHaveCount(1);
  await expect(rail.getByRole("button", { name: /Inbox/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await expect(page.getByRole("banner").getByRole("button", { name: /Inbox/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  const row = drawer.getByRole("link", { name: /^Inbox/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
});
