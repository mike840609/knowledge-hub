import {mkdir} from "node:fs/promises";
import {spawn} from "node:child_process";
import {test,expect,type Locator,type Page} from "./fixtures/test";
import {phase3Origin} from "./fixtures/phase3-identities";
import {stageReadingFolder} from "./fixtures/folder-reading";

// Not a check: regenerates the user guide's screenshots from a fresh account and the
// zh-TW sample wiki (`make guide-screenshots`). Skipped unless KM_GUIDE_CAPTURE names a directory.
// KM_GUIDE_ONLY limits a run to named groups so an unrelated recapture cannot rewrite screens.
const output=process.env.KM_GUIDE_CAPTURE;
const only=process.env.KM_GUIDE_ONLY?.split(",").filter(Boolean);
const wanted=(name:string)=>!only||only.includes(name);
const ROUND_TRIP={timeout:15_000};
test.use({viewport:{width:1280,height:800},deviceScaleFactor:2});

/**
 * Clips `region` (margin, capped height) and shoots both themes. Each target is outlined like a focus
 * ring and numbered at its top-left corner (top-right when `markSide` is `"right"`), kept inside the
 * clip, in the order the caption gives the steps.
 */
async function capture(page:Page,name:string,region:Locator,targets:Locator[]=[],{maxHeight=560,margin=16,offset=3,markSide="left"}:{maxHeight?:number;margin?:number;offset?:number;markSide?:"left"|"right"}={}) {
  const box=(await region.boundingBox())!;
  const clip={x:Math.max(0,box.x-margin),y:Math.max(0,box.y-margin),width:box.width+margin*2,height:Math.min(box.height+margin*2,maxHeight)};
  const boxes=await Promise.all(targets.map(target=>target.boundingBox()));
  for(const target of targets)await target.evaluate((el,offset)=>{el.style.outline="2px solid var(--kh-focus)";el.style.outlineOffset=`${offset}px`;},offset);
  await page.evaluate(({boxes,clip,markSide})=>boxes.forEach((b,i)=>{
    const mark=document.createElement("div");
    mark.className="guide-mark";
    mark.textContent=String(i+1);
    Object.assign(mark.style,{position:"fixed",left:`${markSide==="right"?Math.min(clip.x+clip.width-28,b!.x+b!.width-28):Math.max(clip.x+4,b!.x-12)}px`,top:`${Math.max(clip.y+4,b!.y-12)}px`,width:"24px",height:"24px",borderRadius:"9999px",
      background:"var(--kh-primary)",color:"var(--kh-on-primary)",fontSize:"13px",fontWeight:"600",lineHeight:"24px",textAlign:"center",boxShadow:"0 0 0 2px var(--kh-bg)",zIndex:"2147483647"});
    document.body.append(mark);
  }),{boxes,clip,markSide});
  for(const theme of ["light","dark"]) {
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await page.screenshot({path:`${output}/${name}-${theme}.png`,clip,animations:"disabled",caret:"hide"});
  }
  await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.querySelectorAll(".guide-mark").forEach(mark=>mark.remove());});
  for(const target of targets)await target.evaluate(el=>{el.style.outline="";el.style.outlineOffset="";});
}

