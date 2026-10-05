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
const baselineRoot = process.env.KM_HOME_BASELINE_ROOT ?? "";
if (!baselineRoot) throw new Error("Set KM_HOME_BASELINE_ROOT to a source snapshot saved before the Home simplification.");
const output = path.join(project, "docs/ui-comparisons/home-desktop-simplification");
async function main() {
 await mkdir(output, {recursive:true});
 const base = await mkdtemp(path.join(tmpdir(), "km-ui-comparison-"));
 const before = path.join(base,"before"), after = path.join(base,"after");
 const handle = await provisionIsolatedDatabase("e2e");
 const cfg = {...databaseConfig("e2e"), database:handle.databaseName};
 const pool = createDatabasePool(cfg);
 const servers: ChildProcess[] = [];
 const browser = await chromium.launch({headless:true});
 const evidence: Record<string, unknown> = {baseline:"Local Home before simplification, including earlier UI fixes", capturedAt:new Date().toISOString(), rendering:"Next.js development servers, actual application components, isolated synthetic database", viewports:{desktop:{width:1440,height:900},narrowDesktop:{width:1280,height:800}}};
 try {
  await runMigrations(pool); await pool.end();
  await mkdir(before); await mkdir(after);
  for (const [root,source] of [[before,baselineRoot],[after,project]]) {
   for(const file of ["src","public","next.config.ts","next-env.d.ts","tsconfig.json","package.json","postcss.config.mjs","tailwind.config.ts"]) await cp(path.join(source,file),path.join(root,file),{recursive:true});
  }
  const instances: Array<{label:string;origin:string;ws:string}> = [];
  for(const [label,root,port] of [["before",before,3211],["after",after,3212]] as const) {
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
    for (const sourceName of ["Team knowledge","Engineering handbook","Product reference"]) {
     const snapshot=await stageReadingFolder(api,{workspaceId:ws,sourceName,fixture:"reading-flow-v1"});
     const response=await api.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(response.ok()).toBe(true);
    }
    expect((await api.put(`/api/workspaces/${ws}/onboarding`,{data:{value:{schemaVersion:1,dismissed:true},version:0}})).ok()).toBe(true);
    expect((await api.put(`/api/workspaces/${ws}/personal`,{data:{key:"draft:new",value:{title:"Release planning notes",markdown:"# Release planning notes\nNext steps",baseRevisionId:null},version:0}})).ok()).toBe(true);
   }
   instances.push({label,origin,ws});await api.dispose();console.log(`[screenshots] ${label} ready`);
  }
  const seedApi=await request.newContext({baseURL:instances[0].origin});
  const targets=await (await seedApi.get(`/api/workspaces/${instances[0].ws}/link-targets`)).json();
  const docs=Array.isArray(targets) ? targets : targets.targets;
  const recent=docs.map((doc:{sourceId:string;documentId:string})=>`${doc.sourceId}:${doc.documentId}`);
  await seedApi.dispose();
  for(const instance of instances) {
   for(const [id,width,height,theme] of [["desktop-light",1440,900,"light"],["desktop-dark",1440,900,"dark"],["desktop-1280",1280,800,"light"]] as const) {
    const context=await browser.newContext({viewport:{width,height}});
    await context.addInitScript(({ws,recent,theme})=>{localStorage.setItem("kh:theme",theme);localStorage.setItem(`kh:document-shortcuts:${ws}`,JSON.stringify({favorites:[],recent}));},{ws:instance.ws,recent,theme});
    const page=await context.newPage();await page.goto(`${instance.origin}/w/${instance.ws}/home`);
    await page.getByRole("heading",{name:"Home",exact:true}).waitFor();
    await page.getByRole("region",{name:"Continue reading",exact:true}).waitFor();
    await expect(page.getByRole("region",{name:"Continue reading",exact:true}).locator("[data-list-row]")).toHaveCount(instance.label === "before" ? 4 : 6);
    await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    await page.mouse.move(0,0);
    await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-${id}.png`)});
    await page.screenshot({animations:"disabled",fullPage:true,path:path.join(output,`${instance.label}-${id}-full.png`)});
    if(instance.label === "after") {
     const headings=await page.locator(".kh-page h2").allTextContents();
     expect(headings).toEqual(["Continue reading","Updates"]);
     const left=await page.getByRole("region",{name:"Continue reading",exact:true}).boundingBox();
     const right=await page.getByRole("region",{name:"Updates",exact:true}).boundingBox();
     expect(Math.abs(left!.y-right!.y)).toBeLessThan(2);
     expect(right!.x).toBeGreaterThan(left!.x+left!.width);
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
     evidence[id]={headings,columns:{left,right},horizontalOverflow:overflow};
    }
    await context.close();console.log(`[screenshots] ${instance.label} ${id} captured`);
   }
  }
  const attentionApi=await request.newContext({baseURL:instances[0].origin});
  const previewId=await stageReadingFolder(attentionApi,{workspaceId:instances[0].ws,sourceId:docs[0].sourceId,sourceName:docs[0].sourceName,fixture:"reading-flow-v2"});
  await attentionApi.dispose();
  for(const instance of instances) {
   const context=await browser.newContext({viewport:{width:1440,height:900}});
   await context.addInitScript(({ws,recent})=>{localStorage.setItem("kh:theme","light");localStorage.setItem(`kh:document-shortcuts:${ws}`,JSON.stringify({favorites:[],recent}));},{ws:instance.ws,recent});
   const page=await context.newPage();await page.goto(`${instance.origin}/w/${instance.ws}/home`);
   await page.getByRole("region",{name:"Continue reading",exact:true}).waitFor();
   await expect(page.getByRole("region",{name:"Continue reading",exact:true}).locator("[data-list-row]")).toHaveCount(instance.label === "before" ? 4 : 6);
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-desktop-attention.png`)});
   await page.screenshot({animations:"disabled",fullPage:true,path:path.join(output,`${instance.label}-desktop-attention-full.png`)});
   if(instance.label === "after") {
    const reminder=page.getByRole("link",{name:`Awaiting Apply · Review preview ${docs[0].sourceName}`});
    await expect(reminder).toHaveAttribute("href",`/w/${instance.ws}/sources/imports/${previewId}`);
    await page.getByRole("button",{name:"Home actions",exact:true}).click();
    await expect(page.getByRole("menuitem",{name:"Copy for Agent",exact:true})).toBeVisible();
    await page.getByRole("menuitem",{name:"Manage sources",exact:true}).click();
    await page.getByRole("heading",{name:"Sources",exact:true}).waitFor();
    await expect(page.getByRole("combobox",{name:"Freshness threshold"})).toBeVisible();
    evidence.sourceSettingsMoved=true;
   }
   await context.close();
  }
  await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2));
  const pairs=[
   ["desktop-light","Desktop Home · light · 1440 × 900","Same user and content. Search + Continue reading + Updates; draft included in the reading column."],
   ["desktop-dark","Desktop Home · dark · 1440 × 900","Same layout and data in the existing dark palette."],
   ["desktop-attention","Desktop Home · source needs attention","A pending import stays actionable within Updates, without adding a separate Home section."],
   ["desktop-1280","Desktop Home · light · 1280 × 800","The two columns remain usable on a smaller desktop viewport."],
  ];
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>Desktop Home simplification — before and after</title><style>body{margin:0;background:#eef0f4;color:#1d1f24;font:16px system-ui}main{max-width:1560px;margin:auto;padding:24px}h1{font-size:26px}section{background:white;padding:24px;margin:24px 0;border:1px solid #d8dce5;border-radius:8px}h2{font-size:20px;margin:0}p{color:#525b6c;line-height:1.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.image{display:block;width:100%;height:auto;border:1px solid #d8dce5;box-sizing:border-box}.label{font-size:14px;font-weight:600;margin:12px 0}a{color:#3743a8}.error-mobile a{display:block;height:430px;overflow:hidden}.error-mobile .image{margin-top:-49px}.detail .image{height:72px;object-fit:cover;object-position:right}.mobile .pair{max-width:820px;margin:auto}</style><main><h1>Desktop Home simplification — before / after</h1><p>Before: local Home with earlier UI fixes. After: desktop simplification. Same isolated data, recent history, viewports, theme, fonts and CSP. Synthetic Knowledge User; actual application pages.</p>${pairs.map(([id,title,note])=>`<section id="${id}" class="${id === "error-mobile" ? "mobile error-mobile" : id.includes("mobile") ? "mobile" : id.includes("detail") ? "detail" : ""}"><h2>${title}</h2><p>${note}</p><div class="pair">${["before","after"].map(label=>`<div><div class="label">${label === "before" ? "Before — existing Home" : "After — simplified Home"}</div><a href="${label}-${id}.png"><img class="image" src="${label}-${id}.png"></a></div>`).join("")}</div></section>`).join("")}</main></html>`;
  await writeFile(path.join(output,"index.html"),html);
  const gallery=await browser.newPage({viewport:{width:1600,height:1000}});
  // Inline captured images to render a portable comparison without a persistent server.
  let inline=html;
  for(const [id] of pairs)for(const label of ["before","after"]) {
   const data=(await readFile(path.join(output,`${label}-${id}.png`))).toString("base64");inline=inline.replace(`src="${label}-${id}.png"`,`src="data:image/png;base64,${data}"`);
  }
  await gallery.setContent(inline);await gallery.locator("img").evaluateAll(images=>Promise.all(images.map(image=>(image as HTMLImageElement).decode())));
  for(const [id] of pairs){await gallery.setViewportSize({width:id.includes("mobile") || id.includes("detail") ? 900 : 1600,height:1100});await gallery.locator(`#${id}`).screenshot({animations:"disabled",path:path.join(output,`compare-${id}.png`)});}
  await gallery.close();
  await writeFile(path.join(output,"README.md"),`# Desktop Home comparison\n\nBefore: local Home immediately before this simplification, retaining earlier contrast/CSP/onboarding/error fixes. After: current desktop simplification. Both use the same isolated database, six imported documents and one draft, recent history, theme, viewport, application shell and fonts. Existing user's Getting started is dismissed in both. The attention pair stages a pending update to Product reference in the same database. No production data.\n\n[Side-by-side gallery](index.html) · [Capture evidence](evidence.json)\n\nTo rerun: save a complete source snapshot before editing (src, public and root Next/Tailwind/TypeScript/package configs), then run \`KM_HOME_BASELINE_ROOT=/path/to/snapshot npx tsx scripts/screenshots/home-desktop-simplification.ts\`. Browser captures wait for recent history hydration before taking images.\n\n${pairs.map(([id,title,note])=>`## ${title}\n\n${note}\n\n![Comparison](compare-${id}.png)\n\n[Before](before-${id}.png) · [After](after-${id}.png) · [Before full page](before-${id}-full.png) · [After full page](after-${id}-full.png)\n`).join("\n")}`);
  console.log(`[screenshots] complete: ${output}`);
 } finally {
  await browser.close();
  for(const server of servers)if(server.exitCode === null){server.kill("SIGTERM");await new Promise(resolve=>{server.once("close",resolve);setTimeout(resolve,5000);});}
  await pool.end().catch(()=>{});await disposeIsolatedDatabase(handle);await rm(base,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
