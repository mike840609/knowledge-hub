import { expect, test } from "./fixtures/test";
import { createReviewDocument } from "./fixtures/document-review";
import { phase3Origin } from "./fixtures/phase3-identities";

test("keeps one header and one tab bar across tabs and Back", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  await expect(page.getByRole("heading", { name: "Shares", exact: true })).toHaveCount(1);
  const nav = page.getByRole("navigation", { name: "Shares sections" });
  await expect(nav).toHaveCount(1);

  await nav.getByRole("link", { name: "Saved shares", exact: true }).click();
  await expect(page).toHaveURL(/tab=saved/);
  await expect(nav.getByRole("link", { name: "Saved shares", exact: true })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: /^Discussions/ }).click();
  await expect(page).toHaveURL(/tab=discussions/);
  await expect(nav.getByRole("link", { name: /^Discussions/ })).toHaveAttribute("aria-current", "page");

  await page.goBack();
  await page.goBack();
  await expect(nav.getByRole("link", { name: "My shares", exact: true })).toHaveAttribute("aria-current", "page");
});

test("an unknown tab falls back to My shares with the validation alert", async ({ page, request }) => {
  const navigation = await (await request.get(`${phase3Origin("reviewOwner")}/api/workspaces`)).json();
  const ws = navigation.items.find((item: { type: string }) => item.type === "PERSONAL").id;
  await page.goto(`${phase3Origin("reviewOwner")}/w/${ws}/shares?tab=nope`);
  await expect(page.getByRole("alert").filter({ hasText: "Choose My shares" })).toHaveText("Choose My shares, Saved shares or Discussions.");
  await expect(page.getByRole("navigation", { name: "Shares sections" }).getByRole("link", { name: "My shares", exact: true }))
    .toHaveAttribute("aria-current", "page");
});

test("live search keeps the toolbar and the input's focus", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const input = page.getByLabel("Find shares", { exact: true });
  await input.fill("guide");
  await expect(page).toHaveURL(/q=guide/);
  await expect(input).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Shares sections" })).toHaveCount(1);
});

test("a row's rule sits below its subtitle, and its actions wait for hover", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const row = page.getByRole("list", { name: "Share links" }).getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Copy link for/ }) }).first();
  const copy = row.getByRole("button", { name: /^Copy link for/ });
  expect(await copy.evaluate(node => getComputedStyle(node).opacity)).toBe("0");
  const sub = row.locator("p").first();
  const rowBox = (await row.boundingBox())!, subBox = (await sub.boundingBox())!;
  expect(subBox.y + subBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height - 1);
  await row.hover();
  await expect.poll(() => copy.evaluate(node => getComputedStyle(node).opacity)).toBe("1");
});

test("a phone keeps the search full width and the page inside the viewport", async ({ page, request }) => {
  const doc = await createReviewDocument(request);
  const origin = phase3Origin("reviewOwner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/w/${doc.workspaceId}/shares`);
  const input = page.getByLabel("Find shares", { exact: true });
  const box = (await input.boundingBox())!;
  expect(box.width).toBeGreaterThan(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const count = page.getByRole("status").filter({ hasText: /shares$/ });
  if (await count.count()) {
    const countBox = (await count.boundingBox())!;
    expect(countBox.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
  await page.getByRole("link", { name: "Saved shares", exact: true }).click();
  await expect(page).toHaveURL(/tab=saved/);
  const saved = page.getByLabel("Find saved shares", { exact: true });
  expect((await saved.boundingBox())!.width).toBeGreaterThan(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
