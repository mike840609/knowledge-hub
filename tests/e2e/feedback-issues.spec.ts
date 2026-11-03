import { randomUUID } from "node:crypto";
import { databaseConfig } from "../../src/infrastructure/database/mariadb/config";
import { createDatabasePool } from "../../src/infrastructure/database/mariadb/pool";
import { expect, test } from "./fixtures/test";
import { chooseOption } from "./fixtures/select-menu";

const READER_NAME = "E2E Knowledge User";
const READER_EMP_ID = "E2E-0909";
const OTHER_NAME = "Other Reporter";
const OTHER_EMP_ID = "E2E-OTHER";
const PAGE_SIZE = 50;
const READING_REPORTS = 55;
/** The oldest seeded Reading reports, which therefore belong to the second page. */
const OLDER_DESCRIPTIONS = Array.from({ length: READING_REPORTS - PAGE_SIZE }, (_, index) => `Reading issue ${PAGE_SIZE + index}`);

test("the personal issues board lists, filters and pages the reports", async ({ page, request }) => {
  test.setTimeout(120_000);
  const nav = await (await request.get("/api/workspaces")).json();
  const workspaceId = nav.items.find((workspace: { type: string }) => workspace.type === "PERSONAL").id;
  const list = page.getByRole("list", { name: "Reported issues" });
  const rows = list.getByRole("listitem");
  const pool = createDatabasePool(databaseConfig("e2e"));

  try {
    // 1. The board is not a rail row; it is reached from "Report a problem".
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Issues", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Report a problem", exact: true }).click();
    const reportDialog = page.getByRole("dialog", { name: "Report a problem", exact: true });
    const issues = reportDialog.getByRole("link", { name: "View all reported issues", exact: true });
    await expect(issues).toHaveAttribute("href", `/w/${workspaceId}/issues`);
    await issues.click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/issues$`));
    await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();

    // 2. Two reports sent the way a reader sends them, both listed as Open and attributed to the reader.
    async function sendReport(category: "Sync" | "Other", description: string) {
      await page.getByRole("button", { name: /^Account:/ }).click();
      await page.getByRole("menuitem", { name: "Report a problem", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Report a problem", exact: true });
      await expect(dialog).toBeVisible();
      await chooseOption(dialog.getByLabel("Category"), category);
      await dialog.getByLabel("What happened?").fill(description);
      const sent = page.waitForResponse((response) => response.url().endsWith("/api/feedback-reports") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Send report" }).click();
      expect((await sent).status()).toBe(201);
      await expect(dialog.getByRole("status")).toContainText("Report sent");
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog).toBeHidden();
    }

    await sendReport("Sync", "Issues board first");
    await sendReport("Other", "Issues board second");
    await page.reload();

    const first = rows.filter({ hasText: "Issues board first" });
    const second = rows.filter({ hasText: "Issues board second" });
    for (const [row, category] of [[first, "Sync"], [second, "Other"]] as const) {
      await expect(row).toHaveCount(1);
      await expect(row.getByText("Open", { exact: true })).toBeVisible();
      await expect(row.getByText(category, { exact: true })).toBeVisible();
      await expect(row.getByText(READER_NAME, { exact: true })).toBeVisible();
      await expect(row.getByText(READER_EMP_ID, { exact: true })).toBeVisible();
    }

    // 3. A report from another colleague, seeded where a maintainer would have to see it.
    const reporterId = randomUUID();
    const seededId = randomUUID();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, 'E2E-OTHER', 'Other Reporter', 'E2E')", [reporterId]);
    await pool.query(
      `INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at)
       VALUES (?,?,'E2E-OTHER','Other Reporter','Other','Other reporter issue','/w/x/knowledge',UTC_TIMESTAMP(6))`,
      [seededId, reporterId],
    );
    await page.reload();
    const seeded = rows.filter({ hasText: "Other reporter issue" });
    await expect(seeded).toHaveCount(1);
    await expect(seeded.getByText(OTHER_NAME, { exact: true })).toBeVisible();
    await expect(seeded.getByText(OTHER_EMP_ID, { exact: true })).toBeVisible();
    await expect(first).toHaveCount(1);

    // 4. A status edited outside the app shows on reload; the filters narrow the list.
    await pool.query("UPDATE feedback_reports SET status='RESOLVED' WHERE id=?", [seededId]);
    await page.reload();
    await expect(seeded.getByText("Resolved", { exact: true })).toBeVisible();

    await page.goto(`/w/${workspaceId}/issues?status=RESOLVED`);
    await expect(rows.filter({ hasText: "Other reporter issue" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Issues board first" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "Issues board second" })).toHaveCount(0);

    await page.goto(`/w/${workspaceId}/issues?category=Sync`);
    await expect(rows.filter({ hasText: "Issues board first" })).toBeVisible();
    await expect(rows.filter({ hasText: "Issues board second" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "Other reporter issue" })).toHaveCount(0);

    await page.goto(`/w/${workspaceId}/issues?mine=true`);
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await expect(list).not.toContainText(OTHER_NAME);

    // 5. An unknown status is a typo, not a 404: the page still renders the unfiltered list.
    await page.goto(`/w/${workspaceId}/issues?status=CLOSED`);
    await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
    await expect(list).toContainText("Issues board first");
    await expect(page.getByLabel("Status")).toHaveValue("");

    // 6. Nothing on the board writes a status: the rows hold no controls at all.
    await expect(list.locator("a, button, input, select, textarea, [role='button'], [role='menuitem'], [role='combobox']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /status/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /status/i })).toHaveCount(0);

    // 7. Page 1 stops at fifty, and Older issues continues into the oldest reports without repeating any.
    const reading = Array.from({ length: READING_REPORTS }, (_, index) => ({ id: randomUUID(), description: `Reading issue ${index}` }));
    for (const [index, report] of reading.entries()) {
      await pool.query(
        `INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at)
         VALUES (?,?,'E2E-OTHER','Other Reporter','Reading',?,'/w/x/knowledge',DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND))`,
        [report.id, reporterId, report.description, index],
      );
    }

    await page.goto(`/w/${workspaceId}/issues?category=Reading`);
    await expect(rows).toHaveCount(PAGE_SIZE);
    await expect(list.getByText("Reading", { exact: true })).toHaveCount(PAGE_SIZE);
    const older = page.getByRole("link", { name: "Older issues" });
    await expect(older).toBeVisible();
    await expect(older).toHaveAttribute("href", /category=Reading/);
    await expect(older).toHaveAttribute("href", /beforeAt=/);
    await expect(older).toHaveAttribute("href", /beforeId=/);

    const firstPageTexts = await rows.allInnerTexts();
    expect(new Set(firstPageTexts).size).toBe(firstPageTexts.length);
    await older.click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/issues\\?.*beforeAt=`));
    const olderCount = await rows.count();
    expect(olderCount).toBeGreaterThanOrEqual(READING_REPORTS - PAGE_SIZE);
    await expect(list.getByText("Reading", { exact: true })).toHaveCount(olderCount);
    const olderTexts = await rows.allInnerTexts();
    for (const text of olderTexts) expect(firstPageTexts).not.toContain(text);
    for (const description of OLDER_DESCRIPTIONS) {
      expect(olderTexts.some((text) => text.includes(description))).toBe(true);
    }
  } finally {
    await pool.end();
  }
});
