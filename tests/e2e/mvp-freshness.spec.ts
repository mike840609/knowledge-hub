import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {stageReadingFolder} from "./fixtures/folder-reading";
import {createDatabasePool} from "../../src/infrastructure/database/mariadb/pool";
import {databaseConfig} from "../../src/infrastructure/database/mariadb/config";

test("freshness preference persists and reminders link to source actions",async({page,request})=>{
 const previewsToApply:string[]=[];
 try {
 const nav=await(await request.get("/api/workspaces")).json();
 const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
 const endpoint=`/api/workspaces/${ws}/personal/freshness`;
 const initial=await(await request.get(endpoint)).json();
 expect((await request.put(endpoint,{data:{value:{thresholdDays:14},version:initial.version}})).ok()).toBe(true);
 await page.goto(`/w/${ws}/sources`);
 expect((await (await request.get(endpoint)).json()).thresholdDays).toBe(14);

 const sources:Record<string,string>={};
 for(const name of ["Older folder","Failed folder","Pending folder","Never imported folder"]){
  const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:name,fixture:"reading-flow-v1"});
  const result=await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(result.ok()).toBe(true);sources[name]=(await result.json()).sourceId;
 }
 const pending=await stageReadingFolder(request,{workspaceId:ws,sourceName:"Pending folder",sourceId:sources["Pending folder"],fixture:"reading-flow-v1"});
 previewsToApply.push(pending);
 // Keep an unrelated pending preview so standalone runs exercise duplicate action labels too.
 const unrelated=await stageReadingFolder(request,{workspaceId:ws,sourceName:"Unrelated pending folder",fixture:"reading-flow-v1"});
 const unrelatedApply=await request.post(`/api/source-imports/${unrelated}/apply`,{data:{}});
 expect(unrelatedApply.ok()).toBe(true);
 const unrelatedPending=await stageReadingFolder(request,{workspaceId:ws,sourceName:"Unrelated pending folder",sourceId:(await unrelatedApply.json()).sourceId,fixture:"reading-flow-v1"});
 previewsToApply.push(unrelatedPending);
 // Deterministic import-history fixtures in the engineering wrapper's isolated database.
 const pool=createDatabasePool(databaseConfig("e2e"));
 try {
  await pool.query("UPDATE sync_runs SET completed_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 DAY) WHERE source_id=? AND status='APPLIED'",[sources["Older folder"]]);
  await pool.query("UPDATE sync_runs SET status='FAILED',result_version=NULL WHERE source_id=?",[sources["Failed folder"]]);
  await pool.query("DELETE FROM sync_run_changes WHERE source_id=?",[sources["Never imported folder"]]);
  await pool.query("DELETE FROM sync_runs WHERE source_id=?",[sources["Never imported folder"]]);
 } finally {await pool.end();}
 await page.goto(`/w/${ws}/sources`);
 const region=page.getByRole("region",{name:"Knowledge freshness"});
 await region.getByText("Freshness reminder settings", {exact:true}).click();
 // Other full-suite tests may leave pending or old folders in the shared workspace.
 expect(await region.getByRole("link",{name:"Review preview"}).count()).toBeGreaterThan(1);
 const row=(name:string)=>region.getByRole("listitem").filter({has:page.locator(`a[href="/w/${ws}/sources/${sources[name]}"]`)});
 await expect(row("Older folder").getByText("Check for folder updates",{exact:false})).toBeVisible();
 await expect(row("Failed folder").getByText("Latest sync failed",{exact:false})).toBeVisible();
 await expect(row("Never imported folder").getByText("Never imported",{exact:true})).toBeVisible();
 await expect(row("Pending folder").getByRole("link",{name:"Review preview"})).toHaveAttribute("href",`/w/${ws}/sources/imports/${pending}`);
 await expect(row("Failed folder").getByRole("link",{name:"Retry import"})).toHaveAttribute("href",`/w/${ws}/sources/${sources["Failed folder"]}/update`);
 const saved=page.waitForResponse(r=>r.url().endsWith("/personal/freshness")&&r.request().method()==="PUT");
 await region.getByLabel("Freshness threshold").selectOption("30");expect((await saved).ok()).toBe(true);
 await expect(row("Older folder").getByText("Check for folder updates",{exact:false})).toHaveCount(0);
 await page.reload();await region.getByText("Freshness reminder settings", {exact:true}).click();await expect(region.getByLabel("Freshness threshold")).toHaveValue("30");
 const changed=page.waitForResponse(r=>r.url().endsWith("/personal/freshness")&&r.request().method()==="PUT");await region.getByLabel("Freshness threshold").selectOption("7");expect((await changed).ok()).toBe(true);
 await expect(row("Older folder").getByText("Check for folder updates",{exact:false})).toBeVisible();
 await page.goto(`/w/${ws}/home`);
 await expect(page.getByRole("region",{name:"Knowledge freshness"})).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Updates"}).getByRole("link",{name:/sources need attention/})).toHaveAttribute("href",`/w/${ws}/sources`);
 await page.goto(`/w/${ws}/sources`);
 await expect(region.getByLabel("Freshness threshold")).toHaveValue("7");
 const output=path.resolve("docs/ui-comparisons/mvp-freshness");await mkdir(output,{recursive:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(output,"desktop.png"),fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(output,"mobile.png"),fullPage:true,animations:"disabled"});
 await row("Pending folder").getByRole("link",{name:"Review preview"}).click();await expect(page).toHaveURL(new RegExp(`/sources/imports/${pending}$`));
 } finally {
  // Cancellation protects READY previews; apply only this test's unchanged previews to release quota.
  for(const snapshot of previewsToApply) {
   const applied=await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}});
   expect(applied.ok()).toBe(true);
   expect((await applied.json()).kind).toBe("APPLIED");
  }
 }
});
