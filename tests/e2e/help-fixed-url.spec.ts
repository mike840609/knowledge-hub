import { expect, test } from "./fixtures/test";
import { phase3Origin } from "./fixtures/phase3-identities";

const personalWorkspace = async (request: import("@playwright/test").APIRequestContext, origin: string) =>
  (await (await request.get(`${origin}/api/workspaces`)).json()).items.find((item: { type: string }) => item.type === "PERSONAL").id as string;

// The guides read the same for everyone, so they live at one address anyone signed in can be sent.
test("two people open the same guide address and read the same guide, each led into their own My Space", async ({ page, request }) => {
  for (const persona of ["owner", "viewer"] as const) {
    const origin = phase3Origin(persona);
    const ws = await personalWorkspace(request, origin);
    await page.goto(`${origin}/help`);
    await expect(page).toHaveURL(`${origin}/help`);
    await expect(page.getByRole("heading", { level: 1, name: "使用者操作手冊" })).toBeVisible();
    await expect(page.getByRole("link", { name: "開始匯入", exact: true })).toHaveAttribute("href", `/w/${ws}/sources/import`);
    await expect(page.getByRole("link", { name: "Markdown 格式、knowledge_id 與匯入限制", exact: true })).toHaveAttribute("href", "/help/import-guide?lang=zh-TW");
    await page.goto(`${origin}/help/import-guide`);
    await expect(page.getByRole("heading", { level: 1, name: "把你的維基帶進 Knowledge Hub" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try the sample wiki" })).toHaveAttribute("href", `/w/${ws}/sources/import#sample-wiki`);
  }
});

test("an old workspace guide link lands on the shared address, its language kept", async ({ page, request }) => {
  const ws = await personalWorkspace(request, "");
  await page.goto(`/w/${ws}/help?lang=en`);
  await expect(page).toHaveURL(/\/help\?lang=en$/);
  await expect(page.getByRole("heading", { level: 1, name: "User guide" })).toBeVisible();
  await page.goto(`/w/${ws}/sources/import/guide?lang=zh-TW`);
  await expect(page).toHaveURL(/\/help\/import-guide\?lang=zh-TW$/);
  await page.goto(`/w/${ws}/sources/import/guide`);
  await expect(page).toHaveURL(/\/help\/import-guide$/);
});

test("the account menu leads to the shared address", async ({ page, request }) => {
  const ws = await personalWorkspace(request, "");
  await page.goto(`/w/${ws}/home`);
  await page.getByRole("button", { name: /^Account:/ }).click();
  await expect(page.getByRole("menuitem", { name: "Help & guides", exact: true })).toHaveAttribute("href", "/help");
});
