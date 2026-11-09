import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./fixtures/test";

const port = Number(process.env.KM_E2E_PORT ?? "3101") + 19;
const searchOrigin = "http://127.0.0.1:" + port;
let searchServer: ChildProcess | undefined;
let serverOutput = "";

test.beforeAll(async () => {
  // Enable Task Search on an independent server sharing the E2E test database.
  // The original E2E server still exercises the default-off legacy Task reader.
  searchServer = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", KM_IDENTITY_PROVIDER: "local", TASK_SEARCH_READ_ENABLED: "true", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  searchServer.stdout?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString().slice(-2048); });
  searchServer.stderr?.on("data", (chunk: Buffer) => { serverOutput += chunk.toString().slice(-2048); });
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    if (searchServer.exitCode !== null) throw new Error("Task Search E2E server exited: " + serverOutput.slice(-1500));
    try { await fetch(searchOrigin, { redirect: "manual" }); return; } catch { await new Promise((r) => setTimeout(r, 350)); }
  }
  throw new Error("Task Search E2E server did not start: " + serverOutput.slice(-1500));
});
test.afterAll(async () => { if (searchServer && searchServer.exitCode === null) searchServer.kill("SIGTERM"); });

async function seedTask(request: APIRequestContext, token: string, opts: {
  id: string; title: string; summary: string; findings?: string[];
  agent?: "opencode" | "claude-code"; verification?: "passed" | "failed";
}) {
  const result = await request.post("/api/task-results/ingest", {
    headers: { "x-knowledge-hub-export-token": token },
    data: {
      schemaVersion: 1, taskId: opts.id, artifactRevision: 1,
      agent: opts.agent ?? "opencode", status: "completed",
      title: opts.title, summary: opts.summary, completedAt: "2026-11-06T10:00:00Z",
      verification: { status: opts.verification ?? "passed", checks: [] },
      findings: opts.findings ?? [], references: [],
    },
  });
  expect(result.status()).toBe(201);
}

