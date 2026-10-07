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
