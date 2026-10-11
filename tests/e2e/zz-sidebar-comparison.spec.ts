import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("knowledge navigation stays distinct from document content in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/w/0199f100-0000-7000-8000-000000000001/search?q=SWFP");
  await page.locator("a[data-search-result]").first().click();
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer", exact: true });
  await expect(explorer).toBeVisible();
  await expect(explorer).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("region", { name: "Document content" })).toBeVisible();
  const output = process.env.KM_SIDEBAR_SCREENSHOTS;
  if (output) await mkdir(output, { recursive: true });
  for (const theme of ["Light", "Dark"] as const) {
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    const surfaces = await explorer.evaluate(el => {
      const rail = document.querySelector('aside:not([aria-label="Knowledge explorer"])')!;
      const pane = document.querySelector('[data-document-pane]')!;
      return [rail, el, pane].map(node => getComputedStyle(node).backgroundColor);
    });
    expect(new Set(surfaces).size).toBe(3);
    if (theme === "Dark") {
      const brightness = surfaces.map(color => color.match(/\d+/g)!.slice(0, 3).reduce((sum, channel) => sum + Number(channel), 0));
      expect(brightness[0]).toBeLessThan(brightness[1]);
      expect(brightness[1]).toBeLessThan(brightness[2]);
    }
    const selection = page.locator('nav[aria-label="Primary"] a[aria-current="page"]');
    const selectedDocument = explorer.locator('[aria-selected="true"]');
    await expect(selection).toBeVisible();
    await expect(selectedDocument).toBeVisible();
    expect(await selection.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await selectedDocument.evaluate(el => getComputedStyle(el).backgroundColor));
    if (output) await page.screenshot({ path: `${output}/${theme.toLowerCase()}.png`, animations: "disabled" });
  }
});
