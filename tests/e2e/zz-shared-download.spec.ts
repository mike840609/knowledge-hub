import { expect, test, type Page } from "./fixtures/test";
import { ROUND_TRIP, mySpace, unique } from "./fixtures/organize";
import { phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

/**
 * Download Markdown on shared pages, end to end: what an anonymous reader downloads from a document
 * link, and from a folder link after moving to another document, is what the owner's ordinary export
 * returns. The anonymous reader is a fresh context on phase3UnconfiguredOrigin() (no sign-in exists).
 */
test.describe("shared download markdown", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT && process.env.KM_E2E_UNCONFIGURED_SERVER !== "true", "Run npm run test:e2e to provision the no-sign-in origin.");

  async function apiFolder(page: Page, workspaceId: string, name: string) {
    const response = await page.request.post(`/api/workspaces/${workspaceId}/folders`, { data: { name, parentId: null } });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { treeNodeId: string }).treeNodeId;
  }

  /** A document with `metadata` is created as an upload, whose frontmatter becomes its metadata (the title is the H1). */
  async function apiDocument(page: Page, workspaceId: string, title: string, markdown: string, parentId: string, frontmatter?: string) {
    const data = frontmatter === undefined ? { title, markdown, parentId } : { filename: `${title}.md`, markdown: `---\n${frontmatter}---\n\n# ${title}\n\n${markdown}`, parentId };
    const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { documentId: string }).documentId;
  }

  async function shareLink(page: Page, url: string) {
    const response = await page.request.post(url, { data: {} });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { link: { path: string } }).link.path;
  }

  async function exportOf(page: Page, documentId: string) {
    const response = await page.request.get(`/api/documents/${documentId}/export`);
    expect(response.status()).toBe(200);
    return response.text();
  }

  async function download(reader: Page, url: string) {
    await reader.goto(url);
    const button = reader.getByRole("button", { name: "Download Markdown" });
    await expect(button).toBeVisible(ROUND_TRIP);
    const [file] = await Promise.all([reader.waitForEvent("download"), button.click()]);
    const path = await file.path();
    const { readFile } = await import("node:fs/promises");
    return { name: file.suggestedFilename(), text: await readFile(path, "utf8") };
  }

  test("a document link and a folder link each download what the owner's export holds", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const workspaceId = await mySpace(page);
    const folderId = await apiFolder(page, workspaceId, unique("Download F"));
    const firstTitle = unique("First");
    const secondTitle = unique("Second");
    const first = await apiDocument(page, workspaceId, firstTitle, "First body.", folderId);
    const second = await apiDocument(page, workspaceId, secondTitle, "Second body.", folderId, "tags:\n  - ops\nnested:\n  a: 1\n");
    const documentLink = await shareLink(page, `/api/documents/${first}/share-links`);
    const folderLink = await shareLink(page, `/api/tree-nodes/${folderId}/share-links`);
    const base = phase3UnconfiguredOrigin();

    const anonymous = await browser.newContext();
    try {
      const reader = await anonymous.newPage();
      const single = await download(reader, `${base}${documentLink}`);
      expect(single.name).toBe(`${firstTitle}.md`);
      expect(single.text).toBe(await exportOf(page, first));

      const other = await download(reader, `${base}${folderLink}?d=${second}`);
      expect(other.name).toBe(`${secondTitle}.md`);
      expect(other.text).toBe(await exportOf(page, second));
      expect(other.text).toContain("nested:");
    } finally {
      await anonymous.close();
    }
  });
});
