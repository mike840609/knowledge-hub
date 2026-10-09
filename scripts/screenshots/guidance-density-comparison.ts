import "dotenv/config";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
const output = path.join(project, "docs/ui-comparisons/guidance-density-comparison");
async function main() {
 await mkdir(output, {recursive:true});
 const base = await mkdtemp(path.join(tmpdir(), "km-ui-comparison-"));
 const before = path.join(base,"before"), after = path.join(base,"after");
 const handle = await provisionIsolatedDatabase("e2e");
 const cfg = {...databaseConfig("e2e"), database:handle.databaseName};
 const pool = createDatabasePool(cfg);
 const servers: ChildProcess[] = [];
 const browser = await chromium.launch({headless:true});
 const evidence: Record<string, unknown> = {baseline:execFileSync("git",["rev-parse","HEAD"],{cwd:project,encoding:"utf8"}).trim(), capturedAt:new Date().toISOString(), rendering:"Next.js development servers, actual application components, isolated synthetic database", viewports:{desktop:{width:1440,height:1000}}};
 try {
  await runMigrations(pool); await pool.end();
  await mkdir(before); await mkdir(after);
  execFileSync("tar",["-xf","-","-C",before],{input:execFileSync("git",["archive","HEAD"],{cwd:project,maxBuffer:100*1024*1024})});
  for(const file of ["src","public","next.config.ts","next-env.d.ts","tsconfig.json","package.json","postcss.config.mjs","tailwind.config.ts"]) {
   await cp(path.join(project,file),path.join(after,file),{recursive:true}).catch(error=>{if(file !== "public" || error.code !== "ENOENT") throw error;});
  }
  let sourceId = "";
  const instances: Array<{label:string;origin:string;ws:string}> = [];
  for(const [label,root,port] of [["before",before,3231],["after",after,3232]] as const) {
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
    const snapshot=await stageReadingFolder(api,{workspaceId:ws,sourceName:"Team knowledge",fixture:"reading-flow-v1"});
    const response=await api.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(response.ok()).toBe(true); sourceId = (await response.json()).sourceId;
   }
   instances.push({label,origin,ws});await api.dispose();console.log(`[screenshots] ${label} ready`);
  }

  const first=instances[0];
  const api=await request.newContext({baseURL:first.origin});
  if(!sourceId) throw Error("Missing seeded folder source");
  const snapshot=await stageReadingFolder(api,{workspaceId:first.ws,sourceName:"Preview example",fixture:"reading-flow-v1"});
  await api.dispose();
  const pairs = [
    ["sources","Sources","/sources","常駐提醒設定與說明改為收合；回報區塊移到帳號選單。"],
    ["import","Import folder","/sources/import","合併頁首說明，移除 sample 重複段落，排除規則收合。"],
    ["update","Update from folder",`/sources/${sourceId}/update`,"移除重複的完整資料夾指示與頁首同步版本。"],
    ["graph","Graph","/graph?view=list","篩選器定義移到 About graph filters。"],
    ["context","Copy for Agent","/agent-context","流程只說明一次，限制放到 Prepare context 旁。"],
    ["health","Source health","/sources/health","合併重複的頁首介绍。"],
    ["preview","Import preview",`/sources/imports/${snapshot}`,"教學與完整排除路徑收合；警告仍可見。"],
    ["insights","Insights","/profile","統計定義移到 How counts work。"],
  ];
  for(const instance of instances) {
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(()=>localStorage.setItem("kh:theme","light"));
    const page=await context.newPage();
    for(const [id,title,route] of pairs) {
      await page.goto(`${instance.origin}/w/${instance.ws}${route}`);
      await page.getByRole("heading",{level:1,name:title,exact:true}).waitFor();
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({animations:"disabled",fullPage:true,path:path.join(output,`${instance.label}-${id}.png`)});
      console.log(`[screenshots] ${instance.label} ${id}`);
    }
    await context.close();
  }
  const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>引導文字精簡：修正前後</title><style>body{margin:0;background:#eef0f4;color:#1d1f24;font:16px system-ui}main{max-width:1760px;margin:auto;padding:24px}h1{font-size:28px}section{background:white;padding:24px;margin:24px 0;border:1px solid #d8dce5;border-radius:8px}h2{font-size:22px;margin:0}p{color:#525b6c;line-height:1.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}img{display:block;width:100%;height:auto;border:1px solid #d8dce5;box-sizing:border-box}.label{font-weight:600;margin:12px 0}nav{display:flex;flex-wrap:wrap;gap:16px}a{color:#3743a8}</style><main><h1>桌面版引導文字：修正前後</h1><p>Before：Git HEAD ${String(evidence.baseline).slice(0, 7)}。After：目前工作區修改。相同測試資料、1440 × 1000 桌面視窗、淺色主題、實際頁面，完整頁面截圖。開發伺服器；隱藏開發工具浮標。</p><nav>${pairs.map(([id,title])=>`<a href="#${id}">${title}</a>`).join("")}</nav>${pairs.map(([id,title,,note])=>`<section id="${id}"><h2>${title}</h2><p>${note}</p><div class="pair">${["before","after"].map(label=>`<div><div class="label">${label === "before" ? "修正前" : "修正後"}</div><a href="${label}-${id}.png"><img src="${label}-${id}.png"></a></div>`).join("")}</div></section>`).join("")}</main></html>`;
  await writeFile(path.join(output,"index.html"),html);
  const gallery=await browser.newPage({viewport:{width:1800,height:1100}});
  let inline=html;
  for(const [id] of pairs)for(const label of ["before","after"])inline=inline.replace(`src="${label}-${id}.png"`,`src="data:image/png;base64,${(await readFile(path.join(output,`${label}-${id}.png`))).toString("base64")}"`);
  await gallery.setContent(inline);
  for(const [id] of pairs)await gallery.locator(`#${id}`).screenshot({path:path.join(output,`compare-${id}.png`)});
  await gallery.close();
  await writeFile(path.join(output,"evidence.json"),JSON.stringify({...evidence,sourceId,snapshot,pages:pairs},null,2));
  await writeFile(path.join(output,"README.md"),`# 桌面版修正前後比較\n\n基準：Git HEAD ${String(evidence.baseline).slice(0, 7)}；修正後：目前未提交的工作區。相同 isolated synthetic database、local identity、淺色主題、1440 × 1000 視窗，實際 Next.js 開發頁面；full-page 截圖高度隨內容變動。包含本次精簡以及前面移動回報入口的修改。\n\n[並排比較](index.html) · [擷取紀錄](evidence.json)\n\n${pairs.map(([id,title,,note])=>`## ${title}\n\n${note}\n\n![比較](compare-${id}.png)\n`).join("\n")}`);
  console.log(`[screenshots] complete: ${output}`);
 } finally {
  await browser.close();
  for(const server of servers)if(server.exitCode === null){server.kill("SIGTERM");await new Promise(resolve=>{server.once("close",resolve);setTimeout(resolve,5000);});}
  await pool.end().catch(()=>{});await disposeIsolatedDatabase(handle);await rm(base,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
