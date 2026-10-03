/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

function guestTrialStatus(kind: 'jlpt' | 'eju'): { used: number; remaining: number; storageAvailable: boolean } {
	return (window as Window & { GuestTrialQuota?: { guestTrialStatus: (trialKind: 'jlpt' | 'eju') => { used: number; remaining: number; storageAvailable: boolean } } }).GuestTrialQuota?.guestTrialStatus(kind)
		?? { used: 1, remaining: 0, storageAvailable: false };
}

function consumeGuestTrial(kind: 'jlpt' | 'eju', id: string): boolean {
	return (window as Window & { GuestTrialQuota?: { consumeGuestTrial: (trialKind: 'jlpt' | 'eju', trialId: string) => boolean } }).GuestTrialQuota?.consumeGuestTrial(kind, id) ?? false;
}

function guestPracticeKind(examId: string, family = ''): 'jlpt' | 'eju' {
	return family.toLowerCase() === 'eju' || /^EJU(?:_|-)/i.test(examId) || /^20\d{2}[_-]\d{2}$/.test(examId) ? 'eju' : 'jlpt';
}

interface LegacyQuestion {
	id: string | number;
	correct_answer?: string | string[] | null;
	[key: string]: unknown;
}

interface LegacySection {
	questions?: LegacyQuestion[];
	[key: string]: unknown;
}

interface LegacyExam {
	exam_info?: {
		sections?: LegacySection[];
	};
}

