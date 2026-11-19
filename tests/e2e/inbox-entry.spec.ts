import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("the expanded sidebar puts Inbox beside collapse and gives Search a row", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.route("**/api/review-notifications/unread-count", (route) => route.fulfill({ json: { count: 7 } }));
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const inbox = sidebar.getByRole("link", { name: "Inbox, 7 unread", exact: true });
  await expect(inbox).toHaveText("7");
  await expect(sidebar.getByRole("link", { name: /^Inbox/ })).toHaveCount(1);
  await expect(sidebar.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: /Inbox/ })).toHaveCount(0);
  const search = sidebar.getByRole("button", { name: "Search ⌘K", exact: true });
  await expect(search.getByText("Search", { exact: true })).toBeVisible();
  await expect(search.getByText("⌘K", { exact: true })).toBeVisible();

  const brand = sidebar.getByText("Knowledge Hub", { exact: true });
  const collapse = sidebar.getByRole("button", { name: "Collapse navigation" });
  const [brandBox, inboxBox, collapseBox, sidebarBox] = await Promise.all([
    brand.boundingBox(), inbox.boundingBox(), collapse.boundingBox(), sidebar.boundingBox(),
  ]);
  expect(brandBox && inboxBox && collapseBox && sidebarBox).toBeTruthy();
  expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(inboxBox!.x + 1);
  expect(inboxBox!.x + inboxBox!.width).toBeLessThanOrEqual(collapseBox!.x + 1);
  expect(Math.abs(inboxBox!.y + inboxBox!.height / 2 - collapseBox!.y - collapseBox!.height / 2)).toBeLessThanOrEqual(1);
  expect(collapseBox!.x + collapseBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);

  await inbox.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(inbox).toHaveAttribute("aria-current", "page");

  await inbox.focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ })).toBeFocused();
  await page.setViewportSize({ width: 1512, height: 900 });
  await expect(inbox).toBeFocused();
  await expect(sidebar.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
});

test("entering Inbox at 1440px carries focus from the header to the rail", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  await sidebar.getByRole("link", { name: /^Inbox/ }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
  const railInbox = sidebar.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ });
  await expect(railInbox).toHaveAttribute("aria-current", "page");
  await expect(railInbox).toBeFocused();
});

test("opening the Inbox from its filtered view closes Menu and returns focus", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const inbox = `${phase3Origin("reviewOwner")}/w/${doc.workspaceId}/inbox`;
  for (const [width, opener] of [[1440, "Expand navigation"], [390, "Open menu"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${inbox}?kind=mention`);
    const trigger = page.getByRole("button", { name: opener, exact: true });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await menu.getByRole("link", { name: /^Inbox/ }).press("Enter");
    await expect(page).toHaveURL(inbox);
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("the collapsed rail and the phone Menu keep one Inbox entry", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  const rail = page.getByRole("complementary", { name: "Workspace navigation" });
  await rail.getByRole("link", { name: /^Inbox/ }).focus();
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(rail.getByRole("button", { name: "Expand navigation" })).toBeFocused();
  await expect(rail.getByRole("link", { name: /^Inbox/ })).toHaveCount(1);
  await expect(rail.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Inbox/ })).toBeVisible();
  await expect(rail.getByRole("button", { name: /Inbox/ })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await expect(page.getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  const row = drawer.getByRole("link", { name: /^Inbox/ });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Inbox", { exact: true })).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/w/${doc.workspaceId}/inbox$`));
});
