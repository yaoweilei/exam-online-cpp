#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const strictTimestamps = process.argv.includes('--strict-timestamps');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkJsonFiles(dir) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const name of fs.readdirSync(dir)) {
		const full = path.join(dir, name);
		const stat = fs.statSync(full);
		if (stat.isDirectory()) {
			out.push(...walkJsonFiles(full));
		} else if (name.endsWith('.json') && !name.startsWith('.')) {
			out.push(full);
		}
	}
	return out.sort((a, b) => a.localeCompare(b));
}

function assetExists(url) {
	if (!url || /^https?:\/\//i.test(url) || /^data:/i.test(url)) return true;
	const normalized = String(url).replace(/^\/+/, '').replace(/\//g, path.sep);
	const candidates = [
		path.join(root, normalized),
		path.join(root, 'static', normalized),
		path.join(root, 'frontend', normalized),
		path.join(root, 'data', normalized.replace(/^data[\\/]/, ''))
	];
	return candidates.some((candidate) => fs.existsSync(candidate));
}

function collectQuestions(section) {
	const out = [];
	if (Array.isArray(section?.questions)) {
		for (const question of section.questions) out.push({ question, passageBlock: null });
	}
	if (Array.isArray(section?.passages)) {
		for (const passageBlock of section.passages) {
			if (Array.isArray(passageBlock?.questions)) {
				for (const question of passageBlock.questions) out.push({ question, passageBlock });
			}
		}
	}
	return out;
}

function skillTags(section, question) {
	return [
		...(Array.isArray(section?.skill_tags) ? section.skill_tags : []),
		...(Array.isArray(question?.skill_tags) ? question.skill_tags : []),
		String(section?.section_type || ''),
		String(section?.section_title || '')
	].map(String);
}

function isListening(section, question) {
	return skillTags(section, question).some((tag) => /listening|聴解|読聴解|听力|读听|eju\.listening/i.test(tag));
}

function isWriting(section, question) {
	return skillTags(section, question).some((tag) => /writing|記述|写作|eju\.writing/i.test(tag));
}

function isAnswerable(question) {
	if (question?.has_ans === false) return false;
	return question?.answer != null || question?.correct_answer != null;
}

function addImageUrls(question, passageBlock, section, urls) {
	for (const value of [question?.passage, question?._groupPassage, passageBlock?.passage, section?.passage]) {
		if (value?.type === 'image' && value.url) urls.push(value.url);
	}
	if (question?.image) urls.push(question.image);
	if (question?.script_layout_image) urls.push(question.script_layout_image);
}

function validTime(value) {
	if (!value) return true;
	return /^\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?$/.test(String(value));
}

const report = {
	ejuFiles: 0,
	jlptFiles: 0,
	ejuQuestions: 0,
	jlptQuestions: 0,
	ejuListeningQuestions: 0,
	ejuListeningWithAudio: 0,
	ejuListeningWithScript: 0,
	ejuListeningWithTimedScript: 0,
	ejuImageRefs: 0,
	issues: [],
	warnings: []
};

function issue(code, message) {
	report.issues.push({ code, message });
}

function warning(code, message) {
	report.warnings.push({ code, message });
}

function countByCode(items) {
	return items.reduce((counts, item) => {
		counts[item.code] = (counts[item.code] || 0) + 1;
		return counts;
	}, {});
}

function auditEju() {
	const dir = path.join(root, 'data', 'paper', 'eju');
	for (const filePath of walkJsonFiles(dir)) {
		const examId = path.basename(filePath, '.json');
		if (examId.startsWith('eju_')) continue;
		report.ejuFiles += 1;
		let doc;
		try {
			doc = readJson(filePath);
		} catch (error) {
			issue('EJU_JSON_PARSE', `${examId}: ${error.message}`);
			continue;
		}

		const sections = doc?.exam_info?.sections;
		if (!Array.isArray(sections) || sections.length === 0) {
			issue('EJU_NO_SECTIONS', `${examId}: missing exam_info.sections`);
			continue;
		}

		for (const section of sections) {
			for (const { question, passageBlock } of collectQuestions(section)) {
				report.ejuQuestions += 1;
				const qid = question?.id ?? question?.eju_question_no ?? '?';
				const label = `${examId}:${section.section_type || section.section_id || 'section'}:q${qid}`;

				if (isAnswerable(question) && !isWriting(section, question)) {
					if (!String(question?.explanation || '').trim()) {
						issue('EJU_MISSING_EXPLANATION', `${label}: missing explanation`);
					}
					if (!String(question?.explanation_expand || '').trim()) {
						issue('EJU_MISSING_EXPLANATION_EXPAND', `${label}: missing explanation_expand`);
					}
				}

				if (Array.isArray(question?.options) && question.options.some((option) => !String(option || '').trim())) {
					issue('EJU_BLANK_OPTION', `${label}: blank option`);
				}

				const imageUrls = [];
				addImageUrls(question, passageBlock, section, imageUrls);
				for (const url of imageUrls) {
					report.ejuImageRefs += 1;
					if (!assetExists(url)) {
						issue('EJU_MISSING_IMAGE', `${label}: ${url}`);
					}
				}

				if (!isListening(section, question)) continue;
				report.ejuListeningQuestions += 1;
				const audio = question?.audio || passageBlock?.audio || section?.audio;
				const script = question?.script || passageBlock?.script || section?.script;

				if (!audio) {
					issue('EJU_LISTENING_NO_AUDIO', `${label}: missing audio`);
				} else {
					report.ejuListeningWithAudio += 1;
					if (!assetExists(audio)) {
						issue('EJU_MISSING_AUDIO_FILE', `${label}: ${audio}`);
					}
				}

				if (!Array.isArray(script) || script.length === 0) {
					issue('EJU_LISTENING_NO_SCRIPT', `${label}: missing script`);
					continue;
				}
				report.ejuListeningWithScript += 1;

				let hasTimedLine = false;
				script.forEach((line, index) => {
					if (!String(line?.text || '').trim()) {
						issue('EJU_SCRIPT_BLANK_TEXT', `${label}: line ${index + 1}`);
					}
					if (line?.start || line?.end) hasTimedLine = true;
					if (!validTime(line?.start) || !validTime(line?.end)) {
						issue('EJU_SCRIPT_BAD_TIME', `${label}: line ${index + 1}`);
					}
				});

				if (hasTimedLine) {
					report.ejuListeningWithTimedScript += 1;
				} else {
					const message = `${label}: script has no timestamps`;
					if (strictTimestamps) issue('EJU_SCRIPT_NO_TIMESTAMPS', message);
					else warning('EJU_SCRIPT_NO_TIMESTAMPS', message);
				}
			}
		}
	}
}

function auditJlpt() {
	const dir = path.join(root, 'data', 'paper', 'jlpt');
	for (const filePath of walkJsonFiles(dir)) {
		report.jlptFiles += 1;
		const examId = path.relative(path.join(root, 'data', 'paper', 'jlpt'), filePath);
		let doc;
		try {
			doc = readJson(filePath);
		} catch (error) {
			issue('JLPT_JSON_PARSE', `${examId}: ${error.message}`);
			continue;
		}
		const sections = doc?.exam_info?.sections;
		if (!Array.isArray(sections)) {
			issue('JLPT_NO_SECTIONS', `${examId}: missing exam_info.sections`);
			continue;
		}
		if (sections.length === 0) {
			warning('JLPT_EMPTY_SECTIONS', `${examId}: empty template or unavailable exam`);
			continue;
		}
		for (const section of sections) {
			for (const { question } of collectQuestions(section)) {
				report.jlptQuestions += 1;
				const qid = question?.id ?? '?';
				const label = `${examId}:${section.section_type || section.section_id || 'section'}:q${qid}`;
				if (isAnswerable(question)) {
					if (!String(question?.explanation || '').trim()) {
						issue('JLPT_MISSING_EXPLANATION', `${label}: missing explanation`);
					}
					if (!String(question?.explanation_expand || '').trim()) {
						issue('JLPT_MISSING_EXPLANATION_EXPAND', `${label}: missing explanation_expand`);
					}
				}
			}
		}
	}
}

function auditDuplicateAssetDirs() {
	for (const kind of ['audio', 'image']) {
		const dir = path.join(root, 'data', kind, 'eju');
		if (!fs.existsSync(dir)) continue;
		const names = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory());
		for (const name of names) {
			const normalized = name.replace(/_(\d)$/, '_0$1');
			if (normalized !== name && names.includes(normalized)) {
				warning('EJU_DUPLICATE_ASSET_DIR', `data/${kind}/eju has both ${name} and ${normalized}`);
			}
		}
	}
}

auditEju();
auditJlpt();
auditDuplicateAssetDirs();

const summary = {
	ejuFiles: report.ejuFiles,
	ejuQuestions: report.ejuQuestions,
	ejuListeningQuestions: report.ejuListeningQuestions,
	ejuListeningWithAudio: report.ejuListeningWithAudio,
	ejuListeningWithScript: report.ejuListeningWithScript,
	ejuListeningWithTimedScript: report.ejuListeningWithTimedScript,
	ejuImageRefs: report.ejuImageRefs,
	jlptFiles: report.jlptFiles,
	jlptQuestions: report.jlptQuestions,
	issues: report.issues.length,
	warnings: report.warnings.length,
	issuesByCode: countByCode(report.issues),
	warningsByCode: countByCode(report.warnings),
	strictTimestamps
};

console.log('Exam content audit summary');
console.log(JSON.stringify(summary, null, 2));

if (report.warnings.length) {
	console.log('\nWarnings');
	for (const item of report.warnings.slice(0, 80)) {
		console.log(`- [${item.code}] ${item.message}`);
	}
	if (report.warnings.length > 80) {
		console.log(`... ${report.warnings.length - 80} more warnings`);
	}
}

if (report.issues.length) {
	console.error('\nIssues');
	for (const item of report.issues.slice(0, 120)) {
		console.error(`- [${item.code}] ${item.message}`);
	}
	if (report.issues.length > 120) {
		console.error(`... ${report.issues.length - 120} more issues`);
	}
	process.exitCode = 1;
}
