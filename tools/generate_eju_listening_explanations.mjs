import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EJU_DIR = path.join(ROOT, 'data', 'paper', 'eju');
const GENERATED_BY = 'codex_eju_listening_explanation_v2_publication_style';
const GENERATED_AT = '2026-05-15T00:00:00+08:00';

function flattenScript(script) {
  if (!Array.isArray(script)) return [];
  return script
    .map((item) => {
      const text = typeof item === 'string' ? item : String(item?.text || '');
      return text.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/^([男女]子学生|学生|先生|男性|女性|講師|レポーター|農家|職員|店員|客|アナウンサー)\s*[:：]\s*/, '$1：')
    .trim();
}

function isBareOption(option) {
  return /^[1-4]$/.test(String(option || '').trim());
}

function optionTextFromQuestion(question, answerNo) {
  const option = question.options?.[answerNo - 1];
  if (option && !isBareOption(option)) return String(option).trim();

  const lines = flattenScript(question.script);
  const optionLine = lines.find((line) => {
    const normalized = line.replace(/^[\s　]*/, '');
    return new RegExp(`^${answerNo}[\\.．]\\s*`).test(normalized);
  });
  if (optionLine) return optionLine.replace(/^[\s　]*[1-4][\\.．]\s*/, '').trim();

  if (option) return String(option).trim();
  return `${answerNo}`;
}

function extractScriptOptions(question) {
  const fromQuestion = (question.options || []).map((option, idx) => ({
    no: idx + 1,
    text: String(option || '').trim(),
  }));
  if (fromQuestion.some((item) => !isBareOption(item.text))) return fromQuestion;

  const lines = flattenScript(question.script);
  const parsed = [];
  for (const line of lines) {
    const match = line.match(/^\s*([1-4])[\.．]\s*(.+)$/);
    if (match) parsed.push({ no: Number(match[1]), text: match[2].trim() });
  }
  if (parsed.length >= 2) return parsed;
  return fromQuestion;
}

function findQuestionLine(question, lines) {
  const q = String(question.question || '').replace(/\s+/g, '');
  const candidates = lines.filter((line) => line.includes('ですか') || line.includes('ますか') || line.includes('でしょうか'));
  if (!q) return candidates[candidates.length - 1] || '';
  const exact = candidates.find((line) => q.includes(line.replace(/\s+/g, '')) || line.replace(/\s+/g, '').includes(q));
  return exact || candidates[0] || String(question.question || '').trim();
}

function evidenceLines(question) {
  const lines = flattenScript(question.script).map(cleanLine);
  if (!lines.length) return [];

  const optionStart = lines.findIndex((line) => /^\s*1[\.．]/.test(line));
  const contentEnd = optionStart >= 0 ? optionStart : lines.length;
  const content = lines.slice(0, contentEnd);
  const questionLine = findQuestionLine(question, content);

  const usable = content.filter((line) => {
    if (!line || line === questionLine) return false;
    if (/^\d+番/.test(line) && line.includes('話しています')) return false;
    return line.length >= 8;
  });

  const tail = usable.slice(-5);
  const selected = tail.length ? tail : usable.slice(0, 5);
  return selected.slice(0, 4);
}

function questionType(question) {
  const tags = question.skill_tags || [];
  if (tags.some((tag) => String(tag).includes('listening_reading'))) return '读听解题';
  return '听解题';
}

function detailType(question) {
  const text = [question.question, ...flattenScript(question.script)].join(' ');
  if (/女子学生|男子学生|男性|女性|店員|客|職員|レポーター|農家/.test(text)) return '人物对话题';
  if (/先生|講師|授業|講義|説明|発表/.test(text)) return '讲义说明题';
  return questionType(question);
}

function compactEvidence(evidence) {
  if (!evidence.length) return '音频中给出了判断答案所需的条件、理由和结论。';
  return evidence.map((line) => `「${line}」`).join('、');
}

function shortEvidence(evidence) {
  if (!evidence.length) return '音频中的关键条件';
  const picked = evidence.slice(-2).join(' / ');
  return picked.length > 180 ? `${picked.slice(0, 180)}…` : picked;
}

function wrongOptionReason(wrong, correctNo, correctText, evidenceText, needsVisual) {
  const wrongText = String(wrong.text || '').trim();
  const correctLabel = isBareOption(correctText) ? `第${correctNo}项` : `「${correctText}」`;
  if (needsVisual || isBareOption(wrongText)) {
    return `- ${wrong.no}：图中第${wrong.no}项没有同时满足音频里的关键条件。定位信息指向的是${correctLabel}，所以不能只看图形或文字中的局部相似点。`;
  }
  return `- ${wrong.no}. ${wrongText}：音频的有效信息指向${correctLabel}。该项与定位信息「${evidenceText}」所体现的条件、对象或结果不一致。`;
}

function displayQuestionText(question, evidence) {
  const explicit = String(question.question || '').trim();
  if (explicit) return explicit;
  const lines = flattenScript(question.script).map(cleanLine);
  return findQuestionLine(question, lines) || evidence.find((line) => /ですか|ますか|でしょうか/.test(line)) || '听力材料末尾提出的问题';
}

function answerLogicText(needsVisual, evidence, correctLabel) {
  const compact = compactEvidence(evidence);
  if (needsVisual) {
    return `这题要把音频条件和题册图表对应。音频中的关键判断是：${compact}。这些条件共同指向${correctLabel}。`;
  }
  return `音频中的关键判断是：${compact}。这些信息共同限定了对象、动作和结论，最符合${correctLabel}。`;
}

function buildExplanation(question) {
  const answerNo = Number(question.correct_answer || question.answer);
  const omitted = String(question.question || '').includes('出版上の都合') || String(flattenScript(question.script).join(' ')).includes('出版上の都合');
  if (omitted) {
    return {
      explanation: `【题目解析】
这道题在原始资料中标注为「試験問題として成立していますが、出版上の都合により本問題の掲載はいたしません。」。

【听力定位】
原题因出版原因未刊载，当前数据中没有可用于判断答案的完整题干、选项或听力材料。

【为什么不能正常解析】
这类题虽然在正式考试中成立，但公开资料没有给出完整内容。缺少题目和选项时，不能可靠地反推正确答案，也不应编造解析。

【拿分提醒】
复习时可以跳过这类“未刊载”题，把时间放在有完整音频原文、题干和选项的题目上。`,
      explanation_expand: `【补充解析】
本题属于公开资料缺项，不是普通听解题。当前数据只保留了出版说明，不能进行正常的定位句分析或误选项比较。

【自学者复盘】
遇到未刊载题时，不需要纠结答案。建议记录为资料缺失，并用同年份其他完整题练习听取条件、结论和选项对应。`,
      explanation_source: {
        generated_by: GENERATED_BY,
        style_reference: 'JLPT listening/reading explanation format',
        generated_at: GENERATED_AT,
        review_pass: 'official omission notice; no fabricated answer analysis',
      },
    };
  }
  if (!Number.isInteger(answerNo) || answerNo < 1 || answerNo > 4) return null;
  if (!Array.isArray(question.script) || question.script.length === 0) return null;

  const type = questionType(question);
  const detailedType = detailType(question);
  const correctText = optionTextFromQuestion(question, answerNo);
  const options = extractScriptOptions(question);
  const evidence = evidenceLines(question);
  const qText = displayQuestionText(question, evidence);
  const evidenceText = shortEvidence(evidence);
  const evidenceBlock = evidence.length
    ? evidence.map((line, idx) => `${idx + 1}. ${line}`).join('\n')
    : '1. 音声の後半で、条件・理由・結論が整理されています。';

  const correctLabel = isBareOption(correctText) ? `第${answerNo}项` : `第${answerNo}项「${correctText}」`;
  const needsVisual = questionType(question) === '读听解题';
  const visualNote = answerLogicText(needsVisual, evidence, correctLabel);

  const wrongItems = options
    .filter((item) => item.no !== answerNo)
    .slice(0, 3)
    .map((item) => wrongOptionReason(item, answerNo, correctText, evidenceText, needsVisual))
    .join('\n');

  const explanation = `【题目解析】
这题是${type}，具体属于${detailedType}。题干问的是「${qText}」。解题时先确认问题问的是“对象、动作、原因、结果”中的哪一类，再听音频中最后确认的信息。

【听力定位】
${evidenceBlock}

【为什么选${answerNo}】
正确答案是${correctLabel}。${visualNote}

【误选项为什么不对】
${wrongItems || '- 其他选项与音频中的关键条件不一致，不能只凭相同词语判断。'}

【拿分提醒】
EJU 听力不要只抓关键词。人物对话题要特别注意「でも」「じゃ」「そうしてみる」之后的最终决定；讲义说明题要注意定义、分类、实验结果和最后一句问题；读听解题还要把音频条件逐项落到图表上。`;

  const explanationExpand = `【补充解析】
本题的关键是把问题中的要求和音频里的有效信息对应起来。正确项不是因为出现了某个相同词，而是因为它同时满足音频中的对象、条件和结论。

【解题步骤】
1. 先确认问的是“谁”“做什么”“为什么”“图中哪一项”。
2. 听到转折、总结、最后决定或实验结果时做标记。
3. 把选项拆成对象、动作、条件和结果来核对。
4. 排除只符合局部信息、顺序不对或把原因结果颠倒的选项。

【自学者复盘】
建议复听时把定位句和正确项并排写下来。读听解题还要把图表中的轴、项目名和音频里的条件逐一连线，这比单纯记答案更有效。`;

  return {
    explanation,
    explanation_expand: explanationExpand,
    explanation_source: {
      generated_by: GENERATED_BY,
      style_reference: 'JLPT listening/reading explanation format',
      generated_at: GENERATED_AT,
      review_pass: 'publication-style script-based explanation generation; blocked items without transcript skipped',
    },
  };
}

function visitListeningQuestions(root, callback) {
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.eju_question_no && value.audio) callback(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(root?.exam_info?.sections);
}

let filesChanged = 0;
let explanationsAdded = 0;
let skippedNoScript = 0;
let listeningQuestions = 0;

for (const file of fs.readdirSync(EJU_DIR).filter((name) => name.endsWith('.json')).sort()) {
  const filePath = path.join(EJU_DIR, file);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = false;

  visitListeningQuestions(payload, (question) => {
    listeningQuestions += 1;
    const generated = buildExplanation(question);
    if (!generated) {
      skippedNoScript += 1;
      return;
    }
    question.explanation = generated.explanation;
    question.explanation_expand = generated.explanation_expand;
    question.explanation_source = generated.explanation_source;
    explanationsAdded += 1;
    changed = true;
  });

  if (changed) {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    filesChanged += 1;
    console.log(`${file}: explanations updated`);
  }
}

console.log(JSON.stringify({ filesChanged, listeningQuestions, explanationsAdded, skippedNoScript }, null, 2));
