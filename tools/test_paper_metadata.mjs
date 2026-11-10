import assert from 'node:assert/strict';
import { cancellationEvidence } from './lib/paper_metadata.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const value of ['cancelled', 'CANCELED', 'not_held', 'not-held']) {
    assert.ok(cancellationEvidence({exam_info: {availability: value}}));
}
assert.ok(cancellationEvidence({exam_info: {cancelled: true}}));
assert.ok(cancellationEvidence({exam_info: {title: 'JLPT [因COVID-19取消]'}}));
for (const title of ['2024年真题', '未取消', '没有取消', '未被取消']) {
    assert.equal(cancellationEvidence({exam_info: {title}}), '');
}
assert.equal(cancellationEvidence(null), '');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture=fs.mkdtempSync(path.join(repo,'tmp','paper-metadata-'));
const save=(name,info)=>{const target=path.join(fixture,'data/paper',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify({exam_info:info}));};
fs.mkdirSync(path.join(fixture,'data/paper/eju'),{recursive:true});
save('jlpt/n1/N1_2020_07.json',{id:'N1_2020_07',title:'因COVID-19取消',sections:[]});
save('jlpt/n2/N2_2020_07.json',{id:'N2_2020_07',title:'待整理',sections:[]});
save('jlpt/n3/N3_2020_07.json',{id:'N3_2020_07',status:'not_held',sections:[{questions:[{id:1,question:'题目',options:['a'],correct_answer:1}]}]});
const gaps=spawnSync(process.execPath,[path.join(repo,'tools/audit_paper_library_gaps.mjs')],{cwd:fixture,encoding:'utf8'});
assert.equal(gaps.status,0,gaps.stderr);
const report=JSON.parse(gaps.stdout).jlpt;
assert.equal(report.notHeldSessions.length,1);
assert.deepEqual(report.emptyTemplates,['N2_2020_07']);
assert.equal(report.metadataConflicts[0].id,'N3_2020_07');
const audit=spawnSync(process.execPath,[path.join(repo,'tools/audit_exam_content.mjs')],{cwd:fixture,encoding:'utf8'});
assert.equal(audit.status,1);
assert.match(audit.stderr,/JLPT_CANCELLATION_CONFLICT/);
assert.match(audit.stdout,/"jlptNotHeldFiles": 1/);
console.log('Paper metadata classification checks passed');
