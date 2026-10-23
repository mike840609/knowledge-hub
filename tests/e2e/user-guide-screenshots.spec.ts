import {mkdir} from "node:fs/promises";
import {test,expect,type Locator,type Page} from "./fixtures/test";

// Not a check: regenerates the user guide's screenshots from a fresh account and the
// zh-TW sample wiki (`make guide-screenshots`). Skipped unless KM_GUIDE_CAPTURE names a directory.
const output=process.env.KM_GUIDE_CAPTURE;
const ROUND_TRIP={timeout:15_000};
test.use({viewport:{width:1280,height:800},deviceScaleFactor:2});

/**
 * Clips `region` (margin, capped height) and shoots both themes. Each target is outlined like a focus
 * ring and numbered at its top-left corner, kept inside the clip, in the order the caption gives the steps.
 */
async function capture(page:Page,name:string,region:Locator,targets:Locator[]=[],{maxHeight=560,margin=16,offset=3}={}) {
  const box=(await region.boundingBox())!;
  const clip={x:Math.max(0,box.x-margin),y:Math.max(0,box.y-margin),width:box.width+margin*2,height:Math.min(box.height+margin*2,maxHeight)};
  const boxes=await Promise.all(targets.map(target=>target.boundingBox()));
  for(const target of targets)await target.evaluate((el,offset)=>{el.style.outline="2px solid var(--kh-focus)";el.style.outlineOffset=`${offset}px`;},offset);
  await page.evaluate(({boxes,clip})=>boxes.forEach((b,i)=>{
    const mark=document.createElement("div");
    mark.className="guide-mark";
    mark.textContent=String(i+1);
    Object.assign(mark.style,{position:"fixed",left:`${Math.max(clip.x+4,b!.x-12)}px`,top:`${Math.max(clip.y+4,b!.y-12)}px`,width:"24px",height:"24px",borderRadius:"9999px",
      background:"var(--kh-primary)",color:"var(--kh-on-primary)",fontSize:"13px",fontWeight:"600",lineHeight:"24px",textAlign:"center",boxShadow:"0 0 0 2px var(--kh-bg)",zIndex:"2147483647"});
    document.body.append(mark);
  }),{boxes,clip});
  for(const theme of ["light","dark"]) {
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await page.screenshot({path:`${output}/${name}-${theme}.png`,clip,animations:"disabled",caret:"hide"});
  }
  await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.querySelectorAll(".guide-mark").forEach(mark=>mark.remove());});
  for(const target of targets)await target.evaluate(el=>{el.style.outline="";el.style.outlineOffset="";});
}

test("capture user guide screenshots",async({page})=>{
  test.skip(!output,"set KM_GUIDE_CAPTURE to a directory to capture");
  await mkdir(output!,{recursive:true});
  const nav=await (await page.request.get("/api/workspaces")).json();
  const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
  const content=page.locator(".kh-page").first();

  await page.goto(`/w/${ws}/sources/import`);
  await capture(page,"import",content,[page.getByRole("button",{name:"Choose folder"})]);
  await page.getByRole("group",{name:"Try with a sample wiki"}).getByRole("button",{name:"繁體中文",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Summary"})).toBeVisible(ROUND_TRIP);
  await capture(page,"preview",content,[page.getByRole("region",{name:/^Warnings \(1\)/}),page.getByRole("button",{name:"Apply changes"})],{maxHeight:800});
  await page.getByRole("button",{name:"Apply changes"}).click();
  await expect(page).toHaveURL(/\/runs\//,ROUND_TRIP);
  const sourceId=page.url().match(/sources\/([^/]+)\//)![1];

  await page.goto(`/w/${ws}/sources/${sourceId}`);
  await capture(page,"sync",content,[page.getByRole("link",{name:"Update from folder"})],{maxHeight:340});

  await page.getByRole("link",{name:"Browse documents"}).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}/[a-f0-9-]+$`),ROUND_TRIP);
  const tree=page.getByRole("tree",{name:"Knowledge tree"});
  await expect(tree).toHaveAttribute("aria-busy","false",ROUND_TRIP);
  const article=page.getByRole("region",{name:"Document content",exact:true}).getByRole("heading",{level:1}).first();
  await capture(page,"reading",page.locator("main"),[tree.getByRole("treeitem",{name:"連結",exact:true}),article],{maxHeight:520,margin:0});

  await page.locator("main").getByRole("button",{name:"Share link…"}).click();
  const dialog=page.getByRole("dialog",{name:"Share link"});
  await dialog.getByRole("textbox",{name:/^Label/}).fill("給專案夥伴");
  await dialog.getByRole("button",{name:"Create link"}).click();
  await expect(dialog.getByRole("button",{name:"Copy link"})).toBeVisible(ROUND_TRIP);
  await capture(page,"share",dialog,[dialog.getByRole("button",{name:"Create link"}),dialog.getByRole("button",{name:"Copy link"})],{maxHeight:800});

  await page.goto(`/w/${ws}/profile?days=30`);
  await capture(page,"insights",content,[page.getByRole("navigation",{name:"Statistics period"})],{maxHeight:660});

  // Sources list, one row of each kind: a web note (Hub), a folder this browser remembers, one it does not.
  await page.goto(`/w/${ws}/sources/import`);
  await page.getByRole("group",{name:"Try with a sample wiki"}).getByRole("button",{name:"English",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Summary"})).toBeVisible(ROUND_TRIP);
  await page.getByRole("button",{name:"Apply changes"}).click();
  await expect(page).toHaveURL(/\/runs\//,ROUND_TRIP);
  const rememberedId=page.url().match(/sources\/([^/]+)\//)![1];
  expect((await page.request.post(`/api/workspaces/${ws}/documents`,{data:{title:"會議筆記",markdown:"# 會議筆記\n\n在網站上直接寫的筆記。"}})).ok()).toBe(true);
  // What picking a folder leaves behind; the row reads only this, so no real folder is needed to show it.
  await page.evaluate(id=>localStorage.setItem(`km:folder-handle:${id}`,JSON.stringify({rootName:"wiki",lastSyncAt:new Date().toISOString()})),rememberedId);
  await page.goto(`/w/${ws}/sources`);
  const rows=page.locator("main li");
  await expect(rows).toHaveCount(3,ROUND_TRIP);
  await capture(page,"sources",content,[
    rows.filter({has:page.getByRole("link",{name:"Notes Hub"})}).locator(":scope > span").first(),
    page.getByRole("button",{name:"Check for changes: Sample wiki"}),
    page.getByRole("link",{name:"Update from folder: 範例知識庫"}),
  ],{maxHeight:320,offset:0});
});
