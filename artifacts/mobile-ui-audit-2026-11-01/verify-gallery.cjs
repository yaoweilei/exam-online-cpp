const {chromium}=require('@playwright/test');const path=require('node:path');const {pathToFileURL}=require('node:url');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});
await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);await page.locator('select').selectOption('orgAdmin');
const result=await page.evaluate(()=>({total:document.querySelectorAll('article').length,shown:[...document.querySelectorAll('article')].filter(e=>!e.hidden).length,wrong:[...document.querySelectorAll('article')].filter(e=>!e.hidden&&e.dataset.role!=='orgAdmin').length,firstImage:document.querySelector('article:not([hidden]) img')?.getAttribute('src')}));
await page.locator('article:not([hidden]) img').first().scrollIntoViewIfNeeded();await page.locator('article:not([hidden]) img').first().evaluate(e=>e.decode());
if(result.total!==132||result.wrong!==0||result.shown===0)throw Error(JSON.stringify(result));console.log(JSON.stringify(result));await browser.close();})().catch(e=>{console.error(e);process.exitCode=1;});
