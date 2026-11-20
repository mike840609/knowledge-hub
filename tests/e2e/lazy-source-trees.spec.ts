import { expect, test } from "./fixtures/test";

const workspace = "0199f100-0000-7000-8000-000000000001";
const source = "0199f100-0000-7000-8000-000000000101";
const otherSource = "0199f100-0000-7000-8000-000000000105";
const trees = `/api/workspaces/${workspace}/sources/`;

test("source trees load on expansion, retry failures and reuse loaded results", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(trees) && path.endsWith("/tree")) requests.push(path);
  });
  await page.goto(`/w/${workspace}/knowledge/${source}`, { waitUntil: "networkidle" });
  const explorer = page.getByRole("complementary", { name: "Knowledge explorer" });
  await expect(explorer.getByRole("treeitem", { name: "Architecture", exact: true })).toBeVisible();
  const other = explorer.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
  await expect(other).toHaveAttribute("aria-expanded", "false");
  expect(requests).toEqual([`${trees}${source}/tree`]);

  const otherTree = `${trees}${otherSource}/tree`;
  await page.route(`**${otherTree}`, route => route.fulfill({ status: 503, json: {} }), { times: 1 });
  await other.click();
  await expect(explorer.getByText("Documents could not be loaded.")).toBeVisible();
  await explorer.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(explorer.getByRole("treeitem", { name: "Compliance Policy", exact: true })).toBeVisible();
  await expect(explorer.getByText("Documents could not be loaded.")).toHaveCount(0);
  expect(requests.filter(path => path === otherTree)).toHaveLength(2);

  await other.click();
  await other.click();
  await expect(other).toHaveAttribute("aria-expanded", "true");
  await expect(explorer.getByRole("treeitem", { name: "Compliance Policy", exact: true })).toBeVisible();
  expect(requests.filter(path => path === otherTree)).toHaveLength(2);
  await explorer.getByRole("button", { name: "Filter tree: documents and sources" }).click();
  await explorer.getByPlaceholder("Filter documents and sources").fill("Runbooks");
  await expect(explorer.getByRole("treeitem", { name: "Runbooks", exact: true })).toBeVisible();
});