interface ScoreResult {
	total_questions: number;
	correct_count: number;
	wrong_count: number;
	unanswered_count: number;
	score: number;
	accuracy: number;
	completion: number;
	results?: Record<string, {
		question_id?: string;
		section_index?: number;
		status?: 'correct' | 'wrong' | 'unanswered';
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

interface PracticeRecord {
	exam_id: string;
	label: string;
	section_indexes: number[];
	answers: Record<string, unknown>;
	submission_id: string;
	created_at: number;
	owner_id?: string;
}

const PENDING_PRACTICE_KEY = 'japanese.pending-practice-results.v1';

interface AnswerManagerExamViewer {
	currentSectionIndex: number;
	currentQuestionIndex: number;
	userId?: string;
	_currentExamId?: string;
	currentExam?: LegacyExam | null;
	userAnswers: Record<string, unknown>;
	showAnswers: boolean;
	isSubmitted?: boolean;
	examMode?: 'practice' | 'mock';
	checkedPracticeQuestions?: Set<string>;
	practiceScope?: { label: string; sectionIndexes: number[] } | null;
	savedPracticeMode?: 'review' | 'retest' | null;
	renderQuestionNavigation?: () => void;
	choosePracticeCategory?: () => void;
	reselectPracticeGroups?: () => void;
	choosePracticePaper?: () => void;
	questionMapManager?: {
		refreshQuestionMapAnswered: () => void;
	};
	renderExam: () => void;
	jumpToQuestion?: (sectionIndex: number, questionIndex: number) => void;
	restartCurrentExam?: () => void;
	setAnswerSaveStatus?: (state: 'idle' | 'saving' | 'saved' | 'failed' | 'submitted', text: string) => void;
	onAnswersSubmitted?: () => void;
	applyDraftSnapshot?: (draft: Record<string, unknown>) => void;
	beginPracticeReview?: () => () => void;
	wrongCorrectionContext?: Record<string, unknown> | null;
}

/**
 * 答题管理器 - 负责答案选择、评分和答题状态管理
 */
class AnswerManager {
	private readonly examViewer: AnswerManagerExamViewer;

	// 每题作答后立即保存；连续作答时串行合并，避免草稿版本冲突。
	private draftSaveTimer: number | null = null;
	private draftSaveInFlight: Promise<void> | null = null;
	private draftSaveQueued = false;
	private draftSaveQueuedForceOverwrite = false;
	private draftRetryCount = 0;
	private draftRevision = 0;
	private submissionInFlight: Promise<void> | null = null;
	private submissionId = '';
	private attemptId = this.createAttemptId();
	private modalReturnFocus: HTMLElement | null = null;
	private practiceReviewRestore: (() => void) | null = null;
	private currentPracticeRecord: PracticeRecord | null = null;
	private currentPracticeSignature = '';
	private currentPracticeSaveState: 'local' | 'saving' | 'saved' | 'failed' = 'local';
	private currentPracticeQuotaBlocked = false;
	private practiceSaveInFlight = false;
	private practiceSaveQueued = false;

	constructor(examViewer: AnswerManagerExamViewer) {
		this.examViewer = examViewer;
		document.addEventListener('keydown', (event) => this.handleResultModalKeydown(event));
		window.addEventListener('userContextChanged', (event) => {
			const context = (event as CustomEvent<Record<string, unknown>>).detail;
			const userId = String(context?.user_id || context?.id || 'guest');
			if (userId !== 'guest') void this.flushPendingPracticeRecords(userId);
		});
	}

	saveCurrentDraft(): void {
		if (this.examViewer.savedPracticeMode) return;
		if (!this.examViewer.isSubmitted && Object.values(this.examViewer.userAnswers).some(answer => answer !== null && answer !== undefined && answer !== '')) this.scheduleDraftSave();
	}

	prepareNewPracticeAttempt(): void {
		this.currentPracticeRecord = null;
		this.currentPracticeSignature = '';
		this.currentPracticeQuotaBlocked = false;
	}

	/**
	 * 每次答案变化后立即保存草稿；已有请求进行时，排队保存最新快照。
	 * - 仅登录用户保存（guest 不写）
	 * - 仅有 _currentExamId 时保存
	 */
	private scheduleDraftSave(fromRetry = false, forceOverwrite = false): void {
		if (this.examViewer.savedPracticeMode) return;
		const userId = this.examViewer.userId;
		const examId = this.examViewer._currentExamId;
		if (!userId || userId === 'guest' || !examId) {
			this.examViewer.setAnswerSaveStatus?.('idle', '已在本机作答');
			return;
		}
		// 功能开关：resume_draft 关闭时不写草稿
		const isEnabled = (window as Window & { isFeatureEnabled?: (k: string) => boolean }).isFeatureEnabled;
		if (isEnabled && !isEnabled('resume_draft')) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.saveDraft !== 'function') {
			return;
		}
		if (this.draftSaveInFlight) {
			this.draftSaveQueued = true;
			this.draftSaveQueuedForceOverwrite ||= forceOverwrite;
			this.examViewer.setAnswerSaveStatus?.('saving', '正在保存…');
			return;
		}
		if (this.draftSaveTimer !== null) {
			window.clearTimeout(this.draftSaveTimer);
		}
		if (!fromRetry) this.draftRetryCount = 0;
		this.examViewer.setAnswerSaveStatus?.('saving', '正在保存…');
		this.draftSaveTimer = window.setTimeout(() => {
			this.draftSaveTimer = null;
			this.draftSaveInFlight = (async () => {
			try {
				const allAnswers = this.examViewer.userAnswers || {};
				// 仅保留已作答的（非 null/undefined），减少体积
				const answers: Record<string, unknown> = {};
				let answered = 0;
				for (const k of Object.keys(allAnswers)) {
					const v = allAnswers[k];
					if (v !== null && v !== undefined && v !== '') {
						answers[k] = v;
						answered += 1;
					}
				}
				const total = Object.keys(allAnswers).length;
				this.examViewer.setAnswerSaveStatus?.('saving', '正在保存…');
				const saved = await api.saveDraft(userId, {
					exam_id: examId,
					exam_mode: this.examViewer.examMode === 'mock' ? 'mock' : 'practice',
					total_questions: total,
					answered_count: answered,
					last_section_index: this.examViewer.currentSectionIndex,
					last_question_index: this.examViewer.currentQuestionIndex,
					answers,
					base_revision: this.draftRevision,
					force_overwrite: forceOverwrite,
					attempt_id: this.attemptId
				}) as { revision?: number } | null;
				this.draftRevision = Number(saved?.revision || this.draftRevision + 1);
				this.draftRetryCount = 0;
				this.examViewer.setAnswerSaveStatus?.('saved', '已保存');
			} catch (error) {
				if (this.errorCode(error) === 'ATTEMPT_SUBMITTED') {
					this.draftSaveQueued = false;
					this.handleAlreadySubmitted();
					return;
				}
				if (this.isDraftConflict(error)) {
					this.draftSaveQueued = false;
					this.examViewer.setAnswerSaveStatus?.('failed', '发现其他设备的新草稿');
					void this.resolveDraftConflict(userId);
					return;
				}
				if (this.examViewer._currentExamId === examId && this.draftRetryCount < 3) {
					this.draftRetryCount += 1;
					const delaySeconds = 5 * this.draftRetryCount;
					this.examViewer.setAnswerSaveStatus?.('failed', `保存失败，${delaySeconds} 秒后重试`);
					this.draftSaveTimer = window.setTimeout(() => {
						this.draftSaveTimer = null;
						this.scheduleDraftSave(true);
					}, delaySeconds * 1000);
				} else {
					this.examViewer.setAnswerSaveStatus?.('failed', '保存失败，请检查网络');
				}
			}
			})().finally(() => {
				this.draftSaveInFlight = null;
				if (!this.draftSaveQueued) return;
				this.draftSaveQueued = false;
				const queuedForceOverwrite = this.draftSaveQueuedForceOverwrite;
				this.draftSaveQueuedForceOverwrite = false;
				this.scheduleDraftSave(false, queuedForceOverwrite);
			});
		}, 0);
	}

	setDraftRevision(revision: unknown): void {
		this.draftRevision = Math.max(0, Number(revision) || 0);
	}

	setAttemptId(attemptId: unknown): void {
		if (typeof attemptId === 'string' && attemptId) this.attemptId = attemptId;
	}

	private errorCode(error: unknown): string {
		return (error as { payload?: { code?: string } } | null)?.payload?.code || '';
	}

	private isDraftConflict(error: unknown): boolean {
		return this.errorCode(error) === 'DRAFT_CONFLICT';
	}

	private handleAlreadySubmitted(): void {
		this.examViewer.onAnswersSubmitted?.();
		const modal = document.getElementById('exam-result-modal');
		const panel = document.getElementById('exam-result-panel');
		if (!modal || !panel) return;
		panel.innerHTML = '<div class="exam-result-error"><span aria-hidden="true">✓</span><h2 id="exam-result-title">该次答题已经提交</h2><p>另一个页面或设备已完成交卷，本页面已停止继续保存。</p></div><div class="exam-result-actions"><button type="button" class="result-primary" data-submitted-close>知道了</button></div>';
		this.openResultPanel('[data-submitted-close]');
		panel.querySelector('[data-submitted-close]')?.addEventListener('click', () => this.closeResultPanel());
	}

	private async resolveDraftConflict(userId: string): Promise<void> {
		try {
			const remote = await window.APIClient?.getDraft(userId) as Record<string, unknown> | null;
			if (!remote) return;
			const modal = document.getElementById('exam-result-modal');
			const panel = document.getElementById('exam-result-panel');
			if (!modal || !panel) return;
			const remoteCount = Number(remote.answered_count || 0);
			const localCount = Object.values(this.examViewer.userAnswers).filter((value) => value !== null && value !== undefined && value !== '').length;
			const remoteAnswers = remote.answers && typeof remote.answers === 'object' && !Array.isArray(remote.answers) ? remote.answers as Record<string, unknown> : {};
			const merge = this.buildDraftMerge(this.examViewer.userAnswers, remoteAnswers);
			const conflictRows = merge.conflicts.map((item, index) => `
				<fieldset class="draft-conflict-row"><legend>题目 ${this.escapeHtml(item.key)}</legend>
					<label><input type="radio" name="draft-conflict-${index}" value="local" checked> 本机：${this.escapeHtml(this.answerLabel(item.local))}</label>
					<label><input type="radio" name="draft-conflict-${index}" value="remote"> 云端：${this.escapeHtml(this.answerLabel(item.remote))}</label>
				</fieldset>`).join('');
			panel.innerHTML = `
				<div class="exam-result-error draft-conflict"><span aria-hidden="true">↔</span><h2 id="exam-result-title">发现其他设备的答题进度</h2><p>云端已答 ${remoteCount} 题，本机已答 ${localCount} 题。${merge.conflicts.length ? `有 ${merge.conflicts.length} 题答案不同，请逐题选择。` : '双方答案没有冲突，可以安全合并。'}</p></div>
				${conflictRows ? `<div class="draft-conflict-list">${conflictRows}</div>` : ''}
				<div class="exam-result-actions"><button type="button" class="result-primary" data-draft-choice="merge">${merge.conflicts.length ? '按选择合并' : '合并双方答案'}</button><button type="button" data-draft-choice="remote">只用云端</button><button type="button" data-draft-choice="local">只用本机</button></div>`;
			this.openResultPanel('[data-draft-choice="merge"]');
			panel.querySelector('[data-draft-choice="merge"]')?.addEventListener('click', () => {
				merge.conflicts.forEach((item, index) => {
					const selected = panel.querySelector<HTMLInputElement>(`input[name="draft-conflict-${index}"]:checked`)?.value;
					merge.answers[item.key] = selected === 'remote' ? item.remote : item.local;
				});
				this.examViewer.userAnswers = { ...this.examViewer.userAnswers, ...merge.answers };
				this.setDraftRevision(remote.revision);
				this.closeResultPanel();
				this.examViewer.renderExam();
				this.scheduleDraftSave(false, true);
			});
			panel.querySelector('[data-draft-choice="remote"]')?.addEventListener('click', () => {
				this.setDraftRevision(remote.revision);
				this.setAttemptId(remote.attempt_id);
				this.examViewer.userAnswers = {};
				this.examViewer.applyDraftSnapshot?.(remote);
				this.closeResultPanel();
			});
			panel.querySelector('[data-draft-choice="local"]')?.addEventListener('click', () => {
				this.setDraftRevision(remote.revision);
				this.closeResultPanel();
				this.scheduleDraftSave(false, true);
			});
		} catch {
			this.examViewer.setAnswerSaveStatus?.('failed', '草稿冲突处理失败，请刷新页面');
		}
	}

	private buildDraftMerge(local: Record<string, unknown>, remote: Record<string, unknown>): {
		answers: Record<string, unknown>;
		conflicts: Array<{ key: string; local: unknown; remote: unknown }>;
	} {
		const answers: Record<string, unknown> = {};
		const conflicts: Array<{ key: string; local: unknown; remote: unknown }> = [];
		const answered = (value: unknown) => value !== null && value !== undefined && value !== '';
		for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
			const localValue = local[key];
			const remoteValue = remote[key];
			if (!answered(localValue)) answers[key] = remoteValue;
			else if (!answered(remoteValue) || JSON.stringify(localValue) === JSON.stringify(remoteValue)) answers[key] = localValue;
			else conflicts.push({ key, local: localValue, remote: remoteValue });
		}
		return { answers, conflicts };
	}

