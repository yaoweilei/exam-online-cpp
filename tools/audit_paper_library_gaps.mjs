#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { cancellationEvidence } from './lib/paper_metadata.mjs';

const root = process.cwd();
const paperRoot = path.join(root, 'data', 'paper');
const downloadsRoot = path.join(root, 'downloads');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(filePath) {
	return fs.existsSync(filePath);
}

function walkFiles(dir) {
	const out = [];
	if (!exists(dir)) return out;
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		const stat = fs.statSync(full);
		if (stat.isDirectory()) out.push(...walkFiles(full));
		else out.push(full);
	}
	return out.sort((a, b) => a.localeCompare(b));
}

function countQuestions(sections) {
	let count = 0;
	for (const section of Array.isArray(sections) ? sections : []) {
		if (Array.isArray(section?.questions)) count += section.questions.length;
		if (Array.isArray(section?.passages)) {
			for (const passage of section.passages) {
				if (Array.isArray(passage?.questions)) count += passage.questions.length;
			}
		}
	}
	return count;
}

function sourceHintForEju(id) {
	const files = walkFiles(path.join(downloadsRoot, 'EJU日本语'));
	const [year, sessionText] = id.split('_');
	const session = Number(sessionText);
	const sessionWords = session === 1
		? ['第1回', '第１回', '第一回', '6月', 'R6.1', '2024年6月']
		: ['第2回', '第２回', '第二回', '11月', 'R6.2'];
	const matched = files.filter((filePath) => {
		const text = filePath.replaceAll(path.sep, '/');
		return text.includes(year) && sessionWords.some((word) => text.includes(word));
	});
	if (matched.length) return matched.map((filePath) => path.relative(root, filePath));

	if (id.startsWith('2025_')) {
		const maybe2025 = files.filter((filePath) => filePath.includes('2025'));
		if (maybe2025.length) return maybe2025.map((filePath) => path.relative(root, filePath));
	}
	return [];
}

function auditEju() {
	const dir = path.join(paperRoot, 'eju');
	const files = fs.readdirSync(dir)
		.filter((name) => /^\d{4}_\d{2}\.json$/.test(name))
		.map((name) => name.replace(/\.json$/, ''))
		.sort();
	const years = files.map((id) => Number(id.slice(0, 4)));
	const maxYearFromDownloads = walkFiles(path.join(downloadsRoot, 'EJU日本语'))
		.map((filePath) => [...filePath.matchAll(/20\d{2}/g)].map((match) => Number(match[0])))
		.flat()
		.filter((year) => year >= 2010 && year <= 2030)
		.reduce((max, year) => Math.max(max, year), 0);
	const maxYear = Math.max(...years, maxYearFromDownloads);
	const expected = [];
	for (let year = Math.min(...years); year <= maxYear; year += 1) {
		expected.push(`${year}_01`, `${year}_02`);
	}
	const missing = expected
		.filter((id) => !files.includes(id))
		.map((id) => ({
			id,
			sourceCandidates: sourceHintForEju(id)
		}));
	return { files, expected, missing };
}

function auditJlpt() {
	const levels = ['N1', 'N2', 'N3', 'N4', 'N5'];
	const sessions = ['07', '12'];
	const startYear = 2010;
	const endYear = 2025;
	const missingFiles = [];
	const emptyTemplates = [];
	const complete = [];
	const notHeldSessions = [];
	const metadataConflicts = [];

	for (const level of levels) {
		for (let year = startYear; year <= endYear; year += 1) {
			for (const session of sessions) {
				const id = `${level}_${year}_${session}`;
				const filePath = path.join(paperRoot, 'jlpt', level.toLowerCase(), `${id}.json`);
				if (!exists(filePath)) {
					missingFiles.push(id);
					continue;
				}
				const doc = readJson(filePath);
				const sections = doc?.exam_info?.sections;
				const questions = countQuestions(sections);
				const cancelled = cancellationEvidence(doc);
				if (!Array.isArray(sections) || sections.length === 0 || questions === 0) {
					if (cancelled) notHeldSessions.push({ id, evidence: cancelled });
					else emptyTemplates.push(id);
				} else {
					complete.push({ id, questions });
					if (cancelled) metadataConflicts.push({ id, questions, evidence: cancelled });
				}
			}
		}
	}
	return { expectedCount: levels.length * (endYear - startYear + 1) * sessions.length, missingFiles, emptyTemplates, notHeldSessions, metadataConflicts, complete };
}

