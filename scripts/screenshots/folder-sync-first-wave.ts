import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, request, expect } from "@playwright/test";
import {
  provisionIsolatedDatabase,
  disposeIsolatedDatabase,
} from "../db/test-database";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations } from "../db/migrate";
import { stageReadingFolder } from "../../tests/e2e/fixtures/folder-reading";
async function main() {
  const output =
    process.env.KM_SCREENSHOT_DIR ??
    "/workspace/artifacts/folder-sync-first-wave";
  const baseline =
    process.env.KM_BASELINE_ROOT ?? "/tmp/knowledge-hub-firstwave-baseline";
  const feature = process.cwd();
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  async function capture(
    label: "before" | "after",
    root: string,
    port: number,
  ) {
    const handle = await provisionIsolatedDatabase("e2e");
    const cfg = { ...databaseConfig("e2e"), database: handle.databaseName };
    const pool = createDatabasePool(cfg);
    let server: ChildProcess | undefined;
    try {
      await runMigrations(pool);
      await pool.end();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        KM_DB_HOST: cfg.host,
        KM_DB_PORT: String(cfg.port),
        KM_DB_USER: cfg.user,
        KM_DB_PASSWORD: cfg.password,
        KM_DB_NAME: cfg.database,
        KM_IDENTITY_PROVIDER: "local",
        KM_LOCAL_IDENTITY_ENABLED: "true",
        KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION: "true",
        KM_TEAM_WORKSPACES_ENABLED: "true",
        KM_LOCAL_ID: "0199f000-0000-7000-8000-000000000909",
        KM_LOCAL_EMP_ID: "E2E-0909",
        KM_LOCAL_NAME: "Knowledge User",
        KM_LOCAL_ORG_CODE: "E2E",
      };
      server = spawn(
        process.execPath,
        [
          path.join(root, "node_modules/next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
        ],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let log = "";
      server.stdout?.on("data", (b) => (log += String(b)));
      server.stderr?.on("data", (b) => (log += String(b)));
      const origin = `http://127.0.0.1:${port}`;
      const api = await request.newContext({ baseURL: origin });
      for (let i = 0; i < 100; i++) {
        if (server.exitCode !== null) throw Error(log);
        try {
          if ((await api.get("/api/workspaces")).ok()) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      const nav = await (await api.get("/api/workspaces")).json(),
        ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id;
      const v1 = await stageReadingFolder(api, {
        workspaceId: ws,
        sourceName: "Team knowledge",
        fixture: "reading-flow-v1",
      });
      const appliedResponse = await api.post(
        `/api/source-imports/${v1}/apply`,
        { data: {} },
      );
      expect(appliedResponse.ok()).toBe(true);
      const first = await appliedResponse.json();
      const v2 = await stageReadingFolder(api, {
        workspaceId: ws,
        sourceId: first.sourceId,
        sourceName: "Team knowledge",
        fixture: "reading-flow-v2",
      });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "light",
        locale: "en-US",
        timezoneId: "Asia/Taipei",
        baseURL: origin,
      });
      const page = await context.newPage();
      await context.addInitScript(() => {
        localStorage.setItem("km:theme", "light");
      });
      const screenshot = async (name: string, url: string) => {
        await page.goto(url);
        await page.locator("main").first().waitFor();
        await page.screenshot({
          path: path.join(output, `${label}-${name}.png`),
          fullPage: true,
          animations: "disabled",
        });
      };
      await screenshot("home", `/w/${ws}/home`);
      await screenshot("sources", `/w/${ws}/sources`);
      await screenshot("preview", `/w/${ws}/sources/imports/${v2}`);
      if (label === "after") {
        await page
          .getByRole("button", { name: /View changes:/ })
          .first()
          .click();
        await expect(
          page.getByText("New workflow: check, review, apply, and read.", {
            exact: false,
          }),
        ).toBeVisible();
        await page.getByText("New workflow: check, review, apply, and read.",{exact:false}).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(output, "after-preview-diff.png"),
          fullPage: true,
          animations: "disabled",
        });
      }
      await page.getByRole("button", { name: "Apply changes" }).click();
      await expect(page).toHaveURL(
        label === "before" ? /import=success/ : /\/runs\//,
      );
      await page.screenshot({
        path: path.join(output, `${label}-result.png`),
        fullPage: true,
        animations: "disabled",
      });
      await screenshot("home-updated", `/w/${ws}/home`);
      await screenshot("history", `/w/${ws}/sources/${first.sourceId}`);
      if(label==="before"){
        await page.goto(`/w/${ws}/knowledge/${first.sourceId}`);
        await page.getByRole("link",{name:"Updated team guide",exact:true}).last().click();
        await page.getByRole("button",{name:"Details",exact:true}).first().click();
        await page.screenshot({path:path.join(output,"before-reader.png"),fullPage:true,animations:"disabled"});
      }
      const wrong = await stageReadingFolder(api, {
        workspaceId: ws,
        sourceId: first.sourceId,
        sourceName: "Team knowledge",
        fixture: "wrong-folder",
      });
      await screenshot("risk", `/w/${ws}/sources/imports/${wrong}`);
      if (label === "after") {
        await screenshot("updates", `/w/${ws}/updates`);
        await screenshot("health", `/w/${ws}/sources/${first.sourceId}/health`);
        const history = await api.get(`/api/source-imports/${v2}`);
        const preview = await history.json();
        const run = await api.post(`/api/source-imports/${v2}/apply`, {
          data: {},
        });
        const result = await run.json();
        await page.goto(
          `/w/${ws}/sources/${first.sourceId}/runs/${result.runId}`,
        );
        await page.getByRole("link", { name: "Read this update" }).click();
        await page
          .getByRole("button", { name: /Details/ })
          .first()
          .click()
          .catch(() => {});
        await page.screenshot({
          path: path.join(output, "after-reader.png"),
          fullPage: true,
          animations: "disabled",
        });
        await writeFile(
          path.join(output, "fixture.json"),
          JSON.stringify(
            {
              baseline: "15c8b7786239735ece7112bb663760346b33a580",
              viewport: "1440×1000",
              locale: "en-US",
              theme: "light",
              fixtures: ["reading-flow-v1", "reading-flow-v2", "wrong-folder"],
              state: preview.state,
            },
            null,
            2,
          ),
        );
      }
      await context.close();
      await api.dispose();
      await writeFile(path.join(output, `${label}-server.log`), log);
    } finally {
      if (server) {
        server.kill("SIGTERM");
        await new Promise<void>((r) => {
          if (server!.exitCode !== null) r();
          else server!.once("exit", () => r());
        });
      }
      await pool.end().catch(() => {});
      await disposeIsolatedDatabase(handle);
    }
  }
  try {
    await capture("before", baseline, 3211);
    await capture("after", feature, 3212);
    const compare=await browser.newPage({viewport:{width:2880,height:1100},deviceScaleFactor:1});
    for(const name of ["home","preview","risk","result","reader"]){
      const after=name==="preview"?"after-preview-diff.png":name==="home"?"after-home-updated.png":`after-${name}.png`;
      const beforeData=(await readFile(path.join(output,name==="home"?"before-home-updated.png":`before-${name}.png`))).toString("base64");
      const afterData=(await readFile(path.join(output,after))).toString("base64");
      await compare.setContent(`<html><body style="margin:0;display:grid;grid-template-columns:1fr 1fr;font:28px system-ui;background:#fff"><section><div style="padding:20px;border-bottom:1px solid #ddd">Before · main (15c8b77)</div><img style="display:block;width:100%" src="data:image/png;base64,${beforeData}"/></section><section><div style="padding:20px;border-bottom:1px solid #ddd">After · Folder Sync first wave</div><img style="display:block;width:100%" src="data:image/png;base64,${afterData}"/></section></body></html>`);
      await compare.locator("img").evaluateAll(images=>Promise.all(images.map(img=>(img as HTMLImageElement).decode())));
      await compare.screenshot({path:path.join(output,`compare-${name}.png`),fullPage:true});
    }
    await compare.close();
  } finally {
    await browser.close();
  }
  console.log(`Screenshots saved to ${output}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
