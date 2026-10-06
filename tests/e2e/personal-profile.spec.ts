import {test,expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {stageReadingFolder} from "./fixtures/folder-reading";

test("personal profile counts, detail links, themes and mobile layout",async({page,request},testInfo)=>{
 const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const nav=await (await request.get("/api/workspaces")).json();const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
 const detailCount=async(filter:string)=>{
  await page.goto(`/w/${ws}/profile/articles?filter=${filter}`);
  const text=await page.locator("main header p").textContent();
  expect(text).toMatch(/^\d+ documents?$/);
  return Number(text!.split(" ")[0]);
 };
 const overview=async()=>{
  await page.goto(`/w/${ws}/profile`);
  await expect(page.getByRole("heading",{name:"Insights",exact:true})).toBeVisible();
  const composition=page.getByRole("region",{name:"Your knowledge",exact:true});
  if(await composition.count()===0){
   await expect(page.getByRole("heading",{name:"See your knowledge grow",exact:true})).toBeVisible();
   return {articles:0,folders:0,browsed:0};
  }
  const articles=Number((await page.getByText(/^\d[\d,]* active documents in My Space\.$/).textContent())!.split(" ")[0].replaceAll(",",""));
  const distribution=await page.getByText(/^\d+ documents across \d+ synced folders\.$/).textContent();
  const folders=Number(distribution!.match(/across (\d+)/)![1]);
  const browsed=Number(await page.locator("[data-browsed-count]").getAttribute("data-browsed-count"));
  return {articles,folders,browsed};
 };
 const baseline={...await overview(),favorites:await detailCount("favorites"),unread:await detailCount("unread")};
 let source:string="";
 for(const name of ["Work Wiki","Engineering notes","Reading notes","Product docs"]){
  const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:name,fixture:"reading-flow-v1"});
  const applied=await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(applied.ok()).toBe(true);source=(await applied.json()).sourceId;
 }
 const noteResponse=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:"Dashboard favorite",markdown:"A personal note for the overview."}});expect(noteResponse.status()).toBe(201);const note=await noteResponse.json();
 expect((await request.put(`/api/workspaces/${ws}/personal`,{data:{key:`favorite:${note.documentId}`,value:{favorite:true},version:0}})).ok()).toBe(true);
 await stageReadingFolder(request,{workspaceId:ws,sourceId:source,sourceName:"Product docs",fixture:"reading-flow-v1"});
 const updated=await overview();
 expect(updated.articles).toBe(baseline.articles+9);expect(updated.folders).toBe(baseline.folders+4);expect(updated.browsed).toBe(baseline.browsed);
 expect(await detailCount("favorites")).toBe(baseline.favorites+1);
 await expect(page.getByRole("heading",{name:"Favorites",exact:true,level:1})).toBeVisible();await expect(page.getByRole("link",{name:/Dashboard favorite/})).toBeVisible();
 expect(await detailCount("unread")).toBe(baseline.unread+8);
 await expect(page.getByRole("heading",{name:"Unread updates",exact:true,level:1})).toBeVisible();
 const marked=page.waitForResponse(r=>r.url().endsWith("/read")&&r.request().method()==="POST");
 await page.getByRole("link",{name:/Team guide.*Work Wiki/}).click();expect((await marked).status()).toBe(204);
 const articleHref=page.url();
 expect(await detailCount("unread")).toBe(baseline.unread+7);
 expect((await overview()).browsed).toBe(baseline.browsed+1);
 // Reopening one article must not inflate the cumulative total.
 const reopened=page.waitForResponse(r=>r.url().endsWith("/read")&&r.request().method()==="POST");
 await page.goto(articleHref);expect((await reopened).status()).toBe(204);
 expect((await overview()).browsed).toBe(baseline.browsed+1);
 await page.getByRole("link",{name:"30 days",exact:true}).click();await expect(page).toHaveURL(/days=30$/);await expect(page.getByText("Recorded folder changes in the past 30 days.", {exact:true})).toBeVisible();await expect(page.locator("[data-browsed-count]")).toHaveAttribute("data-browsed-count",String(baseline.browsed+1));
 await page.getByRole("link",{name:/^Awaiting Apply:/}).click();await expect(page).toHaveURL(new RegExp(`/w/${ws}/profile/sync\\?filter=pending$`));await expect(page.getByRole("heading",{name:"Awaiting Apply",exact:true,level:1})).toBeVisible();await expect(page.getByRole("link",{name:/Product docs.*Review preview before Apply/})).toBeVisible();
 await page.goto(`/w/${ws}/profile?days=7`);
 await page.getByText("How counts work",{exact:true}).click();await expect(page.getByText("When these statistics were requested.",{exact:false})).toBeVisible();await page.getByText("How counts work",{exact:true}).click();
 const oldTime=await page.locator("footer time").getAttribute("datetime");await page.getByRole("button",{name:"Refresh statistics"}).click();await expect(page.locator("footer time")).not.toHaveAttribute("datetime",oldTime!);
 const output=process.env.KM_PROFILE_SCREENSHOTS??testInfo.outputPath("profile");await mkdir(output,{recursive:true});
 await page.setViewportSize({width:1440,height:1280});
 await page.goto(`/w/${ws}/home`);
 await expect(page.getByRole("region",{name:"Personal statistics"})).toHaveCount(0);
 await expect(page.locator("[data-browsed-count]")).toHaveCount(0);
 await expect(page.getByRole("region",{name:"Continue reading"}).getByRole("link",{name:/Team guide/})).toBeVisible();
 await page.screenshot({path:path.join(output,"home-light.png"),fullPage:true,animations:"disabled"});
 await page.getByRole("navigation",{name:"Primary"}).getByRole("link",{name:"Insights"}).click();
 await expect(page.locator("[data-browsed-count]")).toHaveAttribute("data-browsed-count",String(baseline.browsed+1));
 await expect(page.getByRole("heading",{name:"Insights",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"Sync overview",exact:true})).toBeVisible();
 await page.screenshot({path:path.join(output,"desktop-light.png"),fullPage:true,animations:"disabled"});
 await page.getByRole("button",{name:/^Account:/}).click();await page.getByRole("menuitemradio",{name:"Dark",exact:true}).click();await page.keyboard.press("Escape");await expect(page.locator("html")).toHaveAttribute("data-theme","dark");await page.screenshot({path:path.join(output,"desktop-dark.png"),fullPage:true,animations:"disabled"});
 await page.getByRole("button",{name:/^Account:/}).click();await page.getByRole("menuitemradio",{name:"Light",exact:true}).click();await page.keyboard.press("Escape");
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole("heading",{name:"Insights",exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:path.join(output,"mobile-top.png"),animations:"disabled"});await page.getByRole("heading",{name:"Sync overview",exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,"mobile-bottom.png"),animations:"disabled"});
 expect(errors).toEqual([]);
});

test("Team workspace has no personal profile route or navigation entry",async({page,request})=>{
 const nav=await (await request.get("/api/workspaces")).json();const team=nav.items.find((w:{type:string})=>w.type==="TEAM");test.skip(!team,"Personal-only rollout has no Team workspace.");
 await page.goto(`/w/${team.id}/profile`);await expect(page.getByRole("heading",{name:"Not found or no access"})).toBeVisible();await expect(page.getByRole("link",{name:"Insights",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Your knowledge",exact:true})).toHaveCount(0);
});
