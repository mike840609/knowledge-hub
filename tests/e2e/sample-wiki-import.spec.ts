import { expect, test, type Page } from "@playwright/test";

// The sample wiki goes through the same flow as a picked folder (fetch in the
// browser, then Preview, then Apply); nothing here stubs a request.
const ROUND_TRIP = { timeout: 15_000 };

const SAMPLES = [
  {
    button: "English",
    sourceName: "Sample wiki",
    indexTitle: "Team handbook",
    indexLink: "handbook/onboarding",
    onboardingTitle: "Onboarding",
    anchorLink: "how to request leave",
    anchorHash: "#how-to-request-leave",
    anchorTargetTitle: "Leave policy",
  },
  {
    button: "繁體中文",
    sourceName: "範例知識庫",
    indexTitle: "團隊手冊",
    indexLink: "handbook/onboarding",
    onboardingTitle: "新人報到",
    anchorLink: "怎麼申請請假",
    anchorHash: "#請假流程",
    anchorTargetTitle: "請假規定",
  },
];

async function personalWorkspaceId(page: Page): Promise<string> {
  const nav = await (await page.request.get("/api/workspaces")).json();
  return nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
}

for (const sample of SAMPLES) {
  test(`sample wiki (${sample.button}): Preview, Apply, then links resolve by a real click`, async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import`);
    await page.getByRole("group", { name: "Try with a sample wiki" }).getByRole("button", { name: sample.button, exact: true }).click();

    // Preview: seven documents, and exactly one warning, the title conflict.
    await expect(page).toHaveURL(/\/sources\/imports\//, ROUND_TRIP);
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByText(/^7 added · \d+ updated/).first()).toBeVisible();
    await expect(page.getByText("1 warnings · 0 blockers")).toBeVisible();
    const warnings = page.getByRole("region", { name: /^Warnings \(1\)/ });
    await expect(warnings.getByRole("listitem")).toHaveCount(1);
    await expect(warnings).toContainText("handbook/title-mismatch.md");
    await expect(warnings).toContainText("frontmatter.title differs from the first H1");

    // Apply, then read the source this run created (by id, not an assumed-empty workspace).
    await page.getByRole("button", { name: "Apply changes" }).click();
    await expect(page).toHaveURL(/\/runs\//, ROUND_TRIP);
    const sourceId = page.url().match(/sources\/([^/]+)\//)![1];
    await page.goto(`/w/${ws}/sources/${sourceId}`);
    await expect(page.getByRole("heading", { level: 1, name: sample.sourceName, exact: true })).toBeVisible(ROUND_TRIP);
    await page.getByRole("link", { name: "Browse documents" }).click();
    const documentLinks = page.getByRole("tree", { name: "Knowledge tree" }).locator(`a[href*="/knowledge/${sourceId}/"]`);
    await expect(documentLinks).toHaveCount(7, ROUND_TRIP);

    // index: a real click on its wikilink (rendered as the text it was written with) to the onboarding page.
    const tree = page.getByRole("tree", { name: "Knowledge tree" });
    await tree.getByRole("treeitem", { name: sample.indexTitle, exact: true }).locator("a").first().click();
    const article = page.locator("article").first();
    await article.getByRole("link", { name: sample.indexLink, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: sample.onboardingTitle, exact: true })).toBeVisible(ROUND_TRIP);
    await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}/[a-f0-9-]+`));

    // onboarding: a link to a heading anchor in the leave policy keeps the slug in the URL.
    await page.locator("article").first().getByRole("link", { name: sample.anchorLink, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: sample.anchorTargetTitle, exact: true })).toBeVisible(ROUND_TRIP);
    await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toBe(sample.anchorHash);
  });
}
