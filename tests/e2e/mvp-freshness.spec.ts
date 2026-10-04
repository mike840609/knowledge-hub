import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {stageReadingFolder} from "./fixtures/folder-reading";
import {createDatabasePool} from "../../src/infrastructure/database/mariadb/pool";
import {databaseConfig} from "../../src/infrastructure/database/mariadb/config";

test("freshness preference persists and reminders link to source actions",async({page,request})=>{
 const nav=await(await request.get("/api/workspaces")).json();
 const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
 const sources:Record<string,string>={};
 for(const name of ["Older folder","Failed folder","Pending folder","Never imported folder"]){
  const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:name,fixture:"reading-flow-v1"});
  const result=await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(result.ok()).toBe(true);sources[name]=(await result.json()).sourceId;
 }
 const pending=await stageReadingFolder(request,{workspaceId:ws,sourceName:"Pending folder",sourceId:sources["Pending folder"],fixture:"reading-flow-v1"});
 // Deterministic import-history fixtures in the engineering wrapper's isolated database.
 const pool=createDatabasePool(databaseConfig("e2e"));
 try {
  await pool.query("UPDATE sync_runs SET completed_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 20 DAY) WHERE source_id=? AND status='APPLIED'",[sources["Older folder"]]);
  await pool.query("UPDATE sync_runs SET status='FAILED',result_version=NULL WHERE source_id=?",[sources["Failed folder"]]);
  await pool.query("DELETE FROM sync_run_changes WHERE source_id=?",[sources["Never imported folder"]]);
  await pool.query("DELETE FROM sync_runs WHERE source_id=?",[sources["Never imported folder"]]);
 } finally {await pool.end();}
 await page.goto(`/w/${ws}/home`);
 const region=page.getByRole("region",{name:"Knowledge freshness"});
 await expect(region.getByText("Import may be outdated",{exact:false})).toBeVisible();
 await expect(region.getByText("Latest sync failed",{exact:false})).toBeVisible();
 await expect(region.getByText("Never imported",{exact:true})).toBeVisible();
 await expect(region.getByRole("link",{name:"Review preview"})).toHaveAttribute("href",`/w/${ws}/sources/imports/${pending}`);
 await expect(region.getByRole("link",{name:"Retry import"})).toHaveAttribute("href",`/w/${ws}/sources/${sources["Failed folder"]}/update`);
 const saved=page.waitForResponse(r=>r.url().endsWith("/personal/freshness")&&r.request().method()==="PUT");
 await region.getByLabel("Freshness threshold").selectOption("30");expect((await saved).ok()).toBe(true);
 await expect(region.getByText("Import may be outdated",{exact:false})).toHaveCount(0);
 await page.reload();await expect(region.getByLabel("Freshness threshold")).toHaveValue("30");
 const changed=page.waitForResponse(r=>r.url().endsWith("/personal/freshness")&&r.request().method()==="PUT");await region.getByLabel("Freshness threshold").selectOption("7");expect((await changed).ok()).toBe(true);
 await expect(region.getByText("Import may be outdated",{exact:false})).toBeVisible();
 const output=path.resolve("docs/ui-comparisons/mvp-freshness");await mkdir(output,{recursive:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(output,"desktop.png"),fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});await region.scrollIntoViewIfNeeded();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(output,"mobile.png"),fullPage:true,animations:"disabled"});
 await region.getByRole("link",{name:"Review preview"}).click();await expect(page).toHaveURL(new RegExp(`/sources/imports/${pending}$`));
});
