const {request}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const {loginApi,uniqueLoginId}=require('../helpers/session');
(async()=>{
const repo=path.resolve(__dirname,'../../..'),allowed=repo+path.sep+'tmp'+path.sep;
const fixturePath=path.resolve(process.env.TEACHER_EDGE_FIXTURE||''),dataRoot=path.resolve(process.env.TEACHER_EDGE_DATA_ROOT||'');
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:8082';
if(!fixturePath.startsWith(allowed)||!dataRoot.startsWith(allowed)||new URL(baseURL).port==='8080')throw Error('Use an isolated data root and fixture under repo/tmp, away from live port 8080');
const r=await request.newContext({baseURL});
const admin=await loginApi(r,'superadmin_demo');
const actors=[];for(const prefix of ['teacher_edge','student_edge','student_reviewed','student_missing']){const name=uniqueLoginId(prefix);actors.push({name,...await loginApi(r,name)});}
const [teacher,student,reviewed,missing]=actors;
const auth=t=>({Authorization:`Bearer ${t}`});
const post=async(url,data,t=admin.token)=>{const res=await r.post(url,{headers:auth(t),data});const j=await res.json();if(!res.ok())throw Error(JSON.stringify(j));return j.data;};
const org=await post('/api/v1/organizations',{name:'边界回归 '+Date.now(),organization_type:'school',plan:'pro',seats:10});const oid=org.organization_id;
for(const a of actors)await post(`/api/v1/organizations/${oid}/members`,{user_id:a.user_id,roles:[a===teacher?'teacher':'student'],confirmation:'确认修改机构成员',reauth_password:''});
const group=await post(`/api/v1/organizations/${oid}/learning-groups`,{name:'边界测试组',subject:'japanese',type:'class',status:'active'});const gid=group.learning_group_id;
for(const a of actors)await post(`/api/v1/organizations/${oid}/learning-groups/${gid}/enrollments`,{user_id:a.user_id,role:a===teacher?'teacher':'student',status:'active'});
Object.assign(teacher,await loginApi(r,teacher.name));
const plans={};for(const [kind,title] of [['api','旧备课接口20题'],['ui','旧备课界面20题'],['precise','离散两题方案'],['broken','失效的旧备课']])plans[kind]=await post('/api/v1/institution/lesson-prep/plans',{org_id:oid,learning_group_id:gid,exam_id:'N3_2010_07',title,limit:kind==='precise'?500:20,...(kind==='precise'?{question_ids:['0:1','0:3']}:{})},teacher.token);
const createUrl=`/api/v1/organizations/${oid}/learning-groups/${gid}/assignments`;
const assignments={};for(const kind of ['legacy','historical','reminder'])assignments[kind]=await post(createUrl,{title:'边界作业 '+kind,exam_id:'N3_2010_07',question_start:1,question_end:3,auto_reminder_enabled:false},teacher.token);
const answers={'0:1':1,'0:2':2,'0:3':1};
await post(`/api/v1/assignments/${assignments.historical.assignment_id}/submit`,{answers},student.token);
await post(`/api/v1/assignments/${assignments.historical.assignment_id}/submissions/${student.user_id}/review`,{action:'reviewed',manual_score:85,comment:'历史评语保留'},teacher.token);
for(const a of [student,reviewed]){await post(`/api/v1/assignments/${assignments.reminder.assignment_id}/submit`,{answers},a.token);await post(`/api/v1/assignments/${assignments.reminder.assignment_id}/submissions/${a.user_id}/review`,{action:a===student?'returned':'reviewed',comment:a===student?'请重做':'已检查'},teacher.token);}
fs.mkdirSync(path.dirname(fixturePath),{recursive:true});fs.writeFileSync(fixturePath,JSON.stringify({teacher,student,reviewed,missing,oid,gid,plans,assignments,answers,dataRoot}));console.log('Fixture ready: 4 plans, 3 assignments');await r.dispose();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
