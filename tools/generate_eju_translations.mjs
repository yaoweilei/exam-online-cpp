import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const rootDir = process.cwd();
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const raw = process.argv[i];
  if (!raw.startsWith('--')) continue;
  const [key, inlineValue] = raw.slice(2).split('=');
  if (inlineValue !== undefined) {
    args.set(key, inlineValue);
  } else if (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    args.set(key, process.argv[i + 1]);
    i += 1;
  } else {
    args.set(key, 'true');
  }
}

const overwrite = args.get('overwrite') === 'true';
const translate = args.get('translate') !== 'false';
const onlyExam = args.get('exam') || '';
const maxExams = Number(args.get('max-exams') || '0');
const updatedAt = args.get('updated-at') || new Date().toISOString();
const depsDir = path.resolve(rootDir, args.get('deps') || 'tmp/translation-gen/node_modules');
const paperDir = path.resolve(rootDir, 'data/paper/eju');
const outDir = path.resolve(rootDir, 'data/system/translations/eju/japanese');
const cachePath = path.resolve(rootDir, 'tmp/translation-gen/translate-cache-ja-zh.json');

const requireFromDeps = createRequire(path.join(depsDir, 'entry.cjs'));
const kuromoji = requireFromDeps('kuromoji');
const wanakana = requireFromDeps('wanakana');

const tokenizer = await new Promise((resolve, reject) => {
  kuromoji
    .builder({ dicPath: path.join(depsDir, 'kuromoji/dict') })
    .build((err, built) => (err ? reject(err) : resolve(built)));
});

const translationCache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, 'utf8'))
  : {};

function saveCache() {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(translationCache, null, 2) + '\n', 'utf8');
}

function hasJapaneseText(text) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

function hasKanji(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text || ''));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
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

function annotate(text) {
  const source = String(text || '');
  if (!source) return { kana: '', ruby: '' };
  const tokens = tokenizer.tokenize(source);
  let kana = '';
  let ruby = '';
  for (const token of tokens) {
    const surface = token.surface_form || '';
    const readingRaw = token.reading && token.reading !== '*' ? token.reading : '';
    const reading = readingRaw ? wanakana.toHiragana(readingRaw) : '';
    kana += reading || surface;
    if (reading && hasKanji(surface)) {
      ruby += `<ruby data-auto-furi="1"><rb>${escapeHtml(surface)}</rb><rt>${escapeHtml(reading)}</rt></ruby>`;
    } else {
      ruby += escapeHtml(surface);
    }
  }
  return { kana, ruby };
}

function addTask(tasks, scope, pIdx, sIdx, text, kind) {
  const source = String(text || '').trim();
  if (!source || !hasJapaneseText(source)) return;
  tasks.push({ scope, pIdx, sIdx, text: source, kind });
}

