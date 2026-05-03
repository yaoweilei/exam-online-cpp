import { ApiClient } from '../api/client.js';
import { AppStore } from '../state/store.js';

export interface ExamSummary {
	id: string;
	family?: string;
	level: string;
	year: string;
	session: string;
	display: string;
	checked?: boolean;
	access_level?: string;
	[key: string]: unknown;
}

export type ExamsByFamily = Record<string, Record<string, ExamSummary[]>>;

const DEFAULT_ENABLED_EXAM_FAMILIES = ['jlpt', 'eju'];

function getEnabledExamFamilies(): string[] {
	const raw = (window as Window & { __ENABLED_EXAM_FAMILIES__?: unknown }).__ENABLED_EXAM_FAMILIES__;
	const values = Array.isArray(raw)
		? raw
		: typeof raw === 'string'
			? raw.split(',')
			: DEFAULT_ENABLED_EXAM_FAMILIES;
	const normalized = values
		.map((value) => String(value).trim().toLowerCase())
		.filter((value) => value.length > 0);
	return normalized.length > 0 ? [...new Set(normalized)] : DEFAULT_ENABLED_EXAM_FAMILIES;
}

function isEnabledExamFamily(family: string): boolean {
	return getEnabledExamFamilies().includes(family.toLowerCase());
}

function getDefaultFamily(grouped: ExamsByFamily): string {
	const enabledFamilies = getEnabledExamFamilies();
	const preferred = enabledFamilies.find((family) => grouped[family]);
	if (preferred) {
		return preferred;
	}
	if (grouped.jlpt && isEnabledExamFamily('jlpt')) {
		return 'jlpt';
	}
	return Object.keys(grouped)[0] ?? 'jlpt';
}

export async function loadExams(api: ApiClient, store: AppStore): Promise<ExamsByFamily> {
	const exams = await api.request<ExamSummary[]>('/exams?sort=date_desc');
	const grouped: ExamsByFamily = {};

	for (const exam of exams) {
		const family = String(exam.family || 'jlpt').toLowerCase();
		if (!isEnabledExamFamily(family)) {
			continue;
		}
		const level = String(exam.level || '');
		if (!grouped[family]) grouped[family] = {};
		if (!grouped[family][level]) grouped[family][level] = [];
		grouped[family][level].push(exam);
	}

	const defaultFamily = getDefaultFamily(grouped);
	store.setState({
		examsByFamily: grouped as Record<string, Record<string, unknown[]>>,
		examsByLevel: (grouped[defaultFamily] ?? {}) as Record<string, unknown[]>,
		currentFamily: defaultFamily
	});
	(window as Window & { __EXAMS_BY_LEVEL__?: unknown; __EXAMS_BY_FAMILY__?: unknown }).__EXAMS_BY_LEVEL__ =
		grouped[defaultFamily] ?? {};
	(window as Window & { __EXAMS_BY_FAMILY__?: unknown }).__EXAMS_BY_FAMILY__ = grouped;
	return grouped;
}
