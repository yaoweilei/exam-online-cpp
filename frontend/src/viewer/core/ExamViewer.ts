/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

/**
 * ================================================================================================
 * ExamViewer 主控制类
 * ================================================================================================
 *
 * 负责管理整个试卷查看器的状态和交互逻辑
 * 采用模块化架构，将功能委托给专门的管理器
 */

import { createUuid } from '../../uuid.js';
import { requestAppConfirmation, showAppToast } from '../../ui/dialogs.js';
import { guestTrialStatus, practiceTrialKind } from '../../features/guestTrialRecords.js';
import { QuestionRenderer } from '../renderers/QuestionRenderer.js';

type LegacyAnyRecord = Record<string, any>;
type ExamMode = 'practice' | 'mock';
interface PracticeQuestionRef { examId: string; questionId: string; sectionIndex?: number; }
interface PracticeOutcome { exam_id: string; question_id: string; section_index?: number; answer: unknown; viewed: boolean; status: string; }

interface NavigationButtonConfig {
	className: string;
	text: string;
	disabled?: boolean;
	onClick: () => void;
}

interface CategoryItem {
	id: string;
	label: string;
	sectionIndexes: number[];
}

interface ExamViewerQuestion extends LegacyAnyRecord {
	id: string | number;
	audio?: string;
	script?: LegacyAnyRecord[];
	_groupPassage?: LegacyAnyRecord;
	_groupPassageKey?: string;
	_groupIndex?: string | number;
	_groupTopic?: string;
}

interface ExamViewerPassageGroup extends LegacyAnyRecord {
	id?: string | number;
	topic?: string;
	passage?: LegacyAnyRecord;
	audio?: string;
	script?: LegacyAnyRecord[];
	questions?: ExamViewerQuestion[];
}

interface ExamViewerSection extends LegacyAnyRecord {
	section_id?: string | number;
	section_type?: string;
	section_title?: string;
	questions?: ExamViewerQuestion[];
	passages?: ExamViewerPassageGroup[];
}

interface ExamViewerExamData extends LegacyAnyRecord {
	exam_info: {
		sections: ExamViewerSection[];
		[key: string]: any;
	};
}

interface WrongCorrectionContext {
	userId: string;
	examId: string;
	questionId: string;
	actualQuestionId: string;
	sectionIndex: number;
	questionIndex: number;
	examTarget: string;
	position: number;
	total: number;
	hasNext: boolean;
}

interface WrongCorrectionResult {
	correct: boolean;
	correct_answer?: unknown;
	correct_streak?: number;
	mastered?: boolean;
	completed_today?: boolean;
}
class ExamViewer {
	[key: string]: any;
	private readonly logger: {
		info: (...args: unknown[]) => void;
		debug: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};

