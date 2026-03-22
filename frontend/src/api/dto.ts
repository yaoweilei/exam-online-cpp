export interface ExamSummary {
	id: string;
	title: string;
	questionCount: number;
	level: string;
	year: string;
	session: string;
	display: string;
	checked?: boolean;
}

export interface ExamDetail {
	exam_info: Record<string, unknown>;
	[key: string]: unknown;
}

export interface SubmitAnswerRequest {
	user_id: string;
	exam_id: string;
	answers: Record<string, string>;
}

export interface ScoreResult {
	exam_id: string;
	total_questions: number;
	correct_count: number;
	wrong_count: number;
	unanswered_count: number;
	score: number;
	accuracy: number;
	completion: number;
	results: Record<string, unknown>;
	timestamp: string;
}

export interface UserStatistics {
	user_id: string;
	total_exams: number;
	total_questions: number;
	correct_answers: number;
	wrong_answers: number;
	overall_accuracy: number;
	average_score: number;
	exams: Array<Record<string, unknown>>;
}

export interface WeakPoint {
	section: string;
	total_questions: number;
	wrong_count: number;
	error_rate: number;
}

export interface LearningCurvePoint {
	date: string;
	exams_count: number;
	questions_count: number;
	correct_count: number;
	average_score: number;
}

export interface RecommendationItem {
	exam_id: string;
	reason: string;
	score: number;
}
