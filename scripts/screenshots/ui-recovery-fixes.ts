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
const output = path.join(project, "docs/ui-comparisons/ui-recovery-fixes");
const preview = `"use client";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import WorkspaceError from "../error";
export default function Preview() {
 const params = useSearchParams();
 if(params.get("mode") === "error") return <WorkspaceError error={new Error("Screenshot fixture")} reset={()=>{}}/>;
 return <div className="kh-page py-6"><h1 className="text-heading font-semibold">Button interaction states</h1><p className="mt-2 text-body text-kh-text-muted">Left: default. Right: pointer hover.</p>
 {(["primary","danger","secondary"] as const).map(variant=><section key={variant} data-preview-row={variant} className="mt-6 border-b border-kh-border pb-6"><h2 className="mb-3 text-body font-medium">{variant === "primary" ? "Primary action" : variant === "danger" ? "Danger action" : "Secondary action"}</h2><div className="flex gap-6"><Button variant={variant} size="lg">{variant === "primary" ? "Import folder" : variant === "danger" ? "Confirm revoke" : "Search"}</Button><Button variant={variant} size="lg" data-hover-target>{variant === "primary" ? "Import folder" : variant === "danger" ? "Confirm revoke" : "Search"}</Button></div></section>)}</div>;
}`;

async function main() {
 await mkdir(output, {recursive:true});
 const base = await mkdtemp(path.join(tmpdir(), "km-ui-comparison-"));
 const before = path.join(base,"before"), after = path.join(base,"after");
 const handle = await provisionIsolatedDatabase("e2e");
 const cfg = {...databaseConfig("e2e"), database:handle.databaseName};
 const pool = createDatabasePool(cfg);
 const servers: ChildProcess[] = [];
 const browser = await chromium.launch({headless:true});
 const evidence: Record<string, unknown> = {baseline:execFileSync("git",["rev-parse","HEAD"],{cwd:project,encoding:"utf8"}).trim(), capturedAt:new Date().toISOString(), rendering:"Next.js development servers, actual application components, isolated synthetic database", viewports:{desktop:{width:1440,height:900},mobile:{width:390,height:844}}};
 try {
  await runMigrations(pool); await pool.end();
  await mkdir(before); await mkdir(after);
  execFileSync("tar",["-xf","-","-C",before],{input:execFileSync("git",["archive","HEAD"],{cwd:project,maxBuffer:100*1024*1024})});
  for(const file of ["src","public","next.config.ts","next-env.d.ts","tsconfig.json","package.json","postcss.config.mjs","tailwind.config.ts"]) {
   await cp(path.join(project,file),path.join(after,file),{recursive:true}).catch(error=>{if(file !== "public" || error.code !== "ENOENT") throw error;});
  }
  const instances: Array<{label:string;origin:string;ws:string}> = [];
  for(const [label,root,port] of [["before",before,3211],["after",after,3212]] as const) {
   await symlink(path.join(project,"node_modules"),path.join(root,"node_modules"),"dir");
   const cssPath=path.join(root,"src/app/globals.css"); await writeFile(cssPath,(await readFile(cssPath,"utf8"))+"\n/* Screenshot fixture: hide development chrome. */\nnextjs-portal { display: none !important; }\n");
   const route=path.join(root,"src/app/w/[workspaceId]/ui-review-preview"); await mkdir(route,{recursive:true}); await writeFile(path.join(route,"page.tsx"),preview);
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
    const response=await api.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(response.ok()).toBe(true);
   }
   instances.push({label,origin,ws});await api.dispose();console.log(`[screenshots] ${label} ready`);
  }
  // Capture both Home states before search can record completion activity.
  for(const instance of instances) {
   const context=await browser.newContext();const page=await context.newPage();
   for(const [device,width,height] of [["desktop",1440,900],["mobile",390,844]] as const) {
    await page.setViewportSize({width,height});await page.goto(`${instance.origin}/w/${instance.ws}/home`);await page.getByRole("heading",{name:"Home",exact:true}).waitFor();
    await page.evaluate(()=>document.documentElement.removeAttribute("data-theme"));await page.evaluate(()=>document.fonts.ready);
    const guide=page.getByRole("region",{name:"Get started",exact:true});
    expect(await guide.count()).toBe(instance.label === "before" ? 1 : 0);
    await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-home-${device}.png`)});
   }
   await context.close();console.log(`[screenshots] ${instance.label} Home captured`);
  }
  for(const instance of instances) {
   const context=await browser.newContext();
   await context.addInitScript(()=>{const dark=location.pathname.endsWith("/search") || (location.pathname.endsWith("/ui-review-preview") && !location.search.includes("mode=error"));localStorage.setItem("kh:theme",dark?"dark":"light");});
   const page=await context.newPage();const csp:string[]=[];
   page.on("console",message=>{if(message.text().includes("Content Security Policy") && message.text().includes("data:image"))csp.push(message.text());});
   await page.setViewportSize({width:1440,height:900});
   await page.goto(`${instance.origin}/w/${instance.ws}/ui-review-preview`);await page.getByRole("heading",{name:"Button interaction states"}).waitFor();
   await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await page.evaluate(()=>document.fonts.ready);
   for(const variant of ["primary","danger","secondary"]) {
    const row=page.locator(`[data-preview-row="${variant}"]`);await row.locator("[data-hover-target]").hover();
    await row.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-button-${variant}-dark.png`)});
   }
   for(const [device,width,height] of [["desktop",1440,900],["mobile",390,844]] as const) {
    await page.setViewportSize({width,height});await page.goto(`${instance.origin}/w/${instance.ws}/ui-review-preview?mode=error`);
    await page.getByRole("heading",{name:instance.label === "before" ? "Something went wrong" : "This page could not be loaded"}).waitFor();
    await page.evaluate(()=>document.documentElement.removeAttribute("data-theme"));await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-error-${device}.png`)});
   }
   await page.setViewportSize({width:1440,height:900});await page.goto(`${instance.origin}/w/${instance.ws}/search?scope=workspace&q=Team`);
   const input=page.locator("#search-q");await input.waitFor();await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await page.evaluate(()=>document.fonts.ready);
   await input.focus();const box=(await input.boundingBox())!;const rightPadding=await input.evaluate(element=>parseFloat(getComputedStyle(element).paddingRight));const clearX=box.x+box.width-rightPadding-9;await page.mouse.move(clearX,box.y+box.height/2);
   await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-search-dark.png`)});
   const crop={x:Math.floor(box.x-18),y:Math.floor(box.y-12),width:Math.ceil(box.width+36),height:Math.ceil(box.height+24)};
   await page.screenshot({animations:"disabled",path:path.join(output,`${instance.label}-search-clear-detail.png`),clip:crop});
   evidence[`${instance.label}SearchCspBlocked`]=csp.length>0;
   await page.mouse.click(clearX,box.y+box.height/2);
   evidence[`${instance.label}NativeClearWorks`]=(await input.inputValue()) === "";
   if(instance.label === "after") await expect(input).toHaveValue("");
   await context.close();console.log(`[screenshots] ${instance.label} controls, error and search captured`);
  }
  await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2));
  const pairs=[
   ["button-primary-dark","Primary button hover · dark","White text contrast: 3.99:1 → 5.33:1. Pointer is on the right button."],
   ["button-danger-dark","Danger button hover · dark","White text contrast: 4.23:1 → 6.12:1. Pointer is on the right button."],
   ["button-secondary-dark","Secondary button hover · dark","Control boundary contrast: 2.92:1 → 3.18:1. Pointer is on the right button."],
   ["search-clear-detail","Search clear icon · detail","Same filled input, focused, pointer over the clear control, img-src 'self' CSP."],
   ["search-dark","Search · dark desktop","The clear control now loads from a same-origin SVG."],
   ["home-desktop","Existing user Home · desktop","Existing documents; no onboarding preference. After: guide hidden, page-header Import folder removed, Manage sources retained."],
   ["home-mobile","Existing user Home · mobile","Same content at 390 × 844. Hiding the guide makes existing knowledge reachable sooner."],
   ["error-desktop","Workspace error · desktop","Actual error component rendered in a temporary preview route within the workspace shell."],
   ["error-mobile","Workspace error · mobile","Connection guidance, retry and Return to Knowledge at 390 × 844."],
  ];
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>UI recovery fixes — before and after</title><style>body{margin:0;background:#eef0f4;color:#1d1f24;font:16px system-ui}main{max-width:1560px;margin:auto;padding:24px}h1{font-size:26px}section{background:white;padding:24px;margin:24px 0;border:1px solid #d8dce5;border-radius:8px}h2{font-size:20px;margin:0}p{color:#525b6c;line-height:1.5}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.image{display:block;width:100%;height:auto;border:1px solid #d8dce5;box-sizing:border-box}.label{font-size:14px;font-weight:600;margin:12px 0}a{color:#3743a8}.error-mobile a{display:block;height:430px;overflow:hidden}.error-mobile .image{margin-top:-49px}.detail .image{height:72px;object-fit:cover;object-position:right}.mobile .pair{max-width:820px;margin:auto}</style><main><h1>UI recovery fixes — before / after</h1><p>Before: main 1ab16c2b. After: local fixes. Same isolated data, viewports, theme, fonts and CSP. Synthetic Knowledge User; development rendering. Hover/error states use actual components in a temporary preview route.</p>${pairs.map(([id,title,note])=>`<section id="${id}" class="${id === "error-mobile" ? "mobile error-mobile" : id.includes("mobile") ? "mobile" : id.includes("detail") ? "detail" : ""}"><h2>${title}</h2><p>${note}</p><div class="pair">${["before","after"].map(label=>`<div><div class="label">${label === "before" ? "Before — 1ab16c2b" : "After — local fixes"}</div><a href="${label}-${id}.png"><img class="image" src="${label}-${id}.png"></a></div>`).join("")}</div></section>`).join("")}</main></html>`;
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
  await writeFile(path.join(output,"README.md"),`# UI recovery fixes comparison\n\nBaseline: main \`1ab16c2b\`. After: current local fixes. Captures use actual Next.js application pages and components, an isolated synthetic database, identical viewports, and the same CSP. Button and error states are presented by a temporary preview route, removed during cleanup. Desktop: 1440 × 900; mobile: 390 × 844.\n\n[Open the side-by-side gallery](index.html). [Capture evidence](evidence.json).\n\n${pairs.map(([id,title,note])=>`## ${title}\n\n${note}\n\n![Comparison](compare-${id}.png)\n\n[Original before](before-${id}.png) · [Original after](after-${id}.png)\n`).join("\n")}`);
  console.log(`[screenshots] complete: ${output}`);
 } finally {
  await browser.close();
  for(const server of servers)if(server.exitCode === null){server.kill("SIGTERM");await new Promise(resolve=>{server.once("close",resolve);setTimeout(resolve,5000);});}
  await pool.end().catch(()=>{});await disposeIsolatedDatabase(handle);await rm(base,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
