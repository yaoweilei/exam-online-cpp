const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { navigateWorkspace, workspaceDestinations } = require('../../tests/e2e/helpers/workspace-navigation');
const root = process.env.MOBILE_AUDIT_OUTPUT || __dirname;
const baseURL = 'http://127.0.0.1:8124';
const screenshots = path.join(root, 'screenshots');
fs.mkdirSync(screenshots, { recursive: true });
const observationsFile = path.join(root, process.env.MOBILE_AUDIT_FILE || 'observations.json');
const records = fs.existsSync(observationsFile) ? JSON.parse(fs.readFileSync(observationsFile)) : [];
const inventory = [];
const roles = ['superAdmin', 'teacher', 'assistant', 'orgAdmin', 'orgContentAdmin', 'contentAdmin', 'student'];
const accounts = { superAdmin: 'superadmin_demo', teacher: 'teacher_demo', assistant: 'assistant_demo', orgAdmin: 'orgadmin_demo', orgContentAdmin: 'orgcontentadmin_demo', contentAdmin: 'contentadmin_demo', student: 'student_demo' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const slug = value => value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 105);
let browser;

async function settle(page) {
  const deadline = Date.now() + 12000;
  do {
    await sleep(450);
    if (!page.auditPending?.size) { await sleep(250); if (!page.auditPending?.size) return; }
  } while (Date.now() < deadline);
}

async function enter(role, account = accounts[role]) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', deviceScaleFactor: 1 });
  const response = await context.request.post('/api/v1/auth/login', { data: { username: account, password: '' } });
  if (!response.ok()) throw Error(`Login ${account}: ${response.status()}`);
  const ctx = (await (await context.request.get('/api/v1/me/context')).json()).data;
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const errors = [];
  page.auditPending = new Set();
  page.on('request', request => { if (request.url().includes('/api/')) page.auditPending.add(request); });
  page.on('requestfinished', request => page.auditPending.delete(request));
  page.on('requestfailed', request => page.auditPending.delete(request));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(ctx => localStorage.setItem('exam_v2_user', JSON.stringify({ ...ctx.user, token: '', guest: false, profile: ctx.profile, membership: ctx.membership, memberships: ctx.memberships, organizations: ctx.organizations, permissions: ctx.permissions, subscription: ctx.subscription })), ctx);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openPersonalCenter === 'function' && !!window.getUserContext?.().username, undefined, { timeout: 30000 });
  await settle(page);
  await page.evaluate(() => window.openPersonalCenter());
  const shell = page.locator('#platform-admin-shell');
  if (await shell.getAttribute('data-learning-role') !== role) {
    await shell.locator('[data-platform-admin-account-menu]').click();
    const choice = shell.locator(`[data-role-workbench="${role}"]`);
    if (!await choice.count()) { await context.close(); return enter(role, 'superadmin_demo'); }
    await choice.click();
  }
  await settle(page);
  return { context, page, shell, errors, account, ctx };
}

async function intent(state, value) {
  await state.page.evaluate(value => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.roleAdminIntent = value;
    document.querySelector('#platform-admin-shell').append(button); button.click(); button.remove();
  }, value);
  await settle(state.page);
}

async function metrics(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('#platform-admin-shell.pc-platform-admin-open');
    const main = shell?.querySelector('.pc-platform-admin-content') || shell?.querySelector('main') || document.querySelector('#guest-welcome:not([hidden])') || document.body;
    const rect = main.getBoundingClientRect();
    const visible = element => {
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      for (let p = element.parentElement; p && p !== main; p = p.parentElement) {
        if (p.tagName === 'DETAILS' && !p.open && !p.querySelector(':scope > summary')?.contains(element)) return false;
      }
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const selector = element => element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + [...element.classList].slice(0, 4).map(v => '.' + v).join('');
    const frames = [...main.querySelectorAll('section,article,div,details,form,ul')].filter(element => {
      if (!visible(element) || /select|toggle|badge|tag|field|input/.test(element.className)) return false;
      const r = element.getBoundingClientRect(), s = getComputedStyle(element);
      return r.width > rect.width * .42 && r.height > 50 && parseFloat(s.borderTopWidth) > 0 && parseFloat(s.borderTopLeftRadius) >= 6;
    });
    const frameSet = new Set(frames);
    const nested = frames.map(element => {
      const parents = []; for (let p = element.parentElement; p && p !== main; p = p.parentElement) if (frameSet.has(p)) parents.push(selector(p));
      return { depth: parents.length + 1, element: selector(element), parents, text: element.textContent.replace(/\s+/g, ' ').trim().slice(0, 75) };
    }).filter(item => item.depth >= 2).sort((a,b) => b.depth-a.depth).slice(0, 12);
    const overflow = [...main.querySelectorAll('input,select,textarea,button,table,section,form,details')].filter(element => {
      if (!visible(element)) return false;
      const r = element.getBoundingClientRect(); return r.right > rect.right + 2 || r.left < rect.left - 2;
    }).slice(0, 20).map(element => {
      const r = element.getBoundingClientRect(); let scrollParent = '';
      for (let p = element.parentElement; p && p !== main; p = p.parentElement) if (['auto','scroll'].includes(getComputedStyle(p).overflowX)) { scrollParent = selector(p); break; }
      return { element: selector(element), x: Math.round(r.x), width: Math.round(r.width), scrollParent, text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 65) };
    });
    const headings = [...main.querySelectorAll('h1,h2,h3,h4')].filter(visible).map(e => ({ text: e.textContent.trim(), size: getComputedStyle(e).fontSize, selector: selector(e) }));
    return { viewport: innerWidth, documentOverflow: document.documentElement.scrollWidth-innerWidth, mainOverflow: main.scrollWidth-main.clientWidth, mainWidth: main.clientWidth, mainHeight: main.scrollHeight, nested, overflow, headings, text: main.innerText.slice(0, 10000) };
  });
}

