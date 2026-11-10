const { test, expect } = require('@playwright/test');
const { loginApi, uniqueLoginId } = require('./helpers/session');
const fs = require('fs');
const path = require('path');

const file = path.resolve('tmp/operations-content-20261028/api-status.json');
const source = path.resolve('tmp/role-fixes-20261020/data');
let admin, student;
const auth = user => ({ Authorization: 'Bearer ' + user.token });
const fresh = () => ({ schema_version: 1, data_root: source, state: 'succeeded',
  last_successful_backup_created_at: new Date(Date.now() - 60000).toISOString(),
  last_successful_at: new Date(Date.now() - 10000).toISOString(), finished_at: new Date(Date.now() - 10000).toISOString() });
const save = value => fs.writeFileSync(file, JSON.stringify(value));
async function operations(request, user = admin) {
  const response = await request.get('/api/v1/admin/operations', { headers: auth(user) });
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
test.beforeAll(async ({ request }, info) => {
  expect(new URL(info.project.use.baseURL).port).toBe('8083');
  admin = await loginApi(request, uniqueLoginId('superadmin_backup_quality'));
  student = await loginApi(request, uniqueLoginId('student_backup_quality'));
});
test.afterAll(() => { const v=fresh(); v.finished_at=v.last_successful_at; save(v); });

test('备份成功、失败、过期、卡住、错误来源及损坏记录不会混报正常', async ({ request }) => {
  const inspect = async expected => {
    const data = await operations(request), backup = data.checks.find(row => row.name === '数据备份校验');
    expect(backup.state).toBe(expected);
    expect(backup.ready).toBe(expected === 'succeeded' || expected === 'running');
    if (!backup.ready) expect(data.items.some(row => row.type === 'service_issue' && row.title === backup.detail)).toBe(true);
    expect(JSON.stringify(backup)).not.toContain(source);
    expect(JSON.stringify(data)).not.toContain('PRIVATE-SECRET');
    return backup;
  };
  const valid = fresh(); valid.finished_at=valid.last_successful_at; save(valid);
  expect((await inspect('succeeded')).last_verified_at).toBe(valid.last_successful_at);
  save({ ...valid, state: 'failed', error: 'PRIVATE-SECRET C:/private/backup' });
  expect((await inspect('failed')).last_verified_at).toBe(valid.last_successful_at);
  const old = new Date(Date.now()-96*3600000).toISOString();
  save({ ...valid, last_successful_backup_created_at: old }); await inspect('stale');
  save({ ...valid, last_successful_backup_created_at: old, last_successful_at: old, finished_at: old }); await inspect('stale');
  save({ ...valid, state: 'running', started_at: new Date().toISOString() }); await inspect('running');
  save({ ...valid, state: 'running', started_at: old }); await inspect('stalled');
  save({ ...valid, data_root: path.resolve('tmp') }); await inspect('wrong_source');
  fs.writeFileSync(file, '{'); await inspect('invalid');
  fs.unlinkSync(file); await inspect('missing');
});

test('备份任务信息仅平台管理员可读，状态详情不暴露路径或原始错误', async ({ request }) => {
  expect((await request.get('/api/v1/admin/operations', { headers: auth(student) })).status()).toBe(403);
  expect((await request.get('/api/v1/admin/operations')).ok()).toBe(false);
});

test('管理员沿用运行检查展示备份详情和上次成功时间，手机不溢出', async ({ page }, info) => {
  const value=fresh(); value.finished_at=value.last_successful_at; save(value);
  await page.route('**/__backup_probe__', route => route.fulfill({ contentType: 'text/html', body: '<link rel="stylesheet" href="/static/styles/personal-center.css"><link rel="stylesheet" href="/static/styles/institution-workflow.css"><main class="pc-workspace-main"></main>' }));
  await page.goto('/__backup_probe__');
  await page.evaluate(async token => {
    const { renderProductPanel, bindProductPanels }=await import('/static/app/viewer/personalCenter/productImprovements.js');
    const result=await fetch('/api/v1/admin/operations', {headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
    window.APIClient={request:async()=>result.data};
    const root=document.querySelector('main'); root.innerHTML=renderProductPanel('platform-operations');
    bindProductPanels(root,{owner:'backup-quality-ui',token,orgId:'',current:()=>true,changed:()=>{},navigate:()=>{},password:async()=>null,confirm:async()=>false});
  },admin.token);
  await page.locator('[data-role-overview="superAdmin"] [data-platform-admin-page="reminders"]').click();
  await page.getByText('统计范围与服务检查', {exact:true}).click();
  await expect(page.locator('main')).toContainText('最近一次备份任务校验成功');
  await expect(page.locator('main')).toContainText('最近成功校验：');
  await page.setViewportSize({width:390,height:844});
  expect(await page.locator('main').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('backup-status-mobile.png')});
});

test('公开试卷接口提供修复后的完整选项和对应文章解析', async ({ request }) => {
  const get=async id=>{const r=await request.get('/api/v1/exams/'+id);expect(r.ok()).toBe(true);return(await r.json()).data.exam_info.sections;};
  const question=(sections,index,id)=>{const s=sections[index];return [...(s.questions||[]),...(s.passages||[]).flatMap(p=>p.questions||[])].find(q=>q.id===id);};
  const july=question(await get('N1_2015_07'),16,4);
  expect(july.options).toHaveLength(3); expect(july.options[1]).toBe('本当、よく当たるよね。'); expect(july.correct_answer).toBe(3);
  const december=question(await get('N1_2015_12'),15,3);
  expect(december.options).toHaveLength(4); expect(december.options[1]).toBe('雷による被害'); expect(december.correct_answer).toBe(4);
  const n3=await get('N3_2021_12');
  const flower=question(n3,12,1); expect(flower.correct_answer).toBe(3);expect(flower.options[2]).toContain('根元'); expect(flower.explanation).toContain('【为什么选3】');
  const date=question(n3,13,4);expect(date.correct_answer).toBe(3);expect(date.explanation).toContain('来週の土曜日の3時');
  const friends=await get('N3_2024_07');
  for(const [id,answer] of [[54,3],[55,4],[56,2],[57,1]]) {
    const q=question(friends,7,id); expect(q.correct_answer).toBe(answer); expect(q.explanation).toContain('【为什么选'+answer+'】');
    expect(q.explanation+q.explanation_expand).not.toMatch(/ガソリン|加油站|擦窗/);
  }
});
