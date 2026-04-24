#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targetLevels = ["n1", "n2", "n3"];

const sectionDefaultsByLevel = {
  n1: {
    "1.01": ["vocab.kanji.reading"],
    "1.02": ["vocab.context"],
    "1.03": ["vocab.synonym"],
    "1.04": ["vocab.word.usage"],
    "1.05": ["grammar.form", "grammar.pattern"],
    "1.06": ["grammar.word_order", "grammar.sentence.completion"],
    "1.07": ["grammar.discourse"],
    "1.08": ["reading.detail.locate"],
    "1.09": ["reading.detail.locate", "reading.inference"],
    "1.10": ["reading.inference", "reading.summary"],
    "1.11": ["reading.integrated", "reading.structure"],
    "1.12": ["reading.claim", "reading.inference.intent"],
    "1.13": ["reading.information_retrieval"],
    "2.01": ["listening.task"],
    "2.02": ["listening.detail"],
    "2.03": ["listening.main_idea", "listening.intent"],
    "2.04": ["listening.response", "listening.expression"],
    "2.05": ["listening.integrated", "listening.detail"],
  },
  n2: {
    "1.01": ["vocab.kanji.reading"],
    "1.02": ["vocab.kanji.writing"],
    "1.03": ["vocab.word_formation"],
    "1.04": ["vocab.context"],
    "1.05": ["vocab.synonym"],
    "1.06": ["vocab.word.usage"],
    "1.07": ["grammar.form", "grammar.pattern"],
    "1.08": ["grammar.word_order", "grammar.sentence.completion"],
    "1.09": ["grammar.discourse"],
    "1.10": ["reading.detail.locate"],
    "1.11": ["reading.detail.locate", "reading.inference"],
    "1.12": ["reading.integrated", "reading.structure"],
    "1.13": ["reading.claim", "reading.inference.intent"],
    "1.14": ["reading.information_retrieval"],
    "2.01": ["listening.task"],
    "2.02": ["listening.detail"],
    "2.03": ["listening.main_idea", "listening.intent"],
    "2.04": ["listening.response"],
    "2.05": ["listening.integrated", "listening.detail"],
  },
  n3: {
    "1.01": ["vocab.kanji.reading"],
    "1.02": ["vocab.kanji.writing"],
    "1.03": ["vocab.context"],
    "1.04": ["vocab.synonym"],
    "1.05": ["vocab.word.usage"],
    "1.06": ["grammar.form", "grammar.pattern"],
    "1.07": ["grammar.word_order", "grammar.sentence.completion"],
    "1.08": ["grammar.discourse"],
    "1.09": ["reading.detail.locate"],
    "1.10": ["reading.detail.locate", "reading.inference"],
    "1.11": ["reading.inference", "reading.summary"],
    "1.12": ["reading.information_retrieval"],
    "2.01": ["listening.task"],
    "2.02": ["listening.detail"],
    "2.03": ["listening.main_idea", "listening.intent"],
    "2.04": ["listening.expression"],
    "2.05": ["listening.response"],
  },
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function listTargetFiles() {
  return targetLevels.flatMap((level) => {
    const targetRoot = `data/paper/jlpt/${level}`;
    const absoluteRoot = path.join(repoRoot, targetRoot);
    const levelPrefix = level.toUpperCase();
    return fs
      .readdirSync(absoluteRoot)
      .filter((name) => new RegExp(`^${levelPrefix}_\\d{4}_\\d{2}\\.json$`).test(name))
      .sort()
      .map((name) => ({ level, relativeFile: path.join(targetRoot, name) }));
  });
}

function visitQuestions(section, callback) {
  for (const question of section.questions ?? []) {
    callback(question);
  }
  for (const passage of section.passages ?? []) {
    for (const question of passage.questions ?? []) {
      callback(question);
    }
  }
}

function hasQuestions(section) {
  let found = false;
  visitQuestions(section, () => {
    found = true;
  });
  return found;
}

function sectionTagsFor(section, level) {
  const sectionId = String(section.section_id ?? "");
  const sectionName = String(section.section_name ?? "");
  const defaults = sectionDefaultsByLevel[level]?.[sectionId] ?? [];
  if (sectionName.includes("統合理解") && section.section_type === "reading") {
    return unique([...defaults, "reading.integrated", "reading.structure"]);
  }
  if (defaults.length > 0) {
    return defaults;
  }
  return Array.isArray(section.skill_tags) ? section.skill_tags : [];
}

function readingQuestionTags(section, question) {
  if (section.section_type !== "reading") {
    return [];
  }

  const sectionId = String(section.section_id ?? "");
  const sectionName = String(section.section_name ?? "");
  const text = String(question.question ?? "");
  const tags = [];

  if (sectionId === "1.13") {
    tags.push("reading.information_retrieval", "reading.detail.locate");
  }
  if (sectionName.includes("情報検索")) {
    tags.push("reading.information_retrieval", "reading.detail.locate");
  }
  if (sectionName.includes("統合理解") || sectionName.includes("対比")) {
    tags.push("reading.integrated", "reading.structure");
  }

  if (/筆者|著者|作者|AとB|共通|両者|双方|意見|姿勢|述べている|考えている|言いたい|主張|とらえている/.test(text)) {
    tags.push("reading.claim");
  }
  if (/なぜ|どうして|理由|原因|どのような|何か|いつ|いくつ|どれか|について|知らせている/.test(text)) {
    tags.push("reading.detail.locate");
  }
  if (/どういうこと|意味|指す|とは|わかる|考えられる|推測|推察|意図|表している|示している/.test(text)) {
    tags.push("reading.inference");
  }
  if (/合うもの|合っている|内容|全体|まとめ|最も適当|最もよい|結論/.test(text)) {
    tags.push("reading.summary");
  }

  return tags;
}

function questionTagsFor(section, question, level) {
  return unique([
    ...sectionTagsFor(section, level),
    ...readingQuestionTags(section, question),
  ]);
}

function sameStringArray(left, right) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

let totalUpdated = 0;
let totalTouched = 0;
let totalSectionUpdated = 0;

for (const {level, relativeFile} of listTargetFiles()) {
  const absoluteFile = path.join(repoRoot, relativeFile);
  const source = fs.readFileSync(absoluteFile, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const payload = JSON.parse(source);
  let changed = 0;
  let touched = 0;
  let sectionChanged = 0;
  let fileHasQuestions = false;

  for (const section of payload.exam_info?.sections ?? []) {
    const sectionTags = sectionTagsFor(section, level);
    if (sectionTags.length > 0 && hasQuestions(section) && (!Array.isArray(section.skill_tags) || section.skill_tags.length === 0)) {
      section.skill_tags = sectionTags;
      sectionChanged += 1;
    }

    visitQuestions(section, (question) => {
      fileHasQuestions = true;
      const tags = questionTagsFor(section, question, level);
      if (tags.length === 0) {
        return;
      }
      if (!sameStringArray(question.skill_tags, tags)) {
        changed += 1;
      }
      question.skill_tags = tags;
      touched += 1;
    });
  }

  if (!fileHasQuestions) {
    console.log(`${relativeFile}: skipped empty exam`);
    continue;
  }

  if (changed > 0 || sectionChanged > 0) {
    const serialized = `${JSON.stringify(payload, null, 2)}\n`.replace(/\n/g, eol);
    fs.writeFileSync(absoluteFile, serialized, "utf8");
  }

  totalUpdated += changed;
  totalTouched += touched;
  totalSectionUpdated += sectionChanged;
  console.log(`${relativeFile}: touched ${touched} questions, changed ${changed}, section changed ${sectionChanged}`);
}

console.log(`total touched: ${totalTouched}`);
console.log(`total question updated: ${totalUpdated}`);
console.log(`total section updated: ${totalSectionUpdated}`);
