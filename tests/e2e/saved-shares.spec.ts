import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3NoSessionOrigin, phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
test.use({ timezoneId: "Asia/Taipei" });
async function capture(page: Page, prefix: string) {
 const root=process.env.KM_SAVED_SHARE_SCREENSHOTS;if(!root)return;
 await mkdir(root,{recursive:true});
 for(const theme of ["light","dark"]){
  await page.evaluate(value=>{document.documentElement.dataset.theme=value;localStorage.setItem("kh:theme",value);},theme);
  for(const [name,width,height] of [["desktop",1440,1000],["mobile",390,844]] as const){
   await page.setViewportSize({width,height});await page.screenshot({path:path.join(root,`${prefix}-${theme}-${name}.png`),fullPage:true});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
 }
 await page.setViewportSize({width:1440,height:1000});
}

test("recipient saves a foreign article, reopens its current content across contexts and removes an unavailable link",async({page,request,browser})=>{
 const doc=await createReviewDocument(request,"A useful handbook shared by someone else.");
 const owner=phase3Origin("reviewOwner"),reader=phase3Origin("nonCreator");
 const workspace=(await (await request.get(`${reader}/api/workspaces`)).json()).items.find((item:{type:string})=>item.type==="PERSONAL").id;
 const edit=await request.patch(`${owner}/api/documents/${doc.documentId}`,{data:{title:"A shared handbook",markdown:"A useful handbook shared by someone else.",expectedCurrentRevisionId:doc.revisionId}});expect(edit.ok()).toBe(true);const revision=await edit.json();
 await page.goto(`${reader}${doc.links[0].path}`);
 const save=page.getByRole("button",{name:"Save share",exact:true});await expect(save).toBeEnabled();await capture(page,"reader-unsaved");await save.click();await expect(page.getByRole("button",{name:"Saved",exact:true})).toHaveAttribute("aria-pressed","true");
 await page.getByRole("link",{name:"View saved shares",exact:true}).click();await expect(page).toHaveURL(new RegExp(`/w/${workspace}/shares\\?tab=saved$`));
 const list=page.getByRole("list",{name:"Saved shares",exact:true});await expect(list.getByRole("link",{name:"A shared handbook",exact:true})).toBeVisible();
 expect((await request.get(`${reader}/api/workspaces/${doc.workspaceId}/saved-shares`)).status()).toBe(404);
 const favorite=await request.put(`${reader}/api/workspaces/${workspace}/personal`,{data:{key:`favorite:${doc.documentId}`,value:{favorite:true},version:0}});expect(favorite.status()).toBe(404);
 const context=await browser.newContext();try{const fresh=await context.newPage();await fresh.goto(`${reader}${doc.links[0].path}`);await expect(fresh.getByRole("button",{name:"Saved",exact:true})).toBeVisible();}finally{await context.close();}
 const update=await request.patch(`${owner}/api/documents/${doc.documentId}`,{data:{title:"A shared handbook",markdown:"The latest handbook content.",expectedCurrentRevisionId:revision.revisionId}});expect(update.ok()).toBe(true);
 await list.getByRole("link",{name:"A shared handbook",exact:true}).click();await expect(page.getByText("The latest handbook content.",{exact:true})).toBeVisible();
 const second=await request.post(`${reader}/api/saved-shares`,{headers:{Origin:reader},data:{token:doc.links[1].path.slice(3)}});expect(second.ok()).toBe(true);
 await request.post(`${owner}/api/share-links/${doc.links[0].id}/revoke`);
 await page.goto(`${reader}/w/${workspace}/shares?tab=saved`);const unavailable=page.getByRole("listitem").filter({hasText:"Link unavailable"});await expect(unavailable).toHaveCount(1);await expect(unavailable.getByRole("link")).toHaveCount(0);
 await capture(page,"saved");
 if(process.env.KM_SAVED_SHARE_SCREENSHOTS){
  await page.goto(`${reader}/w/${workspace}/shares`);await capture(page,"my-shares");
  await page.goto(`${reader}${doc.links[1].path}`);await expect(page.getByRole("button",{name:"Saved",exact:true})).toBeVisible();await capture(page,"reader-saved");
  await page.goto(`${reader}/w/${workspace}/shares?tab=saved`);
 }
 await page.getByRole("listitem").filter({hasText:"Link unavailable"}).getByRole("button",{name:"Remove saved share: A shared handbook",exact:true}).click();await expect(page.getByText("Link unavailable",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Remove saved share: A shared handbook",exact:true}).click();await expect(page.getByText("No saved shares yet.",{exact:true})).toBeVisible();
});

test("anonymous reader sees clear sign-in feedback without losing the article",async({page,request})=>{
 const doc=await createReviewDocument(request,"Public article remains readable.");
 for(const [origin,message] of [[phase3NoSessionOrigin(),"Sign in to save"],[phase3UnconfiguredOrigin(),"Sign-in is unavailable"]]){
  await page.goto(`${origin}${doc.links[0].path}`);await expect(page.getByText("Public article remains readable.",{exact:true})).toBeVisible();const save=page.getByRole("button",{name:"Save share",exact:true});await expect(save).toBeEnabled();await save.click();await expect(page.getByRole("status").filter({hasText:message})).toBeVisible();
 }
});

test("save network failure is recoverable and filters keep the saved section",async({page,request})=>{
 const doc=await createReviewDocument(request),reader=phase3Origin("viewer");
 await page.goto(`${reader}${doc.links[0].path}`);const save=page.getByRole("button",{name:"Save share",exact:true});await expect(save).toBeEnabled();
 await page.route("**/api/saved-shares",route=>route.abort("failed"));await save.click();await expect(page.getByText("Could not save this share. Try again.",{exact:true})).toBeVisible();await expect(save).toHaveAttribute("aria-pressed","false");await page.unroute("**/api/saved-shares");await save.click();await page.getByRole("link",{name:"View saved shares",exact:true}).click();
 await page.getByLabel("Find saved shares",{exact:true}).fill("no matching article");await page.locator("main").getByRole("button",{name:"Search",exact:true}).click();await expect(page).toHaveURL(/tab=saved/);await expect(page.getByText("No saved shares match these filters.",{exact:true})).toBeVisible();await page.getByRole("link",{name:"Clear filters",exact:true}).first().click();await expect(page.getByRole("list",{name:"Saved shares",exact:true}).getByRole("link")).toHaveCount(1);
});
