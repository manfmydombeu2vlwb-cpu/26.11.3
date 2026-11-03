// Requires Playwright as test tooling only; see Google_Ads_Offline/README.md.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const base=(process.env.SITE_BASE_URL||'http://127.0.0.1:8080/').replace(/\/?$/, '/');
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(require('node:fs').existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox']});
const context=await browser.newContext({acceptDownloads:true});const page=await context.newPage();
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
async function check(name,fn){await fn();checks.push(name);console.log('PASS',name)}
async function go(route){await page.goto(base+route)}
async function exportJSON(selector){const wait=page.waitForEvent('download');await page.locator(selector).click();const d=await wait;return JSON.parse(await fs.readFile(await d.path(),'utf8'))}
async function upload(selector,data,type='application/json'){await page.locator(selector).setInputFiles({name:type==='text/csv'?'backup.csv':'backup.json',mimeType:type,buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))});}
try{
await check('全部 HTML 页面加载且无脚本异常',async()=>{
 const root=require('node:path').join(__dirname,'../Google_Ads_Offline');
 const pages=(await fs.readdir(root,{recursive:true})).filter(p=>p.endsWith('.html'));
 assert(pages.length>0);
 for(const route of pages){const response=await page.goto(new URL(route.split(require('node:path').sep).join('/'),base).href);assert.equal(response.status(),200,route)}
 assert.deepEqual(errors,[]);console.log('Pages checked:',pages.length);
});
await go('index.html');
await check('搜索键盘快捷键、空结果、分类与关闭',async()=>{
 await page.keyboard.press('Control+k');assert(await page.locator('#search-dialog').evaluate(d=>d.open));
 await page.locator('#search-input').fill('no-such-article-847295');await page.waitForTimeout(180);assert.equal(await page.locator('.search-result').count(),0);
 await page.locator('#search-input').fill('关键词');await page.waitForTimeout(180);assert((await page.locator('.search-result').count())>0);
 await page.locator('#search-category').selectOption('search');await page.waitForTimeout(50);
 for(const href of await page.locator('.search-result').evaluateAll(es=>es.map(e=>e.href))){const response=await context.request.get(href);assert.equal(response.status(),200)}
 await page.locator('[data-close-search]').click();await page.waitForFunction(()=>!document.querySelector('#search-dialog').open);assert.equal(await page.locator('#search-dialog').evaluate(d=>d.open),false);
});
await check('投放诊断：计算、保存、刷新、JSON 导出与导入',async()=>{
 await page.locator('#diagnosis-example').click();await page.locator('#diagnosis-form button[type=submit]').click();
 assert(await page.locator('#diagnosis-results').isVisible());assert((await page.locator('#diagnosis-results').innerText()).includes('合格'));
 await page.locator('#diagnosis-action').fill('自检：核对搜索词质量');await page.locator('#diagnosis-save').click();
 assert.equal(await page.locator('[data-diagnosis-edit]').count(),1);
 const backup=await exportJSON('#diagnosis-export');assert.equal(backup.records.length,1);assert.equal(backup.records[0].input.spend,'5500');
 await page.reload();assert.equal(await page.locator('[data-diagnosis-edit]').count(),1);
 await page.locator('[data-diagnosis-delete]').click();assert.equal(await page.locator('[data-diagnosis-edit]').count(),0);
 await upload('#diagnosis-import',backup);await page.waitForFunction(()=>document.querySelectorAll('[data-diagnosis-edit]').length===1);
 await upload('#diagnosis-import',{app:'wrong',version:1,records:[]});await page.waitForTimeout(100);assert.equal(await page.locator('[data-diagnosis-edit]').count(),1);
});
await check('投放诊断拒绝负花费',async()=>{
 await page.locator('#diagnosis-example').click();await page.locator('#diagnosis-form [name=spend]').fill('-1');await page.locator('#diagnosis-form button[type=submit]').click();
 assert(await page.locator('#diagnosis-error').isVisible());assert((await page.locator('#diagnosis-error').innerText()).length>0);
});
for(const kind of ['search','video']){
 await go(`toolbox/${kind}-review/index.html`);
 await check(`${kind} 复盘：CPA、保存、刷新、JSON 往返、无效备份保护`,async()=>{
  await page.locator('#load-example').click();assert.match(await page.locator('#formCPA').evaluate(e=>e.value),/55\.00/);assert.match(await page.locator('#qualifiedCPA').evaluate(e=>e.value),/458\.33/);
  await page.locator('#review-form button[type=submit]').click();assert.equal(await page.locator('#record-count').innerText(),'1');
  const backup=await exportJSON('#export-records');assert.equal(backup.records.length,1);assert.equal(backup.kind,kind);
  await page.reload();assert.equal(await page.locator('#record-count').innerText(),'1');
  await page.locator('#clear-records').click();assert.equal(await page.locator('#record-count').innerText(),'0');
  await upload('#import-records',backup);await page.waitForFunction(()=>document.querySelector('#record-count').textContent==='1');
  await upload('#import-records',{app:'invalid',records:[]});await page.waitForTimeout(100);assert.equal(await page.locator('#record-count').innerText(),'1');
  await page.locator('[data-edit]').click();assert.equal(await page.locator('[name=spend]').inputValue(),'5500');
  await page.evaluate(()=>{window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'))});assert(await page.locator('#review-print').count());
 });
}
await go('toolbox/keyword-workbench/index.html');
await check('词语工具：保存、CSV 导出导入、删除、原文保留',async()=>{
 await page.locator('#keyword-example').click();await page.locator('#keyword-form button[type=submit]').click();assert.equal(await page.locator('[data-word-edit]').count(),1);
 const wait=page.waitForEvent('download');await page.locator('#keyword-export').click();const d=await wait,csv=await fs.readFile(await d.path(),'utf8');assert(csv.includes('machine repair jobs'));
 await page.reload();assert.equal(await page.locator('[data-word-edit]').count(),1);
 await page.locator('[data-word-delete]').click();assert.equal(await page.locator('[data-word-edit]').count(),0);
 await upload('#keyword-import',csv,'text/csv');await page.waitForFunction(()=>document.querySelectorAll('[data-word-edit]').length===1);
 await page.locator('[data-word-edit]').click();assert.equal(await page.locator('#keyword-form [name=term]').inputValue(),'machine repair jobs');
});
await go('practice/quality/index.html');
await check('互动练习：标签切换、质量成本计算、零合格率',async()=>{
 await page.locator('[data-practice-tab=quality]').click();assert(await page.locator('#panel-quality').isVisible());
 await page.locator('#practice-spend').fill('1000');await page.locator('#practice-forms').fill('100');await page.locator('#practice-rate').fill('20');
 assert.match(await page.locator('#practice-form-cpa').innerText(),/10/);assert.match(await page.locator('#practice-qualified-cpa').innerText(),/50/);
 await page.locator('#practice-rate').fill('0');assert(!(await page.locator('#practice-qualified-cpa').innerText()).includes('Infinity'));
 await page.locator('[data-practice-tab=terms]').click();await page.locator('[data-term-action]').first().click();assert.match(await page.locator('#practice-progress').innerText(),/1/);
 await page.locator('[data-practice-tab=feedback]').click();assert(await page.locator('#panel-feedback').isVisible());
});
await go('search/keyword-research/index.html');
await check('文章节点、展开阅读、字号与打印状态恢复',async()=>{
 if(await page.locator('[data-visual-node]').count()){const last=page.locator('[data-visual-node]').last();await last.click();assert.equal(await last.getAttribute('aria-pressed'),'true')}
 if(await page.locator('details#manual').count())await page.locator('details#manual > summary').click();
 if(await page.locator('#expand-reading').count()){await page.locator('#expand-reading').click();assert.equal(await page.locator('#expand-reading').getAttribute('data-expanded'),'true')}
 if(await page.locator('#text-size').count()){await page.locator('#text-size').click();assert(await page.locator('body').evaluate(e=>e.classList.contains('large-text')))}
 const before=await page.locator('details').evaluateAll(es=>es.map(e=>e.open));await page.evaluate(()=>{window.dispatchEvent(new Event('beforeprint'));window.dispatchEvent(new Event('afterprint'))});assert.deepEqual(await page.locator('details').evaluateAll(es=>es.map(e=>e.open)),before);
 await page.locator('[data-open-search]').click();await page.locator('#search-input').fill('关键词');await page.waitForTimeout(180);
 for(const href of await page.locator('.search-result').evaluateAll(es=>es.map(e=>e.href))){assert.equal((await context.request.get(href)).status(),200)}
});
assert.deepEqual(errors,[]);console.log('ALL PASS',checks.length,'functional scenarios; zero page errors');

}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
