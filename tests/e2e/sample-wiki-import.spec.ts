import { expect, test, type Page } from "./fixtures/test";
import { formatGuideBytes } from "../../src/components/imports/import-guide-content";
import { DEFAULT_IMPORT_LIMITS } from "../../src/modules/sources/domain/import-limits";

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
    // The source landing page streams its tree before redirecting to its first document.
    // Wait for that arrival so its late redirect cannot replace the next document click.
    await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}/[a-f0-9-]+$`), ROUND_TRIP);

    // index: a real click on its wikilink (rendered as the text it was written with) to the onboarding page.
    const tree = page.getByRole("tree", { name: "Knowledge tree" });
    await expect(tree).toHaveAttribute("aria-busy", "false", ROUND_TRIP);
    await tree.getByRole("treeitem", { name: sample.indexTitle, exact: true }).locator("a").first().click();
    const content = page.getByRole("region", { name: "Document content", exact: true });
    const article = content.getByRole("article");
    await expect(content.getByRole("heading", { level: 1, name: sample.indexTitle, exact: true })).toBeVisible(ROUND_TRIP);
    await article.getByRole("link", { name: sample.indexLink, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: sample.onboardingTitle, exact: true })).toBeVisible(ROUND_TRIP);
    await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}/[a-f0-9-]+`));

    // onboarding: a link to a heading anchor in the leave policy keeps the slug in the URL.
    await article.getByRole("link", { name: sample.anchorLink, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: sample.anchorTargetTitle, exact: true })).toBeVisible(ROUND_TRIP);
    await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toBe(sample.anchorHash);
  });
}

// The guide reads its limits from the server's import config; this run sets no
// override, so the values on the page are the defaults, formatted by the same helper.
test.describe("import guide", () => {
  const SECTION_HEADINGS = {
    en: ["What you need", "From an Obsidian vault", "From a tool or agent that writes Markdown", "Import, Preview, Apply", "Keeping it in sync", "Read, search, and Copy for Agent", "Limits"],
    zhTW: ["你需要準備什麼", "從 Obsidian 筆記庫（vault）匯入", "從會寫出 Markdown 的工具或代理匯入", "匯入、預覽、套用", "保持同步", "閱讀、搜尋與 Copy for Agent", "限制"],
  };

  test("the import page links to the guide", async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import`);
    await page.getByRole("link", { name: "Folder format guide" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import/guide$`));
    await expect(page.getByRole("heading", { level: 1, name: "Bring your wiki into Knowledge Hub" })).toBeVisible();
  });

  test("English: seven sections in order, with the configured limits", async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import/guide`);
    await expect(page.locator("[lang='en']").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(SECTION_HEADINGS.en);

    const limits = page.getByRole("table");
    const row = (name: string) => limits.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
    const value = (name: string) => row(name).getByRole("cell");
    await expect(value("Files in one import")).toHaveText(DEFAULT_IMPORT_LIMITS.maxManifestEntries.toLocaleString("en-US"));
    await expect(value("Size of one Markdown file")).toHaveText(formatGuideBytes(DEFAULT_IMPORT_LIMITS.maxMarkdownFileBytes));
    await expect(value("Total size of Markdown files in one import")).toHaveText(formatGuideBytes(DEFAULT_IMPORT_LIMITS.maxMarkdownTotalBytes));
    await expect(value("Length of one file path")).toHaveText(formatGuideBytes(DEFAULT_IMPORT_LIMITS.maxPathBytes));

    const nav = page.getByRole("navigation", { name: "Guide language" });
    await expect(nav.getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "繁體中文" })).not.toHaveAttribute("aria-current", /.+/);
  });

  test("unknown ?lang falls back to English", async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import/guide?lang=fr`);
    await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(SECTION_HEADINGS.en[0]);
  });

  test("?lang=zh-TW renders Chinese and the switch marks it current", async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import/guide`);
    await page.getByRole("navigation", { name: "Guide language" }).getByRole("link", { name: "繁體中文" }).click();
    await expect(page).toHaveURL(/[?]lang=zh-TW$/);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(SECTION_HEADINGS.zhTW);
    await expect(page.locator("[lang='zh-TW']").filter({ has: page.getByRole("heading", { level: 1 }) })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Guide language" });
    await expect(nav.getByRole("link", { name: "繁體中文" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "English" })).not.toHaveAttribute("aria-current", /.+/);
    await expect(page.getByRole("cell", { name: DEFAULT_IMPORT_LIMITS.maxManifestEntries.toLocaleString("en-US"), exact: true })).toBeVisible();
  });

  test("Try the sample wiki returns to the import page with the control in view", async ({ page }) => {
    const ws = await personalWorkspaceId(page);
    await page.goto(`/w/${ws}/sources/import/guide`);
    await page.getByRole("link", { name: "Try the sample wiki" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}/sources/import#sample-wiki$`));
    const sample = page.getByRole("group", { name: "Try with a sample wiki" });
    await expect(sample).toBeVisible();
    await expect(sample).toBeInViewport();
  });

  test("a caller with no access to the workspace sees no guide", async ({ page }) => {
    await page.goto("/w/00000000-0000-4000-8000-000000000000/sources/import/guide");
    // The workspace layout answers first (not found); the page's own StatusMessage is the second gate.
    await expect(page.getByRole("heading", { level: 1, name: /^(Page not found|No workspace access)$/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Limits" })).toHaveCount(0);
  });
});

test("import flow guide stays collapsed and opens on desktop and mobile", async ({ page }, testInfo) => {
  const ws = await personalWorkspaceId(page);
  await page.goto(`/w/${ws}/sources/import`);
  const steps = page.getByRole("list", { name: "Folder import steps" });
  await expect(steps).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("import-guide-collapsed-desktop.png"), fullPage: true });
  await page.getByText("How import works", { exact: true }).click();
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps).toContainText("Choose folder");
  await expect(steps).toContainText("Preview");
  await expect(steps).toContainText("Apply");
  await page.screenshot({ path: testInfo.outputPath("import-guide-expanded-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("import-guide-expanded-mobile.png"), fullPage: true });
  await page.getByText("How import works", { exact: true }).click();
  await expect(steps).toBeHidden();
});
