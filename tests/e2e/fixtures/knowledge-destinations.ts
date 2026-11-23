import type { Page } from "@playwright/test";

/** Home, Graph, Sources and Shares: the page switch in the visible Primary navigation. */
export async function openKnowledgeDestinations(page: Page) {
  return page.getByRole("navigation", { name: "Primary", exact: true }).filter({ visible: true });
}