	private answerLabel(value: unknown): string {
		if (Array.isArray(value)) return value.join(', ');
		if (value && typeof value === 'object') return JSON.stringify(value);
		return String(value ?? '未答');
	}

	private escapeHtml(value: string): string {
		return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	/**
	 * 选择选项
	 */
	selectOption(questionId: string, optionIndex: number): void {
		if (this.examViewer.isSubmitted) return;
		try {
			this.setAnswerComposite(this.examViewer.currentSectionIndex, questionId, optionIndex);
		} catch {
			this.examViewer.userAnswers[questionId] = optionIndex;
		}

		const wasChecked = this.examViewer.checkedPracticeQuestions?.delete(`${this.examViewer.currentSectionIndex}:${questionId}`);
		const options = document.querySelectorAll(`[data-question-id="${questionId}"]`);
		options.forEach((option) => {
			option.classList.remove('selected');
		});

		const selectedOption = document.querySelector(
			`[data-question-id="${questionId}"][data-option-index="${optionIndex}"]`
		);
		if (selectedOption) {
			selectedOption.classList.add('selected');
		}

		try {
			this.examViewer.questionMapManager?.refreshQuestionMapAnswered();
		} catch {
			// ignore
		}
		try {
			this.updateAnswerSummary();
		} catch {
			// ignore
		}

		if (wasChecked) this.examViewer.renderExam();
		// 业务功能 4：每次答题变更后触发草稿节流保存
		if (!this.examViewer.wrongCorrectionContext) this.scheduleDraftSave();
	}

	/**
	 * 初始化用户答案
	 */
	initializeUserAnswers(): void {
		this.examViewer.userAnswers = {};
		const sections = this.examViewer.currentExam?.exam_info?.sections;
		if (!sections) {
			return;
		}
		sections.forEach((section) => {
			section.questions?.forEach((question) => {
				this.examViewer.userAnswers[String(question.id)] = null;
			});
		});
	}

	/**
	 * 评估题目答案（客户端临时方法，用于答题卡显示）
	 */
	evaluateQuestionAnswer(sectionIndex: number, questionIndex: number): boolean {
		if (!this.examViewer.currentExam) return false;

		const sections = this.examViewer.currentExam.exam_info?.sections || [];
		const section = sections[sectionIndex];
		if (!section || !section.questions) return false;

		const question = section.questions[questionIndex];
		if (!question) return false;

		const userAnswer = this.getAnswerComposite(sectionIndex, String(question.id));
		if (userAnswer === undefined || userAnswer === null) return false;

		const correctAnswer = question.correct_answer;
		if (correctAnswer === undefined || correctAnswer === null) return false;

		if (Array.isArray(correctAnswer)) {
			if (!Array.isArray(userAnswer)) return false;
			return this.arraysEqualShallow(userAnswer, correctAnswer);
		}

		return userAnswer === correctAnswer;
	}

	/**
	 * 浅比较数组
	 */
	arraysEqualShallow(arr1: unknown[], arr2: unknown[]): boolean {
		if (!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
		if (arr1.length !== arr2.length) return false;

		const sorted1 = [...arr1].map(String).sort();
		const sorted2 = [...arr2].map(String).sort();

		for (let i = 0; i < sorted1.length; i += 1) {
			if (sorted1[i] !== sorted2[i]) return false;
		}
		return true;
	}

	/**
	 * 更新答题概览
	 */
	updateAnswerSummary(): void {
		this.examViewer.renderQuestionNavigation?.();
		const summary = document.getElementById('answer-summary');
		if (!summary) return;

		const answeredCount = Object.values(this.examViewer.userAnswers).filter((answer) => answer !== null).length;
		const totalCount = Object.keys(this.examViewer.userAnswers).length;
		const progress = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;

		summary.innerHTML = `
			<p>已答题: ${answeredCount}/${totalCount}</p>
			<p>进度: ${progress}%</p>
		`;
	}

	private pendingPracticeRecords(): PracticeRecord[] {
		try {
			const records = JSON.parse(localStorage.getItem(PENDING_PRACTICE_KEY) || '[]') as PracticeRecord[];
			return Array.isArray(records) ? records.filter(record => record && Date.now() - Number(record.created_at) < 7 * 86400000 && record.submission_id) : [];
		} catch { return []; }
	}

	private storePendingPracticeRecords(records: PracticeRecord[]): boolean {
		try {
			const guest = !this.examViewer.userId || this.examViewer.userId === 'guest';
			localStorage.setItem(PENDING_PRACTICE_KEY, JSON.stringify(records.slice(guest ? -3 : -20)));
			return true;
		} catch { return false; }
	}

	private updatePracticeSaveStatus(): void {
		const host = document.querySelector<HTMLElement>('#exam-result-panel [data-practice-save-status]');
		if (!host || !this.currentPracticeRecord) return;
		const guest = !this.examViewer.userId || this.examViewer.userId === 'guest';
		const messages = {
			local: guest ? '本次结果暂存在此浏览器；每类体验各 1 次，7 天内在此登录可转存到账号。' : '本次结果暂存在此浏览器，等待保存到账号。',
			saving: '正在保存本次结果到学习记录…',
			saved: '本次结果已保存到账号的学习记录。',
			failed: this.currentPracticeQuotaBlocked ? '访客体验已达上限。本次结果尚未暂存，请登录并保存。' : '保存失败，结果仍暂存在此浏览器，可重试。'
		};
		host.textContent = messages[this.currentPracticeSaveState];
		host.dataset.state = this.currentPracticeSaveState;
		const retry = document.querySelector<HTMLButtonElement>('#exam-result-panel [data-practice-save-retry]');
		if (retry) retry.hidden = this.currentPracticeSaveState !== 'failed' || this.currentPracticeQuotaBlocked;
		const login = document.querySelector<HTMLButtonElement>('#exam-result-panel [data-practice-save-login]');
		if (login) login.hidden = !guest;
	}

	private async flushPendingPracticeRecords(userId: string): Promise<void> {
		if (this.practiceSaveInFlight) { this.practiceSaveQueued = true; return; }
		if (!window.APIClient?.savePracticeGroup) return;
		this.practiceSaveInFlight = true;
		try {
			const records = this.pendingPracticeRecords();
			if (this.currentPracticeRecord && !records.some(record => record.submission_id === this.currentPracticeRecord?.submission_id)
				&& this.currentPracticeSaveState !== 'saved') records.push(this.currentPracticeRecord);
			records.sort((left, right) => Number(right.submission_id === this.currentPracticeRecord?.submission_id) - Number(left.submission_id === this.currentPracticeRecord?.submission_id));
			for (const record of records) {
				if (record.owner_id && record.owner_id !== userId) continue;
				if (record.submission_id === this.currentPracticeRecord?.submission_id) {
					this.draftSaveQueued = false;
					if (this.draftSaveTimer !== null) { window.clearTimeout(this.draftSaveTimer); this.draftSaveTimer = null; }
					if (this.draftSaveInFlight) await this.draftSaveInFlight;
					if (this.draftSaveTimer !== null) { window.clearTimeout(this.draftSaveTimer); this.draftSaveTimer = null; }
					this.currentPracticeSaveState = 'saving';
					this.updatePracticeSaveStatus();
				}
				try {
					await window.APIClient.savePracticeGroup(record);
					this.storePendingPracticeRecords(this.pendingPracticeRecords().filter(item => item.submission_id !== record.submission_id));
					if (record.submission_id === this.currentPracticeRecord?.submission_id) {
						this.currentPracticeSaveState = 'saved';
						this.updatePracticeSaveStatus();
					}
					window.dispatchEvent(new Event('practiceRecordSaved'));
				} catch {
					if (record.submission_id === this.currentPracticeRecord?.submission_id) {
						this.currentPracticeSaveState = 'failed';
						this.updatePracticeSaveStatus();
					}
					break;
				}
			}
		} finally {
			this.practiceSaveInFlight = false;
			if (this.practiceSaveQueued) {
				this.practiceSaveQueued = false;
				void this.flushPendingPracticeRecords(userId);
			}
		}
	}

	showPracticeResults(label: string, questions: Array<{ sectionIndex: number; questionIndex: number; question: LegacyQuestion }>): void {
		const panel = document.getElementById('exam-result-panel');
		if (!panel) return;
		const rows = questions.map(item => {
			const answer = this.getAnswerComposite(item.sectionIndex, String(item.question.id));
			const answered = answer !== undefined && answer !== null && answer !== '';
			const correct = item.question.correct_answer;
			const gradable = correct !== undefined && correct !== null && correct !== '';
			const matches = Array.isArray(correct) ? Array.isArray(answer) && this.arraysEqualShallow(answer, correct) : String(answer) === String(correct);
			return { ...item, answered, gradable, status: !answered ? 'unanswered' : !gradable ? 'ungraded' : matches ? 'correct' : 'wrong' };
		});
		const answered = rows.filter(row => row.answered).length;
		const correct = rows.filter(row => row.status === 'correct').length;
		const wrong = rows.filter(row => row.status === 'wrong').length;
		const graded = correct + wrong;
		const ungraded = rows.filter(row => row.status === 'ungraded').length;
		const targets = rows.filter(row => row.status === 'wrong' || row.status === 'unanswered');
		const guest = !this.examViewer.userId || this.examViewer.userId === 'guest';
		const examId = this.examViewer._currentExamId || '';
		const trialKind = guestPracticeKind(examId, String((this.examViewer.currentExam as LegacyExam & { family?: string } | null)?.family || ''));
		if (answered && examId) {
			const answers: Record<string, unknown> = {};
			for (const row of rows) if (row.answered) answers[`${row.sectionIndex}:${row.question.id}`] = this.getAnswerComposite(row.sectionIndex, String(row.question.id));
			const sectionIndexes = [...new Set(questions.map(item => item.sectionIndex))];
			const signature = JSON.stringify([examId, label, sectionIndexes, answers]);
			if (signature !== this.currentPracticeSignature) {
				this.currentPracticeSignature = signature;
				this.currentPracticeQuotaBlocked = false;
				const submissionId = this.createSubmissionId();
				this.currentPracticeRecord = {
					exam_id: examId, label, section_indexes: sectionIndexes, answers,
					submission_id: submissionId, created_at: Date.now(),
					...(this.examViewer.userId && this.examViewer.userId !== 'guest' ? { owner_id: this.examViewer.userId } : {})
				};
				if (guest && !consumeGuestTrial(trialKind, `practice:${submissionId}`)) {
					this.currentPracticeQuotaBlocked = true;
					this.currentPracticeSaveState = 'failed';
				} else this.currentPracticeSaveState = this.storePendingPracticeRecords([...this.pendingPracticeRecords(), this.currentPracticeRecord]) ? 'local' : 'failed';
			}
		} else {
			this.currentPracticeRecord = null;
			this.currentPracticeSignature = '';
		}
		const rate = graded ? `${Math.round(correct / graded * 100)}%` : '—';
		if (guest && answered) this.examViewer.isSubmitted = true;
		const guestQuotaUsed = guest && guestTrialStatus(trialKind).remaining === 0;
		panel.innerHTML = `<div class="practice-result">
			<button type="button" class="exam-result-close" data-practice-action="close" aria-label="关闭练习结果" title="关闭">×</button>
			<p class="practice-result-kicker">${this.escapeHtml(label)} · 练习完成</p>
			<h2 id="exam-result-title">${this.escapeHtml(label)}练习结果</h2>
			<p class="practice-result-intro">${answered === rows.length ? '这组题已完成。' : `已完成 ${answered} / ${rows.length} 题，未答题也可以继续回看。`}${targets.length ? `接下来可以复盘 ${targets.length} 道错题与未答题。` : '这组题没有错题与未答题。'}</p>
			<div class="practice-result-overview"><div class="practice-result-rate"><strong>${rate}</strong><span>正确率</span></div><div class="practice-result-stats"><div>已答<strong>${answered} / ${rows.length}</strong></div><div>正确<strong>${correct}</strong></div><div>错误<strong>${wrong}</strong></div><div>未答<strong>${rows.length - answered}</strong></div></div></div>
			<p class="practice-result-note">正确率按已答且可自动判分的题目计算。${ungraded ? `${ungraded} 道主观题需对照参考答案自行复盘。` : ''}</p>
			<section class="practice-result-save" aria-label="保存这次练习"><div class="practice-result-save-copy"><strong>保存这次练习</strong><p data-practice-save-status role="status">${answered ? '正在准备保存…' : '尚未作答，本次没有需要保存的结果。'}</p></div>${answered ? '<button type="button" data-practice-save-login>登录并保存到账号</button><button type="button" data-practice-save-retry hidden>重试保存</button>' : ''}</section>
			<div class="exam-result-actions practice-result-main-actions"><button type="button" class="${targets.length ? 'result-primary' : ''}" data-practice-action="review" ${targets.length ? '' : 'hidden'}>复盘错题与未答</button><button type="button" class="${targets.length ? '' : 'result-primary'}" data-practice-action="choose">${guestQuotaUsed ? '选择其他考试' : '练习其他题型'}</button><button type="button" data-practice-action="retry">${guestQuotaUsed ? '登录后再练' : '再练一次'}</button></div>
			<details class="practice-result-more"><summary>其他操作</summary><div class="exam-result-actions"><button type="button" data-practice-action="reselect">重新选择题组</button><button type="button" data-practice-action="paper">更换试卷</button><button type="button" data-practice-action="continue">${guest && answered ? '查看原题' : '返回作答'}</button></div></details>
		</div>`;
		if (this.currentPracticeRecord) {
			this.updatePracticeSaveStatus();
			if (this.examViewer.userId && this.examViewer.userId !== 'guest' && this.currentPracticeSaveState !== 'saved') void this.flushPendingPracticeRecords(this.examViewer.userId);
		}
		panel.querySelector('[data-practice-save-login]')?.addEventListener('click', () => (window as Window & { __openLoginModal?: () => void }).__openLoginModal?.());
		panel.querySelector('[data-practice-save-retry]')?.addEventListener('click', () => {
			if (this.examViewer.userId && this.examViewer.userId !== 'guest') void this.flushPendingPracticeRecords(this.examViewer.userId);
			else (window as Window & { __openLoginModal?: () => void }).__openLoginModal?.();
		});
		panel.querySelector('[data-practice-action="close"]')?.addEventListener('click', () => this.closeResultPanel());
		panel.querySelector('[data-practice-action="continue"]')?.addEventListener('click', () => this.closeResultPanel());
		panel.querySelector('[data-practice-action="review"]')?.addEventListener('click', () => {
			if (!targets.length) return;
			targets.forEach(item => this.examViewer.checkedPracticeQuestions?.add(`${item.sectionIndex}:${item.question.id}`));
			this.closeResultPanel();
			this.practiceReviewRestore = this.examViewer.beginPracticeReview?.() || null;
			this.openReviewQueue(targets, '错题与未答复盘', () => this.showPracticeResults(label, questions));
		});
		panel.querySelector('[data-practice-action="retry"]')?.addEventListener('click', () => {
			if ((!this.examViewer.userId || this.examViewer.userId === 'guest') && guestTrialStatus(trialKind).remaining === 0) {
				(window as Window & { __openLoginModal?: () => void }).__openLoginModal?.();
				return;
			}
			this.currentPracticeRecord = null;
			this.currentPracticeSignature = '';
			this.currentPracticeQuotaBlocked = false;
			this.examViewer.isSubmitted = false;
			questions.forEach(item => {
				delete this.examViewer.userAnswers[this._makeKey(item.sectionIndex, String(item.question.id))];
				delete this.examViewer.userAnswers[String(item.question.id)];
				this.examViewer.checkedPracticeQuestions?.delete(`${item.sectionIndex}:${item.question.id}`);
			});
			this.removeReviewBar();
			this.closeResultPanel();
			if (questions[0]) this.examViewer.jumpToQuestion?.(questions[0].sectionIndex, questions[0].questionIndex);
			this.examViewer.questionMapManager?.refreshQuestionMapAnswered();
			this.scheduleDraftSave();
		});
		panel.querySelector('[data-practice-action="paper"]')?.addEventListener('click', () => {
			this.closeResultPanel(); this.removeReviewBar();
			if (!this.examViewer.userId || this.examViewer.userId === 'guest') window.dispatchEvent(new CustomEvent('guestWelcomeNavigate', { detail: { action: 'home' } }));
			else this.examViewer.choosePracticePaper?.();
		});
		panel.querySelector('[data-practice-action="reselect"]')?.addEventListener('click', () => {
			if ((!this.examViewer.userId || this.examViewer.userId === 'guest') && guestTrialStatus(trialKind).remaining === 0) (window as Window & { __openLoginModal?: () => void }).__openLoginModal?.();
			else this.examViewer.reselectPracticeGroups?.();
		});
		panel.querySelector('[data-practice-action="choose"]')?.addEventListener('click', () => {
			if ((!this.examViewer.userId || this.examViewer.userId === 'guest') && guestTrialStatus(trialKind).remaining === 0) {
				this.closeResultPanel();
				this.removeReviewBar();
				window.dispatchEvent(new CustomEvent('guestWelcomeNavigate', { detail: { action: 'home' } }));
				return;
			}
			this.closeResultPanel();
			this.removeReviewBar();
			this.examViewer.choosePracticeCategory?.();
		});
		this.openResultPanel(targets.length ? '[data-practice-action="review"]' : '[data-practice-action="choose"]');
	}

	/**
	 * 提交答案 - 使用后端 API 进行评分
	 */
	async submitAnswers(): Promise<void> {
		if (this.submissionInFlight) return this.submissionInFlight;
		if (!this.submissionId) this.submissionId = this.createSubmissionId();
		this.submissionInFlight = this.performSubmit();
		try { await this.submissionInFlight; } finally { this.submissionInFlight = null; }
	}

	private async performSubmit(): Promise<void> {
		try {
			const submitButton = document.getElementById('submit-exam') as HTMLButtonElement | null;
			if (submitButton) submitButton.disabled = true;
			this.examViewer.setAnswerSaveStatus?.('saving', '正在交卷…');
			// 快速答到末题后可能仍有最后一次草稿写入。必须先等它结束，
			// 否则较晚完成的草稿会把“已提交”状态覆盖回“待提交”。
			this.draftSaveQueued = false;
			this.draftSaveQueuedForceOverwrite = false;
			if (this.draftSaveTimer !== null) {
				window.clearTimeout(this.draftSaveTimer);
				this.draftSaveTimer = null;
			}
			if (this.draftSaveInFlight) await this.draftSaveInFlight;
			// 保存失败可能安排了重试；提交即将成为最终状态，不再允许旧草稿重试。
			if (this.draftSaveTimer !== null) {
				window.clearTimeout(this.draftSaveTimer);
				this.draftSaveTimer = null;
			}
			this.draftRetryCount = 0;
			const examId = this.examViewer._currentExamId || 'unknown';
			let activeAssignment: { assignment_id?: string; exam_id?: string } | null = null;
			try {
				activeAssignment = JSON.parse(localStorage.getItem('exam_v2_active_assignment') || 'null') as { assignment_id?: string; exam_id?: string } | null;
			} catch {
				activeAssignment = null;
			}
			const shouldSubmitAssignment = !!activeAssignment?.assignment_id && activeAssignment.exam_id === examId;
			const result = window.APIClient
				? (shouldSubmitAssignment && typeof window.APIClient.submitAssignment === 'function'
						? (((await window.APIClient.submitAssignment(
								activeAssignment!.assignment_id!,
								this.examViewer.userAnswers
						  )) as { score?: ScoreResult }).score as ScoreResult)
						: ((await window.APIClient.submitAnswers(
								this.examViewer.userId || 'guest',
								examId,
								this.examViewer.userAnswers,
								this.submissionId,
								this.attemptId,
								this.examViewer.examMode || 'practice'
						  )) as ScoreResult))
				: await (async (): Promise<ScoreResult> => {
						const apiBase = window.__API_BASE__ || '/api/v1';
						const response = await fetch(`${apiBase}/answers/submit`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								user_id: this.examViewer.userId || 'guest',
								exam_id: examId,
								answers: this.examViewer.userAnswers,
								submission_id: this.submissionId,
								attempt_id: this.attemptId,
								exam_mode: this.examViewer.examMode || 'practice'
							})
						});
						const payload = (await response.json()) as Partial<ApiEnvelope<ScoreResult>> | ScoreResult;
						return (payload as Partial<ApiEnvelope<ScoreResult>>).data || (payload as ScoreResult);
				  })();
			if (shouldSubmitAssignment) {
				localStorage.removeItem('exam_v2_active_assignment');
			}
			if (this.examViewer.userId && this.examViewer.userId !== 'guest' && typeof window.APIClient?.clearDraft === 'function') {
				try {
					await window.APIClient.clearDraft(this.examViewer.userId);
				} catch {
					// The scored answer is already persisted; stale-draft cleanup can be retried later.
				}
			}

			this.examViewer.showAnswers = true;
			this.examViewer.onAnswersSubmitted?.();
			if (!this.examViewer.onAnswersSubmitted) this.examViewer.renderExam();
			this.showResults(result);

			if (typeof vscode !== 'undefined' && vscode) {
				vscode.postMessage({
					type: 'answersSubmitted',
					data: result
				});
			}
		} catch (error) {
			console.error('[AnswerManager] Failed to submit answers:', error);
			this.examViewer.setAnswerSaveStatus?.('failed', '提交失败，请重试');
			this.showSubmissionError();
			const submitButton = document.getElementById('submit-exam') as HTMLButtonElement | null;
			if (submitButton) submitButton.disabled = false;
		}
	}

	private createSubmissionId(): string {
		return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? crypto.randomUUID()
			: `submission-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	private createAttemptId(): string {
		return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
			? `attempt-${crypto.randomUUID()}`
			: `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	/**
	 * 显示评分结果
	 */
	showResults(result: ScoreResult): void {
		const modal = document.getElementById('exam-result-modal');
		const panel = document.getElementById('exam-result-panel');
		if (!modal || !panel) return;
		const score = this.safeNumber(result.score);
		const accuracy = this.safeNumber(result.accuracy);
		const completion = this.safeNumber(result.completion);
		panel.innerHTML = `
			<div class="exam-result-heading">
				<div class="exam-result-score" style="--result-progress:${Math.max(0, Math.min(100, score)) * 3.6}deg">
					<strong>${this.formatNumber(score)}</strong><span>分</span>
				</div>
				<div><p class="exam-result-kicker">本次答题结果</p><h2 id="exam-result-title">试卷已提交</h2><p>正确率 ${this.formatNumber(accuracy)}% · 完成度 ${this.formatNumber(completion)}%</p></div>
			</div>
			<div class="exam-result-stats" aria-label="答题统计">
				<div><strong>${this.safeInteger(result.total_questions)}</strong><span>总题数</span></div>
				<div class="is-correct"><strong>${this.safeInteger(result.correct_count)}</strong><span>正确</span></div>
				<div class="is-wrong"><strong>${this.safeInteger(result.wrong_count)}</strong><span>错误</span></div>
				<div class="is-unanswered"><strong>${this.safeInteger(result.unanswered_count)}</strong><span>未答</span></div>
			</div>
			<div class="exam-result-actions">
				<button type="button" class="result-primary" data-result-action="explanations">查看解析</button>
				<button type="button" data-result-action="wrong" ${this.getReviewTargets(result).length ? '' : 'disabled'}>只看错题</button>
				<button type="button" data-result-action="history">交卷历史</button>
				<button type="button" data-result-action="retry">再做一次</button>
			</div>
			<button type="button" class="exam-result-close" data-result-action="close" aria-label="关闭结果">×</button>
		`;
		this.bindResultActions(panel, result);
		this.openResultPanel('[data-result-action="explanations"]');
	}

	private showSubmissionError(): void {
		const modal = document.getElementById('exam-result-modal');
		const panel = document.getElementById('exam-result-panel');
		if (!modal || !panel) return;
		panel.innerHTML = `
			<div class="exam-result-error"><span aria-hidden="true">!</span><h2 id="exam-result-title">提交没有成功</h2><p>答案仍保留在当前页面，请检查网络后重新提交。</p></div>
			<div class="exam-result-actions"><button type="button" class="result-primary" data-result-action="resubmit">重新提交</button><button type="button" data-result-action="close">稍后处理</button></div>
		`;
		panel.querySelector('[data-result-action="resubmit"]')?.addEventListener('click', () => {
			this.closeResultPanel();
			void this.submitAnswers();
		});
		panel.querySelector('[data-result-action="close"]')?.addEventListener('click', () => this.closeResultPanel());
		this.openResultPanel('[data-result-action="resubmit"]');
	}

	private bindResultActions(panel: HTMLElement, result: ScoreResult): void {
		panel.querySelector('[data-result-action="close"]')?.addEventListener('click', () => this.closeResultPanel());
		panel.querySelector('[data-result-action="explanations"]')?.addEventListener('click', () => {
			this.examViewer.showAnswers = true;
			(this.examViewer as AnswerManagerExamViewer & { showExplanations?: boolean }).showExplanations = true;
			this.closeResultPanel();
			this.examViewer.renderExam();
		});
		panel.querySelector('[data-result-action="wrong"]')?.addEventListener('click', () => {
			const targets = this.getReviewTargets(result);
			if (!targets.length) return;
			this.examViewer.showAnswers = true;
			(this.examViewer as AnswerManagerExamViewer & { showExplanations?: boolean }).showExplanations = true;
			this.closeResultPanel();
			this.openReviewQueue(targets);
		});
		panel.querySelector('[data-result-action="retry"]')?.addEventListener('click', () => {
			this.closeResultPanel();
			this.removeReviewBar();
			this.examViewer.restartCurrentExam?.();
			this.submissionId = '';
			this.attemptId = this.createAttemptId();
		});
		panel.querySelector('[data-result-action="history"]')?.addEventListener('click', () => void this.showAttemptHistory(result));
	}

	private async showAttemptHistory(currentResult: ScoreResult): Promise<void> {
		const panel = document.getElementById('exam-result-panel');
		const userId = this.examViewer.userId;
		const examId = this.examViewer._currentExamId;
		if (!panel || !userId || !examId || typeof window.APIClient?.getAnswerAttempts !== 'function') return;
		panel.innerHTML = '<div class="exam-history-loading">正在加载交卷历史…</div>';
		try {
			const attempts = await window.APIClient.getAnswerAttempts(userId, examId, 20) as Array<{
				saved_at?: string;
				statistics?: Partial<ScoreResult>;
				answers?: Record<string, unknown>;
			}>;
			const rows = (Array.isArray(attempts) ? attempts : []).map((attempt, index) => {
				const stats = attempt.statistics || {};
				const savedAt = attempt.saved_at ? new Date(attempt.saved_at).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
				return `<button type="button" class="exam-history-row" data-attempt-index="${index}"><div><strong>第 ${attempts.length - index} 次</strong><span>${savedAt}</span></div><div><strong>${this.formatNumber(this.safeNumber(stats.score))} 分</strong><span>正确 ${this.safeInteger(stats.correct_count)} · 错误 ${this.safeInteger(stats.wrong_count)} · 未答 ${this.safeInteger(stats.unanswered_count)}</span></div></button>`;
			}).join('');
			panel.innerHTML = `<div class="exam-history-heading"><p class="exam-result-kicker">当前试卷</p><h2 id="exam-result-title">交卷历史</h2><p>共保留最近 ${attempts.length} 次正式提交记录</p></div><div class="exam-history-list">${rows || '<p class="exam-history-empty">暂无历史记录</p>'}</div><div class="exam-result-actions"><button type="button" class="result-primary" data-history-back>返回本次结果</button></div>`;
			panel.querySelectorAll<HTMLElement>('[data-attempt-index]').forEach((row) => row.addEventListener('click', () => {
				const index = Number(row.dataset.attemptIndex);
				if (attempts[index]) this.showAttemptDetail(attempts[index], attempts, currentResult);
			}));
			panel.querySelector('[data-history-back]')?.addEventListener('click', () => this.showResults(currentResult));
		} catch {
			panel.innerHTML = '<div class="exam-result-error"><h2 id="exam-result-title">历史记录加载失败</h2><p>请检查网络后重试。</p></div><div class="exam-result-actions"><button type="button" data-history-back>返回</button></div>';
			panel.querySelector('[data-history-back]')?.addEventListener('click', () => this.showResults(currentResult));
		}
	}

	private showAttemptDetail(
		attempt: { saved_at?: string; statistics?: Partial<ScoreResult>; answers?: Record<string, unknown> },
		attempts: Array<{ saved_at?: string; statistics?: Partial<ScoreResult>; answers?: Record<string, unknown> }>,
		currentResult: ScoreResult
	): void {
		const panel = document.getElementById('exam-result-panel');
		if (!panel) return;
		const stats = attempt.statistics || {};
		const results = stats.results || {};
		const issueRows = Object.entries(results).filter(([, row]) => row.status !== 'correct').map(([key, row]) => `
			<div class="exam-attempt-question"><strong>题目 ${this.escapeHtml(key)}</strong><span>${row.status === 'unanswered' ? '未作答' : '回答错误'} · 作答 ${this.escapeHtml(this.answerLabel(row.user_answer))} · 正确 ${this.escapeHtml(this.answerLabel(row.correct_answer))}</span></div>`).join('');
		const savedAt = attempt.saved_at ? new Date(attempt.saved_at).toLocaleString('zh-CN', { hour12: false }) : '时间未知';
		const mode = stats.exam_mode === 'mock' ? '模拟考试' : '练习模式';
		const elapsed = this.formatDuration(this.safeInteger(stats.elapsed_seconds));
		panel.innerHTML = `<div class="exam-history-heading"><p class="exam-result-kicker">${mode} · ${savedAt}</p><h2 id="exam-result-title">${this.formatNumber(this.safeNumber(stats.score))} 分</h2><p>正确 ${this.safeInteger(stats.correct_count)} · 错误 ${this.safeInteger(stats.wrong_count)} · 未答 ${this.safeInteger(stats.unanswered_count)}${elapsed ? ` · 用时 ${elapsed}` : ''}</p></div><div class="exam-attempt-questions">${issueRows || '<p class="exam-history-empty">本次没有错题或未答题。</p>'}</div><div class="exam-result-actions"><button type="button" class="result-primary" data-attempt-retry ${issueRows ? '' : 'disabled'}>重练本次错题</button><button type="button" data-attempt-back>返回历史</button></div>`;
		panel.querySelector('[data-attempt-back]')?.addEventListener('click', () => void this.showAttemptHistory(currentResult));
		panel.querySelector('[data-attempt-retry]')?.addEventListener('click', () => {
			const targets = this.getReviewTargets(stats as ScoreResult);
			if (!targets.length) return;
			this.closeResultPanel();
			this.removeReviewBar();
			this.examViewer.restartCurrentExam?.();
			this.submissionId = '';
			this.attemptId = this.createAttemptId();
			this.openReviewQueue(targets, '错题重练');
		});
		void attempts;
	}

	private getReviewTargets(result: ScoreResult): Array<{ sectionIndex: number; questionIndex: number; status: string }> {
		const sections = this.examViewer.currentExam?.exam_info?.sections || [];
		return Object.entries(result.results || {}).flatMap(([key, row]) => {
			if (row?.status !== 'wrong' && row?.status !== 'unanswered') return [];
			const keyParts = key.split(':');
			const sectionIndex = Number.isInteger(row.section_index) ? Number(row.section_index) : Number(keyParts[0]);
			const questionId = String(row.question_id ?? keyParts.slice(1).join(':'));
			const questionIndex = sections[sectionIndex]?.questions?.findIndex((question) => String(question.id) === questionId) ?? -1;
			return questionIndex >= 0 ? [{ sectionIndex, questionIndex, status: row.status }] : [];
		});
	}

	private openReviewQueue(targets: Array<{ sectionIndex: number; questionIndex: number; status: string }>, title = '错题复盘', onClose?: () => void): void {
		let index = 0;
		const show = () => {
			const target = targets[index];
			this.examViewer.jumpToQuestion?.(target.sectionIndex, target.questionIndex);
			let bar = document.getElementById('exam-review-bar');
			if (!bar) {
				bar = document.createElement('div');
				bar.id = 'exam-review-bar';
				document.getElementById('current-question-container')?.before(bar);
			}
			bar.innerHTML = `<strong>${title}</strong><span>第 ${index + 1} / ${targets.length} 题 · ${target.status === 'unanswered' ? '未作答' : '回答错误'}</span><div><button type="button" data-review-action="prev" ${index === 0 ? 'disabled' : ''}>上一题</button><button type="button" data-review-action="next" ${index === targets.length - 1 ? 'disabled' : ''}>下一题</button><button type="button" data-review-action="close">退出复盘</button></div>`;
			bar.querySelector('[data-review-action="prev"]')?.addEventListener('click', () => { if (index > 0) { index -= 1; show(); } });
			bar.querySelector('[data-review-action="next"]')?.addEventListener('click', () => { if (index < targets.length - 1) { index += 1; show(); } });
			if (onClose) bar.querySelector('[data-review-action="close"]')!.textContent = '返回练习结果';
			bar.querySelector('[data-review-action="close"]')?.addEventListener('click', () => { this.removeReviewBar(); onClose?.(); });
		};
		show();
	}

	private closeResultPanel(): void {
		const modal = document.getElementById('exam-result-modal');
		if (!modal) return;
		modal.hidden = true;
		modal.setAttribute('aria-hidden', 'true');
		const returnFocus = this.modalReturnFocus;
		this.modalReturnFocus = null;
		if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
	}

	private openResultPanel(focusSelector?: string): void {
		const modal = document.getElementById('exam-result-modal');
		if (!modal) return;
		if (modal.hidden) this.modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		modal.hidden = false;
		modal.setAttribute('aria-hidden', 'false');
		const target = focusSelector ? modal.querySelector<HTMLElement>(focusSelector) : null;
		(target || modal.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))?.focus();
	}

	private handleResultModalKeydown(event: KeyboardEvent): void {
		const modal = document.getElementById('exam-result-modal');
		if (!modal || modal.hidden) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			this.closeResultPanel();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = Array.from(modal.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
		if (!focusable.length) { event.preventDefault(); return; }
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	}

	private removeReviewBar(): void {
		document.getElementById('exam-review-bar')?.remove();
		const restore = this.practiceReviewRestore;
		this.practiceReviewRestore = null;
		restore?.();
	}

	private safeNumber(value: unknown): number {
		const number = Number(value);
		return Number.isFinite(number) ? number : 0;
	}

	private safeInteger(value: unknown): number {
		return Math.max(0, Math.round(this.safeNumber(value)));
	}

	private formatNumber(value: number): string {
		return Number.isInteger(value) ? String(value) : value.toFixed(1);
	}

	private formatDuration(totalSeconds: number): string {
		if (!totalSeconds) return '';
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const pad = (value: number) => String(value).padStart(2, '0');
		return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
	}

	private _makeKey(sectionIndex: number, questionId: string): string {
		return `${sectionIndex}:${questionId}`;
	}

	isAnsweredComposite(sectionIndex: number, questionId: string): boolean {
		const k = this._makeKey(sectionIndex, questionId);
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k)) return true;
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)) return true;
		return false;
	}

	getAnswerComposite(sectionIndex: number, questionId: string): unknown {
		const k = this._makeKey(sectionIndex, questionId);
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k)) return this.examViewer.userAnswers[k];
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId))
			return this.examViewer.userAnswers[questionId];
		return undefined;
	}

	setAnswerComposite(sectionIndex: number, questionId: string, value: unknown): void {
		const k = this._makeKey(sectionIndex, questionId);
		if (
			!Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k) &&
			Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)
		) {
			delete this.examViewer.userAnswers[questionId];
		}
		this.examViewer.userAnswers[k] = value;
	}
}

window.AnswerManager = AnswerManager;
