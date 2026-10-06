import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, request, expect } from "@playwright/test";
import { provisionIsolatedDatabase, disposeIsolatedDatabase } from "../db/test-database";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { runMigrations } from "../db/migrate";
import { stageReadingFolder } from "../../tests/e2e/fixtures/folder-reading";

const project = process.cwd();
const baselineRoot = project;
const output = path.join(project, "docs/ui-comparisons/insights-reading-activity");
async function main() {
 await mkdir(output, {recursive:true});
 const base = await mkdtemp(path.join(tmpdir(), "km-ui-comparison-"));
 const before = path.join(base,"before"), after = path.join(base,"after");
 const handle = await provisionIsolatedDatabase("e2e");
 const cfg = {...databaseConfig("e2e"), database:handle.databaseName};
 const pool = createDatabasePool(cfg);
 const servers: ChildProcess[] = [];
 const browser = await chromium.launch({headless:true});
 const evidence: Record<string, unknown> = {baseline:"Daily reading activity with unique period totals", capturedAt:new Date().toISOString(), rendering:"Next.js development servers, actual application components, isolated synthetic database", viewports:{desktop:{width:1440,height:900},narrowDesktop:{width:1280,height:900}}};
 try {
  await runMigrations(pool);
  // Align the disposable fixture with the application clock, including environments with DB clock drift.
  await pool.query("UPDATE reading_activity_tracking SET started_at=? WHERE id=1",[new Date()]);
  await pool.end();
  await mkdir(before); await mkdir(after);
  for (const [root,source] of [[before,baselineRoot],[after,project]]) {
   for(const file of ["src","public","next.config.ts","next-env.d.ts","tsconfig.json","package.json","postcss.config.mjs","tailwind.config.ts"]) await cp(path.join(source,file),path.join(root,file),{recursive:true});
  }
  const instances: Array<{label:string;origin:string;ws:string}> = [];
  for(const [label,root,port] of [["before",before,3211]] as const) {
   await symlink(path.join(project,"node_modules"),path.join(root,"node_modules"),"dir");
   const cssPath=path.join(root,"src/app/globals.css"); await writeFile(cssPath,(await readFile(cssPath,"utf8"))+"\n/* Screenshot fixture: hide development chrome. */\nnextjs-portal { display: none !important; }\n");
   const server = spawn(process.execPath,[path.join(project,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env:{...process.env,NODE_ENV:"development",KM_DB_HOST:cfg.host,KM_DB_PORT:String(cfg.port),KM_DB_USER:cfg.user,KM_DB_PASSWORD:cfg.password,KM_DB_NAME:cfg.database,KM_IDENTITY_PROVIDER:"local",KM_LOCAL_IDENTITY_ENABLED:"true",KM_TEAM_WORKSPACES_ENABLED:"false",KM_LOCAL_ID:"0199f000-0000-7000-8000-000000000909",KM_LOCAL_EMP_ID:"E2E-0909",KM_LOCAL_NAME:"Knowledge User",KM_LOCAL_ORG_CODE:"E2E"},stdio:["ignore","pipe","pipe"]});
   servers.push(server); let log=""; server.stdout?.on("data",b=>{log+=String(b);});server.stderr?.on("data",b=>{log+=String(b);});
   const origin=`http://127.0.0.1:${port}`,api=await request.newContext({baseURL:origin,timeout:10000});
   let nav;
   for(let attempt=0;attempt<120;attempt++) {
    if(server.exitCode !== null) throw Error(log);
    try {const response=await api.get("/api/workspaces"); if(response.ok()){nav=await response.json();break;}} catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   if(!nav) throw Error(`Server ${label} unavailable: ${log.slice(-3000)}`);
   const ws=nav.items.find((item:{type:string})=>item.type==="PERSONAL").id;
   if(label === "before") {
    for (const sourceName of ["Team knowledge","Engineering handbook","Engineering architecture, deployment and troubleshooting knowledge repository"]) {
     const snapshot=await stageReadingFolder(api,{workspaceId:ws,sourceName,fixture:"reading-flow-v1"});
     const response=await api.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(response.ok()).toBe(true);
    }
    expect((await api.put(`/api/workspaces/${ws}/onboarding`,{data:{value:{schemaVersion:1,dismissed:true},version:0}})).ok()).toBe(true);
    expect((await api.put(`/api/workspaces/${ws}/personal`,{data:{key:"draft:new",value:{title:"Release planning notes",markdown:"# Release planning notes\nNext steps",baseRevisionId:null},version:0}})).ok()).toBe(true);
   }
   instances.push({label,origin,ws});await api.dispose();console.log(`[screenshots] ${label} ready`);
  }
  const instance=instances[0];
  const api=await request.newContext({baseURL:instance.origin});
  const {targets:docs}=await (await api.get(`/api/workspaces/${instance.ws}/link-targets`)).json();
  await api.dispose();
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>{if(!localStorage.getItem("kh:theme"))localStorage.setItem("kh:theme","light");});
  const page=await context.newPage();
  async function insights(count:number,days=7) {
   await page.goto(`${instance.origin}/w/${instance.ws}/profile?days=${days}`);
   await page.getByRole("heading",{name:"Insights",exact:true}).waitFor();
   await expect(page.locator("[data-browsed-count]")).toHaveAttribute("data-browsed-count",String(count));
   await expect(page.locator("[data-browsed-count]")).toContainText("Viewed in your current library");
   await page.evaluate(()=>document.fonts.ready);
  }
  async function read(doc:{documentId:string;sourceId:string}) {
   const marked=page.waitForResponse(r=>r.url().endsWith(`/documents/${doc.documentId}/read`)&&r.request().method()==="POST"&&r.status()===204);
   await page.goto(`${instance.origin}/w/${instance.ws}/knowledge/${doc.sourceId}/${doc.documentId}`);await marked;
  }
  await insights(0);
  await expect(page.getByRole("region",{name:"Reading activity"}).getByRole("img",{name:/Not tracked/})).toHaveCount(6);
  await page.getByRole("region",{name:"Reading activity"}).screenshot({path:path.join(output,"reading-empty.png"),animations:"disabled"});
  await read(docs[0]);await insights(1);
  const other=docs.find((d:{documentId:string})=>d.documentId!==docs[0].documentId);
  await read(other);await insights(2);await insights(2,30);
  // Synthetic history belongs only to this disposable database.
  const historyPool=createDatabasePool(cfg);
  try {
   await historyPool.query("UPDATE reading_activity_tracking SET started_at=? WHERE id=1",[new Date(Date.now()-30*86400000)]);
   const {readingDates}=await import("../../src/modules/personal/domain/reading-activity");
   const dates=readingDates(new Date(),30);
   for(const offset of [1,2,4,5,6,10,12,15,20,25]) {
    const date=dates[dates.length-1-offset];
    for(const doc of offset%2===0 ? [docs[0],other] : [docs[0]]) {
     await historyPool.query("INSERT INTO document_read_activity (user_id,workspace_id,document_id,activity_date,opened_at) VALUES (?,?,?,?,?)",["0199f000-0000-7000-8000-000000000909",instance.ws,doc.documentId,date,new Date(`${date}T04:00:00Z`)]);
    }
   }
  } finally {await historyPool.end();}
  await insights(2);
  await expect(page.locator("[data-period-articles]")).toHaveAttribute("data-period-articles","2");
  await expect(page.getByRole("region",{name:"Reading activity"}).getByRole("img")).toHaveCount(7);
  const chart=page.getByRole("region",{name:"Reading activity"});
  await chart.getByRole("img").first().focus();
  await expect(page.getByText((await chart.getByRole("img").first().getAttribute("aria-label"))!,{exact:true})).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(chart.getByRole("img").nth(1)).toBeFocused();
  await page.locator("h1").click();
  await chart.screenshot({path:path.join(output,"reading-detail-light.png"),animations:"disabled"});
  await page.screenshot({path:path.join(output,"insights-desktop-light.png"),animations:"disabled"});
  await insights(2,30);
  await expect(chart.getByRole("img")).toHaveCount(30);
  await page.screenshot({path:path.join(output,"insights-30-days-light.png"),animations:"disabled"});
  await page.setViewportSize({width:1280,height:900});
  if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw Error("Horizontal overflow");
  await page.screenshot({path:path.join(output,"insights-desktop-1280.png"),animations:"disabled"});
  await page.setViewportSize({width:1440,height:900});
  await chart.getByRole("img").first().focus();
  await page.keyboard.press("End");
  await expect(chart.getByRole("img").last()).toBeFocused();
  await page.getByRole("link",{name:"7 days",exact:true}).click();
  await expect(chart.getByRole("img")).toHaveCount(7);
  await expect(chart.locator('[data-reading-day][tabindex="0"]')).toHaveCount(1);
  const counter=page.locator("[data-browsed-count]");
  await counter.screenshot({path:path.join(output,"insights-count-detail.png"),animations:"disabled"});
  await page.goto(`${instance.origin}/w/${instance.ws}/home`);
  await page.getByRole("heading",{name:"Home",exact:true}).waitFor();
  await expect(page.locator("[data-browsed-count]")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Continue reading"}).locator("[data-list-row]")).toHaveCount(2);
  await expect(page.getByRole("region",{name:"Continue reading"}).locator("time").first()).toHaveText(/ago|just now/);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(output,"home-desktop-light.png"),animations:"disabled"});
  await page.evaluate(()=>localStorage.setItem("kh:theme","dark"));
  await insights(2);
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await page.screenshot({path:path.join(output,"insights-desktop-dark.png"),animations:"disabled"});
  const freshContext=await browser.newContext();const freshPage=await freshContext.newPage();
  await freshPage.goto(`${instance.origin}/w/${instance.ws}/profile`);
  await expect(freshPage.locator("[data-browsed-count]")).toHaveAttribute("data-browsed-count","2");
  await freshContext.close();
  evidence.checks=["Home counter removed", "Insights shows 0, 1, 2 from DB", "30-day and 7-day totals identical", "fresh browser shows same total", "light and dark desktop captures", "7/30 daily bars", "untracked days distinguished from zero", "keyboard tooltip", "period switch retains a keyboard entry point", "1280px no overflow"];
  await context.close();await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
 } finally {
  await browser.close();
  for(const server of servers)if(server.exitCode === null){server.kill("SIGTERM");await new Promise(resolve=>{server.once("close",resolve);setTimeout(resolve,5000);});}
  await pool.end().catch(()=>{});await disposeIsolatedDatabase(handle);await rm(base,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
