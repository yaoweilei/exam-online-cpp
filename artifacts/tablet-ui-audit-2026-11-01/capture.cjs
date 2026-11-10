process.env.MOBILE_AUDIT_OUTPUT = __dirname;
process.env.MOBILE_AUDIT_FILE = 'helper-observations.json';
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const audit = require('../mobile-ui-audit-2026-11-01/capture.cjs');
const inventory = require('../mobile-ui-audit-2026-11-01/inventory.json');
const fixture = require('../mobile-ui-audit-2026-11-01/fixture.json');
const { navigateWorkspace } = require('../../tests/e2e/helpers/workspace-navigation');
const outputRoot = process.env.TABLET_AUDIT_OUTPUT || __dirname;
const screenshots = path.join(outputRoot, 'screenshots');
fs.mkdirSync(screenshots, { recursive: true });
const file = path.join(outputRoot, process.env.TABLET_AUDIT_FILE || 'observations.json');
const records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
let browser;
const modes = [{width:768,height:1024}, {width:1024,height:768}];
const slug = s => s.replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,105);
async function metrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('#platform-admin-shell.pc-platform-admin-open');
    const visibleModal=document.querySelector('#login-modal');
    const main = shell?.querySelector('.pc-platform-admin-content') || (visibleModal?.getBoundingClientRect().width ? visibleModal : null) || document.querySelector('#exam-content') || document.body;
    const box = main.getBoundingClientRect();
    const visible = e => {
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      if (!r.width || !r.height || s.display==='none' || s.visibility==='hidden') return false;
      for(let p=e.parentElement;p;p=p.parentElement) if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope>summary')?.contains(e)) return false;
      return true;
    };
    const selector = e => e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+[...e.classList].slice(0,3).map(s=>'.'+s).join('');
    const frames=[...main.querySelectorAll('section,article,div,details,form,ul')].filter(e=>{
      if(!visible(e))return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);
      return r.width>box.width*.35&&r.height>50&&parseFloat(s.borderTopWidth)>0&&parseFloat(s.borderTopLeftRadius)>=6;
    });
    const frameSet=new Set(frames);
    const nested=frames.map(e=>{let depth=1;for(let p=e.parentElement;p&&p!==main;p=p.parentElement)if(frameSet.has(p))depth++;return {depth,element:selector(e),text:e.textContent.replace(/\s+/g,' ').trim().slice(0,80)};}).filter(e=>e.depth>1).sort((a,b)=>b.depth-a.depth).slice(0,12);
    const overflow=[...main.querySelectorAll('table,form,section,details,input,select,textarea,button')].filter(visible).filter(e=>{const r=e.getBoundingClientRect();return r.right>box.right+2||r.left<box.left-2;}).slice(0,25).map(e=>{
      const r=e.getBoundingClientRect();let scrollParent='';for(let p=e.parentElement;p&&p!==main;p=p.parentElement)if(['auto','scroll'].includes(getComputedStyle(p).overflowX)){scrollParent=selector(p);break;}
      return {element:selector(e),width:Math.round(r.width),x:Math.round(r.x),scrollParent,text:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,65)};
    });
    const sidebar=shell?.querySelector('.pc-platform-sidebar');
    return {viewport:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth-innerWidth,mainOverflow:main.scrollWidth-main.clientWidth,mainWidth:main.clientWidth,mainHeight:main.scrollHeight,sidebarWidth:sidebar?.getBoundingClientRect().width||0,nested,overflow,text:main.innerText.slice(0,12000),headings:[...main.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e=>({text:e.textContent.trim(),size:getComputedStyle(e).fontSize}))};
  });
}
async function shot(s,key,label,options={}) {
  const id=slug(key),record={id,role:s.role,label,account:s.account,captures:[],errors:[]};
  for(const mode of options.modes||modes){
    await s.page.setViewportSize(mode);await audit.settle(s.page);
    await s.page.evaluate(()=>{document.querySelectorAll('#platform-admin-shell main,#platform-admin-shell .pc-platform-admin-content,.pc-subpage').forEach(e=>e.scrollTop=0);window.scrollTo(0,0);});
    const data=await metrics(s.page),name=`${id}-${mode.width}-top.png`;
    await s.page.screenshot({path:path.join(screenshots,name)});
    record.captures.push({...mode,position:'top',file:name,metrics:data});
    if(data.mainHeight>mode.height+140&&options.bottom!==false){
      await s.page.evaluate(()=>{const main=document.querySelector('#platform-admin-shell.pc-platform-admin-open .pc-platform-admin-content');if(main)main.scrollTop=main.scrollHeight;else window.scrollTo(0,document.body.scrollHeight);});
      await s.page.waitForTimeout(100);const bottom=`${id}-${mode.width}-bottom.png`;
      await s.page.screenshot({path:path.join(screenshots,bottom)});
      record.captures.push({...mode,position:'bottom',file:bottom,metrics:await metrics(s.page)});
    }
  }
  record.errors=[...s.errors];const at=records.findIndex(r=>r.id===id);if(at>=0)records.splice(at,1);records.push(record);
  fs.writeFileSync(file,JSON.stringify(records,null,2));
  console.log(`${records.length} ${s.role} ${label} `+record.captures.filter(c=>c.position==='top').map(c=>`${c.width}: main=${c.metrics.mainWidth}, overflow=${c.metrics.mainOverflow}, nested=${c.metrics.nested[0]?.depth||0}`).join(' / '));
  return record;
}
async function enter(role,account){const s=await audit.enter(role,account);s.role=role;await s.page.setViewportSize(modes[0]);await audit.settle(s.page);return s;}
async function main(){
  browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
  for(const group of inventory){
    const s=await enter(group.role,fixture.accounts[group.role]||group.account);
    for(const dest of group.destinations){
      const id=slug(group.role+'-'+dest.key);if(process.argv.includes('--resume')&&records.some(r=>r.id===id&&!r.blocked))continue;
      try{await navigateWorkspace(s.shell,dest.key,group.role==='superAdmin');await audit.settle(s.page);await shot(s,id,dest.name);}
      catch(e){records.push({id,role:s.role,label:dest.name,blocked:e.message.split('\n')[0]});fs.writeFileSync(file,JSON.stringify(records,null,2));console.log('BLOCKED',id,e.message.split('\n')[0]);}
    }
    await s.context.close();
  }
  await browser.close();
}
if(require.main===module)main().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
module.exports={enter,shot,metrics,records,modes,audit,fixture,setBrowser:b=>{browser=b;audit.setBrowser(b);},screenshots};
