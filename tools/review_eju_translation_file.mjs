import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const examId = process.argv[2] || '';

if (!examId) {
  console.error('Usage: node tools/review_eju_translation_file.mjs <exam_id>');
  process.exit(1);
}

const paperPath = path.join(rootDir, 'data/paper/eju', `${examId}.json`);
const translationPath = path.join(rootDir, 'data/system/translations/eju/japanese', `${examId}.json`);

function hasJapaneseText(text) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

function splitPassageSentences(rawText) {
  const out = [];
  String(rawText || '').split(/\n/).forEach((para, pIdx) => {
    if (para.trim() === '') return;
    const parts = [];
    const re = /[^。！？!?…]*[。！？!?…]+|[^。！？!?…]+$/g;
    let match;
    while ((match = re.exec(para)) !== null) {
      if (match[0]) parts.push(match[0]);
    }
    if (parts.length === 0) parts.push(para);
    parts.forEach((text, sIdx) => out.push({ pIdx, sIdx, text }));
  });
  return out;
}

function collectTasks(examDoc) {
  const tasks = [];
  const add = (scope, pIdx, sIdx, source, kind) => {
    const text = String(source || '').trim();
    if (!text || !hasJapaneseText(text)) return;
    tasks.push({ scope, key: `${pIdx}.${sIdx}`, source: text, kind });
  };

  for (const section of examDoc.exam_info?.sections || []) {
    if (section.section_type !== 'writing' && section.section_type !== 'reading') continue;
    const sectionId = String(section.section_id || '');

    for (const passageGroup of section.passages || []) {
      const base = `${sectionId}:p${passageGroup.id ?? 1}`;
      const passage = passageGroup.passage;
      if (passage?.type === 'text' && passage.value) {
        for (const sentence of splitPassageSentences(passage.value)) {
          add(base, sentence.pIdx, sentence.sIdx, sentence.text, 'passage');
        }
      }

      for (const question of passageGroup.questions || []) {
        const qScopeBase = `${base}:q${question.id}`;
        add(`${qScopeBase}:question`, 0, 0, question.question || '', 'question');
        (question.options || []).forEach((option, idx) => {
          add(`${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option');
        });
      }
    }

    for (const question of section.questions || []) {
      const base = question._groupPassageKey || `${sectionId}:q${question.id}`;
      const qScopeBase = section.section_type === 'writing' && base.includes(':p')
        ? `${base}:q${question.id}`
        : base;
      add(`${qScopeBase}:question`, 0, 0, question.question || '', 'question');
      (question.options || []).forEach((option, idx) => {
        add(`${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option');
      });
    }
  }
  return tasks;
}

const examDoc = JSON.parse(fs.readFileSync(paperPath, 'utf8'));
const translationDoc = JSON.parse(fs.readFileSync(translationPath, 'utf8'));
const tasks = collectTasks(examDoc);

const counts = {
  total: tasks.length,
  missing: 0,
  emptyText: 0,
  machine: 0,
  reviewed: 0
};

const lines = [];
for (const task of tasks) {
  const item = translationDoc.items?.[task.scope]?.[task.key];
  if (!item) {
    counts.missing += 1;
    lines.push(`${task.scope}\t${task.key}\t${task.kind}\tMISSING\t${task.source}\t`);
    continue;
  }
  if (!String(item.text || '').trim()) counts.emptyText += 1;
  if (String(item.updated_by || '').includes('review')) counts.reviewed += 1;
  else counts.machine += 1;
  lines.push([
    task.scope,
    task.key,
    task.kind,
    item.updated_by || '',
    task.source.replace(/\s+/g, ' '),
    String(item.text || '').replace(/\s+/g, ' ')
  ].join('\t'));
}

console.error(JSON.stringify(counts, null, 2));
process.stdout.write(lines.join('\n') + '\n');
