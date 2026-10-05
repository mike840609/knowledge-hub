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
const output = path.join(project, "docs/ui-comparisons/home-review-fixes");
async function main() {
 await mkdir(output, {recursive:true});
 const base = await mkdtemp(path.join(tmpdir(), "km-ui-comparison-"));
 const before = path.join(base,"before"), after = path.join(base,"after");
 const handle = await provisionIsolatedDatabase("e2e");
 const cfg = {...databaseConfig("e2e"), database:handle.databaseName};
 const pool = createDatabasePool(cfg);
 const servers: ChildProcess[] = [];
 const browser = await chromium.launch({headless:true});
 const evidence: Record<string, unknown> = {baseline:"Current Home with the two review fixes", capturedAt:new Date().toISOString(), rendering:"Next.js development servers, actual application components, isolated synthetic database", viewports:{desktop:{width:1440,height:900},narrowDesktop:{width:1280,height:800}}};
 try {
  await runMigrations(pool); await pool.end();
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
  const doc=docs[0]; const key=`${doc.sourceId}:${doc.documentId}`;
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript(()=>localStorage.setItem("kh:theme","light"));
  const page=await context.newPage();
  await page.goto(`${instance.origin}/w/${instance.ws}/knowledge/${doc.sourceId}/${doc.documentId}`);
  await page.getByRole("button",{name:"Document display options",exact:true}).waitFor();
  await page.waitForFunction(({ws,key})=>Boolean(JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt?.[key]),{ws:instance.ws,key});
  const initial=await page.evaluate(({ws,key})=>JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt[key],{ws:instance.ws,key});
  await page.getByRole("button",{name:"Document display options",exact:true}).click();
  await page.getByRole("menuitemcheckbox",{name:"Show archived",exact:true}).click();
  await expect(page).toHaveURL(/includeArchived=true/);
  await page.getByRole("button",{name:"Document display options",exact:true}).click();
  await expect(page.getByRole("menuitemcheckbox",{name:"Show archived",exact:true})).toHaveAttribute("aria-checked","true");
  await page.keyboard.press("Escape");
  await page.waitForLoadState("networkidle");
  const afterFilter=await page.evaluate(({ws,key})=>JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt[key],{ws:instance.ws,key});
  expect(afterFilter).toBe(initial);
  evidence.openTimePreservedByFilter={documentId:doc.documentId,initial,afterFilter,route:page.url()};
  const other=docs.find((d:{documentId:string;sourceId:string})=>d.sourceId===doc.sourceId&&d.documentId!==doc.documentId);
  const otherKey=`${other.sourceId}:${other.documentId}`;
  await page.locator(`a[href="/w/${instance.ws}/knowledge/${other.sourceId}/${other.documentId}?includeArchived=true"]`).first().click();
  await page.waitForFunction(({ws,key})=>Boolean(JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt?.[key]),{ws:instance.ws,key:otherKey});
  await page.locator(`a[href="/w/${instance.ws}/knowledge/${doc.sourceId}/${doc.documentId}?includeArchived=true"]`).first().click();
  await page.waitForFunction(({ws,key,initial})=>Date.parse(JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt?.[key])>Date.parse(initial),{ws:instance.ws,key,initial});
  const reopened=await page.evaluate(({ws,key})=>JSON.parse(localStorage.getItem(`kh:document-shortcuts:${ws}`)||"{}").openedAt[key],{ws:instance.ws,key});
  evidence.reopeningRecordsNewTime={initial,reopened};
  const recent=docs.map((d:{sourceId:string;documentId:string})=>`${d.sourceId}:${d.documentId}`);
  await page.evaluate(({ws,recent})=>localStorage.setItem(`kh:document-shortcuts:${ws}`,JSON.stringify({recent,favorites:[]})),{ws:instance.ws,recent});
  await page.goto(`${instance.origin}/w/${instance.ws}/home`);
  await expect(page.getByRole("region",{name:"Continue reading"}).locator("[data-list-row]")).toHaveCount(5);
  expect(await page.getByRole("region",{name:"Continue reading"}).locator("time").count()).toBe(0);
  evidence.legacyRecentDatesOmitted=true;
  for(const width of [1440,1280,1100]) {
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>document.fonts.ready);
   const metadata=await page.getByRole("region",{name:"Updates"}).locator("li").evaluateAll(rows=>rows.map(row=>{
    const status=row.querySelector(".shrink-0")!;
    const source=status.previousElementSibling!;
    const link=row.querySelector("a")!.getBoundingClientRect();
    const box=status.getBoundingClientRect();
    return {status:status.textContent,statusFits:status.scrollWidth<=status.clientWidth&&box.right<=link.right,sourceClipped:source.scrollWidth>source.clientWidth};
   }));
   expect(metadata.every(item=>item.statusFits)).toBe(true);
   const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   expect(horizontalOverflow).toBe(false);
   evidence[`width${width}`]={horizontalOverflow,metadata};
   await page.screenshot({path:path.join(output,`desktop-${width}-long-source.png`),animations:"disabled"});
  }
  await context.close();
  await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
 } finally {
  await browser.close();
  for(const server of servers)if(server.exitCode === null){server.kill("SIGTERM");await new Promise(resolve=>{server.once("close",resolve);setTimeout(resolve,5000);});}
  await pool.end().catch(()=>{});await disposeIsolatedDatabase(handle);await rm(base,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
