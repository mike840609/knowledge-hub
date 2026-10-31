import { expect, test, type Page } from "./fixtures/test";
import { ROUND_TRIP, childrenOf, header, mySpace, openKnowledge, row, toast, unique } from "./fixtures/organize";

async function folder(page: Page, workspace: string, name: string, parentId?: string) {
  const response = await page.request.post(`/api/workspaces/${workspace}/folders`, { data: { name, ...(parentId ? { parentId } : {}) } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { treeNodeId: string }).treeNodeId;
}
async function document(page: Page, workspace: string, title: string, parentId: string) {
  const response = await page.request.post(`/api/workspaces/${workspace}/documents`, { data: { title, markdown: `Body of ${title}.`, parentId } });
  expect(response.status()).toBe(201);
}
function requests(page: Page) {
  let count = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().includes("/api/tree-nodes/")) count++; });
  return () => count;
}

test.describe("dragging rows @tree-drag", () => {
  test("reorders documents with one request", async ({ page }) => {
    const workspace = await mySpace(page); const guides = unique("Guides");
    const id = await folder(page, workspace, guides);
    const [a, b, c] = [unique("A"), unique("B"), unique("C")];
    for (const name of [a, b, c]) await document(page, workspace, name, id);
    await openKnowledge(page, workspace); const count = requests(page);
    await row(page, c).dragTo(row(page, b), { targetPosition: { x: 20, y: 2 } });
    await expect.poll(() => childrenOf(row(page, guides)), ROUND_TRIP).toEqual([a, c, b]);
    expect(count()).toBe(1);
  });
  test("moves into a folder and undoes the move", async ({ page }) => {
    const workspace = await mySpace(page); const guides = unique("Guides"); const dest = unique("Destination"); const name = unique("Document");
    const id = await folder(page, workspace, guides); await folder(page, workspace, dest, id); await document(page, workspace, name, id);
    await openKnowledge(page, workspace); const count = requests(page);
    const box = await header(page, dest).boundingBox(); expect(box).not.toBeNull();
    await row(page, name).dragTo(header(page, dest), { targetPosition: { x: 20, y: box!.height / 2 } });
    await expect.poll(() => childrenOf(row(page, dest)), ROUND_TRIP).toEqual([name]);
    expect(count()).toBe(1);
    await toast(page, `Moved “${name}” to “${dest}”.`).getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => childrenOf(row(page, guides)), ROUND_TRIP).toEqual([dest, name]);
  });
  test("places a folder above another and a document after its subtree", async ({ page }) => {
    const workspace = await mySpace(page); const guides = unique("Guides"); const g = unique("G"); const h = unique("H"); const a = unique("A"); const b = unique("B");
    const id = await folder(page, workspace, guides); await document(page, workspace, a, id);
    const gid = await folder(page, workspace, g, id); await folder(page, workspace, h, id); await document(page, workspace, b, gid); await openKnowledge(page, workspace);
    await header(page, h).dragTo(header(page, g), { targetPosition: { x: 20, y: 2 } });
    await expect.poll(() => childrenOf(row(page, guides)), ROUND_TRIP).toEqual([a, h, g]);
    const box = await header(page, g).boundingBox(); expect(box).not.toBeNull();
    await row(page, a).dragTo(header(page, g), { targetPosition: { x: 20, y: box!.height - 2 } });
    await expect.poll(() => childrenOf(row(page, guides)), ROUND_TRIP).toEqual([h, g, a]);
    expect(await childrenOf(row(page, g))).toEqual([b]);
  });
  test("hover opens a collapsed folder without a request, and clicking still opens a document", async ({ page }) => {
    const workspace = await mySpace(page); const guides = unique("Guides"); const g = unique("G"); const a = unique("A");
    const id = await folder(page, workspace, guides); await folder(page, workspace, g, id); await document(page, workspace, a, id);
    await openKnowledge(page, workspace); await header(page, g).click(); await expect(row(page, g)).toHaveAttribute("aria-expanded", "false");
    const count = requests(page); const source = await row(page, a).boundingBox(); const target = await header(page, g).boundingBox(); expect(source && target).toBeTruthy();
    await page.mouse.move(source!.x + 20, source!.y + source!.height / 2); await page.mouse.down();
    await page.mouse.move(target!.x + 20, target!.y + target!.height / 2, { steps: 10 });
    await expect(row(page, g)).toHaveAttribute("aria-expanded", "true", ROUND_TRIP);
    await page.keyboard.press("Escape"); await page.mouse.up(); expect(count()).toBe(0);
    await row(page, a).click(); await expect(row(page, a)).toHaveAttribute("aria-current", "page", ROUND_TRIP);
  });
  test("dropping into a collapsed folder opens it", async ({ page }) => {
    const workspace = await mySpace(page); const guides = unique("Guides"); const g = unique("G"); const a = unique("A");
    const id = await folder(page, workspace, guides); await folder(page, workspace, g, id); await document(page, workspace, a, id);
    await openKnowledge(page, workspace); await header(page, g).click(); await expect(row(page, g)).toHaveAttribute("aria-expanded", "false");
    const box = await header(page, g).boundingBox(); expect(box).not.toBeNull();
    await row(page, a).dragTo(header(page, g), { targetPosition: { x: 20, y: box!.height / 2 } });
    await expect(row(page, g)).toHaveAttribute("aria-expanded", "true", ROUND_TRIP);
    await expect.poll(() => childrenOf(row(page, g)), ROUND_TRIP).toEqual([a]);
  });
  test("does not offer drag in a synced source", async ({ page }) => {
    await page.goto("/w/0199f100-0000-7000-8000-000000000001/knowledge/0199f100-0000-7000-8000-000000000101");
    const vault = page.getByRole("button", { name: "Vendor Compliance Vault", exact: true });
    await expect(vault).toBeVisible(ROUND_TRIP); if (await vault.getAttribute("aria-expanded") !== "true") await vault.click();
    await expect(row(page, "Compliance Policy")).toHaveAttribute("draggable", "false", ROUND_TRIP);
  });
});
