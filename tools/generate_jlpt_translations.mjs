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

const level = String(args.get('level') || 'n1').toLowerCase();
const overwrite = args.get('overwrite') === 'true';
const translate = args.get('translate') !== 'false';
const onlyExam = args.get('exam') || '';
const maxExams = Number(args.get('max-exams') || '0');
const updatedAt = args.get('updated-at') || new Date().toISOString();
const depsDir = path.resolve(rootDir, args.get('deps') || 'tmp/translation-gen/node_modules');
const paperDir = path.resolve(rootDir, 'data/paper/jlpt', level);
const outDir = path.resolve(rootDir, 'data/system/translations/jlpt', level);
const cachePath = path.resolve(rootDir, 'tmp/translation-gen/translate-cache-ja-zh.json');

const requireFromDeps = createRequire(path.join(depsDir, 'entry.cjs'));
const kuromoji = requireFromDeps('kuromoji');
const wanakana = requireFromDeps('wanakana');
const OpenCC = requireFromDeps('opencc-js');
const toSimplified = OpenCC.Converter({ from: 'jp', to: 'cn' });

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

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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

function stripRuby(html) {
  return String(html || '')
    .replace(/<ruby[^>]*><rb>(.*?)<\/rb><rt>.*?<\/rt><\/ruby>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function stripOptionNumber(text) {
  return String(text || '').replace(/^\s*\d+\s*[.．、]\s*/, '').trim();
}

function displayScriptText(line) {
  const text = String(line?.text || '');
  const speaker = line?.speaker ? String(line.speaker) : '';
  if (!speaker) return text;
  const re = new RegExp(`^(${speaker})[：:]\\s*`);
  return text.replace(re, '');
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

function buildLexicon() {
  const lexicon = new Map();
  const translationRoot = path.resolve(rootDir, 'data/system/translations/jlpt');
  if (!fs.existsSync(translationRoot)) return lexicon;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(full);
    }
  };
  walk(translationRoot);
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [scope, rows] of Object.entries(doc.items || {})) {
      if (!scope.includes(':option')) continue;
      const entry = rows?.['0.0'];
      if (!entry?.text || /^读音：/.test(entry.text)) continue;
      const source = stripOptionNumber(stripRuby(entry.ruby || entry.kana || ''));
      if (source) lexicon.set(source, entry.text);
    }
  }
  return lexicon;
}

const optionLexicon = buildLexicon();

function isReadingChoiceToSkip(section, optionText) {
  const sectionId = String(section?.section_id || '');
  const sectionName = [section?.section_name, section?.section_title, section?.description].filter(Boolean).join(' ');
  if (sectionId !== '1.01' && !/(漢字読み|読み方)/.test(sectionName)) return false;
  const core = stripOptionNumber(optionText);
  return core.length > 0 && !hasKanji(core);
}

function addTask(tasks, scope, pIdx, sIdx, text, kind, section = null) {
  const source = String(text || '').trim();
  if (!source || !hasJapaneseText(source)) return;
  if (kind === 'option' && isReadingChoiceToSkip(section, source)) return;
  tasks.push({ scope, pIdx, sIdx, text: source, kind });
}

