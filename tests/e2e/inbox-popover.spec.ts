import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";

test("desktop Inbox is a primary navigation row, with the header popover as its quick peek", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);

  const sidebar = page.locator("aside").first();
  await expect(sidebar).toBeVisible();
  const bounds = await sidebar.boundingBox();
  expect(bounds?.width).toBe(176);
  await expect(sidebar.getByText("Knowledge Hub", { exact: true })).toBeVisible();
  // The primary rail carries Inbox as a place (Linear's model); the header keeps
  // its popover as the quick peek at what arrived.
  await expect(sidebar.getByRole("link", { name: /^Inbox/ })).toBeVisible();

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

test("Inbox popup gives titles the full row width and keeps time in metadata on both tabs", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  const viewer = phase3Origin("viewer");
  const token = doc.links[0].path.split("/").pop();
  const queryResponse = await request.post(`${viewer}/api/share-review/threads/query`, {
    headers: { Origin: viewer }, data: { token },
  });
  expect(queryResponse.ok()).toBe(true);
  const query = await queryResponse.json();
  const created = await request.post(`${viewer}/api/share-review/threads`, {
    headers: { Origin: viewer },
    data: {
      token,
      expectedRevisionId: query.revisionId,
      anchor: { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." },
      body: "A comment to check the compact Inbox notification layout",
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await page.locator("aside").first().getByRole("button", { name: /Inbox/ }).click();

  async function expectCompactRow(listName: string) {
    const row = page.getByRole("list", { name: listName })
      .getByRole("link", { name: /A comment to check the compact Inbox notification layout/ });
    await expect(row).toBeVisible();
    const title = row.locator("[data-inbox-notification-title]");
    const time = row.locator("time");
    await expect(title).toBeVisible();
    await expect(time).toBeVisible();
    const titleBox = await title.boundingBox();
    const timeBox = await time.boundingBox();
    const rowBox = await row.boundingBox();
    expect(titleBox && timeBox && rowBox).toBeTruthy();
    // A timestamp must not squeeze the document title into a tiny first-line column.
    expect(timeBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    expect(timeBox!.x + timeBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width);
  }

  await expectCompactRow("Unread notifications");
  await page.getByRole("tab", { name: "All activity" }).click();
  await expectCompactRow("Recent notifications");

  // The same hierarchy must fit in the narrower mobile popover.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("banner").getByRole("button", { name: /Inbox/ }).click();
  await page.getByRole("tab", { name: "All activity" }).click();
  await expectCompactRow("Recent notifications");
});

test("desktop Inbox gives activity more vertical space while small screens stay bounded", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const owner = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${owner}/w/${doc.workspaceId}/home`);
  await page.locator("aside").first().getByRole("button", { name: /Inbox/ }).click();

  const scroll = page.locator("[data-inbox-scroll]");
  await expect(scroll).toBeVisible();
  // Eight desktop notifications should not be constrained by the old 24rem cap.
  await expect(scroll).toHaveCSS("max-height", "576px");
  await page.getByRole("tab", { name: "All activity" }).click();
  await expect(scroll).toHaveCSS("max-height", "576px");

  // Preserve room for the trigger, header, tabs and footer on shorter desktop viewports.
  await page.setViewportSize({ width: 1440, height: 600 });
  await expect(scroll).toHaveCSS("max-height", "376px");

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("banner").getByRole("button", { name: /Inbox/ }).click();
  await expect(scroll).toHaveCSS("max-height", "384px");
});