function groupedByPrefix(items) {
	const groups = new Map();
	for (const item of items) {
		const [prefix, ...rest] = item.split('_');
		if (!groups.has(prefix)) groups.set(prefix, []);
		groups.get(prefix).push(rest.join('_'));
	}
	return [...groups.entries()].map(([prefix, values]) => `${prefix}: ${values.join(', ')}`);
}

function renderReport(report) {
	const lines = [];
	lines.push('# Paper Library Gap Report');
	lines.push('');
	lines.push(`Generated: ${new Date().toISOString()}`);
	lines.push('');
	lines.push('## Summary');
	lines.push('');
	lines.push(`- EJU JSON files present: ${report.eju.files.length}`);
	lines.push(`- EJU expected sessions in local coverage window: ${report.eju.expected.length}`);
	lines.push(`- EJU missing sessions: ${report.eju.missing.length}`);
	lines.push(`- JLPT calendar slots checked (includes locally marked cancellations): ${report.jlpt.expectedCount}`);
	lines.push(`- JLPT missing JSON files: ${report.jlpt.missingFiles.length}`);
	lines.push(`- JLPT empty template files: ${report.jlpt.emptyTemplates.length}`);
	lines.push(`- JLPT cancelled/not-held sessions identified from local metadata: ${report.jlpt.notHeldSessions.length}`);
	lines.push(`- JLPT contradictory cancellation metadata: ${report.jlpt.metadataConflicts.length}`);
	lines.push(`- JLPT populated files: ${report.jlpt.complete.length}`);
	lines.push('');
	lines.push('## EJU Missing Sessions');
	lines.push('');
	for (const item of report.eju.missing) {
		lines.push(`- ${item.id}`);
		if (item.sourceCandidates.length) {
			for (const source of item.sourceCandidates.slice(0, 8)) {
				lines.push(`  - source candidate: ${source}`);
			}
			if (item.sourceCandidates.length > 8) {
				lines.push(`  - ${item.sourceCandidates.length - 8} more source candidates omitted`);
			}
		} else {
			lines.push('  - source candidate: none found under downloads/EJU日本语');
		}
	}
	lines.push('');
	lines.push('## JLPT Empty Templates');
	lines.push('');
	for (const group of groupedByPrefix(report.jlpt.emptyTemplates)) {
		lines.push(`- ${group}`);
	}
	lines.push('');
	lines.push('## Locally Marked Cancelled / Not-Held Sessions');
	lines.push('');
	for (const item of report.jlpt.notHeldSessions) lines.push(`- ${item.id}: ${item.evidence}`);
	lines.push('');
	lines.push('## Contradictory Local Metadata Requiring Review');
	lines.push('');
	for (const item of report.jlpt.metadataConflicts) lines.push(`- ${item.id}: ${item.questions} questions coexist with ${item.evidence}`);
	lines.push('');
	lines.push('## JLPT Missing Files');
	lines.push('');
	if (report.jlpt.missingFiles.length === 0) {
		lines.push('- None in the 2010-2025 N1-N5 July/December coverage window.');
	} else {
		for (const group of groupedByPrefix(report.jlpt.missingFiles)) lines.push(`- ${group}`);
	}
	lines.push('');
	lines.push('## Notes');
	lines.push('');
	lines.push('- `tools/audit_exam_content.mjs` should still be used for field-level checks such as missing explanations, missing audio, missing images, and malformed timestamps.');
	lines.push('- Empty files explicitly marked cancelled/not-held by local metadata or title are separate from templates awaiting content. These markers are not independently verified against official schedules.');
	lines.push('- Missing files remain unknown coverage gaps; this report does not infer that an exam was held or that a source must exist.');
	lines.push('- EJU source candidates are heuristic matches from local downloads; importing them still requires parsing and visual/content QA.');
	lines.push('');
	return lines.join('\n');
}

const report = {
	eju: auditEju(),
	jlpt: auditJlpt()
};

if (process.argv.includes('--write')) {
	const outPath = path.join(root, 'docs', 'paper-library-gap-report.md');
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, renderReport(report), 'utf8');
	console.log(outPath);
} else {
	console.log(JSON.stringify(report, null, 2));
}
