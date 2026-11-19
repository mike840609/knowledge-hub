import { test, expect } from "./fixtures/test";
import { mkdir } from "node:fs/promises";

test("knowledge navigation stays distinct from document content in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/w/0199f100-0000-7000-8000-000000000001/search?q=SWFP");
  await page.locator("a[data-search-result]").first().click();
  const primary = page.getByRole("navigation", { name: "Primary", exact: true });
  const sidebar = page.locator("aside").filter({ has: primary });
  const explorer = sidebar.getByRole("complementary", { name: "Knowledge explorer", exact: true });
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
    const selected = explorer.getByRole("treeitem", { selected: true });
    await expect(primary.locator('a[aria-current="page"]')).toHaveCount(0);
    await expect(selected).toBeVisible();
    const [navBg, explorerBg, paneBg, selectionBg] = await sidebar.evaluate(element => {
      function surface(node: Element): string {
        const color = getComputedStyle(node).backgroundColor;
        return color === "rgba(0, 0, 0, 0)" && node.parentElement ? surface(node.parentElement) : color;
      }
      return [
        element.querySelector('nav[aria-label="Primary"]')!,
        element.querySelector('[aria-label="Knowledge explorer"]')!,
        document.querySelector('[data-document-pane]')!,
        element.querySelector('[aria-selected="true"]')!,
      ].map(surface);
    });
    expect(navBg).toBe(explorerBg);
    expect(explorerBg).not.toBe(paneBg);
    expect(selectionBg).not.toBe(explorerBg);
    if (theme === "Dark") {
      const brightness = (color: string) => color.match(/\d+/g)!.slice(0, 3).reduce((sum, channel) => sum + Number(channel), 0);
      expect(brightness(explorerBg)).toBeLessThan(brightness(paneBg));
    }
    if (output) await page.screenshot({ path: `${output}/${theme.toLowerCase()}.png`, animations: "disabled" });
  }
});
