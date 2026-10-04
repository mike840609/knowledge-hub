import { test, expect } from "@playwright/test";
import { stageReadingFolder } from "./fixtures/folder-reading";
test("folder preview → durable result → revision-aware personal reading", async ({
  page,
  request,
}) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const first = await stageReadingFolder(request, {
    workspaceId: ws,
    sourceName: "Reading workflow",
    fixture: "reading-flow-v1",
  });
  await page.goto(`/w/${ws}/sources/imports/${first}`);
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Folder synced" }),
  ).toBeVisible();
  const source = page.url().match(/sources\/([^/]+)\//)![1];
  await page.goto(`/w/${ws}/home`);
  await expect(page.getByText("Your local folder is the source of truth.", {exact:false})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByText("Last synced", {exact:false}).first()).toBeVisible();
  await page.goto(`/w/${ws}/sources`);
  await page.getByRole("link", {name:"Check source health"}).click();
  await page.getByRole("link", {name:"Reading workflow",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/sources/${source}/health$`));
  await page.goto(`/w/${ws}/sources/${source}/update`);
  await page.getByText("Excluded paths", {exact:true}).click();
  await page.getByRole("textbox",{name:"One file or folder path per line, relative to the selected folder"}).fill("private");
  await page.getByRole("button",{name:"Save exclusions"}).click();
  await expect(page.getByText("Saved on this browser.",{exact:false})).toBeVisible();
  await page.setViewportSize({width:1280,height:900});
  const second = await stageReadingFolder(request, {
    workspaceId: ws,
    sourceId: source,
    sourceName: "Reading workflow",
    fixture: "reading-flow-v2",
  });
  await page.goto(`/w/${ws}/sources/imports/${second}`);
  await page
    .getByRole("button", { name: /View changes:/ })
    .first()
    .click();
  await expect(
    page.getByText("New workflow: check, review, apply, and read.", {
      exact: false,
    }),
  ).toBeVisible();
  let lost = false;
  await page.route(`**/api/source-imports/${second}/apply`, async (route) => {
    if (lost) {
      await route.continue();
      return;
    }
    lost = true;
    const committed = await route.fetch();
    expect(committed.ok()).toBe(true);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
  await page.goto(`/w/${ws}/updates`);
  const article = page
    .getByRole("link", { name: /Updated team guide.*Unread/ })
    .first();
  await expect(article).toBeVisible();
  const marked = page.waitForResponse(
    (r) => r.url().endsWith("/read") && r.request().method() === "POST",
  );
  await article.click();
  expect((await marked).status()).toBe(204);
  await expect(
    page
      .getByRole("article")
      .getByText("New workflow: check, review, apply, and read."),
  ).toBeVisible();
  await page.goto(`/w/${ws}/updates`);
  await expect(
    page.getByRole("link", { name: /Updated team guide.*Read/ }),
  ).toBeVisible();
  const wrong = await stageReadingFolder(request, {
    workspaceId: ws,
    sourceId: source,
    sourceName: "Reading workflow",
    fixture: "wrong-folder",
  });
  await page.goto(`/w/${ws}/sources/imports/${wrong}`);
  await expect(
    page.getByRole("button", { name: "Apply changes" }),
  ).toBeDisabled();
  const bypass = await request.post(`/api/source-imports/${wrong}/apply`, {
    data: {},
  });
  expect((await bypass.json()).error.code).toBe(
    "IMPORT_RISK_CONFIRMATION_REQUIRED",
  );
  await page
    .getByRole("textbox", { name: "Confirm source name" })
    .fill("Reading workflow");
  await expect(
    page.getByRole("button", { name: "Apply changes" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]+$/);
  await expect(
    page.getByText("ARCHIVED", { exact: true }).first(),
  ).toBeVisible();
});
