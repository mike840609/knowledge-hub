import {expect,test} from "./fixtures/test";
import {PHASE3_TEAM_ID,phase3NoSessionOrigin,phase3Origin,phase3UnconfiguredOrigin} from "./fixtures/phase3-identities";
test.use({timezoneId:"Asia/Taipei"});

test("personal collection creates a reading path, annotations, reorders and opens latest document",async({page,request})=>{
 const origin=phase3Origin("reviewOwner");
 const navigation=await (await request.get(`${origin}/api/workspaces`)).json();
 const workspaceId=navigation.items.find((item:{type:string})=>item.type==="PERSONAL").id as string;
 const one=await request.post(`${origin}/api/workspaces/${workspaceId}/documents`,{data:{title:"Architecture overview",markdown:"Current architecture"}});expect(one.ok()).toBe(true);
 const two=await request.post(`${origin}/api/workspaces/${workspaceId}/documents`,{data:{title:"Incident runbook",markdown:"Troubleshooting steps"}});expect(two.ok()).toBe(true);
 const overview=await one.json(),runbook=await two.json();
 await page.goto(`${origin}/w/${workspaceId}/collections`);
 await expect(page.getByRole("navigation",{name:"Primary"}).getByRole("link",{name:"Collections"})).toBeVisible();
 await page.getByLabel("Name",{exact:true}).fill("Authentication onboarding");
 await page.getByLabel("Description (optional)").fill("Start here for the whole system.");
 await page.getByRole("button",{name:"Create collection"}).click();
 await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
 await expect(page.getByRole("heading",{name:"Authentication onboarding"})).toBeVisible();
 const u=new URL(page.url()),collectionId=u.pathname.split("/").at(-1);
 const add=async(documentId:string,expectedVersion:number)=>{
   const r=await request.post(`${origin}/api/workspaces/${workspaceId}/collections/${collectionId}/items`,{headers:{Origin:origin},data:{documentId,expectedVersion}});
   expect(r.ok()).toBe(true);return (await r.json()).version as number;
 };
 let version=1;
 version=await add(overview.documentId,version);
 version=await add(runbook.documentId,version);
 expect(version).toBe(3);
 await page.reload();
 const reading=page.getByRole("list",{name:"Collection documents"});
 await expect(reading.getByRole("link",{name:"Architecture overview"})).toBeVisible();
 await expect(reading.getByRole("link",{name:"Incident runbook"})).toBeVisible();
 await reading.getByRole("textbox",{name:"Reading note for item 1"}).fill("Read this before the API spec.");
 await reading.getByRole("button",{name:"Save note"}).first().click();
 await expect(page.getByText("Read this before the API spec.")).toBeVisible();
 await reading.getByRole("button",{name:"Move document 2 up"}).click();
 await expect(reading.locator("li").first().getByRole("link",{name:"Incident runbook"})).toBeVisible();
 await reading.getByRole("link",{name:"Incident runbook"}).click();
 await expect(page.getByText("Troubleshooting steps",{exact:true})).toBeVisible();
});

test("workspace references are not grants; unavailable metadata stays hidden",async({request,page})=>{
 const origin=phase3Origin("reviewOwner"),outsider=phase3Origin("nonCreator");
 const navigation=await (await request.get(`${origin}/api/workspaces`)).json();
 const workspaceId=navigation.items.find((i:{type:string})=>i.type==="PERSONAL").id as string;
 const document=await request.post(`${origin}/api/workspaces/${workspaceId}/documents`,{data:{title:"Private internal architecture",markdown:"Never copy this"}});expect(document.ok()).toBe(true);
 const doc=await document.json();
 const created=await request.post(`${origin}/api/workspaces/${workspaceId}/collections`,{headers:{Origin:origin},data:{name:"Secure path"}});expect(created.ok()).toBe(true);
 const {id}=await created.json();
 const added=await request.post(`${origin}/api/workspaces/${workspaceId}/collections/${id}/items`,{headers:{Origin:origin},data:{documentId:doc.documentId,readingNote:"Private review note",expectedVersion:1}});expect(added.ok()).toBe(true);
 expect((await request.get(`${outsider}/api/workspaces/${workspaceId}/collections/${id}`)).status()).toBe(404);
 await page.goto(`${origin}/w/${workspaceId}/collections/${id}`);
 await expect(page.getByText("Private internal architecture")).toBeVisible();
 const archived=await request.post(`${origin}/api/documents/${doc.documentId}/archive`);expect(archived.ok()).toBe(true);
 await page.reload();
 const list=page.getByRole("list",{name:"Collection documents"});
 await expect(list.getByText("Unavailable document")).toBeVisible();
 await expect(list.getByText("Private internal architecture")).toHaveCount(0);
 await expect(list.getByText("Private review note")).toHaveCount(0);
});

test("collection API distinguishes no session from unavailable identity",async({request})=>{
 for(const [origin,status] of [[phase3NoSessionOrigin(),401],[phase3UnconfiguredOrigin(),503]] as const){
   const response=await request.get(`${origin}/api/workspaces/${PHASE3_TEAM_ID}/collections`);
   expect(response.status()).toBe(status);
 }
});

test("team editor may update an owner collection, viewer cannot",async({request})=>{
 test.skip(process.env.KM_TEAM_WORKSPACES_ENABLED==="false","Team feature flag is disabled.");
 const owner=phase3Origin("owner"),editor=phase3Origin("editor"),viewer=phase3Origin("viewer");
 const created=await request.post(`${owner}/api/workspaces/${PHASE3_TEAM_ID}/collections`,{headers:{Origin:owner},data:{name:"Team knowledge"}});expect(created.ok()).toBe(true);
 const {id}=await created.json();
 const changed=await request.patch(`${editor}/api/workspaces/${PHASE3_TEAM_ID}/collections/${id}`,{headers:{Origin:editor},data:{name:"Team handoff",expectedVersion:1}});
 expect(changed.ok()).toBe(true);
 const denied=await request.patch(`${viewer}/api/workspaces/${PHASE3_TEAM_ID}/collections/${id}`,{headers:{Origin:viewer},data:{name:"Viewer edit",expectedVersion:2}});
 expect(denied.status()).toBe(403);
 const response=await request.get(`${viewer}/api/workspaces/${PHASE3_TEAM_ID}/collections/${id}`);
 expect(response.ok()).toBe(true);
 expect((await response.json()).collection.name).toBe("Team handoff");
});
