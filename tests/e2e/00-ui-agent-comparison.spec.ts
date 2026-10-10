import { test, expect } from './fixtures/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stageReadingFolder } from './fixtures/folder-reading';
test('agent UI comparison and responsive layout', async ({page,request},testInfo) => {
 test.setTimeout(120000);
 const output=process.env.KM_UI_SCREENSHOTS??testInfo.outputPath("ui-comparison"); await mkdir(output,{recursive:true});
 const nav=await (await request.get('/api/workspaces')).json(); const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:'Engineering handbook',fixture:'reading-flow-v1'});
 expect((await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}})).ok()).toBe(true);
 await stageReadingFolder(request,{workspaceId:ws,sourceName:'Product handbook',fixture:'reading-flow-v1'});
 const created=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:'Release checklist',markdown:'# Release checklist\n\nReview the release before deployment.'}}); expect(created.ok()).toBe(true);
 const doc=await created.json();
 const shared=await request.post(`/api/documents/${doc.documentId}/share-links`,{data:{label:'Release review'}});expect(shared.ok()).toBe(true);
 const urls=['agent-context'];
  for(const route of urls) {await page.goto(`/w/${ws}/${route}`); await expect(page.getByRole('heading',{name:route.startsWith('profile')?'Insights':route==='home'?'Home':route.startsWith('graph')?'Graph':route==='search'?'Search':route==='shares'?'Shares':route==='agent-context'?'Copy for Agent':'Sources',exact:true}).first()).toBeVisible();
   if(route==='agent-context'){await page.getByLabel('Find documents').fill('Release checklist');await page.getByRole('checkbox',{name:/Select Release checklist/}).check();await page.getByLabel('Find documents').fill('handbook');}
   for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]] as const){await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,`${route.split('?')[0]}-${size}.png`),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  }

});

test('selected tray preserves hidden choices, removes them and invalidates previews', async ({page,request}) => {
 const nav=await (await request.get('/api/workspaces')).json(); const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const created=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:'Selection tray guide',markdown:'Saved selection body.'}});expect(created.ok()).toBe(true);
 await page.goto(`/w/${ws}/agent-context`);
 await page.getByLabel('Find documents').fill('Selection tray guide');
 await page.getByRole('checkbox',{name:/Select Selection tray guide/}).check();
 await page.getByLabel('Find documents').fill('does-not-match-anything');
 const tray=page.getByRole('complementary',{name:'Selected documents'});
 await expect(tray).toContainText('Outside current results');
 await tray.getByRole('button',{name:'Prepare context'}).click();
 await expect(page.getByLabel('Markdown preview')).toHaveValue(/Saved selection body/);
 await tray.getByRole('button',{name:'Remove Selection tray guide from selection'}).click();
 await expect(page.getByLabel('Markdown preview')).toHaveCount(0);
 await expect(tray.getByRole('button',{name:'Prepare context'})).toBeDisabled();
});