	currentExam: ExamViewerExamData | null = null;
	currentSectionIndex = 0;
	currentQuestionIndex = 0;
	currentCategory: string | null = null;
	userAnswers: Record<string, unknown> = {};
	practiceScope: { label: string; sectionIndexes: number[] } | null = null;
	practiceRangeLocked = false;
	specialtyPractice: { label: string; questions: PracticeQuestionRef[]; index: number } | null = null;
	private specialtyLoading = false;
	private specialtyOutcomes = new Map<string, PracticeOutcome>();
	private specialtyReview = false;
	private specialtySubmission = '';
	private specialtySaving = false;
	private specialtySavedSignature = '';
	private specialtyRevealed = new Set<string>();
	private specialtyEntryMode = 'practice';
	private specialtyReturnContext: LegacyAnyRecord | null = null;
	private specialtyResultDestination: 'catalog' | 'home' = 'catalog';
	private specialtyReturnNotice: { text: string; chapterId: string } | null = null;
	private specialtyPreviousFeedback: { index: number; status: string } | null = null;
	private specialtyFeedbackTimer: number | null = null;
	private specialtyQuestionKey(ref: PracticeQuestionRef): string {
		return `${ref.examId}:${ref.sectionIndex !== undefined ? `${ref.sectionIndex}:` : ''}${ref.questionId}`;
	}
	private specialtyStoredAnswer(answers: Record<string, unknown>, ref: PracticeQuestionRef): unknown {
		if (ref.sectionIndex !== undefined) return answers[`${ref.sectionIndex}:${ref.questionId}`] ?? answers[ref.questionId];
		return Object.entries(answers).find(([key]) => key === ref.questionId || key.endsWith(`:${ref.questionId}`))?.[1];
	}
	getLearningSessionKind(): 'diagnostic' | 'system' | 'free' {
		if (this.wrongCorrectionContext) return 'system';
		if (this.specialtyPractice) return this.specialtyEntryMode === 'system' ? 'system' : 'free';
		return this.currentExam?.exam_info?.paper_type === 'diagnostic' || this.currentExam?.paper_type === 'diagnostic' ? 'diagnostic' : 'free';
	}
	getSpecialtySessionInfo() {
		const session = this.specialtyPractice;
		if (!session || !['unanswered', 'wrong', 'correct', 'whole-paper', 'system', 'assignment'].includes(this.specialtyEntryMode)) return null;
		const items = this.getSpecialtyQuestionMapItems() || [];
		const viewed = items.filter(item => item.status === 'viewed').length;
		const answered = items.filter(item => !['unanswered', 'viewed'].includes(item.status)).length;
		const mode = this.specialtyEntryMode === 'assignment' ? (this.specialtyReview ? '作业回顾' : '作业作答') : this.specialtyEntryMode === 'system' ? '系统学习' : this.specialtyEntryMode === 'whole-paper' ? (this.specialtyReview ? '整套回顾' : '整套练习') : this.specialtyEntryMode === 'correct' ? '答对题回顾' : this.specialtyEntryMode === 'wrong' ? '错题重练' : '未做题练习';
		const level = session.questions[0]?.examId.match(/N[1-3]/)?.[0] || '';
		const target = this.isEjuExam() ? 'EJU' : `JLPT${level ? ` ${level}` : ''}`;
		return { mode, label: session.label, target, total: items.length, readOnly: this.specialtyReview, returnLabel: this.specialtyReturnContext?.surface === 'assignment' ? '← 返回我的作业' : this.specialtyReturnContext?.surface === 'system' ? '← 返回系统学习' : this.specialtyReturnContext?.surface === 'paper' ? '← 返回真题模式' : '← 返回专项',
			progress: this.specialtyReview ? `共 ${items.length} 题 · 仅回顾，不更新练习统计` : `本次共 ${items.length} 题 · 已答 ${answered} 题${viewed ? ` · 仅查看 ${viewed} 题` : ''}` };
	}
	returnFromSpecialtyPractice(): void {
		if (this.specialtyEntryMode === 'assignment') { this.persistSpecialtyDraft(); this.returnToSpecialtyCatalog(); return; }
		if (this.specialtyPractice && this.specialtyEntryMode === 'whole-paper' && !this.specialtyReview) {
			this.persistSpecialtyDraft();
			this.returnToSpecialtyCatalog();
			return;
		}
		void this.finishSpecialtyPractice();
	}
	requestSpecialtyHomeReturn(): boolean {
		if (!this.specialtyPractice || this.specialtyReview || !this.getSpecialtyProgress()) return false;
		if (this.specialtyEntryMode === 'system' && !this.getSpecialtyProgress()?.answered) return false;
		if (this.specialtyEntryMode === 'whole-paper' || this.specialtyEntryMode === 'assignment') {
			this.persistSpecialtyDraft();
			this.audioManager.stopAllAudio();
			return false;
		}
		void this.finishSpecialtyPractice('home');
		return true;
	}
	private specialtyDraftKey(): string { return `examViewer.specialtyDraft.v1:${this.userId || 'guest'}`; }
	private specialtyDraftsKey(): string { return `examViewer.specialtyDrafts.v2:${this.userId || 'guest'}`; }
	private specialtyCloudPending = new Map<string, LegacyAnyRecord>();
	private specialtyCloudRevisions = new Map<string, number>();
	private specialtyCloudTimer: number | null = null;
	private specialtyCloudSaving: Promise<void> | null = null;
	private specialtyCloudConflicts = new Map<string, LegacyAnyRecord>();
	private specialtyCloudClientId = createUuid();
	async syncPracticeDrafts(): Promise<void> {
		const userId = this.userId;
		if (!userId || userId === 'guest' || !window.APIClient?.listPracticeDrafts) return;
		await this.flushPracticeDrafts();
		try {
			const response = await window.APIClient.listPracticeDrafts(userId) as LegacyAnyRecord;
			if (this.userId !== userId) return;
			const rows = Array.isArray(response?.items) ? response.items : [];
			const drafts = new Map(this.readSpecialtyDrafts().filter(d => !d.cloudRevision || d.dirty || rows.some((row: LegacyAnyRecord) => row.exam_id === d.submission)).map(d => [d.submission, d]));
			for (const row of rows) {
				const remote = row.session_draft;
				if (!this.validSpecialtyDraft(remote)) continue;
				const local = drafts.get(remote.submission);
				const content = (draft: LegacyAnyRecord) => JSON.stringify([draft.session, draft.answers, draft.outcomes, draft.revealed]);
				const ownUpdate = local?.clientId && local.clientId === remote.clientId;
				if (local?.dirty && ownUpdate && Number(row.revision) > Number(local.cloudRevision || 0)) {
					drafts.set(remote.submission, { ...local, cloudRevision: row.revision });
					this.specialtyCloudRevisions.set(remote.submission, Number(row.revision));
				} else if (local?.dirty && Number(row.revision) > Number(local.cloudRevision || 0) && content(local) !== content(remote)) this.specialtyCloudConflicts.set(remote.submission, { ...remote, cloudRevision: row.revision, dirty: false });
				if (!local || (!local.dirty || content(local) === content(remote)) && Number(row.revision) >= Number(local.cloudRevision || 0)) {
					drafts.set(remote.submission, { ...remote, cloudRevision: row.revision, dirty: false });
					this.specialtyCloudRevisions.set(remote.submission, Number(row.revision));
					this.specialtyCloudConflicts.delete(remote.submission);
				}
			}
			this.writeSpecialtyDrafts([...drafts.values()]);
			for (const draft of drafts.values()) if ((!draft.cloudRevision || draft.dirty) && !rows.some((row: LegacyAnyRecord) => row.exam_id === draft.submission && Number(row.revision) > Number(draft.cloudRevision || 0))) {
				this.specialtyCloudPending.set(draft.submission, { ...draft, ownerId: userId });
			}
			await this.flushPracticeDrafts();
		} catch (error) { console.warn('[practice] 云端进度暂不可用，保留本机进度', error); }
	}
	async flushPracticeDrafts(): Promise<void> {
		if (this.specialtyCloudTimer !== null) { clearTimeout(this.specialtyCloudTimer); this.specialtyCloudTimer = null; }
		if (this.specialtyCloudSaving) { await this.specialtyCloudSaving; if (this.specialtyCloudPending.size) return this.flushPracticeDrafts(); return; }
		const api = window.APIClient;
		if (!api?.savePracticeDraft) return;
		const userId = this.userId;
		this.specialtyCloudSaving = (async () => {
			const conflictRetries = new Set<string>();
			while (this.specialtyCloudPending.size && this.userId === userId) {
				const [id, draft] = this.specialtyCloudPending.entries().next().value!;
				this.specialtyCloudPending.delete(id);
				if (draft.ownerId && draft.ownerId !== userId) continue;
				try {
					const saved = await api.savePracticeDraft!(userId, { session_draft: draft, base_revision: this.specialtyCloudRevisions.get(id) ?? Number(draft.cloudRevision || 0) }) as LegacyAnyRecord;
					if (this.userId !== userId) return;
					this.specialtyCloudRevisions.set(id, Number(saved.revision));
					this.writeSpecialtyDrafts(this.readSpecialtyDrafts().map(local => local.submission === id ? { ...local, cloudRevision: saved.revision, dirty: local.updatedAt !== draft.updatedAt } : local));
					if (this.specialtySubmission === id) this.setAnswerSaveStatus('saved', '进度已同步云端');
				} catch (error) {
					if (this.userId !== userId) return;
					const code = (error as { payload?: { code?: string } })?.payload?.code;
					if (code === 'DRAFT_CONFLICT' && api.listPracticeDrafts && !conflictRetries.has(id)) {
						conflictRetries.add(id);
						try {
							const latest = await api.listPracticeDrafts(userId) as LegacyAnyRecord;
							const remote = latest.items?.find((row: LegacyAnyRecord) => row.exam_id === id);
							if (remote?.session_draft?.clientId && remote.session_draft.clientId === draft.clientId && this.userId === userId) {
								this.specialtyCloudRevisions.set(id, Number(remote.revision));
								if (!this.specialtyCloudPending.has(id)) this.specialtyCloudPending.set(id, draft);
								continue;
							}
						} catch { /* Keep the local draft until an explicit retry. */ }
					}
					if (code === 'ATTEMPT_SUBMITTED') {
						this.specialtyCloudPending.delete(id);
						this.writeSpecialtyDrafts(this.readSpecialtyDrafts().filter(d => d.submission !== id));
						if (this.specialtySubmission === id) this.specialtyReview = true;
					}
					if (this.specialtySubmission === id) this.setAnswerSaveStatus('failed', code === 'DRAFT_CONFLICT' ? '进度已在其他页面更新，请重新进入练习同步' : code === 'ATTEMPT_SUBMITTED' ? '本次练习已在其他页面结束' : '已暂存本机，云端同步失败');
				}
			}
		})();
		try { await this.specialtyCloudSaving; } finally { this.specialtyCloudSaving = null; }
	}
	private validSpecialtyDraft(draft: LegacyAnyRecord | null): boolean {
		const session = draft?.session;
		if (!session || typeof session.label !== 'string' || !Array.isArray(session.questions) || !session.questions.length
			|| !session.questions.every((q: LegacyAnyRecord) => q && typeof q.examId === 'string' && typeof q.questionId === 'string')
			|| !Number.isInteger(session.index) || session.index < 0 || session.index >= session.questions.length
			|| typeof draft.submission !== 'string' || !Array.isArray(draft.outcomes) || !draft.outcomes.every((e: unknown[]) => Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object')
			|| !Array.isArray(draft.answers) || !draft.answers.every((e: LegacyAnyRecord[]) => Array.isArray(e) && typeof e[0] === 'string' && e[1]?.answers && typeof e[1].answers === 'object' && Array.isArray(e[1].checked))
			|| !Array.isArray(draft.revealed) || !draft.revealed.every((key: unknown) => typeof key === 'string')) return false;
		return true;
	}
	private readSpecialtyDrafts(): LegacyAnyRecord[] {
		if (!this.userId || this.userId === 'guest') return [];
		const read = (key: string) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
		const stored = read(this.specialtyDraftsKey());
		const drafts: LegacyAnyRecord[] = Array.isArray(stored) ? stored.filter(draft => this.validSpecialtyDraft(draft)) : [];
		// Keep the previous single draft readable while migrating existing browsers.
		const legacy = read(this.specialtyDraftKey());
		if (this.validSpecialtyDraft(legacy) && !drafts.some(draft => draft.submission === legacy.submission)) drafts.push(legacy);
		return drafts.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
	}
	private writeSpecialtyDrafts(drafts: LegacyAnyRecord[]): void {
		localStorage.setItem(this.specialtyDraftsKey(), JSON.stringify(drafts));
		if (drafts.length) localStorage.setItem(this.specialtyDraftKey(), JSON.stringify(drafts[0]));
		else localStorage.removeItem(this.specialtyDraftKey());
	}
	private readSpecialtyDraft(id?: string): LegacyAnyRecord | null {
		const drafts = this.readSpecialtyDrafts();
		return (id ? drafts.find(draft => draft.submission === id) : drafts.find(draft => draft.mode !== 'assignment')) || null;
	}
	persistSpecialtyDraft(): void {
		if (!this.specialtyPractice || this.specialtyReview || !this.userId || this.userId === 'guest') return;
		if (!this.getSpecialtyProgress()) return;
		if (this.specialtyEntryMode === 'system' && !this.getSpecialtyProgress()?.answered) return;
		const answers = new Map(this.specialtyAnswers);
		if (this._currentExamId) answers.set(this._currentExamId, { answers: { ...this.userAnswers }, checked: new Set(this.checkedPracticeQuestions) });
		try {
			const previous = this.readSpecialtyDraft(this.specialtySubmission);
			const draft = { ownerId: this.userId, clientId: this.specialtyCloudClientId, session: this.specialtyPractice, mode: this.specialtyEntryMode, returnContext: this.specialtyReturnContext, updatedAt: Math.max(Date.now(), Number(previous?.updatedAt || 0) + 1), cloudRevision: previous?.cloudRevision || 0, dirty: true,
				submission: this.specialtySubmission, outcomes: [...this.specialtyOutcomes], answers: [...answers].map(([id, value]) => [id, { answers: value.answers, checked: [...value.checked] }]), revealed: [...this.specialtyRevealed] };
			this.writeSpecialtyDrafts([draft, ...this.readSpecialtyDrafts().filter(stored => stored.submission !== draft.submission)]);
			this.specialtyCloudPending.set(draft.submission, structuredClone(draft));
			if (window.APIClient?.savePracticeDraft) {
				this.setAnswerSaveStatus('saving', '已暂存本机，正在同步云端…');
				if (this.specialtyCloudTimer !== null) clearTimeout(this.specialtyCloudTimer);
				this.specialtyCloudTimer = window.setTimeout(() => { this.specialtyCloudTimer = null; void this.flushPracticeDrafts(); }, 150);
			}
		} catch { this.setAnswerSaveStatus('failed', '无法暂存进度，请结束练习保存结果'); }
	}
	private async clearSpecialtyDraft(): Promise<void> {
		const id = this.specialtySubmission, userId = this.userId;
		await this.flushPracticeDrafts();
		try { this.writeSpecialtyDrafts(this.readSpecialtyDrafts().filter(draft => draft.submission !== this.specialtySubmission)); }
		catch { /* Storage can be unavailable. */ }
		try { await window.APIClient?.clearPracticeDraft?.(userId, id); } catch { /* The result endpoint also closes the cloud session. */ }
	}
	async resumeSpecialtyPractice(id?: string, isCurrent?: () => boolean): Promise<void> {
		await this.answerManager.flushCurrentDraft();
		await this.syncPracticeDrafts();
		if (isCurrent && !isCurrent()) return;
		let draft = this.readSpecialtyDraft(id);
		if (!draft) throw new Error('暂无可继续的专项练习');
		const remote = this.specialtyCloudConflicts.get(draft.submission);
		if (remote) {
			const useCloud = await requestAppConfirmation('这次练习已在其他页面更新。使用云端进度继续？取消会把本机进度另存为一份练习。', '使用云端进度');
			const localCopy = { ...draft, submission: createUuid(), session: { ...draft.session, label: `${draft.session.label}（本机副本）` }, cloudRevision: 0, dirty: true, updatedAt: Date.now(), ownerId: this.userId };
			this.writeSpecialtyDrafts([remote, localCopy, ...this.readSpecialtyDrafts().filter(d => d.submission !== draft!.submission)]);
			this.specialtyCloudRevisions.set(remote.submission, Number(remote.cloudRevision));
			this.specialtyCloudConflicts.delete(remote.submission);
			draft = useCloud ? remote : localCopy;
		}
		this.specialtyPractice = null;
		this.specialtyReview = false;
		this.specialtyEntryMode = draft.mode || 'practice';
		this.specialtyReturnContext = draft.returnContext || null;
		this.specialtySubmission = draft.submission;
		this.specialtySavedSignature = '';
		this.specialtyResultDestination = 'catalog';
		this.specialtyPreviousFeedback = null;
		this.specialtyOutcomes = new Map(draft.outcomes);
		this.specialtyRevealed = new Set(draft.revealed);
		this.specialtyAnswers = new Map(draft.answers.map(([id, value]: [string, LegacyAnyRecord]) => [id, { answers: value.answers, checked: new Set(value.checked || []) }]));
		if (draft.mode === 'assignment') this.specialtyRevealed.clear();
		await this.openSpecialtyPosition(draft.session, undefined, isCurrent);
	}
	getSpecialtyDraftProgresses(): { id: string; label: string; answered: number; total: number; examIds: string[]; updatedAt: number; mode: string; questionKeys: string[] }[] {
		return this.readSpecialtyDrafts().filter(draft => draft.mode !== 'assignment').map(draft => {
			const keys = new Set(draft.outcomes.map(([key]: [string]) => key));
			for (const [examId, value] of draft.answers) for (const ref of draft.session.questions) {
				const answer = this.specialtyStoredAnswer(value.answers, ref);
				if (ref.examId === examId && (Array.isArray(answer) ? answer.length > 0 : answer !== null && answer !== undefined && answer !== '')) keys.add(this.specialtyQuestionKey(ref));
			}
			return { id: draft.submission, label: draft.session.label, answered: keys.size, total: draft.session.questions.length,
				examIds: [...new Set<string>(draft.session.questions.map((q: PracticeQuestionRef) => q.examId))], updatedAt: Number(draft.updatedAt || 0), mode: draft.mode || 'practice', questionKeys: draft.session.questions.map((q: PracticeQuestionRef) => this.specialtyQuestionKey(q)) };
		});
	}
	getSpecialtyProgress(): { label: string; answered: number; total: number; examIds: string[] } | null {
		if (!this.specialtyPractice || this.specialtyReview) {
			const draft = this.readSpecialtyDraft();
			if (!draft) return null;
			const keys = new Set(draft.outcomes.map(([key]: [string]) => key));
			for (const [examId, value] of draft.answers) for (const ref of draft.session.questions) {
				const answer = this.specialtyStoredAnswer(value.answers || {}, ref);
				if (ref.examId === examId && (Array.isArray(answer) ? answer.length > 0 : answer !== null && answer !== undefined && answer !== '')) keys.add(this.specialtyQuestionKey(ref));
			}
			return { label: draft.session.label, answered: keys.size, total: draft.session.questions.length, examIds: [...new Set<string>(draft.session.questions.map((q: { examId: string }) => q.examId))] };
		}
		const ref = this.specialtyPractice.questions[this.specialtyPractice.index];
		const answer = this.answerManager.getAnswerComposite(this.currentSectionIndex, ref.questionId);
		const pending = !this.specialtyOutcomes.has(this.specialtyQuestionKey(ref)) && (Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '');
		if (!pending && this.specialtySavedSignature === JSON.stringify([...this.specialtyOutcomes.values()])) return null;
		return { label: this.specialtyPractice.label, answered: this.specialtyOutcomes.size + Number(pending), total: this.specialtyPractice.questions.length, examIds: [...new Set(this.specialtyPractice.questions.map(question => question.examId))] };
	}
	private specialtyAnswers = new Map<string, { answers: Record<string, unknown>; checked: Set<string> }>();
	async startAssignment(assignmentId: string, isCurrent: () => boolean): Promise<void> {
		const assignment = await window.APIClient!.getAssignment(assignmentId) as LegacyAnyRecord;
		if (!isCurrent()) return;
		const data = await window.APIClient!.getExam(assignment.exam_id) as ExamViewerExamData;
		if (!isCurrent()) return;
		const keys = new Set<string>(assignment.question_ids || []);
		const refs = data.exam_info.sections.flatMap((section, sectionIndex) =>
			(section.questions?.length ? section.questions : (section.passages || []).flatMap(p => p.questions || []))
				.filter(q => keys.has(`${sectionIndex}:${q.id}`)).map(q => ({ examId: String(assignment.exam_id), questionId: String(q.id), sectionIndex })));
		if (!refs.length) throw new Error('作业题目范围已失效，请联系老师重新布置');
		const own = assignment.own_submission || {}, attemptNo = Number(own.attempt_no || 0);
		const review = !!own.submitted_at && (own.review_status || own.status) !== 'returned';
		if (!review) {
			await this.syncPracticeDrafts();
			if (!isCurrent()) return;
			const draft = this.readSpecialtyDrafts().find(d => d.mode === 'assignment' && d.returnContext?.assignmentId === assignmentId
				&& Number(d.returnContext?.attemptNo || 0) === attemptNo && JSON.stringify(d.session.questions) === JSON.stringify(refs));
			if (draft) { await this.resumeSpecialtyPractice(draft.submission, isCurrent); return; }
		}
		await this.startSpecialtyPractice(assignment.title || '我的作业', refs, review, { mode: 'assignment', examData: data, isCurrent,
			returnContext: { surface: 'assignment', assignmentId, attemptNo, teacherComment: own.teacher_comment || '', manualScore: own.manual_score } });
		if (!isCurrent() || !review) return;
		this.specialtyAnswers.set(assignment.exam_id, { answers: { ...own.answers }, checked: new Set() });
		this.userAnswers = { ...own.answers };
		for (const ref of refs) {
			const result = own.score?.results?.[`${ref.sectionIndex}:${ref.questionId}`];
			this.specialtyOutcomes.set(this.specialtyQuestionKey(ref), { exam_id: ref.examId, question_id: ref.questionId, section_index: ref.sectionIndex,
				answer: own.answers?.[`${ref.sectionIndex}:${ref.questionId}`], status: result?.status || 'ungraded', viewed: false });
		}
		await this.openSpecialtyPosition(this.specialtyPractice!, undefined, isCurrent);
	}
	private async finishAssignment(): Promise<void> {
		const session = this.specialtyPractice;
		if (!session || this.specialtySaving) return;
		if (this.specialtyReview) { this.returnToSpecialtyCatalog(); return; }
		this.commitSpecialtyAnswer();
		const answers: Record<string, unknown> = {};
		for (const ref of session.questions) {
			const source = ref.examId === this._currentExamId ? this.userAnswers : this.specialtyAnswers.get(ref.examId)?.answers || {};
			const answer = source[`${ref.sectionIndex}:${ref.questionId}`];
			if (Array.isArray(answer) ? answer.length : answer !== null && answer !== undefined && answer !== '') answers[`${ref.sectionIndex}:${ref.questionId}`] = answer;
		}
		this.specialtySaving = true;
		const missing = session.questions.length - Object.keys(answers).length;
		try {
			if (!await requestAppConfirmation(missing ? `还有 ${missing} 题未作答。确认提交作业？提交后老师退回前不能修改。` : '确认提交作业？提交后老师退回前不能修改。', '提交作业')) return;
			this.persistSpecialtyDraft();
			this.setAnswerSaveStatus('saving', '正在提交作业…');
			const response = await window.APIClient!.submitAssignment(String(this.specialtyReturnContext?.assignmentId), answers, this.specialtySubmission) as LegacyAnyRecord;
			const rows = session.questions.map(ref => ({ exam_id: ref.examId, question_id: ref.questionId, section_index: ref.sectionIndex,
				answer: answers[`${ref.sectionIndex}:${ref.questionId}`], status: response.score?.results?.[`${ref.sectionIndex}:${ref.questionId}`]?.status || (answers[`${ref.sectionIndex}:${ref.questionId}`] ? 'ungraded' : 'unanswered'), viewed: false }));
			rows.forEach((row, i) => this.specialtyOutcomes.set(this.specialtyQuestionKey(session.questions[i]), row));
			this.specialtyReview = true; this.enableAllSpecialtyAssists();
			this.specialtySavedSignature = JSON.stringify([...this.specialtyOutcomes.values()]);
			await this.clearSpecialtyDraft();
			this.showSpecialtyResult({ submission_id: this.specialtySubmission, statistics: { ...response.score, practice_label: session.label, session_questions: rows } }, true);
			this.setAnswerSaveStatus('submitted', '作业已提交');
			window.dispatchEvent(new Event('examAnswersSubmitted'));
		} catch (error) { this.persistSpecialtyDraft(); this.setAnswerSaveStatus('failed', '提交失败，答案已保留，请重试'); showAppToast(error instanceof Error ? error.message : '提交失败，答案已保留，请重试'); }
		finally { this.specialtySaving = false; this.renderExam(); }
	}
	getWholePaperProgress(examId: string): { answered: number; total: number } | null {
		const draft = this.readSpecialtyDrafts().find(draft => draft.mode === 'whole-paper' && draft.session.questions[0]?.examId === examId);
		if (!draft) return null;
		const answers = new Set<string>(draft.outcomes.map(([key]: [string]) => key));
		for (const [id, value] of draft.answers) for (const ref of draft.session.questions) {
			if (ref.examId !== id) continue;
			const answer = this.specialtyStoredAnswer(value.answers || {}, ref);
			if (Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '') answers.add(this.specialtyQuestionKey(ref));
		}
		return { answered: answers.size, total: draft.session.questions.length };
	}
	async startWholePaperPractice(examId: string, label: string, options: { returnContext: LegacyAnyRecord; record?: LegacyAnyRecord | null; draft?: LegacyAnyRecord | null; fresh?: boolean; isCurrent?: () => boolean }): Promise<void> {
		if (options.isCurrent && !options.isCurrent()) return;
		if (!options.fresh && !options.record) await this.syncPracticeDrafts();
		if (options.isCurrent && !options.isCurrent()) return;
		if (!options.fresh && !options.record && this.getWholePaperProgress(examId)) {
			if (this.specialtyEntryMode === 'whole-paper' && this.specialtyPractice?.questions[0]?.examId === examId && !this.specialtyReview) {
				await this.openSpecialtyPosition(this.specialtyPractice);
			} else {
				const draft = this.readSpecialtyDrafts().find(draft => draft.mode === 'whole-paper' && draft.session.questions[0]?.examId === examId)!;
				await this.resumeSpecialtyPractice(draft.submission);
			}
			return;
		}
		const data = await window.APIClient!.getExam(examId) as ExamViewerExamData;
		if (options.isCurrent && !options.isCurrent()) return;
		const positions = data.exam_info.sections.flatMap((section, sectionIndex) =>
			(section.questions?.length ? section.questions : (section.passages || []).flatMap(passage => passage.questions || []))
				.map((question, questionIndex) => ({ questionId: String(question.id), sectionIndex, questionIndex })));
		if (!positions.length) throw new Error('这张试卷暂无可练习的题目');
		const saved = options.record || options.draft;
		const answers = saved?.answers || {};
		await this.startSpecialtyPractice(label, positions.map(position => ({ examId, questionId: position.questionId, sectionIndex: position.sectionIndex })), !!options.record, { mode: 'whole-paper', returnContext: options.returnContext, examData: data, isCurrent: options.isCurrent });
		if (options.isCurrent && !options.isCurrent()) return;
		this.specialtyAnswers.set(examId, { answers: { ...answers }, checked: new Set() });
		this.userAnswers = { ...answers };
		const index = options.draft ? positions.findIndex(position => position.sectionIndex === Number(saved?.last_section_index || 0) && position.questionIndex === Number(saved?.last_question_index || 0)) : 0;
		if (saved) {
			for (const position of positions) {
				const key = `${position.sectionIndex}:${position.questionId}`;
				const answer = answers[key] ?? answers[position.questionId];
				if (answer === undefined || answer === null || answer === '' || (Array.isArray(answer) && !answer.length)) continue;
				if (!options.record && positions.indexOf(position) === index) continue;
				const result = saved?.statistics?.results?.[key] || saved?.statistics?.results?.[position.questionId];
				const question = this.currentExam!.exam_info.sections[position.sectionIndex].questions![position.questionIndex];
				const status = result?.status || (question.correct_answer == null || question.correct_answer === '' ? 'ungraded' : this.answerManager.evaluateQuestionAnswer(position.sectionIndex, position.questionIndex) ? 'correct' : 'wrong');
				this.specialtyOutcomes.set(this.specialtyQuestionKey({ examId, ...position }), { exam_id: examId, question_id: position.questionId, section_index: position.sectionIndex, answer, viewed: false, status });
			}
		}
		await this.openSpecialtyPosition({ ...this.specialtyPractice!, index: Math.max(0, index) });
	}
	private async saveWholePaperResult(label: string, questions: LegacyAnyRecord[]): Promise<LegacyAnyRecord> {
		const examId = this.specialtyPractice!.questions[0].examId;
		const sections = this.currentExam!.exam_info.sections;
		const answers: Record<string, unknown> = {};
		for (const row of questions) {
			const sectionIndex = row.section_index ?? sections.findIndex(section => section.questions?.some(question => String(question.id) === row.question_id));
			if (sectionIndex >= 0 && !row.viewed) answers[`${sectionIndex}:${row.question_id}`] = row.answer;
		}
		const saved = await window.APIClient!.savePracticeGroup({ exam_id: examId, label: `${label} · 整套练习`, section_indexes: sections.map((_, index) => index), answers, submission_id: this.specialtySubmission }) as LegacyAnyRecord;
		const results = saved.statistics?.results || {};
		const rows = questions.map(row => {
			const sectionIndex = row.section_index ?? sections.findIndex(section => section.questions?.some(question => String(question.id) === row.question_id));
			return { ...row, status: results[`${sectionIndex}:${row.question_id}`]?.status || results[row.question_id]?.status || row.status };
		});
		return { ...saved, statistics: { ...saved.statistics, practice_label: label, session_questions: rows } };
	}
	getSpecialtyQuestionMapItems(): { index: number; current: boolean; status: string }[] | null {
		if (!this.specialtyPractice) return null;
		return this.specialtyPractice.questions.map((ref, index) => {
			const key = this.specialtyQuestionKey(ref);
			const outcome = this.specialtyOutcomes.get(key);
			let answer: unknown;
			if (index === this.specialtyPractice!.index) answer = this.answerManager.getAnswerComposite(this.currentSectionIndex, ref.questionId);
			else answer = this.specialtyStoredAnswer(this.specialtyAnswers.get(ref.examId)?.answers || {}, ref);
			const answered = Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '';
			const disclosed = this.specialtyReview || this.specialtyRevealed.has(key);
			const result = outcome?.status || (this.specialtyReview && this.specialtyEntryMode === 'correct' ? 'correct' : '');
			const status = outcome?.viewed ? 'viewed' : disclosed && result === 'correct' ? 'correct' : disclosed && result === 'wrong' ? 'incorrect' : answered || outcome ? 'answered' : 'unanswered';
			return { index, current: index === this.specialtyPractice!.index, status };
		});
	}
	async jumpToSpecialtyPosition(index: number): Promise<void> {
		const session = this.specialtyPractice;
		if (!session || this.specialtyLoading || this.specialtySaving || !Number.isInteger(index) || index < 0 || index >= session.questions.length || index === session.index) return;
		this.commitSpecialtyAnswer();
		this.specialtyPreviousFeedback = null;
		this.audioManager.stopAllAudio();
		await this.openSpecialtyPosition({ ...session, index });
	}
	updateTaskNavigationProgress(): void {
		const progress = document.querySelector<HTMLElement>('#question-navigation .task-progress');
		if (!progress) return;
		const items = this.getSpecialtyQuestionMapItems();
		if (items) {
			const viewed = items.filter(item => item.status === 'viewed').length;
			const answered = items.filter(item => !['unanswered', 'viewed'].includes(item.status)).length;
			progress.textContent = this.specialtyReview ? `共 ${items.length} 题 · 回顾不计入练习统计` : `已答 ${answered}/${items.length} 题${viewed ? ` · 仅查看 ${viewed} 题` : ''}`;
			const confirm = document.querySelector<HTMLButtonElement>('#specialty-question-feedback .specialty-confirm-answer');
			if (confirm) {
				const ref = this.specialtyPractice!.questions[this.specialtyPractice!.index];
				const answer = this.answerManager.getAnswerComposite(this.currentSectionIndex, ref.questionId);
				const hasAnswer = Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '';
				confirm.disabled = this.specialtySaving || (!hasAnswer && !this.specialtyOutcomes.has(this.specialtyQuestionKey(ref)));
				confirm.title = confirm.disabled ? '请先选择答案' : '确认后将锁定本次作答，并显示答案和解析';
			}
		} else {
			const questions = this.getPracticeQuestions();
			const answered = questions.filter(item => { const answer = this.answerManager.getAnswerComposite(item.sectionIndex, String(item.question.id)); return Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== ''; }).length;
			progress.textContent = this.savedPracticeMode === 'review' || this.isSubmitted ? '查看作答与解析' : `已答 ${answered}/${questions.length} 题`;
		}
	}
	async startSpecialtyPractice(label: string, questions: PracticeQuestionRef[], review = false, options?: { mode?: string; returnContext?: LegacyAnyRecord | null; examData?: ExamViewerExamData; isCurrent?: () => boolean }): Promise<void> {
		if (!questions.length) throw new Error('这个专项暂无可用题目');
		await this.answerManager.flushCurrentDraft();
		if (options?.isCurrent && !options.isCurrent()) return;
		this.persistSpecialtyDraft();
		this.specialtyPractice = null;
		this.savedPracticeMode = null;
		this.specialtyAnswers.clear();
		this.specialtyRevealed.clear();
		this.specialtyOutcomes.clear(); this.specialtyReview = review;
		this.specialtyEntryMode = options?.mode || (review ? 'review' : 'practice');
		this.specialtyReturnContext = options?.returnContext || null;
		this.specialtyResultDestination = 'catalog';
		this.specialtyReturnNotice = null;
		this.specialtyPreviousFeedback = null;
		this.specialtySubmission = createUuid();
		this.specialtySavedSignature = '';
		if (!review) this.hideLearningAssists();
		await this.openSpecialtyPosition({ label, questions, index: 0 }, options?.examData, options?.isCurrent);
	}
	private async openSpecialtyPosition(session: NonNullable<ExamViewer['specialtyPractice']>, preparedData?: ExamViewerExamData, isCurrent?: () => boolean): Promise<void> {
		if (this.specialtyLoading) return;
		this.specialtyLoading = true;
		try {
			const ref = session.questions[session.index];
			const data = preparedData || (this._currentExamId === ref.examId && this.currentExam ? this.currentExam : await window.APIClient!.getExam(ref.examId) as LegacyAnyRecord);
			if (isCurrent && !isCurrent()) return;
			const sections = data.exam_info.sections;
			let sectionIndex = -1, questionIndex = -1;
			sections.some((section: ExamViewerSection, index: number) => {
				if (ref.sectionIndex !== undefined && ref.sectionIndex !== index) return false;
				const questions = section.questions?.length ? section.questions : (section.passages || []).flatMap(passage => passage.questions || []);
				const found = questions.findIndex(question => String(question.id) === ref.questionId);
				if (found < 0) return false;
				sectionIndex = index; questionIndex = found; return true;
			});
			if (sectionIndex < 0) throw new Error('暂时无法定位专项题目');
			const changingPaper = this._currentExamId !== ref.examId || !this.currentExam || !this.specialtyPractice;
			if (changingPaper) {
				if (isCurrent && !isCurrent()) return;
				if (this.specialtyPractice && this._currentExamId) this.specialtyAnswers.set(this._currentExamId, { answers: { ...this.userAnswers }, checked: new Set(this.checkedPracticeQuestions) });
			}
			this.examMode = 'practice';
			if (changingPaper) {
				this.openingSavedPractice = true;
				this._currentExamId = ref.examId;
				this.loadExamData(data);
			}
			this.specialtyPractice = session;
			const outcome = this.specialtyOutcomes.get(this.specialtyQuestionKey(ref));
			this.showAnswers = this.specialtyReview || this.specialtyRevealed.has(this.specialtyQuestionKey(ref)); this.showExplanations = this.showAnswers;
			if (this.showAnswers) this.enableAllSpecialtyAssists();
			if (this.practiceScope?.label !== session.label || this.practiceScope.sectionIndexes[0] !== sectionIndex) this.setPracticeScope(session.label, [sectionIndex], true);
			if (changingPaper) {
				const saved = this.specialtyAnswers.get(ref.examId);
				if (saved) { this.userAnswers = { ...saved.answers }; this.checkedPracticeQuestions = new Set(saved.checked); }
			}
			if (outcome && outcome.answer !== null && outcome.answer !== undefined) this.answerManager.setAnswerComposite(sectionIndex, ref.questionId, outcome.answer);
			this.jumpToQuestion(sectionIndex, questionIndex);
			this.loadTranslationsForReadingAssist();
			this.persistSpecialtyDraft();
		} finally { this.specialtyLoading = false; }
	}
	private moveSpecialtyQuestion(offset: number): void {
		const session = this.specialtyPractice;
		if (!session || this.specialtyLoading || this.specialtySaving) return;
		const index = session.index + offset;
		if (index < 0 || index >= session.questions.length) return;
		this.commitSpecialtyAnswer();
		const ref = session.questions[session.index];
		const outcome = this.specialtyOutcomes.get(this.specialtyQuestionKey(ref));
		this.specialtyPreviousFeedback = this.specialtyEntryMode !== 'assignment' && !this.specialtyReview && offset > 0 && (outcome?.status === 'correct' || outcome?.status === 'wrong') ? { index: session.index, status: outcome.status } : null;
		void this.openSpecialtyPosition({ ...session, index }).then(() => {
			const feedback = this.specialtyPreviousFeedback;
			if (this.specialtyFeedbackTimer !== null) window.clearTimeout(this.specialtyFeedbackTimer);
			if (feedback) this.specialtyFeedbackTimer = window.setTimeout(() => {
				if (this.specialtyPreviousFeedback === feedback) { this.specialtyPreviousFeedback = null; document.getElementById('specialty-last-feedback')?.remove(); }
			}, 6000);
		}).catch(error => this.setAnswerSaveStatus('failed', error instanceof Error ? error.message : '读取题目失败，请重试'));
	}
	canAnswerSpecialtyQuestion(): boolean {
		if (!this.specialtyPractice) return true;
		const ref = this.specialtyPractice.questions[this.specialtyPractice.index];
		return !this.specialtyReview && !this.specialtySaving && (this.specialtyEntryMode === 'assignment' || !this.specialtyOutcomes.has(this.specialtyQuestionKey(ref)));
	}
	private enableAllSpecialtyAssists(): void {
		this.showAnswers = true;
		this.showExplanations = true;
		this.showReadingKana = true;
		this.showReadingZh = true;
	}
	private confirmSpecialtyAnswerForReview(): boolean {
		if (this.specialtyEntryMode === 'assignment' && !this.specialtyReview) return false;
		if (!this.specialtyPractice || this.specialtyReview) return true;
		if (this.specialtySaving) return false;
		this.commitSpecialtyAnswer();
		const ref = this.specialtyPractice.questions[this.specialtyPractice.index];
		const key = this.specialtyQuestionKey(ref);
		if (!this.specialtyOutcomes.has(key)) {
			showAppToast('请先选择答案，再确认查看解析');
			return false;
		}
		this.specialtyRevealed.add(key);
		this.persistSpecialtyDraft();
		return true;
	}
	private commitSpecialtyAnswer(): void {
		if (!this.specialtyPractice || !this.canAnswerSpecialtyQuestion()) return;
		const ref = this.specialtyPractice.questions[this.specialtyPractice.index];
		const question = this.currentExam!.exam_info.sections[this.currentSectionIndex].questions![this.currentQuestionIndex];
		const answer = this.answerManager.getAnswerComposite(this.currentSectionIndex, ref.questionId);
		if (Array.isArray(answer) ? !answer.length : answer === undefined || answer === null || answer === '') {
			if (this.specialtyEntryMode === 'assignment') this.specialtyOutcomes.delete(this.specialtyQuestionKey(ref));
			return;
		}
		const status = question.correct_answer == null || question.correct_answer === '' ? 'ungraded' : this.answerManager.evaluateQuestionAnswer(this.currentSectionIndex, this.currentQuestionIndex) ? 'correct' : 'wrong';
		this.specialtyOutcomes.set(this.specialtyQuestionKey(ref), { exam_id: ref.examId, question_id: ref.questionId, section_index: ref.sectionIndex, answer, viewed: false, status });
		this.setAnswerSaveStatus('idle', '本次已记录，结束后保存');
		this.persistSpecialtyDraft();
	}
	async finishSpecialtyPractice(destination: 'catalog' | 'home' = 'catalog'): Promise<void> {
		if (this.specialtyEntryMode === 'assignment') { await this.finishAssignment(); return; }
		const session = this.specialtyPractice;
		if (!session || this.specialtySaving) return;
		if (this.specialtyReview) { this.returnToSpecialtyCatalog(); return; }
		this.specialtyResultDestination = destination;
		this.commitSpecialtyAnswer();
		const questions = [...this.specialtyOutcomes.values()];
		const record = { statistics: { practice_label: session.label, session_questions: questions }, saved_at: new Date().toISOString() };
		if (!questions.length) {
			this.specialtySavedSignature = JSON.stringify(questions);
			await this.clearSpecialtyDraft();
			this.showSpecialtyResult(record, true);
			return;
		}
		this.showSpecialtyResult(record, true);
		this.specialtySaving = true;
		this.setAnswerSaveStatus('saving', '正在保存本次练习…');
		this.renderQuestionNavigation();
		try {
			await this.flushPracticeDrafts();
			const saved = this.specialtyEntryMode === 'whole-paper'
				? await this.saveWholePaperResult(session.label, questions)
				: await window.APIClient!.saveSpecialtySession({ label: session.label, questions, submission_id: this.specialtySubmission, learning_origin: this.specialtyEntryMode === 'system' ? 'system' : 'free' }) as LegacyAnyRecord;
			if (this.specialtyEntryMode === 'system') {
				// Retrying a failed completion reuses the saved submission ID; the
				// session result and each daily completion are idempotent.
				for (const row of questions.filter(row => !row.viewed)) {
					await window.APIClient!.completeDailyPracticeItem(row.section_index === undefined ? row.question_id : `${row.section_index}:${row.question_id}`, row.exam_id, String(this.specialtyReturnContext?.examTarget || ''));
				}
				window.dispatchEvent(new Event('examAnswersSubmitted'));
			}
			this.specialtySavedSignature = JSON.stringify(questions);
			await this.clearSpecialtyDraft();
			if (this.specialtyEntryMode === 'whole-paper') { this.specialtyReview = true; this.enableAllSpecialtyAssists(); }
			this.showSpecialtyResult(saved, true);
			this.setAnswerSaveStatus('saved', '本次结果已保存');
			const rows = (saved.statistics?.session_questions || questions) as typeof questions;
			const correct = rows.filter(row => row.status === 'correct').length;
			const wrong = rows.filter(row => row.status === 'wrong').length;
			this.specialtyReturnNotice = { text: correct + wrong ? `本次答对 ${correct} 题、答错 ${wrong} 题，已更新` : '本次看答案学习已保存，独立作答统计保持不变', chapterId: String(this.specialtyReturnContext?.chapterId || '') };
			window.dispatchEvent(new Event('practiceRecordSaved'));
		} catch {
			const status = document.querySelector<HTMLElement>('[data-specialty-save]');
			if (status) status.textContent = '保存失败，结果仍保留在本页。';
			const home = document.querySelector<HTMLButtonElement>('[data-specialty-home]');
			if (home) home.disabled = true;
			const retry = document.createElement('button'); retry.textContent = '重试保存'; retry.onclick = () => { void this.finishSpecialtyPractice(destination); };
			status?.append(retry);
		} finally { this.specialtySaving = false; if (this.specialtyEntryMode === 'whole-paper' && this.specialtyReview) this.renderExam(); else this.renderQuestionNavigation(); }
	}
	showSpecialtyResult(record: LegacyAnyRecord, active = false): void {
		if (!active) { this.specialtyResultDestination = 'catalog'; this.specialtyReturnNotice = null; }
		const stats = record.statistics || {};
		const rows = (stats.session_questions || []) as PracticeOutcome[];
		const label = String(stats.practice_label || '专项练习');
		const wholePaper = active && this.specialtyEntryMode === 'whole-paper';
		const assignment = this.specialtyReturnContext?.surface === 'assignment';
		const correct = rows.filter(row => row.status === 'correct').length;
		const graded = rows.filter(row => row.status === 'correct' || row.status === 'wrong').length;
		const viewed = rows.filter(row => row.viewed).length;
		const modal = document.getElementById('exam-result-modal'), panel = document.getElementById('exam-result-panel');
		if (!modal || !panel) return;
		panel.innerHTML = `<div class="specialty-result"><button type="button" class="exam-result-close" aria-label="关闭练习结果">×</button><p class="specialty-result-topic"></p><h2 id="exam-result-title">本次练习结果</h2><p class="specialty-result-volume">本次练习 ${rows.length} 题 · 独立作答 ${graded} 题</p><div class="specialty-result-overview" data-specialty-summary><div class="specialty-result-rate"><span>正确率</span><strong>${graded ? Math.round(correct / graded * 100) + '%' : '—'}</strong><small>${graded ? `独立作答 ${graded} 题，答对 ${correct} 题` : '尚无独立作答结果'}</small></div><div class="specialty-result-counts"><div class="is-correct"><span>答对</span><strong>${correct}<small>题</small></strong></div><div class="is-wrong"><span>答错</span><strong>${graded - correct}<small>题</small></strong></div><div><span>看答案学习</span><strong>${viewed}<small>题</small></strong></div></div></div><p class="specialty-result-note">看答案学习的题不计入正确率。</p><p class="specialty-result-save" data-specialty-save role="status"></p><div class="exam-result-actions"><button data-specialty-wrong>复盘错题${graded - correct > 0 ? `（${graded - correct}）` : ''}</button><button data-specialty-review>复盘本次</button><button class="result-primary" data-specialty-home>返回专项</button></div></div>`;
		panel.querySelector('.specialty-result-topic')!.textContent = label;
		if (assignment) {
			panel.querySelector('#exam-result-title')!.textContent = '作业已提交';
			panel.querySelector('.specialty-result-volume')!.textContent = `作业共 ${rows.length} 题`;
			panel.querySelector('.specialty-result-rate > span')!.textContent = '自动成绩';
			panel.querySelector('.specialty-result-rate > strong')!.textContent = Number(stats.score) >= 0 ? `${Number(stats.score).toFixed(1)}%` : '待批改';
			panel.querySelector('.specialty-result-rate > small')!.textContent = stats.requires_manual_review ? '已交给老师批改' : `答对 ${correct} 题 · 作业共 ${rows.length} 题`;
			(panel.querySelector('.specialty-result-note') as HTMLElement).hidden = true;
			(panel.querySelector('.specialty-result-counts > div:last-child') as HTMLElement).hidden = true;
		}
		if (active && this.getSpecialtySessionInfo()) {
			const independentlyAnswered = rows.filter(row => !row.viewed && (!assignment || (Array.isArray(row.answer) ? row.answer.length > 0 : row.answer !== undefined && row.answer !== null && row.answer !== ''))).length;
			const remaining = Math.max(0, this.specialtyPractice!.questions.length - independentlyAnswered);
			const note = document.createElement('p'); note.className = 'specialty-result-note';
			note.textContent = `${this.specialtyEntryMode === 'wrong' ? `本次答对 ${correct} 题，仍需巩固 ${graded - correct} 题。` : ''}${remaining ? `还有 ${remaining} 题未独立作答。` : '本次题目已全部作答。'}`;
			panel.querySelector('.specialty-result-note')?.after(note);
		}
		const sources = [...new Set(rows.map(row => row.exam_id.match(/(20\d{2})[_-](\d{2})/)).filter((date): date is RegExpMatchArray => !!date).map(date => `${date[1]}年${Number(date[2])}${this.isEjuExam() ? '回' : '月'}`))];
		if (sources.length) {
			const source = document.createElement('p'); source.className = 'specialty-result-volume';
			source.textContent = `题目来源：${sources.slice(0, 3).join('、')}${sources.length > 3 ? `等 ${sources.length} 份试卷` : ''}`;
			panel.querySelector('.specialty-result-volume')?.after(source);
		}
		panel.querySelector('[data-specialty-save]')!.textContent = !rows.length ? '尚未作答或查看答案，本次没有需要保存的结果。' : active && !record.submission_id ? '正在保存本次结果…' : '已保存本次结果';
		modal.hidden = false; modal.setAttribute('aria-hidden', 'false');
		const close = () => { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); };
		panel.querySelector<HTMLButtonElement>('.exam-result-close')!.onclick = close;
		const homeButton = panel.querySelector<HTMLButtonElement>('[data-specialty-home]')!;
		homeButton.textContent = assignment ? '返回我的作业' : this.specialtyResultDestination === 'home' ? '返回首页' : this.specialtyReturnContext?.surface === 'system' ? '返回系统学习' : this.specialtyReturnContext?.surface === 'paper' ? '返回真题模式' : '返回专项';
		homeButton.disabled = active && rows.length > 0 && !record.submission_id;
		homeButton.onclick = () => {
			if (active && !rows.length) this.specialtySavedSignature = JSON.stringify([]);
			close();
			if (this.specialtyResultDestination === 'home') {
				this.specialtyResultDestination = 'catalog';
				this.specialtyReturnNotice = null;
				this.audioManager.stopAllAudio();
				(window as unknown as { navigateLearningWorkspace: (intent: string) => void }).navigateLearningWorkspace('__overview__');
			} else this.returnToSpecialtyCatalog();
		};
		const open = async (selected: typeof rows, review: boolean, mode = review ? 'review' : 'wrong') => {
			if (!selected.length) return;
			try {
				if (wholePaper) mode = 'whole-paper';
				if (assignment) mode = 'assignment';
				if (this.specialtyReturnContext?.surface === 'system') mode = 'system';
				await this.startSpecialtyPractice(label, selected.map(row => ({ examId: row.exam_id, questionId: row.question_id, sectionIndex: row.section_index })), review, { mode, returnContext: this.specialtyReturnContext });
				this.specialtyReview = review;
				if (review) { selected.forEach(row => this.specialtyOutcomes.set(this.specialtyQuestionKey({ examId: row.exam_id, questionId: row.question_id, sectionIndex: row.section_index }), row)); await this.openSpecialtyPosition(this.specialtyPractice!); }
				close(); window.dispatchEvent(new CustomEvent('specialtyPracticeOpened'));
			} catch (error) { panel.querySelector('[data-specialty-save]')!.textContent = error instanceof Error ? error.message : '打开练习失败'; }
		};
		panel.querySelector<HTMLButtonElement>('[data-specialty-review]')!.onclick = () => { void open(rows, true); };
		const wrongButton = panel.querySelector<HTMLButtonElement>('[data-specialty-wrong]')!;
		const wrong = rows.filter(row => row.status === 'wrong'); wrongButton.disabled = !wrong.length;
		wrongButton.onclick = () => { void open(wrong, true); };

	}
	private returnToSpecialtyCatalog(): void {
		this.audioManager.stopAllAudio();
		const modal = document.getElementById('exam-result-modal');
		if (modal) { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); }
		window.dispatchEvent(new CustomEvent('specialtyReturnToCatalog', { detail: this.specialtyReturnContext || this.specialtyReturnNotice ? { ...this.specialtyReturnContext, notice: this.specialtyReturnNotice } : null }));
		this.specialtyReturnNotice = null;
	}
	practiceSelectionDomain = '';
	checkedPracticeQuestions = new Set<string>();
	savedPracticeMode: 'review' | 'retest' | null = null;
	private openingSavedPractice = false;

	openSavedPracticeAttempt(examId: string, examData: LegacyAnyRecord, attempt: {
		label: string; sectionIndexes: number[]; answers: Record<string, unknown>;
	}, mode: 'review' | 'retest'): void {
		this.openingSavedPractice = true;
		this.savedPracticeMode = mode;
		this.examMode = 'practice';
		this._currentExamId = examId;
		this.loadExamData(examData);
		const notice = document.createElement('p');
		notice.id = 'saved-practice-notice';
		notice.textContent = mode === 'review'
			? '历史复习 · 正在查看这次提交的答案和解析，不能修改'
			: '再测试 · 答案已清空，完成后会保存为一条新成绩';
		document.getElementById('exam-workarea')?.prepend(notice);
		this.setPracticeScope(attempt.label, attempt.sectionIndexes, true);
		if (mode === 'review') {
			this.userAnswers = { ...attempt.answers };
			this.isSubmitted = true;
			this.showAnswers = true;
			this.showExplanations = true;
			this.showReadingKana = true;
			this.showReadingZh = true;
			this.loadTranslationsForReadingAssist();
		} else {
			this.answerManager.prepareNewPracticeAttempt();
			this.showAnswers = false;
			this.showExplanations = false;
		}
		this.jumpToQuestion(attempt.sectionIndexes[0], 0, false);
		this.renderExam();
	}

	getPracticeQuestions() {
		const sections = this.currentExam?.exam_info.sections || [];
		const indexes = this.practiceScope?.sectionIndexes || sections.map((_, index) => index);
		return indexes.flatMap(sectionIndex => (sections[sectionIndex]?.questions || []).map((question, questionIndex) => ({ sectionIndex, questionIndex, question })));
	}

	setPracticeScope(domain: string, selectedIndexes?: number[], locked = false) {
		const types: Record<string, string[]> = { '词汇 / 语法': ['vocabulary', 'vocab', 'grammar'], '阅读': ['reading'], '读解': ['reading'], '记述': ['writing'], '听力': ['listening'], '听解': ['listening'], '听读解': ['listening_reading', 'listeningreading'] };
		const sections = this.currentExam?.exam_info.sections || [];
		const sectionIndexes = sections.map((section, index) => types[domain]?.includes(String(section.section_type).toLowerCase()) ? index : -1).filter(index => index >= 0);
		const chosen = selectedIndexes || sectionIndexes;
		this.practiceScope = selectedIndexes ? (!domain && chosen.length === sections.length ? null : { label: domain || '自选题组', sectionIndexes: chosen }) : domain && chosen.length ? { label: domain, sectionIndexes: chosen } : null;
		this.practiceRangeLocked = locked;
		this.practiceSelectionDomain = domain;
		this.checkedPracticeQuestions.clear();
		this.categoryNavigationManager.initCategoryDropdowns();
		this.renderQuestionNavigation();
		window.dispatchEvent(new Event('practiceRangeChanged'));
	}

	renderPracticeSetup(host: HTMLElement, domain: string, onStart: () => void) {
		const types: Record<string, string[]> = { '词汇 / 语法': ['vocabulary', 'vocab', 'grammar'], '阅读': ['reading'], '读解': ['reading'], '记述': ['writing'], '听力': ['listening'], '听解': ['listening'], '听读解': ['listening_reading', 'listeningreading'] };
		const sections = this.currentExam?.exam_info.sections || [];
		const candidates = sections.map((section, index) => ({ section, index })).filter(({ section }) => (section.questions?.length || 0) > 0 && (!domain || types[domain]?.includes(String(section.section_type).toLowerCase())));
		host.replaceChildren();
		host.classList.add('practice-setup');
		const list = document.createElement('div');
		list.className = 'practice-section-choices';
		candidates.forEach(({ section, index }, position) => {
			const row = document.createElement('label');
			const input = document.createElement('input');
			input.type = 'checkbox'; input.value = String(index); input.checked = position === 0;
			input.dataset.practiceSection = String(index);
			const name = document.createElement('span');
			name.textContent = section.section_name || section.section_title || `問題${position + 1}`;
			const count = document.createElement('small');
			count.textContent = `${section.questions!.length} 题`;
			row.append(input, name, count); list.append(row);
		});
		const summary = document.createElement('p');
		summary.className = 'practice-selection-summary'; summary.setAttribute('role', 'status');
		const start = document.createElement('button');
		start.type = 'button'; start.className = 'practice-start-btn'; start.textContent = '开始练习';
		const selected = () => Array.from(list.querySelectorAll<HTMLInputElement>('input:checked')).map(input => Number(input.value));
		const update = () => {
			const indexes = selected();
			const guest = !this.userId || this.userId === 'guest';
			const quota = guest ? guestTrialStatus(practiceTrialKind(this._currentExamId || '', String(this.currentExam?.family || ''))) : null;
			summary.textContent = `已选 ${indexes.length} 个题组，共 ${indexes.reduce((count, index) => count + sections[index].questions!.length, 0)} 题${quota ? ` · 本类访客体验剩余 ${quota.remaining} 次` : ''}`;
			start.textContent = quota?.remaining === 0 ? '登录后继续练习' : '开始练习';
			start.disabled = !indexes.length;
		};
		list.addEventListener('change', update);
		start.addEventListener('click', async () => {
			const indexes = selected(); if (!indexes.length) return;
			if (!await this.setExamMode('practice')) return;
			if ((!this.userId || this.userId === 'guest') && guestTrialStatus(practiceTrialKind(this._currentExamId || '', String(this.currentExam?.family || ''))).remaining === 0) {
				summary.textContent = '这类访客体验已用完。登录后可以继续练习并保存成绩。';
				(window as Window & { __openLoginModal?: () => void }).__openLoginModal?.();
				return;
			}
			this.setPracticeScope(domain, indexes, true);
			document.getElementById('exam-review-bar')?.remove();
			this.jumpToQuestion(indexes[0], 0);
			onStart();
			this.renderExam();
		});
		host.append(list, summary, start); update();
	}

	reselectPracticeGroups() {
		const modal = document.getElementById('exam-result-modal');
		const panel = document.getElementById('exam-result-panel');
		if (!panel || !modal) return;
		panel.innerHTML = '<h2 id="exam-result-title">重新选择题组</h2><div class="practice-setup-host"></div>';
		this.renderPracticeSetup(panel.querySelector<HTMLElement>('.practice-setup-host')!, this.practiceSelectionDomain, () => { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); });
		modal.hidden = false; modal.setAttribute('aria-hidden', 'false');
		panel.querySelector<HTMLInputElement>('input')?.focus();
	}

	choosePracticePaper() {
		this.practiceRangeLocked = false;
		window.dispatchEvent(new Event('practiceRangeChanged'));
		const picker = document.querySelector<HTMLDetailsElement>('.ls-paper-picker');
		if (picker) { picker.open = true; picker.querySelector<HTMLSelectElement>('select')?.focus(); }
	}

	preparePracticeCategory(categoryId: string, sectionIndex?: number) {
		if (this.practiceRangeLocked) return;
		if (this.examMode !== 'practice' || !this.practiceScope) return;
		if (sectionIndex !== undefined && this.practiceScope.sectionIndexes.includes(sectionIndex)) return;
		const labels: Record<string, string> = { vocab: '词汇 / 语法', vocabulary: '词汇 / 语法', grammar: '词汇 / 语法', reading: '阅读', writing: '记述', listening: '听力', listening_reading: '听读解', listeningreading: '听读解' };
		const sectionType = sectionIndex === undefined ? categoryId : this.currentExam?.exam_info.sections[sectionIndex]?.section_type || categoryId;
		this.setPracticeScope(labels[sectionType] || (categoryId === 'writing_reading' ? '读解' : categoryId));
		document.getElementById('exam-review-bar')?.remove();
	}

	isCurrentPracticeQuestionChecked() {
		if (this.specialtyPractice) return this.showAnswers;
		const question = this.currentExam?.exam_info.sections[this.currentSectionIndex]?.questions?.[this.currentQuestionIndex];
		return this.examMode === 'practice' && !!question && this.checkedPracticeQuestions.has(`${this.currentSectionIndex}:${question.id}`);
	}

	finishPractice() {
		if (this.specialtyPractice) { void this.finishSpecialtyPractice(); return; }
		if (this.savedPracticeMode === 'review') return;
		this.audioManager.stopAllAudio();
		document.getElementById('exam-review-bar')?.remove();
		if (this.examMode === 'practice' && this.practiceScope) this.answerManager.showPracticeResults(this.practiceScope.label, this.getPracticeQuestions());
		else this.questionMapManager.showQuestionMap();
	}

	choosePracticeCategory() {
		const panel = document.getElementById('exam-result-panel');
		const modal = document.getElementById('exam-result-modal');
		if (!panel || !modal) return;
		const types: Record<string, string[]> = { '词汇 / 语法': ['vocabulary', 'vocab', 'grammar'], '阅读': ['reading'], '读解': ['reading'], '记述': ['writing'], '听力': ['listening'], '听解': ['listening'], '听读解': ['listening_reading', 'listeningreading'] };
		const domains = (this.isEjuExam() ? ['记述', '读解', '听读解', '听解'] : ['词汇 / 语法', '阅读', '听力']).filter(domain => this.currentExam?.exam_info.sections.some(section => types[domain].includes(String(section.section_type).toLowerCase())));
		panel.innerHTML = '<h2 id="exam-result-title">选择下一项练习</h2><div class="exam-result-actions practice-category-choices"></div>';
		for (const domain of domains) {
			const button = document.createElement('button');
			button.type = 'button';
			button.textContent = domain;
			button.addEventListener('click', () => {
				panel.innerHTML = '<h2 id="exam-result-title">选择题组</h2><div class="practice-setup-host"></div>';
				this.renderPracticeSetup(panel.querySelector<HTMLElement>('.practice-setup-host')!, domain, () => { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); });
				panel.querySelector<HTMLInputElement>('input')?.focus();
			});
			panel.querySelector('.practice-category-choices')!.append(button);
		}
		modal.hidden = false;
		modal.setAttribute('aria-hidden', 'false');
		panel.querySelector<HTMLButtonElement>('button')?.focus();
	}
	showAnswers = false;
	showExplanations = false;
	showReadingKana = false;
	showReadingZh = false;
	examMode: ExamMode = 'practice';
	isSubmitted = false;
	private _kbBound = false;
	private _draftRestoreRequest = 0;
	private submitConfirmationPending = false;
	private answerStatusHideHandle: number | null = null;
	private floatingNavigationResizeObserver: ResizeObserver | null = null;
	private expiredSectionIndexes = new Set<number>();
	_currentExamId: string | null = null;
	wrongCorrectionContext: WrongCorrectionContext | null = null;
	private wrongCorrectionResult: WrongCorrectionResult | null = null;
	private wrongCorrectionSubmitting = false;
	private wrongCorrectionSubmission = '';
	private wrongCorrectionLoadPending = false;
	constructor() {
		// 初始化日志记录器
		this.logger = Logger.getLogger('ExamViewer');
		this.logger.info('Initializing exam viewer');

		// ==================== 核心状态管理 ====================
		this.currentExam = null;
		this.currentSectionIndex = 0;
		this.currentQuestionIndex = 0;
		this.currentCategory = null;
		this.userAnswers = {};
		this.showAnswers = false;
		this.showExplanations = false;
		this.showReadingKana = this.readBooleanPreference('examViewer.showReadingKana', false);
		this.showReadingZh = this.readBooleanPreference('examViewer.showReadingZh', false);
		this.examMode = this.readExamModePreference();
		this.isSubmitted = false;

		// ==================== 初始化管理器 ====================
		// 注意：初始化顺序很重要，某些管理器依赖其他管理器

		// 1. 基础管理器（无依赖）
		this.userContextManager = UserContextManager.getInstance();
		this.stateManager = new StateManager(this as any);
		this.navigationManager = new NavigationManager(this as any);

		// 2. 功能管理器（可能有依赖）
		this.audioManager = new AudioManager(this as any);
		// 生词划词查词 · 个人词本
		this.vocabLookupManager = new (window as any).VocabLookupManager(this as any);
		this.answerManager = new AnswerManager(this as any);
		this.questionMapManager = new QuestionMapManager(this as any);
		this.categoryNavigationManager = new CategoryNavigationManager(this as any);
		this.questionRenderer = new QuestionRenderer(this as any);
		// 答题计时管理器（业务功能 3）
		this.examTimerManager = new ExamTimerManager(this as any);

		// ==================== 初始化各个子系统 ====================
		this.initializeEventListeners();
		this.initializeModeControl();
		this.initializeLeaveProtection();
		this.initializeNetworkStatus();
		this.loadExamData();
		
		// Web 应用模式下不自动调用 initExamLibrary（由 loader.js 处理）
		if (!window.__WEB_APP_MODE__) {
			this.initExamLibrary();
		}
		
		this.questionMapManager.initQuestionMap();
		this.categoryNavigationManager.initCategoryDropdowns();
		(window as unknown as { TranslationManager?: { installDelegation?: () => void } }).TranslationManager?.installDelegation?.();
		this.vocabLookupManager?.init?.();

		// ==================== 后端通信设置 ====================
		this.setupBackendCommunication();
		this.userContextManager.addListener(this.onUserContextChanged.bind(this));
		this.onUserContextChanged(this.userContextManager.getUserContext());

		// ==================== 延迟初始化 ====================
		setTimeout(() => {
			this.unifyTopAndCategoryButtonWidths();
		}, 100);

		console.log('[ExamViewer] Initialization completed');
	}

	// ==================== 后端通信管理 ====================

	onUserContextChanged(userContext: LegacyAnyRecord) {
		const previousUserId = this.userId;
		this.userId = userContext?.user_id || userContext?.id || 'guest';
		if (this.userId !== previousUserId) { this.specialtyPractice = null; this.specialtyOutcomes.clear(); this.specialtyAnswers.clear(); this.specialtyRevealed.clear(); this.specialtySavedSignature = ''; }
		this.token = userContext?.token || '';
		this.roles = Array.isArray(userContext?.roles) ? userContext.roles : [];
		if (this.currentExam && this._currentExamId && this.userId !== 'guest' && this.userId !== previousUserId && !this.wrongCorrectionContext) {
			const hasLocalAnswers = Object.values(this.userAnswers).some(answer => answer !== null && answer !== undefined && answer !== '');
			if (hasLocalAnswers && previousUserId === 'guest' && document.getElementById('exam-result-modal')?.hidden !== false) this.answerManager.saveCurrentDraft();
			else if (!hasLocalAnswers) void this.restoreDraftForCurrentExam();
		}
	}

	setupBackendCommunication() {
		window.addEventListener('message', (event) => {
			console.log('[ExamViewer] Received backend message:', event.data);
			const msg = event.data;
			if (!msg || !msg.type) { return; }

			switch (msg.type) {
				case 'loadExam':
					console.log('[ExamViewer] Processing exam load message');
					// 业务功能 3：先设置 examId，loadExamData 末尾据此启动计时
					this._currentExamId = msg.examId || null;
					this.loadExamData(msg.data);
					break;
				case 'error':
					console.error('[ExamViewer] Backend parsing failed', msg.message);
					break;
				case 'examList':
					this.renderExamList(msg.list || []);
					break;
				case 'examLocked':
					this.showExamLocked(msg.examId, msg.reason);
					break;
				case 'examLoadError':
					console.warn('Exam loading failed', msg.examId, msg.message);
					this.showExamLocked(msg.examId, msg.message || 'Loading failed');
					break;
				case 'userContext':
					this.userContextManager.setUserContext(msg.data);
					break;
				case 'command':
					this.handleCommand(msg.command);
					break;
				default:
					console.warn('[ExamViewer] Unknown message type:', msg.type);
					break;
			}
		});
	}

	initExamLibrary() {
		setTimeout(() => {
			try {
				if (typeof vscode !== 'undefined' && vscode) {
					vscode.postMessage({ type: 'listExams' });
				}
			} catch (e) {
				console.warn('[ExamViewer] Exam library initialization failed:', e);
			}
		}, 0);
	}

	// ==================== 数据加载与管理 ====================

	loadExamData(examData?: LegacyAnyRecord | null) {
		this._draftRestoreRequest++;
		this.specialtyPractice = null;
		document.getElementById('saved-practice-notice')?.remove();
		if (!this.openingSavedPractice) this.savedPracticeMode = null;
		const skipDraftRestore = this.openingSavedPractice;
		this.openingSavedPractice = false;
		this.practiceScope = null;
		this.practiceRangeLocked = false;
		this.checkedPracticeQuestions.clear();
		document.getElementById('exam-review-bar')?.remove();
		console.log('[ExamViewer] Starting to load exam data:', examData ? 'external data' : 'inline data');

		try {
			if (!this.wrongCorrectionLoadPending) this.clearWrongQuestionCorrection();
			this.wrongCorrectionLoadPending = false;
			if (examData) {
				console.log('[ExamViewer] Using external exam data');
				if (examData.exam_info && Array.isArray(examData.exam_info.sections)) {
					this.currentExam = examData as ExamViewerExamData;
				} else {
					console.warn('[ExamViewer] Invalid external exam data shape');
					this.currentExam = null;
				}
			} else if (!window.__WEB_APP_MODE__) {
				// 只在非 Web 应用模式下尝试从内联脚本加载
				console.log('[ExamViewer] Loading data from inline script');
				const examDataLoader = window.ExamDataLoader as
					| {
							loadFromScript: (scriptId: string) => ExamViewerExamData | null;
					  }
					| undefined;
				this.currentExam = examDataLoader?.loadFromScript('exam-data') ?? null;
				if (this.currentExam) {
					console.log('[ExamViewer] Inline data loaded successfully:', this.currentExam);
				} else {
					console.log('[ExamViewer] Inline data loading failed');
				}
			} else {
				// Web 应用模式：显示提示，等待用户选择试卷
				console.log('[ExamViewer] Web app mode: waiting for user to select exam');
				const container = document.getElementById('current-question-container');
				if (container) {
					container.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;">请选择试卷</div>';
				}
				return; // 不继续处理
			}

			if (this.currentExam) {
				console.log('[ExamViewer] Exam data loaded successfully, preprocessing...');
				this.preprocessExamData();
				console.log('[ExamViewer] Starting render...');
				
				// 保存当前的显示状态
				const prevShowAnswers = this.showAnswers;
				const prevShowExplanations = this.showExplanations;
				const prevShowReadingKana = this.showReadingKana;
				const prevShowReadingZh = this.showReadingZh;
				
				this.answerManager.beginDraftSession();
				this.resetExamState();
				this.expiredSectionIndexes.clear();
				this.isSubmitted = false;
				if (this.getLearningSessionKind() === 'diagnostic') this.examMode = 'mock';
				
				// 恢复显示状态
				this.showAnswers = prevShowAnswers;
				this.showExplanations = prevShowExplanations;
				this.showReadingKana = prevShowReadingKana;
				this.showReadingZh = prevShowReadingZh;
				if (this.examMode === 'mock' || this.wrongCorrectionContext) {
					this.hideLearningAssists();
				}
				this.setAnswerSaveStatus('idle', '尚未作答');
				this.setInitialNavigationPosition();
				
				this.renderExam();
				this.categoryNavigationManager.initCategoryDropdowns();
				console.log('[ExamViewer] Render completed');
				this.loadTranslationsForReadingAssist();
				if (!this.wrongCorrectionContext && !skipDraftRestore) void this.restoreDraftForCurrentExam();

				// 模拟考试记录考试用时；练习模式只累计学员学习时长。
				try {
					if (this._currentExamId && this.examTimerManager) {
						this.examTimerManager.startForExam(this._currentExamId, this.examMode === 'mock' ? this.extractExamTimerLimits() : undefined);
					}
				} catch (timerErr) {
					console.warn('[ExamViewer] Failed to start exam timer', timerErr);
				}
			} else {
				console.log('[ExamViewer] No exam data to render');
			}
		} catch (error) {
			console.error('[ExamViewer] Exam data loading failed:', error);
		}
	}

	/**
	 * 预处理试卷数据
	 * 将 passages 中的题目展平到 section.questions
	 */
	preprocessExamData() {
		if (!this.currentExam || !this.currentExam.exam_info || !this.currentExam.exam_info.sections) {
			return;
		}

		this.currentExam.exam_info.sections.forEach((section: ExamViewerSection) => {
			if ((section as LegacyAnyRecord).diagnostic_excluded) { section.questions = []; return; }
			if (section.passages && Array.isArray(section.passages) && section.passages.length > 0) {
				const sectionTags = Array.isArray((section as LegacyAnyRecord)?.skill_tags) ? (section as LegacyAnyRecord).skill_tags : [];
				const isWritingSection = section.section_type === 'writing' || sectionTags.includes('eju.writing');
				if (isWritingSection) {
					const firstPassage = section.passages[0];
					const firstSectionQuestion = Array.isArray(section.questions) ? section.questions[0] : undefined;
					const firstPassageQuestion = Array.isArray(firstPassage?.questions) ? firstPassage.questions[0] : undefined;
					const canonicalPassage = firstPassage?.passage || firstSectionQuestion?._groupPassage || firstPassageQuestion?._groupPassage;
					const normalizedQuestion = (firstSectionQuestion || firstPassageQuestion || {
						id: 1,
						question: '',
						has_ans: false,
						skill_tags: ['eju.writing']
					}) as ExamViewerQuestion;
					normalizedQuestion.id = 1;
					normalizedQuestion.question = String(normalizedQuestion.question || '');
					normalizedQuestion.has_ans = false;
					normalizedQuestion.skill_tags = ['eju.writing'];
					if (canonicalPassage) {
						normalizedQuestion._groupPassage = canonicalPassage;
					}
					normalizedQuestion._groupPassageKey = `${section.section_id || ''}:p1`;
					section.questions = [normalizedQuestion];
					if (firstPassage) {
						firstPassage.id = 1;
						delete firstPassage.questions;
						section.passages = [firstPassage];
					}
					return;
				}

				const hasMultiplePassages = section.passages.length > 1;
				const existingQuestions = Array.isArray(section.questions) ? section.questions : [];
				if (existingQuestions.length > 0) {
					const byId = new Map<string, ExamViewerPassageGroup>();
					const byAnswerNo = new Map<string, ExamViewerPassageGroup>();
					section.passages.forEach((passage: ExamViewerPassageGroup) => {
						const groupPassageKey =
							section.section_id !== undefined && passage.id !== undefined
								? `${section.section_id}:p${passage.id}`
								: '';
						if (passage.questions && Array.isArray(passage.questions)) {
							passage.questions.forEach((question: ExamViewerQuestion) => {
								const idKey = question.id !== undefined ? String(question.id) : '';
								if (idKey) {
									byId.set(idKey, passage);
								}
								const answerNo = (question as LegacyAnyRecord).eju_answer_no;
								const answerKey = answerNo !== undefined ? String(answerNo) : '';
								if (answerKey) {
									byAnswerNo.set(answerKey, passage);
								}
								question._groupPassage = question._groupPassage || passage.passage;
								question._groupPassageKey = question._groupPassageKey || groupPassageKey || `${section.section_id || ''}:${question.id ?? ''}`;
							});
						}
					});

					existingQuestions.forEach((question: ExamViewerQuestion) => {
						const idKey = question.id !== undefined ? String(question.id) : '';
						const answerNo = (question as LegacyAnyRecord).eju_answer_no;
						const answerKey = answerNo !== undefined ? String(answerNo) : '';
						const passage = (idKey && byId.get(idKey)) || (answerKey && byAnswerNo.get(answerKey));
						if (!passage) {
							return;
						}
						const groupPassageKey =
							section.section_id !== undefined && passage.id !== undefined
								? `${section.section_id}:p${passage.id}`
								: '';
						question._groupPassage = question._groupPassage || passage.passage;
						question._groupPassageKey = question._groupPassageKey || groupPassageKey || `${section.section_id || ''}:${question.id ?? ''}`;
						if (hasMultiplePassages) {
							question._groupIndex = question._groupIndex || passage.id;
						}
						question._groupTopic = question._groupTopic || passage.topic;
						if (passage.audio && !question.audio) {
							question.audio = passage.audio;
						}
						if (passage.script && !question.script) {
							question.script = passage.script;
						}
					});

					console.log(
						`[ExamViewer] Preprocessed section ${section.section_id}: reused ${existingQuestions.length} section questions with ${section.passages.length} passages`
					);
					return;
				}

				const sectionQuestions: ExamViewerQuestion[] = [];

				section.passages.forEach((passage: ExamViewerPassageGroup) => {
					if (passage.questions && Array.isArray(passage.questions)) {
						const groupPassageKey =
							section.section_id !== undefined && passage.id !== undefined
								? `${section.section_id}:p${passage.id}`
								: '';
						// 将文章信息附加到每道题目上
						passage.questions.forEach((question: ExamViewerQuestion) => {
							question._groupPassage = passage.passage;
							question._groupPassageKey = groupPassageKey || `${section.section_id || ''}:${question.id ?? ''}`;
							// 只有多篇文章时才显示"第X篇"标签
							if (hasMultiplePassages) {
								question._groupIndex = passage.id;
							}
							question._groupTopic = passage.topic;
							// 复制 passage 的 audio 和 script 到 question
							if (passage.audio && !question.audio) {
								question.audio = passage.audio;
							}
							if (passage.script && !question.script) {
								question.script = passage.script;
							}
							sectionQuestions.push(question);
						});
					}
				});
				section.questions = sectionQuestions;

				console.log(
					`[ExamViewer] Preprocessed section ${section.section_id}: ${sectionQuestions.length} questions from ${section.passages.length} passages`
				);
			}
		});
	}

	resetExamState() {
		this.stateManager.resetExamState();
	}

	// ==================== 渲染系统 ====================

	renderExam() {
		this.logger.debug('renderExam called');
		this.logger.debug('Current state:', {
			category: this.currentCategory,
			sectionIndex: this.currentSectionIndex,
			questionIndex: this.currentQuestionIndex
		});

		this.renderHeader();
		this.categoryNavigationManager.renderCategoryNavigation();
		this.renderControls();
		this.updateReadingAssistButtonStates();
		this.questionRenderer.renderCurrentQuestion();
		this.renderQuestionNavigation();
		this.renderAnswerPanel();
		this.renderWrongQuestionCorrectionBar();

		this.logger.debug('renderExam completed');
	}

	renderHeader() {
		this.renderExamHeader();
	}

	renderExamHeader() {
		const container = DOMUtils.safeGetElement('exam-header', 'renderExamHeader');
		if (!container) {
			return;
		}
		if (!this.currentExam) {
			console.warn('[ExamViewer] Header render failed: missing exam data');
			container.classList.add('is-empty');
			DOMUtils.safeSetInnerHTML(container, '', 'renderExamHeader');
			return;
		}

		container.classList.remove('is-empty');
		container.querySelector('.exam-title')?.remove();
	}

	renderControls() {
		const controls = document.getElementById("exam-controls");
		if (!controls) {
			return;
		}
		const family = this.isEjuExam() ? 'family-eju' : 'family-jlpt';
		controls.classList.remove('family-eju', 'family-jlpt');
		controls.classList.add(family);
		// HTML模板中已经定义了所有需要的按钮
		this.syncMobilePaperSelector();
		this.updateReadingAssistButtonStates();
		this.updateLearningAssistAvailability();
		this.syncExamSettingsLayout();
		const modeSelect = document.getElementById('exam-mode-select') as HTMLSelectElement | null;
		if (modeSelect) modeSelect.value = this.examMode;
		const submitButton = document.getElementById('submit-exam') as HTMLButtonElement | null;
		if (submitButton) {
			submitButton.disabled = !this.currentExam || this.isSubmitted;
			const label = this.getLearningSessionKind() === 'diagnostic' ? '提交诊断' : '提交试卷';
			submitButton.title = label; submitButton.setAttribute('aria-label', label);
			const text = submitButton.querySelector('.submit-exam-text');
			if (text) text.textContent = label;
		}
	}

	private syncMobilePaperSelector() {
		const panel = document.getElementById('exam-library-panel');
		const toggle = document.getElementById('mobile-paper-toggle') as HTMLButtonElement | null;
		const summary = document.getElementById('mobile-paper-summary');
		if (!panel || !toggle || !summary || !this.currentExam) return;

		const family = (document.getElementById('exam-family-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const level = (document.getElementById('exam-level-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const paper = (document.getElementById('exam-paper-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const paperLabel = this._currentExamId ? this.currentPaperSourceTitle() : [family, level, paper].filter(Boolean).join(' · ') || '当前试卷';
		summary.dataset.paperLabel = paperLabel;
		const keepExpanded = panel.dataset.mobilePaperExpanded === 'true';
		summary.textContent = keepExpanded ? '收起' : paperLabel;
		panel.classList.add('mobile-paper-ready');
		panel.classList.toggle('mobile-paper-collapsed', !keepExpanded);
		toggle.setAttribute('aria-expanded', String(keepExpanded));
		toggle.setAttribute('aria-label', keepExpanded ? '收起试卷选择' : `展开试卷选择，当前${paperLabel}`);
		toggle.title = keepExpanded ? '收起试卷选择' : '展开试卷选择';
	}
	private currentPaperSourceTitle(): string {
		const id = String(this._currentExamId || '');
		const level = id.match(/N[1-3]/)?.[0] || '';
		const date = id.match(/(20\d{2})[_-](\d{2})/) || String(this.currentExam?.exam_info.exam_date || '').match(/(20\d{2})[/-](\d{1,2})/);
		return `${this.isEjuExam() ? 'EJU' : `JLPT ${level}`} ${date ? `· ${date[1]}年${this.isEjuExam() ? `第${Number(date[2])}回` : `${Number(date[2])}月`}真题` : `· ${id}`}`;
	}

	private toggleMobilePaperSelector() {
		const panel = document.getElementById('exam-library-panel');
		const toggle = document.getElementById('mobile-paper-toggle') as HTMLButtonElement | null;
		const summary = document.getElementById('mobile-paper-summary');
		if (!panel || !toggle || !summary) return;
		const collapsed = panel.classList.toggle('mobile-paper-collapsed');
		if (collapsed) {
			delete panel.dataset.mobilePaperExpanded;
		} else {
			panel.dataset.mobilePaperExpanded = 'true';
		}
		const paperLabel = summary.dataset.paperLabel || '当前试卷';
		summary.textContent = collapsed ? paperLabel : '收起';
		toggle.setAttribute('aria-expanded', String(!collapsed));
		toggle.setAttribute('aria-label', collapsed ? `展开试卷选择，当前${paperLabel}` : '收起试卷选择');
		toggle.title = collapsed ? '展开试卷选择' : '收起试卷选择';
	}

	private collapseMobilePaperSelector() {
		const panel = document.getElementById('exam-library-panel');
		const toggle = document.getElementById('mobile-paper-toggle') as HTMLButtonElement | null;
		const summary = document.getElementById('mobile-paper-summary');
		if (!panel || !toggle || !summary) return;
		delete panel.dataset.mobilePaperExpanded;
		panel.classList.add('mobile-paper-collapsed');
		const paperLabel = summary.dataset.paperLabel || '当前试卷';
		summary.textContent = paperLabel;
		toggle.setAttribute('aria-expanded', 'false');
		toggle.setAttribute('aria-label', `展开试卷选择，当前${paperLabel}`);
		toggle.title = '展开试卷选择';
	}

	private toggleMobileTools() {
		const controls = document.getElementById('exam-controls');
		const toggle = document.getElementById('mobile-tools-toggle') as HTMLButtonElement | null;
		if (!controls || !toggle) return;
		const expanded = controls.classList.toggle('mobile-tools-expanded');
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.textContent = expanded ? '收起' : '更多';
		toggle.title = expanded ? '收起更多工具' : '展开更多工具';
	}

	private toggleLearningToolsMenu(force?: boolean) {
		const toggle = document.getElementById('learning-tools-toggle') as HTMLButtonElement | null;
		const menu = document.getElementById('learning-tools-menu');
		if (!toggle || !menu || (toggle.disabled && force !== false)) return;
		const shouldOpen = force ?? menu.hidden;
		menu.hidden = !shouldOpen;
		toggle.setAttribute('aria-expanded', String(shouldOpen));
		toggle.title = shouldOpen ? '关闭学习辅助工具' : '打开学习辅助工具';
	}

	private toggleExamSettingsMenu(force?: boolean) {
		const toggle = document.getElementById('exam-settings-toggle') as HTMLButtonElement | null;
		const menu = document.getElementById('exam-settings-menu');
		if (!toggle || !menu) return;
		const shouldOpen = force ?? menu.hidden;
		menu.hidden = !shouldOpen;
		toggle.setAttribute('aria-expanded', String(shouldOpen));
		toggle.setAttribute('aria-label', shouldOpen ? '关闭考试设置' : '打开考试设置');
		toggle.title = shouldOpen ? '关闭考试设置' : '考试设置';
		if (!shouldOpen) this.toggleLearningToolsMenu(false);
	}

	private syncExamSettingsLayout() {
		const settings = document.getElementById('exam-settings-control');
		if (!settings) return;
		const modeField = settings.querySelector<HTMLElement>('.exam-mode-field');
		if (modeField) modeField.hidden = this.practiceRangeLocked || this.getLearningSessionKind() !== 'free';
		const heading = settings.querySelector<HTMLElement>('.exam-settings-heading strong');
		if (heading) heading.textContent = this.getLearningSessionKind() === 'diagnostic' ? '诊断设置' : this.examMode === 'practice' ? '练习设置' : '考试设置';
		const hint = settings.querySelector<HTMLElement>('.exam-settings-heading span');
		if (hint) hint.hidden = this.practiceRangeLocked || this.getLearningSessionKind() !== 'free';
		this.syncFloatingNavigationAlignment();
		if (!this.floatingNavigationResizeObserver && typeof ResizeObserver !== 'undefined') {
			const workarea = document.getElementById('exam-workarea');
			if (workarea) {
				this.floatingNavigationResizeObserver = new ResizeObserver(() => {
					this.syncFloatingNavigationAlignment();
				});
				this.floatingNavigationResizeObserver.observe(workarea);
			}
		}

		const selectSlots: Array<[string, string]> = [
			['exam-family-select', 'family'],
			['exam-level-select', 'level'],
			['exam-paper-select', 'paper'],
			['exam-mode-select', 'mode']
		];
		for (const [id, slotName] of selectSlots) {
			const element = document.getElementById(id);
			const slot = settings.querySelector(`[data-exam-setting-slot="${slotName}"]`);
			if (element && slot && element.parentElement !== slot) slot.appendChild(element);
		}
		const assists = document.getElementById('learning-tools-control');
		const assistsSlot = settings.querySelector('[data-exam-setting-slot="assists"]');
		if (assists && assistsSlot && assists.parentElement !== assistsSlot) assistsSlot.appendChild(assists);
		settings.classList.add('is-compact');
	}

	private taskNavigationObserver: ResizeObserver | null = null;
	private toggleTaskSessionDetails(open?: boolean, restoreFocus = false) {
		const panel = document.getElementById('task-session-panel');
		const toggle = document.querySelector<HTMLButtonElement>('#question-navigation .task-details-toggle');
		if (!panel || !toggle) return;
		const expanded = open ?? panel.hidden;
		panel.hidden = !expanded;
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute('aria-label', expanded ? '收起练习详情' : '展开练习详情');
		if (!expanded && restoreFocus) toggle.focus();
	}

	private syncFloatingNavigationAlignment() {
		const taskPaper = document.getElementById('current-question-container');
		if (taskPaper && !this.taskNavigationObserver) {
			this.taskNavigationObserver = new ResizeObserver(() => this.syncFloatingNavigationAlignment());
			this.taskNavigationObserver.observe(taskPaper);
			const navigation = document.getElementById('question-navigation');
			if (navigation) this.taskNavigationObserver.observe(navigation);
		}
		const taskBox = taskPaper?.getBoundingClientRect();
		if (taskBox && taskBox.width > 0) {
			// Align with the stem's content column; short option grids have their own inset.
			const contentBox = taskPaper?.querySelector('.question-content')?.getBoundingClientRect();
			const left = contentBox && contentBox.width > 0 ? contentBox.left : taskBox.left + 16;
			const right = contentBox && contentBox.width > 0 ? contentBox.right : taskBox.right - 16;
			document.documentElement.style.setProperty('--exam-task-center', `${(left + right) / 2}px`);
			document.documentElement.style.setProperty('--exam-task-width', `${Math.max(0, right - left)}px`);
		}
		const navigation = document.getElementById('question-navigation');
		if (navigation?.classList.contains('task-navigation') && navigation.getClientRects().length) {
			const bottom = Math.max(0, Number.parseFloat(getComputedStyle(navigation).bottom) || 0);
			const clearance = Math.ceil(navigation.getBoundingClientRect().height + bottom + 16);
			document.documentElement.style.setProperty('--exam-task-clearance', `${clearance}px`);
		}
		const commandBar = document.getElementById('exam-command-bar');
		if (commandBar) {
			const paper = document.body.classList.contains('learning-shell-active')
				? document.querySelector('#current-question-container .current-question')
				: null;
			const paperBox = paper?.getBoundingClientRect();
			const accountButton = document.getElementById('user-menu-trigger');
			const accountBox = accountButton?.getBoundingClientRect();
			const alignmentRight = paperBox && paperBox.width > 0
				? paperBox.right - 8
				: accountBox && accountBox.width > 0
					? accountBox.right
					: commandBar.getBoundingClientRect().right;
			const rightOffset = Math.max(0, window.innerWidth - alignmentRight);
			document.documentElement.style.setProperty('--exam-floating-right-offset', `${rightOffset}px`);
		}
	}

	renderQuestionNavigation() {
		this.categoryNavigationManager.syncActiveCategory();
		const container = DOMUtils.safeGetElement("question-navigation", "renderQuestionNavigation");
		if (!container || !this.currentExam) return;

		DOMUtils.safeSetInnerHTML(container, "", "renderQuestionNavigation-clear");

		// 渲染底部导航按钮
		const currentCategory = this.getCurrentCategory();
		if (!currentCategory) { return; }

		const baseNavigationData = this.calculateNavigationData(currentCategory);
		if (this.getLearningSessionKind() === 'diagnostic') {
			const sections = this.currentExam.exam_info.sections;
			baseNavigationData.currentQuestionNumber = sections.slice(0, this.currentSectionIndex).reduce((sum, section) => sum + (section.questions?.length || 0), 0) + this.currentQuestionIndex + 1;
			baseNavigationData.totalQuestions = sections.reduce((sum, section) => sum + (section.questions?.length || 0), 0);
		}
		if (this.examMode === 'practice' && this.practiceScope) {
			const questions = this.getPracticeQuestions();
			baseNavigationData.currentQuestionNumber = questions.findIndex(item => item.sectionIndex === this.currentSectionIndex && item.questionIndex === this.currentQuestionIndex) + 1;
			baseNavigationData.totalQuestions = questions.length;
		}
		const navigationData = {
			...baseNavigationData,
			isFinalExamQuestion: baseNavigationData.isQuestionSelected
				&& !this.navigationManager.calculateNextPosition('next')
		};
		if (this.specialtyPractice) {
			navigationData.currentQuestionNumber = this.specialtyPractice.index + 1;
			navigationData.totalQuestions = this.specialtyPractice.questions.length;
			navigationData.isFinalExamQuestion = this.specialtyPractice.index === this.specialtyPractice.questions.length - 1;
		}
		const navElement = this.createNavigationElement(navigationData);

		container.appendChild(navElement);
		container.classList.add('task-navigation');
		this.updateTaskNavigationProgress();
		this.syncFloatingNavigationAlignment();
	}


	/**
	 * 渲染答题卡（按分类显示）
	 */
	renderAnswerCard(container: HTMLElement) {
		if (!this.currentExam) {
			return;
		}
		const categories = this.getCategories();
		const sections = this.currentExam.exam_info?.sections || [];

		categories.forEach(category => {
			if (category.sectionIndexes.length === 0) { return; }

			// 创建分类容器
			const categoryDiv = document.createElement('div');
			categoryDiv.className = 'answer-card-category';

			// 分类标题
			const categoryTitle = document.createElement('div');
			categoryTitle.className = 'answer-card-category-title';
			categoryTitle.textContent = category.label;
			categoryDiv.appendChild(categoryTitle);

			// 遍历该分类下的所有 section
			category.sectionIndexes.forEach(sectionIndex => {
				const section = sections[sectionIndex];
				if (!section || !section.questions || section.questions.length === 0) { return; }

				// 创建 section 容器
				const sectionDiv = document.createElement('div');
				sectionDiv.className = 'answer-card-section';

				// 提取 section 标题中的"問題X"部分
				const sectionTitle = section.section_title || '';
				const match = sectionTitle.match(/問題\d+/);
				const sectionLabel = match ? match[0] : '';

				if (sectionLabel) {
					const sectionLabelDiv = document.createElement('span');
					sectionLabelDiv.className = 'answer-card-section-label';
					sectionLabelDiv.textContent = sectionLabel;
					sectionDiv.appendChild(sectionLabelDiv);
				}

				// 题号容器
				const questionsDiv = document.createElement('div');
				questionsDiv.className = 'answer-card-questions';

				// 渲染每道题的编号
				section.questions.forEach((question: ExamViewerQuestion, qIndex: number) => {
					const questionBtn = document.createElement('button');
					questionBtn.className = 'answer-card-question-btn';
					questionBtn.textContent = String(qIndex + 1);
					questionBtn.dataset.sectionIndex = String(sectionIndex);
					if (this.expiredSectionIndexes.has(sectionIndex)) questionBtn.classList.add('section-expired');
					if (this.examMode === 'mock' && !this.allowsEarlySectionAdvance() && sectionIndex > this.currentSectionIndex) questionBtn.classList.add('section-locked');

					// 标记当前题目
					if (sectionIndex === this.currentSectionIndex && qIndex === this.currentQuestionIndex) {
						questionBtn.classList.add('current');
					}

					// 标记已答题目
					let answerValue: unknown = this.userAnswers[String(question.id)];
					try {
						answerValue = this.answerManager.getAnswerComposite(sectionIndex, String(question.id));
					} catch {
						// Keep legacy direct lookup fallback.
					}
					if (answerValue !== undefined && answerValue !== null) {
						questionBtn.classList.add('answered');
					}

					// 点击跳转到该题
					questionBtn.addEventListener('click', () => {
						this.jumpToQuestion(sectionIndex, qIndex);
					});

					questionsDiv.appendChild(questionBtn);
				});

				sectionDiv.appendChild(questionsDiv);
				categoryDiv.appendChild(sectionDiv);
			});

			container.appendChild(categoryDiv);
		});
	}

	/**
	 * 跳转到指定题目
	 */
	jumpToQuestion(sectionIndex: number, questionIndex: number, persistPosition = true) {
		if (!this.currentExam) {
			return;
		}
		if (!this.currentExam.exam_info.sections[sectionIndex]?.questions?.[questionIndex]) return;
		if (this.specialtyPractice) {
			const questionId = String(this.currentExam.exam_info.sections[sectionIndex]?.questions?.[questionIndex]?.id || '');
			const index = this.specialtyPractice.questions.findIndex(ref => ref.examId === this._currentExamId && ref.questionId === questionId && (ref.sectionIndex === undefined || ref.sectionIndex === sectionIndex));
			if (index < 0) return;
			if (index !== this.specialtyPractice.index) this.commitSpecialtyAnswer();
			this.specialtyPractice.index = index;
			this.showAnswers = this.specialtyReview || this.specialtyRevealed.has(this.specialtyQuestionKey(this.specialtyPractice.questions[index])); this.showExplanations = this.showAnswers;
			if (this.showAnswers) this.enableAllSpecialtyAssists();
		}
		if (!this.canNavigateToSection(sectionIndex)) return;
		if (this.wrongCorrectionContext
			&& (sectionIndex !== this.wrongCorrectionContext.sectionIndex || questionIndex !== this.wrongCorrectionContext.questionIndex)) return;
		// 停止所有正在播放的音频
		this.audioManager.stopAllAudio();

		this.currentSectionIndex = sectionIndex;
		this.currentQuestionIndex = questionIndex;

		// 更新分类
		const section = this.currentExam.exam_info.sections[sectionIndex];
		if (section && section.section_type) {
			this.currentCategory = this.resolveCategoryIdForSection(section) || this.currentCategory;
		}

		// 重新渲染
		this.renderControls();
		this.questionRenderer.renderCurrentQuestion();
		this.renderQuestionNavigation();
		this.renderWrongQuestionCorrectionBar();
		if (persistPosition) this.answerManager.saveCurrentDraft();
	}

	beginWrongQuestionCorrection(context: WrongCorrectionContext): void {
		this.wrongCorrectionContext = { ...context };
		this.wrongCorrectionSubmission = createUuid();
		this.wrongCorrectionResult = null;
		this.wrongCorrectionSubmitting = false;
		this.wrongCorrectionLoadPending = true;
		this.hideLearningAssists();
		this.isSubmitted = false;
		document.getElementById('exam-workarea')?.classList.add('is-wrong-correction');
	}

	clearWrongQuestionCorrection(): void {
		this.wrongCorrectionContext = null;
		this.wrongCorrectionResult = null;
		this.wrongCorrectionSubmitting = false;
		this.wrongCorrectionLoadPending = false;
		document.getElementById('wrong-correction-bar')?.remove();
		document.getElementById('exam-workarea')?.classList.remove('is-wrong-correction');
	}

	private renderWrongQuestionCorrectionBar(): void {
		document.getElementById('wrong-correction-bar')?.remove();
		const context = this.wrongCorrectionContext;
		const container = document.getElementById('current-question-container');
		if (!context || !container) return;
		document.getElementById('exam-workarea')?.classList.add('is-wrong-correction');

		const bar = document.createElement('section');
		bar.id = 'wrong-correction-bar';
		bar.className = `wrong-correction-bar${this.wrongCorrectionResult ? (this.wrongCorrectionResult.correct ? ' is-correct' : ' is-wrong') : ''}`;
		const result = this.wrongCorrectionResult;
		const status = result
			? result.correct
				? `<div class="wrong-correction-result"><strong>订正正确</strong><span>${result.mastered ? '已连续答对 2 次，这道题已掌握。' : '今天的订正已完成，之后会再安排复习。'}</span></div>`
				: '<div class="wrong-correction-result"><strong>这次没有答对</strong><span>请查看正确选项和解析，理解后再做一次。</span></div>'
			: '<div class="wrong-correction-result"><strong>重新独立作答</strong><span>选择答案后提交订正。</span></div>';
		const actions = result
			? result.correct
				? `${context.hasNext ? '<button type="button" class="wrong-correction-primary" data-correction-action="next">下一题</button>' : ''}<button type="button" data-correction-action="return">返回今日</button>`
				: '<button type="button" class="wrong-correction-primary" data-correction-action="retry">再做一次</button><button type="button" data-correction-action="return">返回今日</button>'
			: `<button type="button" class="wrong-correction-primary" data-correction-action="submit"${this.wrongCorrectionSubmitting ? ' disabled' : ''}>${this.wrongCorrectionSubmitting ? '正在判定…' : '提交订正'}</button><button type="button" data-correction-action="return">返回今日</button>`;
		bar.innerHTML = `<div class="wrong-correction-head"><span>错题订正</span><em>${context.position}/${context.total}</em></div>${status}<div class="wrong-correction-actions">${actions}</div>`;
		container.insertAdjacentElement('afterend', bar);
		bar.querySelectorAll<HTMLButtonElement>('[data-correction-action]').forEach((button) => {
			button.addEventListener('click', () => {
				const action = button.dataset.correctionAction;
				if (action === 'submit') void this.submitWrongQuestionCorrection();
				else if (action === 'retry') this.retryWrongQuestionCorrection();
				else if (action === 'next') window.dispatchEvent(new CustomEvent('wrongCorrectionNext'));
				else if (action === 'return') {
					this.clearWrongQuestionCorrection();
					window.dispatchEvent(new CustomEvent('wrongCorrectionReturn'));
				}
			});
		});
	}

	private async submitWrongQuestionCorrection(): Promise<void> {
		const context = this.wrongCorrectionContext;
		if (!context || this.wrongCorrectionSubmitting) return;
		const answer = this.answerManager?.getAnswerComposite?.(context.sectionIndex, context.actualQuestionId);
		if (answer === undefined || answer === null || answer === '') {
			showAppToast('请先选择答案');
			return;
		}
		const api = window.APIClient;
		if (!api?.submitWrongQuestionCorrection) return;
		this.wrongCorrectionSubmitting = true;
		this.renderWrongQuestionCorrectionBar();
		try {
			this.wrongCorrectionResult = await api.submitWrongQuestionCorrection(context.userId, context.questionId, {
				submission_id: this.wrongCorrectionSubmission,
				exam_id: context.examId,
				actual_question_id: context.actualQuestionId,
				section_index: context.sectionIndex,
				answer,
				exam_target: context.examTarget
			}) as WrongCorrectionResult;
			const question = this.currentExam?.exam_info?.sections?.[context.sectionIndex]?.questions?.[context.questionIndex];
			if (question && this.wrongCorrectionResult.correct_answer !== undefined) {
				const normalized = Number(this.wrongCorrectionResult.correct_answer);
				question.correct_answer = Number.isFinite(normalized) ? normalized : this.wrongCorrectionResult.correct_answer;
			}
			this.showAnswers = true;
			this.showExplanations = true;
			this.isSubmitted = true;
			this.enableAllSpecialtyAssists();
			this.renderExam();
			window.dispatchEvent(new CustomEvent('wrongCorrectionSubmitted', { detail: { ...this.wrongCorrectionResult, questionId: context.questionId } }));
		} catch (error) {
			const message = (error as { message?: string } | null)?.message || '订正提交失败，请重试';
			showAppToast(message);
		} finally {
			this.wrongCorrectionSubmitting = false;
			this.renderWrongQuestionCorrectionBar();
			document.getElementById('wrong-correction-bar')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}

	private retryWrongQuestionCorrection(): void {
		const context = this.wrongCorrectionContext;
		if (!context) return;
		this.wrongCorrectionSubmission = createUuid();
		this.answerManager?.setAnswerComposite?.(context.sectionIndex, context.actualQuestionId, null);
		this.wrongCorrectionResult = null;
		this.hideLearningAssists();
		this.isSubmitted = false;
		this.renderExam();
		this.renderWrongQuestionCorrectionBar();
	}

	calculateNavigationData(currentCategory: CategoryItem | null) {
		if (!this.currentExam) {
			return {
				currentQuestionNumber: 0,
				totalQuestions: 0,
				isQuestionSelected: false,
				isFirstQuestion: false,
				isLastQuestion: false
			};
		}

		this.logger.debug('calculateNavigationData called:', {
			categoryId: currentCategory?.id ?? null,
			sectionIndexes: currentCategory?.sectionIndexes ?? [],
			currentSectionIndex: this.currentSectionIndex,
			currentCategory: this.currentCategory
		});

		const totalQuestions = this.getTotalQuestionsInCategory();
		let currentQuestionNumber = 0;

		if (currentCategory) {
			let passed = 0;
			for (let i = 0; i < currentCategory.sectionIndexes.length; i++) {
				const sIdx = currentCategory.sectionIndexes[i];
				const section = this.currentExam.exam_info.sections[sIdx];
				if (sIdx === this.currentSectionIndex) {
					currentQuestionNumber = passed + this.currentQuestionIndex + 1;
					this.logger.debug('Found current section:', { index: i, questionNumber: currentQuestionNumber });
					break;
				}
				if (section?.questions) { passed += section.questions.length; }
			}

			if (currentQuestionNumber === 0) {
				this.logger.warn('Current section not found in category!', {
					lookingFor: this.currentSectionIndex,
					categorySectionIndexes: currentCategory.sectionIndexes
				});
			}
		}

		return {
			currentQuestionNumber,
			totalQuestions,
			isQuestionSelected: currentQuestionNumber > 0,
			isFirstQuestion: currentQuestionNumber === 1,
			isLastQuestion: currentQuestionNumber === totalQuestions
		};
	}

	createNavigationElement(data: LegacyAnyRecord) {
		const navDiv = DOMUtils.createElementWithClass("div", "question-nav");
		navDiv.classList.add('task-nav');
		navDiv.setAttribute('role', 'navigation');
		navDiv.setAttribute('aria-label', this.specialtyReview || this.savedPracticeMode === 'review' ? '题目回顾操作' : '答题操作');
		document.getElementById('specialty-question-feedback')?.remove();
		document.getElementById('specialty-question-source')?.remove();
		document.getElementById('specialty-practice-mode')?.remove();
		document.getElementById('specialty-last-feedback')?.remove();
		document.getElementById('task-check-answer')?.remove();
		if (this.specialtyPractice) navDiv.classList.add('specialty-nav');
		const isFinalExamQuestion = data.isFinalExamQuestion === true;

		const prevBtn = this.createNavigationButton({
			className: "nav-btn prev-btn",
			text: "上一题",
			disabled: this.specialtyPractice ? this.specialtyPractice.index === 0 : !this.navigationManager.calculateNextPosition('prev'),
			onClick: () => {
				this.logger.debug('Right-bottom prev button clicked');
				this.navigateToPreviousQuestion();
			}
		});

		const nextBtn = this.createNavigationButton({
			className: `nav-btn next-btn${isFinalExamQuestion ? ' finish-btn' : ''}`,
			text: isFinalExamQuestion ? (this.specialtyPractice ? (this.specialtyReview ? '最后一题' : this.specialtyEntryMode === 'assignment' ? '提交作业' : '完成练习') : this.savedPracticeMode === 'review' ? '最后一题' : this.examMode === 'mock' ? '检查并提交' : '完成练习') : "下一题",
			disabled: isFinalExamQuestion && (this.specialtyReview || this.savedPracticeMode === 'review'),
			onClick: () => {
				if (isFinalExamQuestion) {
					this.finishPractice();
					return;
				}
				this.navigateToNextQuestion();
			}
		});

		const compactCounter = !this.practiceScope;
		const counter = this.createNavigationButton({
			className: 'question-counter',
			text: compactCounter ? `${data.currentQuestionNumber} / ${data.totalQuestions}` : `第${data.currentQuestionNumber}题/共${data.totalQuestions}题`,
			onClick: () => {
				this.toggleTaskSessionDetails(false);
				counter.focus();
				this.questionMapManager.showQuestionMap();
			}
		});
		counter.type = 'button';
		counter.title = '打开答题卡，选择题目跳转';
		counter.setAttribute('aria-haspopup', 'dialog');
		counter.setAttribute('aria-controls', 'question-map-overlay');
		if (compactCounter) counter.setAttribute('aria-label', `第${data.currentQuestionNumber}题，共${data.totalQuestions}题`);

		if (this.examMode === 'practice' && !this.wrongCorrectionContext) {
			const question = this.currentExam?.exam_info.sections[this.currentSectionIndex]?.questions?.[this.currentQuestionIndex];
			const answer = question && this.answerManager.getAnswerComposite(this.currentSectionIndex, String(question.id));
			const answered = Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && answer !== '';
			const correctAnswer = question?.correct_answer;
			const hasCorrectAnswer = Array.isArray(correctAnswer) ? correctAnswer.length > 0 : correctAnswer !== undefined && correctAnswer !== null && correctAnswer !== '';
			const checked = this.isCurrentPracticeQuestionChecked();
			if (this.specialtyPractice) {
				const outcome = this.specialtyOutcomes.get(this.specialtyQuestionKey(this.specialtyPractice.questions[this.specialtyPractice.index]));
				const feedback = document.createElement('div');
				feedback.id = 'specialty-question-feedback'; feedback.className = 'specialty-question-feedback';
				if (this.specialtyReview) {
					feedback.setAttribute('role', 'status');
					const grade = this.specialtyReturnContext?.manualScore;
					feedback.textContent = this.specialtyEntryMode === 'assignment' ? `作业已提交${typeof grade === 'number' && grade >= 0 ? ` · 老师评分：${grade}%` : ''}${this.specialtyReturnContext?.teacherComment ? ` · 老师评语：${this.specialtyReturnContext.teacherComment}` : ' · 可查看答案与解析'}` : this.specialtyEntryMode === 'correct' ? '此前答对 · 正确答案已标绿' : '练习回顾 · 不更新练习统计';
				} else if (this.specialtyEntryMode === 'assignment') {
					feedback.textContent = `${this.specialtyReturnContext?.teacherComment ? `老师退回：${this.specialtyReturnContext.teacherComment} · ` : ''}作答会自动暂存，提交作业后可查看答案与解析。`;
				} else if (outcome && this.showAnswers) {
					feedback.setAttribute('role', 'status');
					feedback.classList.add(outcome.status === 'correct' ? 'is-correct' : outcome.status === 'wrong' ? 'is-wrong' : 'is-viewed');
					feedback.textContent = outcome.viewed ? '仅查看答案 · 不计作答，不计入正确率' : outcome.status === 'correct' ? (this.specialtyEntryMode === 'wrong' ? '✓ 本次答对了' : '✓ 答对了') : outcome.status === 'wrong' ? (this.specialtyEntryMode === 'wrong' ? '✕ 仍需巩固，看看下面的解析' : '✕ 答错了，看看下面的解析') : '已作答 · 本题需自行对照答案';
				} else {
					feedback.append(document.createTextNode(outcome ? '本次作答已记录 · ' : '选择答案后，点下一题保存 · '));
					const confirm = this.createNavigationButton({ className: 'specialty-confirm-answer', text: outcome ? '查看解析' : '确认并查看解析', disabled: !answered && !outcome,
						onClick: () => { if (!this.confirmSpecialtyAnswerForReview()) return; this.enableAllSpecialtyAssists(); this.renderExam(); this.loadTranslationsForReadingAssist(); } });
					confirm.title = confirm.disabled ? '请先选择答案' : '确认后将锁定本次作答，并显示答案和解析';
					feedback.append(confirm);
				}
				const host = document.getElementById('current-question-container');
				const info = this.getSpecialtySessionInfo();
				const source = document.createElement('p'); source.id = 'specialty-question-source'; source.className = 'specialty-question-source'; source.textContent = `本题来源：${this.currentPaperSourceTitle()}`;
				if (!info) host?.querySelector('.current-question')?.prepend(source);
				const previous = this.specialtyPreviousFeedback;
				if (!this.specialtyReview && previous && previous.index !== this.specialtyPractice.index) {
					const hint = document.createElement('p'); hint.id = 'specialty-last-feedback'; hint.className = `specialty-last-feedback is-${previous.status}`; hint.setAttribute('role', 'status');
					hint.textContent = previous.status === 'correct' ? '上一题答对了' : '上一题答错了 · ';
					if (previous.status === 'wrong') {
						const link = this.createNavigationButton({ className: 'specialty-answer-link', text: '查看解析', onClick: () => {
							const session = this.specialtyPractice;
							if (!session || this.specialtyLoading || this.specialtySaving) return;
							this.commitSpecialtyAnswer();
							const ref = session.questions[previous.index];
							this.specialtyRevealed.add(this.specialtyQuestionKey(ref));
							this.specialtyPreviousFeedback = null;
							void this.openSpecialtyPosition({ ...session, index: previous.index }).catch(error => showAppToast(error instanceof Error ? error.message : '读取解析失败'));
						} });
						hint.append(link);
					}
					host?.querySelector('.current-question')?.prepend(hint);
				}
				const options = host?.querySelector('.options-container');
				if (options) options.after(feedback); else host?.append(feedback);
			} else if (this.savedPracticeMode !== 'review') {
				const check = this.createNavigationButton({ className: 'nav-btn check-btn', text: checked ? (this.answerManager.evaluateQuestionAnswer(this.currentSectionIndex, this.currentQuestionIndex) ? '回答正确' : '回答错误') : '检查答案', disabled: checked,
					onClick: () => {
					if (!answered) { showAppToast('请先选择答案'); return; }
					if (!hasCorrectAnswer) { showAppToast('本题暂无可核对的标准答案'); return; }
					this.audioManager.stopAllAudio();
					this.checkedPracticeQuestions.add(`${this.currentSectionIndex}:${question!.id}`);
					this.renderExam();
				} });
				const feedback = document.createElement('div'); feedback.id = 'task-check-answer'; feedback.className = 'task-check-answer'; feedback.append(check);
				const host = document.getElementById('current-question-container');
				const options = host?.querySelector('.options-container');
				if (options) options.after(feedback); else host?.querySelector('.current-question')?.append(feedback);
			}
			if (this.practiceScope) {
				const answeredCount = this.getPracticeQuestions().filter(item => { const value = this.answerManager.getAnswerComposite(item.sectionIndex, String(item.question.id)); return value !== undefined && value !== null && value !== ''; }).length;
				counter.textContent = this.specialtyPractice ? `${data.currentQuestionNumber} / ${data.totalQuestions}` : `${this.practiceScope.label} · 第${data.currentQuestionNumber}/${data.totalQuestions}题 · 已答${answeredCount}/${data.totalQuestions}`;
				if (this.specialtyPractice) counter.setAttribute('aria-label', `第${data.currentQuestionNumber}题，共${data.totalQuestions}题`);
			}
		}
		const paging = DOMUtils.createElementWithClass('div', 'task-paging');
		paging.setAttribute('role', 'group');
		paging.setAttribute('aria-label', '题目翻页');
		paging.append(counter, prevBtn, nextBtn);
		const panel = DOMUtils.createElementWithClass('div', 'task-session-panel');
		panel.id = 'task-session-panel';
		panel.hidden = true;
		panel.setAttribute('role', 'region');
		panel.setAttribute('aria-label', '本次练习详情');
		let exitButton: HTMLButtonElement | null = null;
		if (!this.specialtyPractice && this.examMode === 'practice' && this.practiceScope && !this.wrongCorrectionContext && this.savedPracticeMode !== 'review') {
			exitButton = this.createNavigationButton({ className: 'nav-btn end-practice-btn', text: '结束练习', onClick: () => { this.toggleTaskSessionDetails(false); this.finishPractice(); } });
		}
		if (this.specialtyPractice) {
			exitButton = this.createNavigationButton({ className: 'nav-btn exit-specialty-btn', text: this.specialtyReview ? (this.specialtyReturnContext?.surface === 'assignment' ? '返回我的作业' : this.specialtyReturnContext?.surface === 'system' ? '返回系统学习' : this.specialtyReturnContext?.surface === 'paper' ? '返回真题模式' : '返回专项') : this.specialtySaving ? '正在保存…' : this.specialtyEntryMode === 'assignment' ? '提交作业' : '结束练习', onClick: () => { this.toggleTaskSessionDetails(false); void this.finishSpecialtyPractice(); } });
		}
		const details = document.createElement('div'); details.className = 'task-details';
		const mark = document.createElement('span'); mark.className = 'task-mark'; mark.setAttribute('aria-hidden', 'true');
		mark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h7v16H4zM13 4h7v16h-7zM11 6h2"/></svg>';
		const titleLine = document.createElement('div'); titleLine.className = 'task-title-line';
		const title = document.createElement('strong'); title.className = 'task-title';
		const specialtyInfo = this.getSpecialtySessionInfo();
		title.textContent = specialtyInfo ? (specialtyInfo.label.startsWith(specialtyInfo.target) ? specialtyInfo.label : `${specialtyInfo.target} · ${specialtyInfo.label}`) : this.specialtyPractice?.label || this.practiceScope?.label || this.currentPaperSourceTitle();
		title.title = title.textContent;
		const mode = document.createElement('span'); mode.className = 'task-mode';
		if (this.specialtyPractice) {
			mode.id = 'specialty-practice-mode';
			mode.textContent = this.getSpecialtySessionInfo()?.mode || (this.specialtyReview ? '练习回顾' : this.specialtyEntryMode === 'paper' ? '题组练习' : '专项练习');
		} else mode.textContent = this.savedPracticeMode === 'review' || this.isSubmitted ? '回顾' : this.examMode === 'mock' ? '考试' : '练习';
		const progress = document.createElement('span'); progress.className = 'task-progress';
		titleLine.append(title, mode); details.append(mark, titleLine, progress);
		const panelHead = DOMUtils.createElementWithClass('div', 'task-panel-head');
		const closePanel = this.createNavigationButton({ className: 'nav-btn task-panel-close', text: '收起', onClick: () => this.toggleTaskSessionDetails(false, true) });
		closePanel.setAttribute('aria-label', '收起练习详情');
		panelHead.append(details, closePanel);
		counter.textContent = `${data.currentQuestionNumber} / ${data.totalQuestions}`;
		counter.setAttribute('aria-label', `第${data.currentQuestionNumber}题，共${data.totalQuestions}题，点击跳转题目`);
		panel.append(panelHead);
		if (specialtyInfo) {
			const question = this.currentExam?.exam_info.sections[this.currentSectionIndex]?.questions?.[this.currentQuestionIndex];
			const originalNumber = this.isEjuExam() ? question?.eju_question_no ?? question?.eju_answer_no ?? question?.id : question?.id;
			const source = document.createElement('p'); source.id = 'specialty-question-source'; source.className = 'task-source'; source.textContent = `本题来源：${this.currentPaperSourceTitle()}${originalNumber != null ? ` · 第${originalNumber}题` : ''}`;
			panel.append(source);
		}
		const detailsToggle = this.createNavigationButton({ className: 'nav-btn task-details-toggle', text: '', onClick: () => this.toggleTaskSessionDetails() });
		detailsToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h8"/><path class="task-menu-arrow" d="m16 15 5 3-5 3z"/></svg>';
		detailsToggle.title = '练习详情';
		detailsToggle.setAttribute('aria-expanded', 'false');
		detailsToggle.setAttribute('aria-controls', panel.id);
		detailsToggle.setAttribute('aria-label', '展开练习详情');
		const utilities = DOMUtils.createElementWithClass('div', 'task-utilities');
		utilities.setAttribute('role', 'group');
		utilities.setAttribute('aria-label', '本次练习操作');
		utilities.append(detailsToggle);
		if (exitButton) {
			const exitLabel = exitButton.textContent || '结束练习';
			exitButton.title = exitLabel;
			exitButton.setAttribute('aria-label', exitLabel);
			exitButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h10"/></svg>';
			utilities.append(exitButton);
		}
		navDiv.append(utilities, paging, panel);

		return navDiv;
	}

	createNavigationButton({ className, text, disabled, onClick }: NavigationButtonConfig) {
		const button = document.createElement('button');
		button.className = className;
		button.textContent = text;
		button.disabled = Boolean(disabled || (this.specialtyPractice && this.specialtySaving));
		button.addEventListener('click', onClick);
		return button;
	}

	renderAnswerPanel() {
		const panel = document.getElementById("answer-panel");
		if (!panel) {
			return;
		}

		panel.innerHTML = `
			<h3>答题情况</h3>
			<div id="answer-summary"></div>
		`;
	}

	getAnswerText(answerIndex: number, options: string[] | undefined) {
		if (!options || !Array.isArray(options) || answerIndex < 0 || answerIndex >= options.length) {
			return 'N/A';
		}
		const letter = String.fromCharCode(65 + answerIndex);
		return `${letter}. ${options[answerIndex]}`;
	}

	getCategories() {
		if (!this.currentExam) { return []; }

		const sections = this.currentExam.exam_info?.sections || [];
		const orderedCategories: CategoryItem[] = [];
		const categoryMap = new Map<string, CategoryItem>();

		sections.forEach((section: ExamViewerSection, index: number) => {
			if ((section as LegacyAnyRecord).diagnostic_excluded) return;
			const resolved = this.resolveCategoryForSection(section, index);
			if (!resolved) {
				return;
			}
			const existing = categoryMap.get(resolved.id);
			if (existing) {
				existing.sectionIndexes.push(index);
				return;
			}
			const nextCategory: CategoryItem = {
				id: resolved.id,
				label: resolved.label,
				sectionIndexes: [index]
			};
			categoryMap.set(resolved.id, nextCategory);
			orderedCategories.push(nextCategory);
		});

		return orderedCategories;
	}

	canNavigateToSection(sectionIndex: number): boolean {
		if (this.practiceRangeLocked && this.practiceScope && !this.practiceScope.sectionIndexes.includes(sectionIndex)) return false;
		if (this.examMode !== 'mock' || this.isSubmitted) return true;
		if (this.expiredSectionIndexes.has(sectionIndex)) {
			this.setAnswerSaveStatus('failed', `第 ${sectionIndex + 1} 部分已结束，不能返回修改`);
			return false;
		}
		if (!this.allowsEarlySectionAdvance() && sectionIndex > this.currentSectionIndex) {
			this.setAnswerSaveStatus('failed', '当前考试不允许提前进入下一部分');
			return false;
		}
		return true;
	}

	private allowsEarlySectionAdvance(): boolean {
		return (this.currentExam?.exam_info as LegacyAnyRecord | undefined)?.allow_early_section_advance !== false;
	}

	syncExpiredSections(sectionIndexes: number[]) {
		if (this.examMode !== 'mock' || this.isSubmitted) return;
		sectionIndexes.forEach((index) => {
			if (Number.isInteger(index) && index >= 0) this.expiredSectionIndexes.add(index);
		});
		this.renderExpiredSectionMarkers();
	}

	private renderExpiredSectionMarkers() {
		document.querySelectorAll<HTMLElement>('.answer-card-question-btn[data-section-index]').forEach((button) => {
			const sectionIndex = Number(button.dataset.sectionIndex);
			button.classList.toggle('section-expired', this.expiredSectionIndexes.has(sectionIndex));
		});
	}

	onSectionExpired(sectionIndex: number) {
		if (this.examMode !== 'mock' || this.isSubmitted || sectionIndex !== this.currentSectionIndex) return;
		this.expiredSectionIndexes.add(sectionIndex);
		const sections = this.currentExam?.exam_info?.sections || [];
		for (let next = sectionIndex + 1; next < sections.length; next += 1) {
			if (sections[next]?.questions?.length) {
				this.currentSectionIndex = next;
				this.currentQuestionIndex = 0;
				this.currentCategory = this.resolveCategoryIdForSection(sections[next]) || this.currentCategory;
				this.setAnswerSaveStatus('saving', `第 ${sectionIndex + 1} 部分已结束，已进入下一部分`);
				this.renderExam();
				return;
			}
		}
		this.setAnswerSaveStatus('saving', '最后一部分时间已用完，正在自动交卷…');
		this.submitAnswers({ automatic: true });
	}

	getCurrentCategory() {
		const categories = this.getCategories();
		const result = categories.find(cat => cat.id === this.currentCategory) || categories[0] || null;
		this.logger.debug('getCurrentCategory called:', {
			currentCategory: this.currentCategory,
			foundCategory: result
		});
		return result;
	}

	resolveCategoryIdForSection(section: ExamViewerSection) {
		return this.resolveCategoryForSection(section, -1)?.id ?? null;
	}

	resolveCategoryForSection(section: ExamViewerSection, sectionIndex: number) {
		const rawType = String(section.section_type || '').trim();
		const normalizedType = rawType.toLowerCase();
		if (normalizedType) {
			if (this.isEjuExam()) {
				// EJU 的記述通常只有一题，与読解合并为同一个入口；
				// 下拉菜单仍保留两部分内的全部题目和精确跳转。
				if (normalizedType === 'writing' || normalizedType === 'reading') {
					return { id: 'writing_reading', label: '記述/読解' };
				}
				const labels: Record<string, string> = {
					listening_reading: '読聴解',
					listeningreading: '読聴解',
					listening: '聴解'
				};
				return {
					id: this.normalizeCategoryId(normalizedType),
					label: labels[normalizedType] || section.section_name || section.section_title || normalizedType
				};
			}
			return {
				id: this.normalizeCategoryId(normalizedType),
				label: this.getCategoryLabel(normalizedType, section.section_name || section.section_title || '')
			};
		}

		const numericSectionId = Number(section.section_id);
		if (Number.isFinite(numericSectionId)) {
			if (numericSectionId >= 1.01 && numericSectionId <= 1.06) {
				return { id: 'vocab', label: '词汇/语法' };
			}
			if (numericSectionId >= 1.07 && numericSectionId <= 1.99) {
				return { id: 'reading', label: '阅读' };
			}
			if (Math.floor(numericSectionId) === 2) {
				return { id: 'listening', label: '听力' };
			}
		}

		const fallbackLabel = String(section.section_name || section.section_title || '').trim() || `部分 ${sectionIndex + 1}`;
		return {
			id: this.normalizeCategoryId(fallbackLabel),
			label: fallbackLabel
		};
	}

	normalizeCategoryId(value: string) {
		const aliases: Record<string, string> = {
			vocabulary: 'vocab',
			vocab: 'vocab',
			words: 'vocab',
			reading: 'reading',
			listening: 'listening',
			listening_reading: 'listening_reading',
			listeningreading: 'listening_reading',
			grammar: 'grammar',
			writing: 'writing',
			speaking: 'speaking',
			cloze: 'cloze',
			integrated: 'integrated'
		};
		const lowered = value.toLowerCase();
		if (aliases[lowered]) {
			return aliases[lowered];
		}
		return lowered.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'general';
	}

	getCategoryLabel(categoryType: string, fallback: string) {
		const labels: Record<string, string> = {
			vocabulary: '語彙/文法',
			vocab: '語彙/文法',
			reading: '読解',
			listening: '聴解',
			listening_reading: '読聴解',
			listeningreading: '読聴解',
			grammar: '文法',
			writing: '作文',
			speaking: '会話',
			cloze: '穴埋め',
			integrated: '総合'
		};
		return labels[categoryType] || fallback || categoryType;
	}

	isEjuExam() {
		const info = (this.currentExam?.exam_info || {}) as LegacyAnyRecord;
		const family = String(this.currentExam?.family || info.family || '').toLowerCase();
		return family === 'eju';
	}

	getCurrentTotalQuestionIndex() {
		let total = 0;
		const sections = this.currentExam?.exam_info?.sections || [];
		for (let i = 0; i < this.currentSectionIndex; i++) {
			total += sections[i].questions?.length || 0;
		}
		total += this.currentQuestionIndex;
		return total;
	}

	// ==================== 事件监听器系统 ====================

	initializeEventListeners() {
		this.setupGlobalEventDelegation();
		this.setupKeyboardShortcuts();
		this.syncExamSettingsLayout();
		window.addEventListener('resize', () => this.syncExamSettingsLayout());
	}

	setupGlobalEventDelegation() {
		const eventMap: Record<string, () => void> = {
			'#toggle-answers': () => this.toggleAnswers(),
			'#toggle-explanations': () => this.toggleExplanations(),
			'#toggle-reading-kana': () => this.toggleReadingKana(),
			'#toggle-reading-zh': () => this.toggleReadingZh(),
			'#open-question-map': () => this.questionMapManager.showQuestionMap(),
			'#submit-exam': () => this.submitAnswers(),
			'#mobile-paper-toggle': () => this.toggleMobilePaperSelector(),
			'#mobile-tools-toggle': () => this.toggleMobileTools(),
			'#exam-settings-toggle': () => this.toggleExamSettingsMenu(),
			'#learning-tools-toggle': () => this.toggleLearningToolsMenu(),
			'#learning-menu-answers': () => this.toggleAnswers(),
			'#learning-menu-explanations': () => this.toggleExplanations(),
			'#learning-menu-kana': () => this.toggleReadingKana(),
			'#learning-menu-zh': () => this.toggleReadingZh()
		};

		document.addEventListener('click', (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
			}
			if (!target.closest('#learning-tools-control')) {
				this.toggleLearningToolsMenu(false);
			}
			if (!target.closest('#exam-settings-control')) {
				this.toggleExamSettingsMenu(false);
			}
			if (!target.closest('#question-navigation')) this.toggleTaskSessionDetails(false);

			for (const [selector, handler] of Object.entries(eventMap)) {
				if (target.id === selector.slice(1) || target.closest(selector)) {
					handler();
					return;
				}
			}
		});
	}

	setupKeyboardShortcuts() {
		try {
			this.registerKeyboardShortcuts();
		} catch (error) {
			ErrorHandler.handle(error, 'ExamViewer', '注册键盘快捷键');
		}
	}

	registerKeyboardShortcuts() {
		if (this._kbBound) { return; }
		this._kbBound = true;

		document.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector('#exam-result-modal:not([hidden])')) { return; }

			const target = e.target as HTMLElement | null;
			const tag = target?.tagName ? target.tagName.toLowerCase() : '';
			if (tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable)) { return; }

			switch (e.key) {
				case 'ArrowLeft':
					if (!(target instanceof HTMLInputElement && target.type === 'range')) {
						e.preventDefault();
						this.navigateToPreviousQuestion();
					}
					break;
				case 'ArrowRight':
					if (!(target instanceof HTMLInputElement && target.type === 'range')) {
						e.preventDefault();
						this.navigateToNextQuestion();
					}
					break;
				case 'Escape':
					if (document.getElementById('task-session-panel')?.hidden === false) {
						e.preventDefault();
						this.toggleTaskSessionDetails(false, true);
					}
					if (this.questionMapManager.questionMapVisible) {
						e.preventDefault();
						this.questionMapManager.hideQuestionMap();
					}
					break;
			}
		});

		document.addEventListener('change', (event: Event) => {
			const target = event.target as HTMLElement | null;
			if (target?.id === 'exam-paper-select') {
				this.collapseMobilePaperSelector();
			}
		});

		document.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				this.toggleLearningToolsMenu(false);
				this.toggleExamSettingsMenu(false);
			}
		});
	}

	private initializeModeControl() {
		const select = document.getElementById('exam-mode-select') as HTMLSelectElement | null;
		if (!select) return;
		select.value = this.examMode;
		select.addEventListener('change', () => {
			const nextMode: ExamMode = select.value === 'mock' ? 'mock' : 'practice';
			select.disabled = true;
			void this.setExamMode(nextMode, true).then((changed) => {
				if (!changed) select.value = this.examMode;
			}).finally(() => {
				select.disabled = false;
				if (select.isConnected && !select.hidden) select.focus();
			});
		});
	}

	private initializeLeaveProtection() {
		window.addEventListener('beforeunload', (event) => {
			if (this.examMode !== 'mock' || this.isSubmitted || !this.currentExam) return;
			const hasAnswers = Object.values(this.userAnswers).some((answer) => answer !== null && answer !== undefined && answer !== '');
			if (!hasAnswers) return;
			event.preventDefault();
			event.returnValue = '';
		});
	}

	private initializeNetworkStatus() {
		const banner = document.getElementById('network-status-banner');
		if (!banner) return;
		let recoveryTimer: number | null = null;
		const render = (offline: boolean) => {
			if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
			banner.classList.toggle('is-offline', offline);
			banner.classList.toggle('is-online', !offline);
			banner.textContent = offline
				? '网络已断开，当前答案会保留在页面中，联网后将继续保存'
				: '网络已恢复，答案将继续同步';
			banner.hidden = false;
			if (!offline) recoveryTimer = window.setTimeout(() => { banner.hidden = true; }, 3000);
		};
		window.addEventListener('offline', () => render(true));
		window.addEventListener('online', () => render(false));
		if (!navigator.onLine) render(true);
	}

	private async restoreDraftForCurrentExam() {
		const userId = this.userId;
		const examId = this._currentExamId;
		if (!userId || userId === 'guest' || !examId || this.isSubmitted || this.savedPracticeMode || this.specialtyPractice) return;
		if (Object.values(this.userAnswers).some(answer => answer !== null && answer !== undefined && answer !== '')) return;
		const enabled = (window as Window & { isFeatureEnabled?: (key: string) => boolean }).isFeatureEnabled;
		if (enabled && !enabled('resume_draft')) return;
		const api = window.APIClient;
		if (!api || typeof api.getDraft !== 'function') return;
		const requestId = ++this._draftRestoreRequest;
		const answersAtRequest = JSON.stringify(this.userAnswers);
		try {
			let draft = await api.getDraft(userId, examId) as {
				exam_id?: string;
				exam_mode?: ExamMode;
				answers?: Record<string, unknown>;
				answered_count?: number;
				last_section_index?: number;
				last_question_index?: number;
				revision?: number;
				attempt_id?: string;
			} | null;
			// Older versions allowed incomplete diagnostic submissions. Resume their
			// independent answers into a new draft rather than discarding the work.
			if (!draft?.answers && this.getLearningSessionKind() === 'diagnostic' && api.getAnswerAttempts) {
				const attempts = await api.getAnswerAttempts(userId, examId, 1) as LegacyAnyRecord[];
				const previous = attempts?.[0];
				const results = previous?.statistics?.results || {};
				const valid = Object.values(results).filter((row: any) => ['correct', 'wrong'].includes(row?.status) && !row.viewed).length;
				const total = this.currentExam!.exam_info.sections.reduce((sum, section) => sum + (section.questions?.length || 0), 0);
				if (valid && valid < total && previous?.answers) {
					const positions = this.currentExam!.exam_info.sections.flatMap((section, sectionIndex) => (section.questions || []).map((question, questionIndex) => ({ sectionIndex, questionIndex, key: `${sectionIndex}:${question.id}`, id: String(question.id) })));
					const first = positions.find(position => !['correct', 'wrong'].includes((results[position.key] || results[position.id])?.status));
					draft = { exam_id: examId, exam_mode: 'mock', answers: previous.answers, answered_count: valid, last_section_index: first?.sectionIndex, last_question_index: first?.questionIndex };
				}
			}
			if (requestId !== this._draftRestoreRequest || this.userId !== userId || this._currentExamId !== examId
				|| this.specialtyPractice || this.savedPracticeMode || this.isSubmitted || JSON.stringify(this.userAnswers) !== answersAtRequest) return;
			if (!draft || String(draft.exam_id || '') !== examId || !draft.answers || typeof draft.answers !== 'object') return;
			if (draft.exam_mode === 'mock' || draft.exam_mode === 'practice') {
				this.examMode = draft.exam_mode;
				try { localStorage.setItem('examViewer.mode', this.examMode); } catch { }
			}
			this.answerManager.setDraftRevision?.(draft.revision);
			this.answerManager.setAttemptId?.(draft.attempt_id);
			this.applyDraftSnapshot(draft as unknown as Record<string, unknown>);
		} catch {
			// Draft restoration must never block opening a paper.
		}
	}

	applyDraftSnapshot(draft: Record<string, unknown>) {
		const answers = draft.answers;
		if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return;
		Object.assign(this.userAnswers, answers);
		if (draft.exam_mode === 'mock' || draft.exam_mode === 'practice') {
			this.examMode = this.getLearningSessionKind() === 'diagnostic' ? 'mock' : draft.exam_mode;
			try { localStorage.setItem('examViewer.mode', this.examMode); } catch { }
		}
			const sectionIndex = Math.max(0, Number(draft.last_section_index || 0));
			const questionIndex = Math.max(0, Number(draft.last_question_index || 0));
			try { this.jumpToQuestion(sectionIndex, questionIndex, false); } catch { this.renderExam(); }
			if (this.examMode === 'mock') this.hideLearningAssists();
			this.renderExam();
			const answered = Number(draft.answered_count || Object.values(answers).filter((answer) => answer !== null && answer !== undefined && answer !== '').length);
			this.setAnswerSaveStatus('saved', `已恢复 ${answered} 题`);
	}

	private readExamModePreference(): ExamMode {
		try {
			return localStorage.getItem('examViewer.mode') === 'mock' ? 'mock' : 'practice';
		} catch {
			return 'practice';
		}
	}

	private async setExamMode(mode: ExamMode, userInitiated = false): Promise<boolean> {
		if (userInitiated && (this.getLearningSessionKind() === 'diagnostic' || this.wrongCorrectionContext)) return false;
		if (userInitiated && this.savedPracticeMode) return false;
		if (mode === this.examMode) return true;
		const hasAnswers = Object.values(this.userAnswers).some((answer) => answer !== null && answer !== undefined && answer !== '');
		if (userInitiated && hasAnswers) {
			const confirmed = await requestAppConfirmation('切换作答方式会清空当前答案，是否继续？', '清空并切换');
			if (!confirmed) return false;
			this.answerManager.initializeUserAnswers();
			this.setAnswerSaveStatus('saved', '答案已清空');
		}
		this.examMode = mode;
		this.isSubmitted = false;
		try { localStorage.setItem('examViewer.mode', mode); } catch { }
		this.examTimerManager.stop();
		if (mode === 'mock') this.hideLearningAssists();
		if (this.currentExam) this.renderExam();
		if (this._currentExamId) {
			this.examTimerManager.startForExam(this._currentExamId, mode === 'mock' ? this.extractExamTimerLimits() : undefined);
		}
		return true;
	}

	private hideLearningAssists() {
		this.showAnswers = false;
		this.showExplanations = false;
		this.showReadingKana = false;
		this.showReadingZh = false;
	}

	canUseLearningAssists(): boolean {
		if (this.specialtyPractice && this.specialtyEntryMode === 'assignment') return this.specialtyReview;
		if (this.getLearningSessionKind() === 'diagnostic' || this.wrongCorrectionContext) return this.isSubmitted;
		return this.examMode === 'practice' || this.isSubmitted;
	}
	canUseReadingAssists(): boolean {
		if (!this.canUseLearningAssists()) return false;
		if (!this.specialtyPractice || this.specialtyReview) return true;
		const ref = this.specialtyPractice.questions[this.specialtyPractice.index];
		return this.specialtyRevealed.has(this.specialtyQuestionKey(ref));
	}

	private updateLearningAssistAvailability() {
		const locked = !this.canUseLearningAssists();
		const controls = document.getElementById('exam-controls');
		controls?.classList.toggle('mock-active', locked);
		controls?.classList.toggle('practice-active', this.examMode === 'practice');
		const submitButton = document.getElementById('submit-exam') as HTMLButtonElement | null;
		if (submitButton) {
			submitButton.hidden = this.examMode !== 'mock' || this.isSubmitted;
			submitButton.setAttribute('aria-hidden', String(submitButton.hidden));
		}
		['toggle-answers', 'toggle-explanations', 'toggle-reading-kana', 'toggle-reading-zh'].forEach((id) => {
			const button = document.getElementById(id) as HTMLButtonElement | null;
			if (!button) return;
			if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
			const questionLocked = !!this.specialtyPractice && !this.canUseReadingAssists();
			button.disabled = locked || questionLocked;
			button.hidden = locked;
			button.classList.toggle('learning-assist-locked', locked);
			button.title = locked ? '模拟考试提交后可以查看' : questionLocked ? '查看本题答案后可使用' : button.dataset.defaultTitle;
		});
		const desktopTools = document.getElementById('learning-tools-control');
		const desktopToggle = document.getElementById('learning-tools-toggle') as HTMLButtonElement | null;
		if (desktopTools) desktopTools.hidden = locked;
		if (desktopToggle) desktopToggle.disabled = locked;
		if (locked) this.toggleLearningToolsMenu(false);
		this.syncLearningToolsMenuState();
	}

	setAnswerSaveStatus(state: 'idle' | 'saving' | 'saved' | 'failed' | 'submitted', text: string) {
		const status = document.getElementById('answer-save-status');
		if (!status) return;
		if (this.answerStatusHideHandle !== null) {
			window.clearTimeout(this.answerStatusHideHandle);
			this.answerStatusHideHandle = null;
		}
		status.dataset.state = state;
		status.textContent = text;
		const transient = state === 'saved' || state === 'submitted';
		status.hidden = state === 'idle';
		if (transient) {
			status.hidden = false;
			this.answerStatusHideHandle = window.setTimeout(() => {
				status.hidden = true;
				this.answerStatusHideHandle = null;
			}, 1800);
		}
	}

	onAnswersSubmitted() {
		this.isSubmitted = true;
		if (this.getLearningSessionKind() === 'diagnostic') this.enableAllSpecialtyAssists();
		this.setAnswerSaveStatus('submitted', '已提交');
		window.dispatchEvent(new CustomEvent('examAnswersSubmitted', {
			detail: { userId: this.userId || '', examId: this._currentExamId || '' }
		}));
		this.renderExam();
	}

	restartCurrentExam() {
		if (this.savedPracticeMode === 'review') return;
		if (!this.currentExam) return;
		this.isSubmitted = false;
		this.showAnswers = false;
		this.showExplanations = false;
		this.currentSectionIndex = 0;
		this.currentQuestionIndex = 0;
		this.expiredSectionIndexes.clear();
		this.answerManager.initializeUserAnswers();
		this.setInitialNavigationPosition();
		this.setAnswerSaveStatus('idle', '尚未作答');
		if (this.examMode === 'mock') this.hideLearningAssists();
		this.renderExam();
		if (this._currentExamId) {
			this.examTimerManager.stop();
			this.examTimerManager.startForExam(this._currentExamId, this.examMode === 'mock' ? this.extractExamTimerLimits() : undefined);
		}
	}

	toggleReadingKana(show: boolean | null = null) {
		if (!this.canUseReadingAssists()) return;
		this.showReadingKana = show !== null ? show : !this.showReadingKana;
		this.writeBooleanPreference('examViewer.showReadingKana', this.showReadingKana);
		this.renderExam();
		this.loadTranslationsForReadingAssist();
	}

	toggleReadingZh(show: boolean | null = null) {
		if (!this.canUseReadingAssists()) return;
		this.showReadingZh = show !== null ? show : !this.showReadingZh;
		this.writeBooleanPreference('examViewer.showReadingZh', this.showReadingZh);
		this.renderExam();

		const translationMgr = (window as unknown as {
			TranslationManager?: { loadForExam?: (id: string) => Promise<void> };
		}).TranslationManager;
		if (this.showReadingZh && this._currentExamId && translationMgr?.loadForExam) {
			void translationMgr.loadForExam(this._currentExamId).then(() => {
				this.renderExam();
			});
		}
	}

	private updateReadingAssistButtonStates() {
		const allowed = this.canUseReadingAssists();
		this.setToggleButtonActive('toggle-reading-kana', allowed && this.showReadingKana);
		this.setToggleButtonActive('toggle-reading-zh', allowed && this.showReadingZh);
		this.syncLearningToolsMenuState();
	}

	private syncLearningToolsMenuState() {
		const readingAllowed = this.canUseReadingAssists();
		const questionAllowed = this.canUseLearningAssists() && (!this.specialtyPractice || readingAllowed);
		const states: Record<string, boolean> = {
			'learning-menu-answers': questionAllowed && this.showAnswers,
			'learning-menu-explanations': questionAllowed && this.showExplanations,
			'learning-menu-kana': readingAllowed && this.showReadingKana,
			'learning-menu-zh': readingAllowed && this.showReadingZh
		};
		let activeCount = 0;
		for (const [id, active] of Object.entries(states)) {
			const button = document.getElementById(id);
			if (!button) continue;
			button.classList.toggle('active', active);
			button.setAttribute('aria-checked', String(active));
			if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
			(button as HTMLButtonElement).disabled = !questionAllowed || ((id === 'learning-menu-kana' || id === 'learning-menu-zh') && !readingAllowed);
			button.title = !questionAllowed ? '查看本题答案后可使用' : button.dataset.defaultTitle;
			if (active) activeCount += 1;
		}
		const toggle = document.getElementById('learning-tools-toggle');
		if (!toggle) return;
		toggle.classList.toggle('active', activeCount > 0);
		toggle.setAttribute('aria-label', activeCount > 0 ? `学习辅助，已开启 ${activeCount} 项` : '学习辅助');
	}

	private setToggleButtonActive(id: string, active: boolean) {
		const btn = document.getElementById(id);
		if (!btn) return;
		btn.classList.toggle('active', active);
		btn.setAttribute('aria-pressed', active ? 'true' : 'false');
	}

	private readBooleanPreference(key: string, fallback: boolean) {
		try {
			const raw = localStorage.getItem(key);
			if (raw === '1') return true;
			if (raw === '0') return false;
		} catch {
			// localStorage may be unavailable in embedded contexts.
		}
		return fallback;
	}

	private writeBooleanPreference(key: string, value: boolean) {
		try {
			localStorage.setItem(key, value ? '1' : '0');
		} catch {
			// Ignore persistence failures; the in-memory toggle still works.
		}
	}

	private loadTranslationsForReadingAssist() {
		if (!this.canUseReadingAssists()) return;
		const translationMgr = (window as unknown as {
			TranslationManager?: { loadForExam?: (id: string) => Promise<void> };
		}).TranslationManager;
		if ((!this.showReadingZh && !this.showReadingKana) || !this._currentExamId || !translationMgr?.loadForExam) {
			return;
		}
		void translationMgr.loadForExam(this._currentExamId).then(() => {
			this.renderExam();
		});
	}

	beginPracticeReview(): () => void {
		if (!this.confirmSpecialtyAnswerForReview()) return () => {};
		const previous = {
			showAnswers: this.showAnswers,
			showExplanations: this.showExplanations,
			showReadingKana: this.showReadingKana,
			showReadingZh: this.showReadingZh
		};
		this.showAnswers = true;
		this.showExplanations = true;
		this.showReadingKana = true;
		this.showReadingZh = true;
		this.renderExam();
		this.loadTranslationsForReadingAssist();
		return () => {
			Object.assign(this, previous);
			this.renderExam();
		};
	}

	toggleExplanations() {
		if (!this.canUseLearningAssists()) return;
		if (this.specialtyPractice && !this.canUseReadingAssists()) return;
		if (!this.showExplanations && !this.confirmSpecialtyAnswerForReview()) return;
		this.showExplanations = !this.showExplanations;

		// “显示详解”是“显示答案”的超集：打开详解时必须同时打开答案
		let shouldNotifyAnswersToggled = false;
		if (this.showExplanations && !this.showAnswers) {
			this.showAnswers = true;
			shouldNotifyAnswersToggled = true;
		}

		this.renderExam();

		// 更新按钮激活状态
		const explainBtn = document.getElementById('toggle-explanations');
		if (explainBtn) {
			if (this.showExplanations) {
				explainBtn.classList.add('active');
			} else {
				explainBtn.classList.remove('active');
			}
		}
		const answersBtn = document.getElementById('toggle-answers');
		if (answersBtn) {
			if (this.showAnswers) {
				answersBtn.classList.add('active');
			} else {
				answersBtn.classList.remove('active');
			}
		}

		if (shouldNotifyAnswersToggled) {
			if (typeof vscode !== 'undefined' && vscode) {
				vscode.postMessage({
					type: 'answersToggled',
					data: { show: this.showAnswers }
				});
			}
		}
	}

	toggleAnswers(show: boolean | null = null) {
		if (!this.canUseLearningAssists()) return;
		if (this.specialtyPractice && !this.canUseReadingAssists()) return;
		const next = show !== null ? show : !this.showAnswers;
		if (next && !this.confirmSpecialtyAnswerForReview()) return;
		this.showAnswers = next;

		// “显示答案”是精简模式：一旦切到答案模式，就退出“显示详解”
		// 同时：关闭答案时也必须关闭详解（避免不可能状态）
		if (!this.showAnswers) {
			this.showExplanations = false;
		} else if (this.showExplanations) {
			this.showExplanations = false;
		}

		this.renderExam();

		// 更新按钮激活状态
		const btn = document.getElementById('toggle-answers');
		if (btn) {
			if (this.showAnswers) {
				btn.classList.add('active');
			} else {
				btn.classList.remove('active');
			}
		}
		const explainBtn = document.getElementById('toggle-explanations');
		if (explainBtn) {
			if (this.showExplanations) {
				explainBtn.classList.add('active');
			} else {
				explainBtn.classList.remove('active');
			}
		}

		if (typeof vscode !== 'undefined' && vscode) {
			vscode.postMessage({
				type: 'answersToggled',
				data: { show: this.showAnswers }
			});
		}
	}

	// ==================== 导航系统 ====================

	navigateToPreviousQuestion() {
		if (this.specialtyPractice) { this.moveSpecialtyQuestion(-1); return; }
		this.logger.debug('========== navigateToPreviousQuestion START ==========');
		this.logger.debug('State before navigation:', {
			category: this.currentCategory,
			sectionIndex: this.currentSectionIndex,
			questionIndex: this.currentQuestionIndex,
			navigationManagerExists: !!this.navigationManager
		});

		// 停止所有正在播放的音频
		this.audioManager.stopAllAudio();

		if (this.navigationManager) {
			this.logger.debug('Calling navigationManager.navigateToQuestion("prev")');
			try {
				const success = this.navigationManager.navigateToQuestion('prev');
				this.logger.debug('Navigation result:', success);
				if (success) this.answerManager.saveCurrentDraft();
			} catch (error) {
				this.logger.error('Navigation error:', error);
			}
		} else {
			this.logger.error('navigationManager is null!');
		}

		this.logger.debug('State after navigation:', {
			category: this.currentCategory,
			sectionIndex: this.currentSectionIndex,
			questionIndex: this.currentQuestionIndex
		});
		this.logger.debug('========== navigateToPreviousQuestion END ==========');
	}

	navigateToNextQuestion() {
		if (this.specialtyPractice) { this.moveSpecialtyQuestion(1); return; }
		this.logger.debug('========== navigateToNextQuestion START ==========');
		this.logger.debug('State before navigation:', {
			category: this.currentCategory,
			sectionIndex: this.currentSectionIndex,
			questionIndex: this.currentQuestionIndex,
			navigationManagerExists: !!this.navigationManager
		});

		// 停止所有正在播放的音频
		this.audioManager.stopAllAudio();

		if (this.navigationManager) {
			this.logger.debug('Calling navigationManager.navigateToQuestion("next")');
			try {
				if (this.examMode === 'practice' && this.practiceScope && !this.navigationManager.calculateNextPosition('next')) { this.finishPractice(); return; }
			const success = this.navigationManager.navigateToQuestion('next');
				this.logger.debug('Navigation result:', success);
				if (success) this.answerManager.saveCurrentDraft();
			} catch (error) {
				this.logger.error('Navigation error:', error);
			}
		} else {
			this.logger.error('navigationManager is null!');
		}

		this.logger.debug('State after navigation:', {
			category: this.currentCategory,
			sectionIndex: this.currentSectionIndex,
			questionIndex: this.currentQuestionIndex
		});
		this.logger.debug('========== navigateToNextQuestion END ==========');
	}

	getTotalQuestionsInCategory() {
		if (!this.currentExam || !this.currentCategory) {
			return 0;
		}
		const exam = this.currentExam;

		const currentCategory = this.getCurrentCategory();
		if (!currentCategory) {
			return 0;
		}

		let total = 0;
		currentCategory.sectionIndexes.forEach((sectionIndex) => {
			const section = exam.exam_info.sections[sectionIndex];
			if (section && section.questions) {
				total += section.questions.length;
			}
		});

		return total;
	}

	selectCategory(categoryId: string) {
		this.categoryNavigationManager.selectCategory(categoryId);
	}

	setInitialNavigationPosition() {
		const sections = this.currentExam?.exam_info?.sections || [];
		const firstAvailableSectionIndex = sections.findIndex((section: ExamViewerSection) => {
			return Array.isArray(section.questions) && section.questions.length > 0;
		});
		this.currentSectionIndex = firstAvailableSectionIndex >= 0 ? firstAvailableSectionIndex : 0;
		this.currentQuestionIndex = 0;
		const section = sections[this.currentSectionIndex];
		this.currentCategory = section ? this.resolveCategoryIdForSection(section) : (this.getCategories()[0]?.id ?? null);
	}

	// ==================== 试卷库管理 ====================

	renderExamList(list: LegacyAnyRecord[]) {
		const container = document.getElementById('exam-list');
		if (!container) { return; }

		container.innerHTML = list.map(exam =>
			`<button class="exam-item" data-exam-id="${exam.id}">${exam.year} ${exam.session} ${exam.level}</button>`
		).join('');

		container.addEventListener('click', (e: MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.classList.contains('exam-item')) {
				const examId = target.getAttribute('data-exam-id');
				try {
					if (typeof vscode !== 'undefined' && vscode) {
						vscode.postMessage({ type: 'loadExam', examId });
					}
				} catch (e) {
					console.warn('Failed to load exam:', e);
				}
			}
		});
	}

	showExamLocked(examId: string, reason: string) {
		const container = document.getElementById('exam-content');
		if (!container) { return; }
		const escapeHtml = (value: string): string => value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');

		container.innerHTML = `
			<div style="padding: 36px 20px; text-align: center; max-width: 560px; margin: 0 auto;">
				<h3 style="margin:0 0 12px;font-size:22px;color:#222;">试卷需要升级套餐</h3>
				<p style="margin:0 0 8px;color:#555;line-height:1.7;">${escapeHtml(reason || '当前账号权益不足，无法访问这份试卷。')}</p>
				<p style="margin:0 0 20px;color:#888;font-size:12px;">试卷 ID: ${escapeHtml(examId)}</p>
				<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
					<button id="exam-upgrade-cta" style="padding:10px 18px;border:0;border-radius:6px;background:#0878d8;color:#fff;cursor:pointer;font-weight:600;">立即升级</button>
					<button id="exam-profile-cta" style="padding:10px 18px;border:1px solid #d0d7de;border-radius:6px;background:#fff;color:#333;cursor:pointer;">查看当前权益</button>
				</div>
			</div>
		`;
		const openBilling = () => {
			const win = window as Window & { openRechargePanel?: () => void; openPersonalCenter?: () => void };
			if (typeof win.openRechargePanel === 'function') {
				win.openRechargePanel();
				return;
			}
			win.openPersonalCenter?.();
		};
		document.getElementById('exam-upgrade-cta')?.addEventListener('click', openBilling);
		document.getElementById('exam-profile-cta')?.addEventListener('click', () => {
			const win = window as Window & { openPersonalCenter?: () => void };
			win.openPersonalCenter?.();
		});
	}

	unifyTopAndCategoryButtonWidths() {
		// 统一顶部和分类按钮的宽度
		// 实现细节保持不变
	}

	// ==================== 考试控制 ====================

	startExam() {
		if (this.savedPracticeMode === 'review') return;
		this.showAnswers = false;
		this.answerManager.initializeUserAnswers();
		this.renderExam();

		if (typeof vscode !== 'undefined' && vscode) {
			vscode.postMessage({
				type: 'examStarted',
				data: { examId: this.currentExam?.exam_info.date }
			});
		}
	}

	async submitAnswers(options: { automatic?: boolean } = {}): Promise<void> {
		if (this.examMode === 'practice' && this.practiceScope) { this.finishPractice(); return; }
		if (this.isSubmitted) return;
		const diagnostic = this.getLearningSessionKind() === 'diagnostic';
		if (diagnostic) {
			const pending = this.currentExam!.exam_info.sections.flatMap((section, sectionIndex) => (section.questions || []).map((question, questionIndex) => ({ sectionIndex, questionIndex, answer: this.answerManager.getAnswerComposite(sectionIndex, String(question.id)) })))
				.filter(({ answer }) => Array.isArray(answer) ? !answer.length : answer === null || answer === undefined || answer === '');
			if (pending.length) {
				showAppToast(`还有 ${pending.length} 题未答，请完成后提交诊断。进度会自动保存，可稍后继续。`);
				this.jumpToQuestion(pending[0].sectionIndex, pending[0].questionIndex);
				return;
			}
		}
		if (this.examMode === 'mock' && !options.automatic) {
			if (this.submitConfirmationPending) return;
			this.submitConfirmationPending = true;
			const answers = Object.values(this.userAnswers);
			const answered = answers.filter((answer) => answer !== null && answer !== undefined && answer !== '').length;
			const unanswered = Math.max(0, answers.length - answered);
			const message = diagnostic ? '确认提交诊断并查看学习安排？' : unanswered > 0
				? `还有 ${unanswered} 题未作答。提交后不能继续修改，确定提交吗？`
				: '提交后不能继续修改，确定提交吗？';
			try {
				if (!await requestAppConfirmation(message, diagnostic ? '提交诊断' : '确认交卷')) return;
			} finally {
				this.submitConfirmationPending = false;
			}
		}
		if (options.automatic) this.setAnswerSaveStatus('saving', '时间到，正在自动交卷…');
		void this.answerManager.submitAnswers();
	}

	/**
	 * 业务功能 3：从当前试卷数据中抽取计时限制
	 *   - exam_info.total_limit_seconds（整体限时；可选）
	 *   - exam_info.section_limits_seconds[]（按 section 限时；可选）
	 *   - 兜底支持 exam_info.duration_minutes（分钟），转换为秒
	 *   返回 undefined 表示完全不限时
	 */
	extractExamTimerLimits(): { totalLimitSeconds?: number; sectionLimitsSeconds?: number[] } | undefined {
		if (this.getLearningSessionKind() === 'diagnostic') return { totalLimitSeconds: 0, sectionLimitsSeconds: [] };
		const info = this.currentExam?.exam_info;
		if (!info) return undefined;
		const out: { totalLimitSeconds?: number; sectionLimitsSeconds?: number[] } = {};
		const directTotal = Number((info as any).total_limit_seconds ?? 0);
		if (directTotal > 0) {
			out.totalLimitSeconds = directTotal;
		} else {
			const minutes = Number((info as any).duration_minutes ?? 0);
			if (minutes > 0) {
				out.totalLimitSeconds = minutes * 60;
			}
		}
		const sectionLimits = (info as any).section_limits_seconds;
		if (Array.isArray(sectionLimits) && sectionLimits.length > 0) {
			out.sectionLimitsSeconds = sectionLimits.map((n: unknown) => Math.max(0, Number(n) || 0));
		}
		if (out.totalLimitSeconds === undefined && !out.sectionLimitsSeconds) {
			return undefined;
		}
		return out;
	}

	handleCommand(command: string) {
		switch (command) {
			case 'startExam':
				this.startExam();
				break;
			case 'showAnswers':
				this.toggleAnswers();
				break;
			case 'submitAnswers':
				this.submitAnswers();
				break;
			default:
				console.warn('[ExamViewer] Unknown command:', command);
				break;
		}
	}
}
// Export to global scope
window.ExamViewer = ExamViewer;



