import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stageReadingFolder } from './fixtures/folder-reading';
import { PHASE3_TEAM_ID, phase3Origin } from './fixtures/phase3-identities';
test('governance UI comparison and responsive layout', async ({page,request},testInfo) => {
 test.setTimeout(120000);
 const output=process.env.KM_UI_SCREENSHOTS??testInfo.outputPath("ui-comparison"); await mkdir(output,{recursive:true});
 const nav=await (await request.get('/api/workspaces')).json(); const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:'Engineering handbook',fixture:'reading-flow-v1'});
 expect((await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}})).ok()).toBe(true);
 await stageReadingFolder(request,{workspaceId:ws,sourceName:'Product handbook',fixture:'reading-flow-v1'});
 const created=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:'Release checklist',markdown:'# Release checklist\n\nReview the release before deployment.'}}); expect(created.ok()).toBe(true);
 const doc=await created.json();
 const shared=await request.post(`/api/documents/${doc.documentId}/share-links`,{data:{label:'Release review'}});expect(shared.ok()).toBe(true);
 const urls=['sources','sources/import'];
  for(const route of urls) {await page.goto(`/w/${ws}/${route}`); await expect(page.getByRole('heading',{name:route.startsWith('profile')?'Insights':route==='home'?'Home':route.startsWith('graph')?'Graph':route==='search'?'Search':route==='shares'?'Shares':route==='agent-context'?'Copy for Agent':route==='sources/import'?'Import folder':'Sources',exact:true}).first()).toBeVisible();
   if(route==='agent-context'){await page.getByLabel('Find documents').fill('Release checklist');await page.getByRole('checkbox',{name:/Select Release checklist/}).check();await page.getByLabel('Find documents').fill('handbook');}
   for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]] as const){await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,`${route.split('?')[0].replaceAll('/','-')}-${size}.png`),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  }
 for (const name of ['Release documentation','Phase3 shared Team']) expect((await request.patch(`${phase3Origin('owner')}/api/workspaces/${PHASE3_TEAM_ID}`,{data:{name}})).ok()).toBe(true);
 for(const route of ['','members','groups','audit']){await page.setViewportSize({width:1280,height:900});await page.goto(`${phase3Origin('owner')}/w/${PHASE3_TEAM_ID}/settings/${route}`);await expect(page.getByRole('heading',{name:route===''?'General':route==='groups'?'SSO Groups':route==='members'?'Members':'Audit',exact:true}).first()).toBeVisible();for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]] as const){await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,`settings-${route||"general"}-${size}.png`),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}}
 await page.getByLabel('Audit event type').selectOption('workspace');
 await expect(page.locator('main ol > li')).toHaveCount(2);
 await expect(page.locator('main ol')).toContainText('Renamed the workspace');
 await page.getByLabel('Audit event type').selectOption('groups');
 await expect(page.getByText('No matching events in the loaded history. Choose All events.',{exact:true})).toBeVisible();
 await page.getByLabel('Audit event type').selectOption('all');
 await expect(page.locator('main ol > li')).toHaveCount(2);
});

test('source attention filter preserves latest successful sync and opens pending preview', async ({page,request}) => {
 const nav=await (await request.get('/api/workspaces')).json();const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:'Attention fixture',fixture:'reading-flow-v1'});
 const apply=await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}});expect(apply.ok()).toBe(true);const sourceId=(await apply.json()).sourceId;
 await stageReadingFolder(request,{workspaceId:ws,sourceId,sourceName:'Attention fixture',fixture:'reading-flow-v1'});
 await page.goto(`/w/${ws}/sources`);await page.getByRole('checkbox',{name:/Needs attention/}).check();
 await expect(page.locator('a[data-list-row]').filter({hasText:'Attention fixture'})).toBeVisible();
 await expect(page.getByText('Awaiting Apply · Review preview',{exact:true})).toBeVisible();
 await page.getByLabel('Sort sources',{exact:true}).selectOption('recent');
 await page.getByRole('link',{name:'Awaiting Apply · Review preview',exact:true}).click();await expect(page).toHaveURL(/\/sources\/imports\//);
});