async function capture(state, key, label, options = {}) {
  const { page } = state;
  const id = slug(key);
  const entry = { id, role: state.role, label, account: state.account, captures: [], errors: [...state.errors] };
  for (const width of options.widths || [390, 360]) {
    await page.setViewportSize({ width, height: options.height || (width === 360 ? 800 : 844) });
    await settle(page);
    await page.evaluate(() => { document.querySelectorAll('#platform-admin-shell main, #platform-admin-shell .pc-platform-admin-content, .pc-subpage').forEach(e => e.scrollTop = 0); window.scrollTo(0,0); });
    const file = `${id}-${width}-top.png`;
    const observed = await metrics(page);
    await page.screenshot({ path: path.join(screenshots, file) });
    entry.captures.push({ width, position: 'top', file, metrics: observed });
    if (width === 390 && observed.mainHeight > 920 && options.bottom !== false) {
      await page.evaluate(() => { const main = document.querySelector('#platform-admin-shell.pc-platform-admin-open .pc-platform-admin-content') || document.querySelector('#platform-admin-shell.pc-platform-admin-open main'); if (main) main.scrollTop = main.scrollHeight; else window.scrollTo(0, document.body.scrollHeight); });
      await sleep(100);
      const bottomFile = `${id}-${width}-bottom.png`;
      await page.screenshot({ path: path.join(screenshots, bottomFile) });
      entry.captures.push({ width, position: 'bottom', file: bottomFile, metrics: await metrics(page) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const previous = records.findIndex(record => record.id === id);
  if (previous >= 0) records.splice(previous, 1);
  records.push(entry);
  fs.writeFileSync(observationsFile, JSON.stringify(records, null, 2));
  console.log(`${records.length} ${state.role} ${label} overflow=${entry.captures[0].metrics.mainOverflow} nested=${entry.captures[0].metrics.nested[0]?.depth || 0}`);
  return entry;
}

async function main() {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const lookup = await browser.newContext({ baseURL });
  await lookup.request.post('/api/v1/auth/login', { data: { username: 'superadmin_demo', password: '' } });
  const all = (await (await lookup.request.get('/api/v1/organizations')).json()).data || [];
  const score = org => ['lessons', 'course_packages', 'learning_groups', 'followups'].reduce((n, key) => n + (org[key]?.length || 0) * (key === 'lessons' ? 5 : 1), 0);
  const selected = {};
  for (const org of [...all].sort((a,b) => score(b)-score(a)).slice(0, 45)) {
    const id = org.organization_id;
    const members = (await (await lookup.request.get(`/api/v1/organizations/${id}/members`)).json()).data || [];
    for (const role of ['teacher', 'assistant', 'orgAdmin', 'orgContentAdmin']) {
      const member = members.find(m => m.roles?.includes(role) && m.username && m.username !== 'superadmin_demo' && !m.username.startsWith('superadmin_'));
      if (member && !selected[role]) { selected[role] = { account: member.username, organizationId: id, organizationName: org.name, score: score(org) }; accounts[role] = member.username; }
    }
    if (Object.keys(selected).length === 4) break;
  }
  fs.writeFileSync(path.join(root, 'sample-contexts.json'), JSON.stringify(selected, null, 2));
  await lookup.close();
  const fixturePath = path.join(root, 'fixture.json');
  if (fs.existsSync(fixturePath)) {
    const fixture = JSON.parse(fs.readFileSync(fixturePath));
    for (const role of ['teacher', 'assistant', 'orgAdmin', 'orgContentAdmin']) if (fixture.accounts[role]) accounts[role] = fixture.accounts[role];
  }
  for (const role of roles) {
    const state = await enter(role); state.role = role;
    const destinations = await workspaceDestinations(state.shell, role === 'superAdmin');
    inventory.push({ role, account: state.account, destinations, organizationCount: state.ctx.organizations?.length || 0, memberships: state.ctx.memberships?.length || 0 });
    console.log(JSON.stringify(inventory.at(-1)));
    if (!process.argv.includes('--probe')) {
      await capture(state, `${role}-overview`, '总览');
      for (const destination of destinations) {
        if (['overview', '__overview__'].includes(destination.key)) continue;
        try {
          await navigateWorkspace(state.shell, destination.key, role === 'superAdmin');
          await settle(state.page);
          await capture(state, `${role}-${destination.key}`, destination.name);
        } catch (error) {
          records.push({ id: slug(`${role}-${destination.key}`), role, label: destination.name, blocked: error.message.split('\n')[0] });
          console.log(`BLOCKED ${role} ${destination.key} ${error.message.split('\n')[0]}`);
        }
      }
    }
    await state.context.close();
    fs.writeFileSync(path.join(root, 'inventory.json'), JSON.stringify(inventory, null, 2));
  }
  await browser.close();
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; browser?.close(); });
module.exports = { enter, intent, capture, settle, screenshots, root, records, setBrowser: value => browser = value };
