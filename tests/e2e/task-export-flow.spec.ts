import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Page } from "./fixtures/test";
import { stageReadingFolder } from "./fixtures/folder-reading";

const CLI = path.resolve("tools/knowledge-hub/bin/knowledge-hub.mjs");
const TIMEOUT_MS = 1500;

/** Forwards to the E2E server; while `holdNext` is set, the next ingest commits upstream but answers only after the CLI gave up. */
function delayingProxy(upstream: string) {
  const state = { holdNext: false };
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => name !== "host" && name !== "content-length")) as Record<string, string>;
    const answer = await fetch(`${upstream}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const body = Buffer.from(await answer.arrayBuffer());
    if (state.holdNext && req.url === "/api/task-results/ingest") {
      state.holdNext = false;
      await new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS * 2));
    }
    res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" }).end(body);
  });
  return new Promise<{ url: string; state: typeof state; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state, close: () => server.close() }));
  });
}

function cli(home: string, project: string) {
  return (args: string[], stdin = "") => new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: project,
      env: { NODE_ENV: "test", HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? "", KNOWLEDGE_HUB_TIMEOUT_MS: String(TIMEOUT_MS) },
    });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    child.stdin.end(stdin);
    child.on("close", (code) => resolve({ code: code ?? -1, out }));
  });
}

const content = (title: string, summary = "Stopped the guide page from redirecting to itself.") => JSON.stringify({
  agent: "claude-code", status: "completed", title, summary, completedAt: "2026-11-04T10:00:00Z",
  verification: { status: "passed", checks: ["npm test -- guide: 4 passed"] },
  references: [{ type: "WIKI", path: "flow-guide.md" }],
});

const bindingRow = (page: Page, label: string) => page.getByRole("listitem").filter({ hasText: label });

test("manual task export from the CLI, through timeout, revisions, archive, rotation and revocation", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
  const sourceName = `Flow export ${Date.now()}`;
  const label = `flow laptop ${Date.now()}`;
  const snapshot = await stageReadingFolder(request, { workspaceId: ws, sourceName, fixture: "task-export-flow" });
  expect((await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} })).ok()).toBe(true);

  // Browser creates the binding; the token is shown once.
  await page.goto(`/w/${ws}/tasks/setup`);
  await page.getByLabel("Label").fill(label);
  await page.getByRole("button", { name: "Create binding" }).click();
  const token = await page.getByLabel("Export token").inputValue();
  const bindingId = /--binding-id (\S+)/.exec(await page.locator("pre").innerText())![1];

  const proxy = await delayingProxy(baseURL!);
  const home = mkdtempSync(path.join(tmpdir(), "kh-flow-home-"));
  const project = mkdtempSync(path.join(tmpdir(), "kh-flow-project-"));
  spawnSync("git", ["init", "-q"], { cwd: project });
  const run = cli(home, project);
  try {
    expect((await run(["configure", "--hub-url", proxy.url, "--binding-id", bindingId, "--allow-insecure-localhost"], token)).code).toBe(0);

    // A timeout that actually committed: exit 3, then --new is refused and --retry answers EXISTING.
    proxy.state.holdNext = true;
    const lost = await run(["export", "--new"], content("Fix guide redirect"));
    expect(lost.code).toBe(3);
    expect(lost.out).toMatch(/may already be stored/i);
    const taskId = /--retry ([0-9a-f-]{36})/.exec(lost.out)![1];
    const refused = await run(["export", "--new"], content("Fix guide redirect, again"));
    expect(refused.code).toBe(2);
    expect(refused.out).toContain(`knowledge-hub export --retry ${taskId}`);
    const retried = await run(["export", "--retry", taskId]);
    expect(retried.code).toBe(0);
    const taskPath = new URL(/Saved to Knowledge Hub: (\S+)/.exec(retried.out)![1]).pathname;

    // Exactly one task: the replay did not duplicate it.
    await page.goto(`/w/${ws}/tasks`);
    await expect(page.getByRole("link", { name: /Fix guide redirect/ })).toHaveCount(1);
    await page.goto(taskPath);
    await expect(page.getByRole("heading", { name: "Fix guide redirect" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Flow guide" })).toBeVisible();

    // --task adds revision 2.
    expect((await run(["export", "--task", taskId], content("Fix guide redirect (rev 2)"))).code).toBe(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Fix guide redirect (rev 2)" })).toBeVisible();

    // Archive refuses a new revision; restore lets the same saved revision through.
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    const archived = await run(["export", "--task", taskId], content("Fix guide redirect (rev 3)"));
    expect(archived.code).toBe(4);
    expect(archived.out).toMatch(/restore/i);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible();
    expect((await run(["export", "--retry", taskId])).code).toBe(0);

    // Rotation invalidates the old token; configure --rotate picks up the new one.
    await page.goto(`/w/${ws}/tasks/setup`);
    await bindingRow(page, label).getByRole("button", { name: "Rotate token" }).click();
    const rotated = await page.getByLabel("Export token").inputValue();
    expect(rotated).not.toBe(token);
    const stale = await run(["export", "--task", taskId], content("Fix guide redirect (rev 4)"));
    expect(stale.code).toBe(4);
    expect(stale.out).toContain(`knowledge-hub configure --rotate ${bindingId}`);
    expect((await run(["configure", "--rotate", bindingId], rotated)).code).toBe(0);
    expect((await run(["export", "--retry", taskId])).code).toBe(0);

    // Revocation refuses new ingestion; the task stays readable.
    await bindingRow(page, label).getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
    await expect(bindingRow(page, label)).toContainText("Revoked");
    expect((await run(["export", "--task", taskId], content("Fix guide redirect (rev 5)"))).code).toBe(4);
    await page.goto(taskPath);
    await expect(page.getByRole("heading", { name: "Fix guide redirect (rev 4)" })).toBeVisible();
    await expect(page.getByText("Binding revoked")).toBeVisible();
  } finally {
    proxy.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }

  // A browser session never substitutes for the export credential.
  const session = await page.request.post("/api/task-results/ingest", { data: JSON.parse(content("session only")) });
  expect(session.status()).toBe(401);

  // A foreign or made-up Workspace grants nothing.
  const origin = new URL(baseURL!).origin;
  const foreign = await page.request.post(`/api/workspaces/${crypto.randomUUID()}/task-export-bindings`, { headers: { origin }, data: { sourceId: crypto.randomUUID(), label: "x" } });
  expect(foreign.status()).toBe(404);
  const notMine = await page.request.get(`/w/${crypto.randomUUID()}/tasks`);
  expect(notMine.status()).toBe(404);
});

test("the ingest route answers a real OPTIONS preflight with 405 and no CORS grant", async ({ request }) => {
  const response = await request.fetch("/api/task-results/ingest", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "x-knowledge-hub-export-token" },
  });
  expect(response.status()).toBe(405);
  expect(response.headers()["allow"]).toBe("POST");
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  for (const name of Object.keys(response.headers())) expect(name.startsWith("access-control-allow")).toBe(false);
});
