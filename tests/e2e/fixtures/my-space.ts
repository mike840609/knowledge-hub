import { expect, type Page } from "@playwright/test";

/** Resolve fixture setup's workspace without visiting the landing page. */
export async function personalWorkspaceId(page: Page): Promise<string> {
  const response = await page.request.get("/api/workspaces");
  expect(response.ok()).toBe(true);
  const navigation = await response.json() as { items: { id: string; type: string }[] };
  const workspace = navigation.items.find((item) => item.type === "PERSONAL");
  if (!workspace) throw new Error("Personal workspace not found in navigation");
  return workspace.id;
}

/**
 * Wait until opening a document has been recorded in this device's Recent list. The explorer records the open
 * only once its lazily loaded tree holds the document, which can land after the title is on screen; leaving
 * the page before then records nothing.
 */
export async function recordedAsRecent(page: Page, documentId: string): Promise<void> {
  await expect.poll(() => page.evaluate((id) => Object.keys(localStorage).some((key) =>
    key.startsWith("kh:document-shortcuts:") && (localStorage.getItem(key) ?? "").includes(`:${id}"`)), documentId),
  { timeout: 15_000 }).toBe(true);
}
