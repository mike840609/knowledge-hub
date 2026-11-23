import type { Page } from "@playwright/test";

export async function openKnowledgeDestinations(page: Page) {
  return page.getByRole("navigation", { name: "Knowledge destinations", exact: true });
}