test("flag-on Tasks search: field hits, filter URLs, invalid cursor and 390px", async ({ page, request }) => {
  test.setTimeout(120_000);
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const base = "/w/" + ws + "/tasks";
  await page.goto(base + "/setup");
  await page.getByLabel("Label").fill("search e2e laptop " + randomUUID().slice(0, 8));
  await page.getByRole("button", { name: "Create binding" }).click();
  const token = /--token (\S+)/.exec(await page.locator("pre").innerText())?.[1];
  expect(token).toBeTruthy();
  const name = "Search evidence " + randomUUID().slice(0, 8);
  await seedTask(request, token!, {
    id: randomUUID(), title: name, summary: "Unrelated summary before the findings.",
    findings: ["Agent found security authorization evidence in the API."],
  });
  await seedTask(request, token!, {
    id: randomUUID(), title: "Search irrelevant " + randomUUID().slice(0, 8),
    summary: "No matching term", agent: "claude-code", verification: "failed",
  });
  await page.goto(searchOrigin + base + "?q=security");
  await expect(page.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("security");
  const clearance = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>("#task-search-q");
    const icon = input?.parentElement?.querySelector("svg");
    if (!input || !icon) return null;
    const inputRect = input.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      textStart: inputRect.left + parseFloat(getComputedStyle(input).paddingLeft),
      iconRight: iconRect.right,
    };
  });
  expect(clearance).not.toBeNull();
  expect(clearance!.textStart - clearance!.iconRight).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText(/security authorization evidence/i)).toBeVisible();
  await expect(page.getByText("Showing 1 task")).toBeVisible();

  await page.getByRole("combobox", { name: "Agent" }).selectOption("claude-code");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/agent=claude-code/);
  await expect(page.getByText("No matching tasks")).toBeVisible();
  await page.getByRole("link", { name: /Remove Agent:/ }).click();
  await expect(page).not.toHaveURL(/agent=/);
  await expect(page.getByText(/security authorization evidence/i)).toBeVisible();
  await page.getByRole("link", { name: "Archived" }).click();
  await expect(page).toHaveURL(/archived=1/);
  await expect(page.getByRole("link", { name: "Clear all" })).toHaveAttribute("href", base + "?archived=1");
  await page.getByRole("link", { name: "Active" }).click();
  await expect(page).not.toHaveURL(/archived=1/);

  await page.goto(searchOrigin + base + "?q=" + "x".repeat(201));
  await expect(page.getByRole("region", { name: "Task search and filters" }).getByRole("alert")).toContainText(/at most 200/i);
  await expect(page.getByText("No matching tasks")).toHaveCount(0);
  await page.goto(searchOrigin + base + "?cursor=malformed");
  await expect(page).toHaveURL(searchOrigin + base);

  // Opening the date disclosure must not widen the page at tablet widths.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto(searchOrigin + base);
  await page.locator("details").first().locator("summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(searchOrigin + base + "?q=security");
  await expect(page.getByText(/security authorization evidence/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "light" });
  await test.info().attach("task-search-390px-light.png", { body: await page.screenshot(), contentType: "image/png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await test.info().attach("task-search-390px-dark.png", { body: await page.screenshot(), contentType: "image/png" });
});

test("flag-on Task Search GET form works without JavaScript", async ({ browser, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  // Keep this test independent of the previous test's seed: a workspace with
  // no Tasks intentionally hides the search form.
  const binding = await request.post(searchOrigin + "/api/workspaces/" + ws + "/task-export-bindings", {
    headers: { origin: searchOrigin },
    data: { label: "no-js " + randomUUID().slice(0, 8) },
  });
  expect(binding.status()).toBe(201);
  const token = (await binding.json()).token as string;
  await seedTask(request, token, {
    id: randomUUID(), title: "No-JS search target " + randomUUID().slice(0, 8),
    summary: "Unrelated summary",
  });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(searchOrigin + "/w/" + ws + "/tasks");
    await expect(page.getByRole("searchbox", { name: "Search tasks" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search tasks" }).fill("absentsearchterm999");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/q=absentsearchterm999/);
    await expect(page.getByText("No matching tasks")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});



test("missing date-offset deep link re-queries at browser fixed offset while explicit UTC stays UTC", async ({ browser, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const base = searchOrigin + "/w/" + ws + "/tasks";
  const context = await browser.newContext({ timezoneId: "Asia/Taipei" });
  try {
    const page = await context.newPage();
    // Selecting a date on a previously unfiltered page must submit the
    // local offset in the FIRST GET instead of flashing UTC then replacing.
    await page.goto(base);
    await expect(page.locator("details").first()).toHaveJSProperty("open", false);
    await page.locator("details").first().locator("summary").click();
    await page.locator('input[name="from"]').fill("2026-11-06");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/from=2026-11-06/);
    await expect(page).toHaveURL(/offset=480/);
    // Clearing both dates from an explicitly dated page removes obsolete
    // hidden offsets rather than keeping a stale offset-only URL.
    await page.goto(base + "?from=2026-11-06&to=2026-11-06&offset=480");
    // Active dates now auto-expand Completed. Clicking the summary would
    // collapse the inputs, causing Playwright's fill() to time out.
    await expect(page.locator("details").first()).toHaveJSProperty("open", true);
    await page.locator('input[name="from"]').fill("");
    await page.locator('input[name="to"]').fill("");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).not.toHaveURL(/(?:[?&])offset=/);
    // Native GET can serialize blank dates as from=&to=; both mean no filter.
    // The stale offset must actually be absent.
    const cleared = new URL(page.url()).searchParams;
    expect(cleared.has("offset")).toBe(false);
    expect(cleared.get("from") ?? "").toBe("");
    expect(cleared.get("to") ?? "").toBe("");
    await page.goto(base + "?from=2026-11-06&to=2026-11-06");
    await expect(page).toHaveURL(/offset=480/);
    await expect(page.locator("details")).toContainText("UTC+08:00");
    await page.goto(base + "?from=2026-11-06&to=2026-11-06&offset=0");
    await expect(page).toHaveURL(/offset=0/);
    await expect(page.locator("details")).toContainText("UTC+00:00");
  } finally {
    await context.close();
  }
});
