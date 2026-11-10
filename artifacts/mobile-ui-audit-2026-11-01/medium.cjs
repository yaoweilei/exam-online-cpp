process.env.MOBILE_AUDIT_FILE='medium.json';
const {chromium}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const audit=require('./capture.cjs');
const {navigateWorkspace}=require('../../tests/e2e/helpers/workspace-navigation');
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'inventory.json')));let browser;
(async()=>{browser=await chromium.launch({channel:'msedge',headless:true});audit.setBrowser(browser);
for(const role of inventory){const s=await audit.enter(role.role,role.account);s.role=role.role;
await audit.capture(s,role.role+'-overview','总览',{widths:[540],height:1170});
for(const target of role.destinations){if(['overview','__overview__'].includes(target.key))continue;await navigateWorkspace(s.shell,target.key,role.role==='superAdmin');await audit.settle(s.page);await audit.capture(s,role.role+'-'+target.key,target.name,{widths:[540],height:1170});}
await s.context.close();}await browser.close();})().catch(e=>{console.error(e.stack);browser?.close();process.exitCode=1;});
