import { test, expect } from "./fixtures/test";

test.skip(process.env.KM_TEAM_WORKSPACES_ENABLED !== "false", "Runs with the personal-only rollout.");

test("a draft survives archiving and can be restored from Home", { tag: "@smoke-personal" }, async ({ page }) => {
  await page.goto("/");
  const navigation = await (await page.request.get("/api/workspaces")).json();
  const workspaceId = navigation.items[0].id;
  const created = await page.request.post(`/api/workspaces/${workspaceId}/documents`, {
    data: { title: "Draft recovery", markdown: "Original body" },
  });
  expect(created.ok()).toBe(true);
  const document = await created.json();

  const draft = await page.request.put(`/api/workspaces/${workspaceId}/personal`, {
    data: {
      key: `draft:${document.documentId}`,
      value: { title: "Draft recovery", markdown: "Unsaved draft body", baseRevisionId: null },
      version: 0,
    },
  });
  expect(draft.ok()).toBe(true);

  const archived = await page.request.post(`/api/documents/${document.documentId}/archive`);
  expect(archived.ok()).toBe(true);

  await page.goto(`/w/${workspaceId}/home`);
  const drafts = page.getByRole("region", { name: "Drafts", exact: true });
  const row = drafts.getByRole("link").filter({ has: page.getByText("Draft recovery", { exact: true }) });
  await expect(row).toHaveAttribute("href", `/w/${workspaceId}/knowledge/drafts/${document.sourceId}/${document.documentId}`);
  await row.click();
  await expect(page.getByText("Unsaved draft body", { exact: true })).toBeVisible();
  await expect(page.getByText("The original document is archived", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Restore document", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${document.documentId}$`));
  await expect(page.getByRole("textbox", { name: "Content", exact: true })).toBeEditable();
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown", exact: true })).toHaveValue("Unsaved draft body");
});