function collectTasks(examDoc) {
  const tasks = [];
  for (const section of examDoc.exam_info?.sections || []) {
    if (section.section_type !== 'writing' && section.section_type !== 'reading') continue;
    const sectionId = String(section.section_id || '');

    for (const passageGroup of section.passages || []) {
      const passageId = passageGroup.id ?? 1;
      const base = `${sectionId}:p${passageId}`;
      const passage = passageGroup.passage;
      if (passage?.type === 'text' && passage.value) {
        for (const sentence of splitPassageSentences(passage.value)) {
          addTask(tasks, base, sentence.pIdx, sentence.sIdx, sentence.text, 'passage');
        }
      }

      for (const question of passageGroup.questions || []) {
        const qScopeBase = `${base}:q${question.id}`;
        addTask(tasks, `${qScopeBase}:question`, 0, 0, question.question || '', 'question');
        (question.options || []).forEach((option, idx) => {
          addTask(tasks, `${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option');
        });
      }
    }

    for (const question of section.questions || []) {
      const base = question._groupPassageKey || `${sectionId}:q${question.id}`;
      const qScopeBase = section.section_type === 'writing' && base.includes(':p')
        ? `${base}:q${question.id}`
        : base;
      addTask(tasks, `${qScopeBase}:question`, 0, 0, question.question || '', 'question');
      (question.options || []).forEach((option, idx) => {
        addTask(tasks, `${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option');
      });
    }
  }
  return tasks;
}

async function fetchTranslationBatch(texts) {
  const marked = texts.map((text, idx) => `@@${idx}@@ ${text}`).join('\n');
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=zh-CN&dt=t&q=' +
    encodeURIComponent(marked);
  const data = await getJson(url);
  const translated = (data?.[0] || []).map((part) => part?.[0] || '').join('');
  const result = new Array(texts.length).fill('');
  const re = /@@(\d+)@@\s*([\s\S]*?)(?=\n@@\d+@@|$)/g;
  let match;
  while ((match = re.exec(translated)) !== null) {
    const idx = Number(match[1]);
    if (Number.isInteger(idx) && idx >= 0 && idx < texts.length) {
      result[idx] = match[2].trim();
    }
  }
  return result;
}

function getJson(url, attempt = 1) {
  return new Promise((resolve, reject) => {
    const command = [
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();',
      "$ProgressPreference='SilentlyContinue';",
      "$ErrorActionPreference='Stop';",
      '$r=Invoke-WebRequest -Uri $env:TRANSLATE_URL -UseBasicParsing -TimeoutSec 60;',
      '$r.Content'
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        env: { ...process.env, TRANSLATE_URL: url },
        timeout: 90000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      },
      async (err, stdout) => {
        if (!err) {
          try {
            resolve(JSON.parse(stdout));
          } catch (parseErr) {
            reject(parseErr);
          }
          return;
        }
        if (attempt < 4) {
          await new Promise((retryResolve) => setTimeout(retryResolve, 500 * attempt));
          try {
            resolve(await getJson(url, attempt + 1));
          } catch (retryErr) {
            reject(retryErr);
          }
          return;
        }
        reject(new Error(err.message));
      }
    );
  });
}

async function translateMany(tasks) {
  const needed = [];
  for (const task of tasks) {
    const key = task.text;
    if (translationCache[key]) {
      task.translation = translationCache[key];
    } else {
      needed.push(task);
    }
  }

  const uniqueTexts = [...new Set(needed.map((task) => task.text))];
  let done = 0;
  while (uniqueTexts.length > 0) {
    const batch = [];
    let chars = 0;
    while (uniqueTexts.length > 0 && batch.length < 18 && chars + uniqueTexts[0].length < 900) {
      const next = uniqueTexts.shift();
      batch.push(next);
      chars += next.length + 8;
    }
    if (batch.length === 0) batch.push(uniqueTexts.shift());

    let translated;
    try {
      translated = await fetchTranslationBatch(batch);
    } catch (err) {
      console.warn(`[translations:eju] batch failed, retrying one by one: ${err.message}`);
      translated = [];
      for (const text of batch) {
        try {
          const single = await fetchTranslationBatch([text]);
          translated.push(single[0] || '');
        } catch (singleErr) {
          console.warn(`[translations:eju] single failed: ${singleErr.message}`);
          translated.push('');
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    for (const [idx, text] of batch.entries()) {
      translationCache[text] = translated[idx] || '';
    }
    done += batch.length;
    if (done % 400 < batch.length) {
      console.log(`[translations:eju] translated ${done} unique texts`);
      saveCache();
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  for (const task of tasks) {
    if (!task.translation) task.translation = translationCache[task.text] || '';
  }
  saveCache();
}

function buildDoc(examId, tasks) {
  const doc = { exam_id: examId, items: {}, updated_at: updatedAt };
  for (const task of tasks) {
    const { kana, ruby } = annotate(task.text);
    if (!doc.items[task.scope]) doc.items[task.scope] = {};
    doc.items[task.scope][`${task.pIdx}.${task.sIdx}`] = {
      text: task.translation || '',
      kana,
      ruby,
      updated_by: translate ? 'codex-eju-mt-seed' : 'codex-eju-kana-seed',
      updated_at: updatedAt
    };
  }
  return doc;
}

if (!fs.existsSync(paperDir)) {
  throw new Error(`paper dir not found: ${paperDir}`);
}
fs.mkdirSync(outDir, { recursive: true });

let paperFiles = fs.readdirSync(paperDir).filter((name) => name.endsWith('.json')).sort();
if (onlyExam) paperFiles = paperFiles.filter((name) => name.replace(/\.json$/, '') === onlyExam);
if (maxExams > 0) paperFiles = paperFiles.slice(0, maxExams);

let generated = 0;
for (const file of paperFiles) {
  const examId = file.replace(/\.json$/, '');
  const outPath = path.join(outDir, file);
  if (!overwrite && fs.existsSync(outPath)) {
    console.log(`[translations:eju] skip existing ${examId}`);
    continue;
  }
  const examDoc = JSON.parse(fs.readFileSync(path.join(paperDir, file), 'utf8'));
  const tasks = collectTasks(examDoc);
  if (translate && tasks.length > 0) {
    console.log(`[translations:eju] ${examId}: translating ${tasks.length} entries`);
    await translateMany(tasks);
  } else {
    console.log(`[translations:eju] ${examId}: generating ${tasks.length} kana/ruby entries`);
  }
  const doc = buildDoc(examId, tasks);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  generated += 1;
  console.log(`[translations:eju] wrote ${path.relative(rootDir, outPath)} (${tasks.length} entries)`);
}

console.log(`[translations:eju] done, generated ${generated} file(s)`);