test("capture user guide screenshots",async({page,request})=>{
  test.skip(!output,"set KM_GUIDE_CAPTURE to a directory to capture");
  await mkdir(output!,{recursive:true});
  const nav=await (await page.request.get("/api/workspaces")).json();
  const ws=nav.items.find((w:{type:string})=>w.type==="PERSONAL").id;
  const content=page.locator(".kh-page").first();

  if(wanted("existing")) {
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
  }

  if(wanted("tasks")||wanted("inbox")) {
    // A real folder supplies a resolvable Wiki reference for the Task detail.
    const folder=await stageReadingFolder(request,{workspaceId:ws,sourceName:"Task references",fixture:"task-export-my-space"});
    expect((await request.post(`/api/source-imports/${folder}/apply`,{data:{}})).ok()).toBe(true);
    const origin=`http://127.0.0.1:${process.env.KM_E2E_PORT??"3101"}`;
    const bindingResponse=await request.post(`/api/workspaces/${ws}/task-export-bindings`,{headers:{Origin:origin},data:{label:"macbook"}});
    expect(bindingResponse.status()).toBe(201);
    const binding=await bindingResponse.json();
    expect(binding.token).toBeTruthy();
    const ingest=(body:unknown)=>request.post("/api/task-results/ingest",{headers:{"x-knowledge-hub-export-token":binding.token},data:body});
    const artifact={
      schemaVersion:1,taskId:crypto.randomUUID(),artifactRevision:1,agent:"claude-code",status:"completed",
      title:"Harden the task export endpoint",
      summary:"Rejected oversized artifacts and unconfirmed revisions, then verified the retry path.",
      completedAt:"2026-11-09T14:05:00Z",
      verification:{status:"passed",checks:["npm run test:unit -- task-export: 18 passed"]},
      findings:["A retry after a lost response reused the saved artifact unchanged."],
      decisions:["Kept rejection over silent truncation for artifacts above 64 KiB."],
      changes:["src/app/api/task-results/ingest/route.ts"],
      references:[{type:"WIKI",path:"space-guide.md"},{type:"PR_URL",url:"https://github.com/example/hub/pull/42"}],
    };
    const created=await ingest(artifact);
    expect(created.status()).toBe(201);
    const {url:detailUrl}=await created.json();
    expect((await ingest({...artifact,artifactRevision:2,title:"Harden the task export endpoint v2"})).status()).toBe(201);
    expect((await ingest({
      schemaVersion:1,taskId:crypto.randomUUID(),artifactRevision:1,agent:"opencode",status:"completed",
      title:"Document the rollout checklist",summary:"Wrote the read-cutover runbook for Task Search.",
      completedAt:"2026-11-08T09:30:00Z",verification:{status:"not_run"},
      references:[{type:"CODE_FILE",path:"docs/operations/task-search-rollout.md"}],
    })).status()).toBe(201);

    await page.setViewportSize({width:1280,height:800});
    await page.goto(`/w/${ws}/tasks`);
    await capture(page,"tasks-list",content,[
      page.getByRole("link",{name:/Harden the task export endpoint v2/}),
      page.getByRole("link",{name:"Set up export"}),
    ]);

    await page.goto(detailUrl);
    const detailSection=(name:string)=>page.locator("section").filter({has:page.getByRole("heading",{name,exact:true})});
    await capture(page,"tasks-detail",content,[
      detailSection("Verification"),
      detailSection("References"),
      detailSection("Revisions"),
    ],{maxHeight:900,markSide:"right"});

    await page.goto(`/w/${ws}/tasks/setup`);
    // The one-time line carries the token and must never reach a committed image.
    await expect(page.getByText("Copy the setup line now.")).toHaveCount(0);
    await capture(page,"tasks-setup",content,[
      page.locator("form").first(),
      page.getByRole("button",{name:"Rotate token"}),
    ],{markSide:"right"});

    if(wanted("inbox")) {
      const note=await (await request.post(`/api/workspaces/${ws}/documents`,{data:{
        title:"Release checklist",
        markdown:"Before shipping, confirm the deploy runbook is current and the rollback owner is available.",
      }})).json();
      const {link}=await (await request.post(`/api/documents/${note.documentId}/share-links`,{data:{label:"Review"}})).json();
      const token=link.path.split("/").pop();
      const viewer=phase3Origin("viewer");
      const query=await (await request.post(`${viewer}/api/share-review/threads/query`,{headers:{Origin:viewer},data:{token}})).json();
      const comment=await request.post(`${viewer}/api/share-review/threads`,{
        headers:{Origin:viewer},
        data:{
          token,expectedRevisionId:query.revisionId,
          anchor:{schemaVersion:1,blockPath:[0],blockKind:"paragraph",startUtf16:63,endUtf16:77,exact:"rollback owner",prefix:"Before shipping, confirm the deploy runbook is current and the ",suffix:" is available."},
          body:"Could we name a backup rollback owner for the release window?",idempotencyKey:crypto.randomUUID(),
        },
      });
      expect(comment.status()).toBe(201);

      await page.setViewportSize({width:1440,height:1000});
      await page.goto(`/w/${ws}/inbox`);
      const rows=page.getByRole("list",{name:"Inbox discussions"}).getByRole("listitem");
      await expect(rows.first()).toBeVisible({timeout:15_000});
      await rows.first().getByRole("link").click();
      await expect(page.getByRole("region",{name:"Selected discussion"}).getByText("Could we name a backup rollback owner for the release window?")).toBeVisible({timeout:15_000});
      await capture(page,"inbox",page.locator("main.grid"),[
        page.getByRole("group",{name:"Inbox relationships"}),
        rows.first(),
        page.getByRole("region",{name:"Selected discussion"}).getByRole("region",{name:"Comment thread"}),
      ],{maxHeight:820,margin:0});
    }

    // The search-enabled reader runs on its own server, sharing this database (as task-search-my-space.spec.ts does).
    const port=Number(process.env.KM_E2E_PORT??"3101")+19;
    const searchOrigin="http://127.0.0.1:"+port;
    const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{
      cwd:process.cwd(),env:{...process.env,NODE_ENV:"production",KM_IDENTITY_PROVIDER:"local",TASK_SEARCH_READ_ENABLED:"true",PORT:String(port)},
      stdio:["ignore","pipe","pipe"],
    });
    try {
      const until=Date.now()+40_000;
      while(Date.now()<until) {
        if(server.exitCode!==null)throw new Error("Task Search capture server exited.");
        try { await fetch(searchOrigin,{redirect:"manual"}); break; } catch { await new Promise(r=>setTimeout(r,350)); }
      }
      await page.setViewportSize({width:1280,height:800});
      await page.goto(`${searchOrigin}/w/${ws}/tasks`);
      await expect(page.getByRole("searchbox",{name:"Search tasks"})).toBeVisible();
      await capture(page,"tasks-search",content,[
        page.getByRole("searchbox",{name:"Search tasks"}),
        page.locator("label").filter({has:page.getByRole("combobox",{name:"Agent"})}),
        page.locator("#task-search-filter-form summary").first(),
        page.getByRole("button",{name:"Apply filters"}),
      ],{markSide:"right"});
    } finally {
      server.kill("SIGTERM");
    }
  }
});
