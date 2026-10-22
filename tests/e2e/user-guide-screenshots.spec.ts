import {mkdir} from "node:fs/promises";
import {test,expect,type Locator,type Page} from "./fixtures/test";

// Not a check: regenerates the user guide's screenshots from a fresh account and the
// zh-TW sample wiki (`make guide-screenshots`). Skipped unless KM_GUIDE_CAPTURE names a directory.
const output=process.env.KM_GUIDE_CAPTURE;
const ROUND_TRIP={timeout:15_000};
test.use({viewport:{width:1280,height:800},deviceScaleFactor:2});

/** Clips `region` (margin, capped height), outlines `target` like a focus ring, shoots both themes. */
async function capture(page:Page,name:string,region:Locator,target?:Locator,maxHeight=560,margin=16) {
  const box=(await region.boundingBox())!;
  const clip={x:Math.max(0,box.x-margin),y:Math.max(0,box.y-margin),width:box.width+margin*2,height:Math.min(box.height+margin*2,maxHeight)};
  await target?.evaluate(el=>{el.style.outline="2px solid var(--kh-focus)";el.style.outlineOffset="3px";});
  for(const theme of ["light","dark"]) {
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await page.screenshot({path:`${output}/${name}-${theme}.png`,clip,animations:"disabled",caret:"hide"});
  }
  await page.evaluate(()=>{document.documentElement.dataset.theme="light";});
  await target?.evaluate(el=>{el.style.outline="";el.style.outlineOffset="";});
}

test("capture user guide screenshots",async({page})=>{
  test.skip(!output,"set KM_GUIDE_CAPTURE to a directory to capture");
  await mkdir(output!,{recursive:true});
  const nav=await (await page.request.get("/api/workspaces")).json();
  const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
  const content=page.locator(".kh-page").first();

  await page.goto(`/w/${ws}/sources/import`);
  await capture(page,"import",content,page.getByRole("button",{name:"Choose folder"}));
  await page.getByRole("group",{name:"Try with a sample wiki"}).getByRole("button",{name:"繁體中文",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Summary"})).toBeVisible(ROUND_TRIP);
  await capture(page,"preview",content,page.getByRole("button",{name:"Apply changes"}),800);
  await page.getByRole("button",{name:"Apply changes"}).click();
  await expect(page).toHaveURL(/\/runs\//,ROUND_TRIP);
  const sourceId=page.url().match(/sources\/([^/]+)\//)![1];

  await page.goto(`/w/${ws}/sources/${sourceId}`);
  await capture(page,"sync",content,page.getByRole("link",{name:"Update from folder"}),340);

  await page.getByRole("link",{name:"Browse documents"}).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}/[a-f0-9-]+$`),ROUND_TRIP);
  await expect(page.getByRole("tree",{name:"Knowledge tree"})).toHaveAttribute("aria-busy","false",ROUND_TRIP);
  await capture(page,"reading",page.locator("main"),undefined,520,0);

  await page.locator("main").getByRole("button",{name:"Share link…"}).click();
  const dialog=page.getByRole("dialog",{name:"Share link"});
  await dialog.getByRole("textbox",{name:/^Label/}).fill("給專案夥伴");
  await dialog.getByRole("button",{name:"Create link"}).click();
  await expect(dialog.getByRole("button",{name:"Copy link"})).toBeVisible(ROUND_TRIP);
  await capture(page,"share",dialog,dialog.getByRole("button",{name:"Copy link"}),800);

  await page.goto(`/w/${ws}/profile?days=30`);
  await capture(page,"insights",content,page.getByRole("navigation",{name:"Statistics period"}),660);
});
