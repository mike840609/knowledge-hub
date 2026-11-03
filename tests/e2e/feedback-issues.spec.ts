import { randomUUID } from "node:crypto";
import { databaseConfig } from "../../src/infrastructure/database/mariadb/config";
import { createDatabasePool } from "../../src/infrastructure/database/mariadb/pool";
import { expect, test } from "./fixtures/test";
import { chooseOption } from "./fixtures/select-menu";

const READER_NAME = "E2E Knowledge User";
const READER_EMP_ID = "E2E-0909";
const OTHER_NAME = "Other Reporter";
const OTHER_EMP_ID = "E2E-OTHER";
const PAGE_SIZE = 20;
const READING_REPORTS = 25;

test("the issues panel lists, filters and loads more reports without leaving the page", async ({ page }) => {
  test.setTimeout(120_000);
  const pool = createDatabasePool(databaseConfig("e2e"));
  const list = page.getByRole("list", { name: "Reported issues" });
  const rows = list.getByRole("listitem");

  async function openDialog() {
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Report a problem", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Report a problem", exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  async function openIssues() {
    const dialog = await openDialog();
    const loaded = page.waitForResponse((response) => response.url().includes("/api/feedback-reports?") && response.request().method() === "GET");
    await dialog.getByRole("tab", { name: "Issues", exact: true }).click();
    await loaded;
    return dialog;
  }
  async function close(dialog: Awaited<ReturnType<typeof openDialog>>) {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }

  try {
    await page.goto("/");

    // 1. No rail row and no page change: the board lives inside the report dialog and closes with Escape.
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Issues", exact: true })).toHaveCount(0);
    const startUrl = page.url();
    const panel = await openIssues();
    await expect(panel.getByRole("tab", { name: "Report", exact: true })).toBeVisible();
    await expect(panel.getByLabel("Status")).toBeVisible();
    await expect(page).toHaveURL(startUrl);
    await close(panel);

    // 2. Two reports sent the way a reader sends them, both listed as Open and attributed to the reader.
    async function sendReport(category: "Sync" | "Other", description: string) {
      const dialog = await openDialog();
      await chooseOption(dialog.getByLabel("Category"), category);
      await dialog.getByLabel("What happened?").fill(description);
      const sent = page.waitForResponse((response) => response.url().endsWith("/api/feedback-reports") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Send report" }).click();
      expect((await sent).status()).toBe(201);
      await expect(dialog.getByRole("status")).toContainText("Report sent");
      await close(dialog);
    }

    await sendReport("Sync", "Issues board first");
    await sendReport("Other", "Issues board second");

    const reporterId = randomUUID();
    const seededId = randomUUID();
    await pool.query("INSERT INTO users (id, emp_id, name, org_code) VALUES (?, 'E2E-OTHER', 'Other Reporter', 'E2E')", [reporterId]);
    await pool.query(
      `INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,created_at)
       VALUES (?,?,'E2E-OTHER','Other Reporter','Other','Other reporter issue','/w/x/knowledge',UTC_TIMESTAMP(6))`,
      [seededId, reporterId],
    );

    const firstPanel = await openIssues();
    const first = rows.filter({ hasText: "Issues board first" });
    const second = rows.filter({ hasText: "Issues board second" });
    for (const [row, category] of [[first, "Sync"], [second, "Other"]] as const) {
      await expect(row).toHaveCount(1);
      await expect(row.getByText("Open", { exact: true })).toBeVisible();
      await expect(row.getByText(category, { exact: true })).toBeVisible();
      await expect(row.getByText(READER_NAME, { exact: true })).toBeVisible();
      await expect(row.getByText(READER_EMP_ID, { exact: true })).toBeVisible();
    }
    await expect(rows.filter({ hasText: "Other reporter issue" }).getByText(OTHER_NAME, { exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Other reporter issue" }).getByText(OTHER_EMP_ID, { exact: true })).toBeVisible();
    await close(firstPanel);

    // 3. A status edited outside the app shows the next time the panel opens; the filters narrow the list.
    await pool.query("UPDATE feedback_reports SET status='RESOLVED' WHERE id=?", [seededId]);
    let filtered = await openIssues();
    const seeded = rows.filter({ hasText: "Other reporter issue" });
    await expect(seeded.getByText("Resolved", { exact: true })).toBeVisible();

    await chooseOption(filtered.getByLabel("Status"), "RESOLVED");
    await expect(rows).toHaveCount(1);
    await expect(seeded).toHaveCount(1);
    await expect(first).toHaveCount(0);

    await chooseOption(filtered.getByLabel("Status"), "all");
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await expect(seeded).toHaveCount(1);
    await filtered.getByLabel("Mine only").check();
    await expect(first).toHaveCount(1);
    await expect(second).toHaveCount(1);
    await expect(seeded).toHaveCount(0);
    await filtered.getByLabel("Mine only").uncheck();
    await close(filtered);

    // 4. Nothing on the board writes a status: the rows hold no controls at all.
    filtered = await openIssues();
    await expect(list.locator("a, button, input, select, textarea, [role='button'], [role='menuitem'], [role='combobox']")).toHaveCount(0);
    await expect(filtered.getByRole("button", { name: /status/i })).toHaveCount(0);
    await close(filtered);

    // 5. Load more appends the next page and keeps what is already visible.
    const reading = Array.from({ length: READING_REPORTS }, (_, index) => ({ id: randomUUID(), description: `Reading issue ${index}` }));
    for (const [index, report] of reading.entries()) {
      await pool.query(
        `INSERT INTO feedback_reports (id,user_id,emp_id,user_name,category,description,page_path,status,created_at)
         VALUES (?,?,'E2E-OTHER','Other Reporter','Reading',?,'/w/x/knowledge','DUPLICATE',DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND))`,
        [report.id, reporterId, report.description, index],
      );
    }

    filtered = await openIssues();
    await chooseOption(filtered.getByLabel("Status"), "DUPLICATE");
    await expect(rows).toHaveCount(PAGE_SIZE);
    const firstPageTexts = await rows.allInnerTexts();
    expect(new Set(firstPageTexts).size).toBe(firstPageTexts.length);

    await filtered.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(rows).toHaveCount(READING_REPORTS);
    const allTexts = await rows.allInnerTexts();
    expect(new Set(allTexts).size).toBe(allTexts.length);
    for (const text of firstPageTexts) expect(allTexts).toContain(text);
    await expect(list.getByText("Duplicate", { exact: true })).toHaveCount(READING_REPORTS);
    await close(filtered);
  } finally {
    await pool.end();
  }
});
