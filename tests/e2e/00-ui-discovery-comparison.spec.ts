import { test, expect } from './fixtures/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { stageReadingFolder } from './fixtures/folder-reading';
test('discovery UI comparison and responsive layout', async ({page,request},testInfo) => {
 test.setTimeout(120000);
 const output=process.env.KM_UI_SCREENSHOTS??testInfo.outputPath("ui-comparison"); await mkdir(output,{recursive:true});
 const nav=await (await request.get('/api/workspaces')).json(); const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const snapshot=await stageReadingFolder(request,{workspaceId:ws,sourceName:'Engineering handbook',fixture:'reading-flow-v1'});
 expect((await request.post(`/api/source-imports/${snapshot}/apply`,{data:{}})).ok()).toBe(true);
 await stageReadingFolder(request,{workspaceId:ws,sourceName:'Product handbook',fixture:'reading-flow-v1'});
 const created=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:'Release checklist',markdown:'# Release checklist\n\nReview the release before deployment.'}}); expect(created.ok()).toBe(true);
 const doc=await created.json();
 const shared=await request.post(`/api/documents/${doc.documentId}/share-links`,{data:{label:'Release review'}});expect(shared.ok()).toBe(true);
 const urls=['graph?view=list', 'search', 'shares'];
  for(const route of urls) {await page.goto(`/w/${ws}/${route}`); await expect(page.getByRole('heading',{name:route.startsWith('profile')?'Insights':route==='home'?'Home':route.startsWith('graph')?'Graph':route==='search'?'Search':route==='shares'?'Shares':route==='agent-context'?'Copy for Agent':'Sources',exact:true}).first()).toBeVisible();
   if(route==='agent-context'){await page.getByLabel('Find documents').fill('Release checklist');await page.getByRole('checkbox',{name:/Select Release checklist/}).check();await page.getByLabel('Find documents').fill('handbook');}
   for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]] as const){await page.setViewportSize({width,height});await page.screenshot({path:path.join(output,`${route.split('?')[0]}-${size}.png`),fullPage:true,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  }

});

test('find feedback, sortable graph, search disclosure and safe share cancellation', async ({page,request}) => {
 const nav=await (await request.get('/api/workspaces')).json(); const ws=nav.items.find((w:{type:string})=>w.type==='PERSONAL').id;
 const created=await request.post(`/api/workspaces/${ws}/documents`,{data:{title:'Feedback guide',markdown:'Feedback body.'}});expect(created.ok()).toBe(true);const doc=await created.json();
 expect((await request.post(`/api/documents/${doc.documentId}/share-links`,{data:{label:'Safe cancel'}})).ok()).toBe(true);
 await page.goto(`/w/${ws}/sources`);
 await expect(page.locator('main details').filter({hasText:'Report a problem'})).toHaveCount(0);
 await page.getByRole('button',{name:/^Account:/}).click();
 await page.getByRole('menuitem',{name:'Report a problem',exact:true}).click();
 const report=page.getByRole('dialog',{name:'Report a problem',exact:true});
 await expect(report).toBeVisible();
 await expect(report.getByRole('button',{name:'Download feedback report'})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(report).toBeHidden();
 await expect(page.getByRole('button',{name:/^Account:/})).toBeFocused();
 await page.goto(`/w/${ws}/graph?view=list`);await page.getByLabel('Find a document').fill('Feedback guide');
 const findHelpId = await page.getByLabel('Find a document').getAttribute('aria-describedby');
 await expect(page.locator(`[id="${findHelpId}"]`)).toContainText('1 match');
 await expect(page.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('button',{name:/^Account:/}).click();
 await page.getByRole('menuitem',{name:'Report a problem',exact:true}).click();
 await report.getByLabel('What happened?').fill('Graph issue');
 const downloading=page.waitForEvent('download');
 await report.getByRole('button',{name:'Download feedback report'}).click();
 expect((await downloading).suggestedFilename()).toBe('knowledge-hub-feedback.md');
 await expect(report.getByRole('status')).toContainText('Report prepared');
 await report.getByRole('button',{name:'Close',exact:true}).click();

 await page.getByRole('button',{name:'Links in',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:/Links in/})).toHaveAttribute('aria-sort','descending');
 await page.getByRole('button',{name:'Clear find'}).click();await expect(page.getByLabel('Find a document')).toHaveValue('');
 await page.goto(`/w/${ws}/search?q=Feedback`);await expect(page.getByLabel('Path',{exact:true})).toBeHidden();
 await page.getByText('Advanced filters',{exact:true}).click();await page.getByLabel('Path',{exact:true}).fill('docs');
 await expect(page).toHaveURL(/[?&]path=docs/);await expect(page.getByLabel('Active search filters')).toContainText('Path: docs');
 await page.getByRole('link',{name:'Clear filters'}).click();await expect(page).not.toHaveURL(/[?&]path=/);await expect(page.getByLabel('Search knowledge')).toHaveValue('Feedback');
 await page.goto(`/w/${ws}/shares?q=Feedback`);await expect(page.getByRole('button',{name:'Copy link for Feedback guide · Safe cancel'})).toBeVisible();
 await page.getByRole('button',{name:'Share actions for Feedback guide · Safe cancel'}).click();await page.getByRole('menuitem',{name:'Revoke',exact:true}).click();
 const dialog=page.getByRole('alertdialog',{name:'Revoke share link?'});await expect(dialog.getByRole('button',{name:'Keep',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 await expect(page.getByRole('list',{name:'Share links'})).toContainText('Active');
});
