import type { Page } from "@playwright/test";

export async function openKnowledgeDestinations(page: Page) {
  await page.getByRole("button", { name: /^Knowledge(?: \/ (Graph|Sources|Shares))?$/ }).click();
  return page.getByRole("navigation", { name: "Knowledge destinations", exact: true });
}