function collectTasks(examDoc) {
  const tasks = [];
  const sections = examDoc.exam_info?.sections || [];
  for (const section of sections) {
    const sectionId = String(section.section_id || '');
    for (const passageGroup of section.passages || []) {
      const passageId = passageGroup.id ?? 1;
      const base = `${sectionId}:p${passageId}`;
      const passage = passageGroup.passage;
      if (passage?.type === 'text' && passage.value) {
        for (const sentence of splitPassageSentences(passage.value)) {
          addTask(tasks, base, sentence.pIdx, sentence.sIdx, sentence.text, 'passage', section);
        }
      }

      for (const question of passageGroup.questions || []) {
        const qScopeBase = `${base}:q${question.id}`;
        addTask(tasks, `${qScopeBase}:question`, 0, 0, question.question || '', 'question', section);
        (question.options || []).forEach((option, idx) => {
          addTask(tasks, `${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option', section);
        });
        const script = question.script || passageGroup.script || [];
        if (Array.isArray(script) && script.length > 0) {
          const scriptScope = `${qScopeBase}:script`;
          script.forEach((line, idx) => addTask(tasks, scriptScope, 0, idx, displayScriptText(line), 'script', section));
        }
      }
    }

    for (const question of section.questions || []) {
      const qScopeBase = `${sectionId}:q${question.id}`;
      addTask(tasks, `${qScopeBase}:question`, 0, 0, question.question || '', 'question', section);
      (question.options || []).forEach((option, idx) => {
        addTask(tasks, `${qScopeBase}:option${idx + 1}`, 0, 0, option, 'option', section);
      });
      if (Array.isArray(question.script)) {
        const scriptScope = `${qScopeBase}:script`;
        question.script.forEach((line, idx) => addTask(tasks, scriptScope, 0, idx, displayScriptText(line), 'script', section));
      }
    }
  }
  return tasks;
}

function lexiconOrHeuristic(task) {
  if (task.kind !== 'option') return '';
  const core = stripOptionNumber(task.text);
  const mapped = optionLexicon.get(core);
  if (mapped) return mapped;
  if (/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{1,8}$/.test(core)) {
    return toSimplified(core);
  }
  return '';
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
			"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();",
			"$ProgressPreference='SilentlyContinue';",
			"$ErrorActionPreference='Stop';",
			"$r=Invoke-WebRequest -Uri $env:TRANSLATE_URL -UseBasicParsing -TimeoutSec 60;",
			"$r.Content"
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
			async (err, stdout, stderr) => {
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
    const heuristic = lexiconOrHeuristic(task);
    if (heuristic) {
      task.translation = heuristic;
      continue;
    }
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
			console.warn(`[translations] batch failed, retrying one by one: ${err.message}`);
			translated = [];
			for (const text of batch) {
				try {
					const single = await fetchTranslationBatch([text]);
					translated.push(single[0] || '');
				} catch (singleErr) {
					console.warn(`[translations] single failed: ${singleErr.message}`);
					translated.push('');
				}
				await new Promise((resolve) => setTimeout(resolve, 80));
			}
		}
    for (const [idx, text] of batch.entries()) {
      let value = translated[idx] || '';
      if (!value) {
        try {
          const single = await fetchTranslationBatch([text]);
          value = single[0] || '';
        } catch {
          value = '';
        }
      }
      translationCache[text] = value;
    }
    done += batch.length;
    if (done % 400 < batch.length) {
      console.log(`[translations] translated ${done} unique texts`);
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
  const doc = {
    exam_id: examId,
    items: {},
    updated_at: updatedAt
  };
  for (const task of tasks) {
    const { kana, ruby } = annotate(task.text);
    if (!doc.items[task.scope]) doc.items[task.scope] = {};
    doc.items[task.scope][`${task.pIdx}.${task.sIdx}`] = {
      text: task.translation || '',
      kana,
      ruby,
      updated_by: translate ? 'codex-mt-seed' : 'codex-kana-seed',
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
    console.log(`[translations] skip existing ${examId}`);
    continue;
  }
  const examDoc = JSON.parse(fs.readFileSync(path.join(paperDir, file), 'utf8'));
  const tasks = collectTasks(examDoc);
  if (translate && tasks.length > 0) {
    console.log(`[translations] ${examId}: translating ${tasks.length} entries`);
    await translateMany(tasks);
  } else {
    console.log(`[translations] ${examId}: generating ${tasks.length} kana/ruby entries`);
  }
  const doc = buildDoc(examId, tasks);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  generated += 1;
  console.log(`[translations] wrote ${path.relative(rootDir, outPath)} (${tasks.length} entries)`);
}

console.log(`[translations] done, generated ${generated} file(s)`);
