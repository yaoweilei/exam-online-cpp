import { ApiClient } from '../api/client.js';
import { AppStore } from '../state/store.js';

export interface ExamSummary {
	id: string;
	level: string;
	year: string;
	session: string;
	display: string;
	checked?: boolean;
	[key: string]: unknown;
}

export async function loadExams(api: ApiClient, store: AppStore): Promise<Record<string, ExamSummary[]>> {
	const exams = await api.request<ExamSummary[]>('/exams?sort=date_desc');
	const grouped: Record<string, ExamSummary[]> = {};

	for (const exam of exams) {
		if (!grouped[exam.level]) grouped[exam.level] = [];
		grouped[exam.level].push(exam);
	}

	store.setState({ examsByLevel: grouped as Record<string, unknown[]> });
	(window as Window & { __EXAMS_BY_LEVEL__?: unknown }).__EXAMS_BY_LEVEL__ = grouped;
	return grouped;
}
