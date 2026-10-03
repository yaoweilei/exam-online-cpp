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

import { requestAppConfirmation, showAppToast } from '../../ui/dialogs.js';
import { guestTrialStatus, practiceTrialKind } from '../../features/guestTrialRecords.js';
import { QuestionRenderer } from '../renderers/QuestionRenderer.js';

type LegacyAnyRecord = Record<string, any>;
type ExamMode = 'practice' | 'mock';

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
		const question = this.currentExam?.exam_info.sections[this.currentSectionIndex]?.questions?.[this.currentQuestionIndex];
		return this.examMode === 'practice' && !!question && this.checkedPracticeQuestions.has(`${this.currentSectionIndex}:${question.id}`);
	}

	finishPractice() {
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
				
				this.resetExamState();
				this.expiredSectionIndexes.clear();
				this.isSubmitted = false;
				
				// 恢复显示状态
				this.showAnswers = prevShowAnswers;
				this.showExplanations = prevShowExplanations;
				this.showReadingKana = prevShowReadingKana;
				this.showReadingZh = prevShowReadingZh;
				if (this.examMode === 'mock') {
					this.hideLearningAssists();
				}
				this.setAnswerSaveStatus('idle', '尚未作答');
				this.setInitialNavigationPosition();
				
				this.renderExam();
				this.categoryNavigationManager.initCategoryDropdowns();
				console.log('[ExamViewer] Render completed');
				this.loadTranslationsForReadingAssist();
				if (!this.wrongCorrectionContext && !skipDraftRestore) void this.restoreDraftForCurrentExam();

				// 模拟考试才启动正式计时；练习模式不展示或累计考试用时。
				try {
					if (this._currentExamId && this.examTimerManager) {
						if (this.examMode === 'mock') {
							this.examTimerManager.startForExam(this._currentExamId, this.extractExamTimerLimits());
						} else {
							this.examTimerManager.stop();
						}
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
		if (submitButton) submitButton.disabled = !this.currentExam || this.isSubmitted;
	}

	private syncMobilePaperSelector() {
		const panel = document.getElementById('exam-library-panel');
		const toggle = document.getElementById('mobile-paper-toggle') as HTMLButtonElement | null;
		const summary = document.getElementById('mobile-paper-summary');
		if (!panel || !toggle || !summary || !this.currentExam) return;

		const family = (document.getElementById('exam-family-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const level = (document.getElementById('exam-level-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const paper = (document.getElementById('exam-paper-select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() || '';
		const paperLabel = [family, level, paper].filter(Boolean).join(' · ') || '当前试卷';
		summary.dataset.paperLabel = paperLabel;
		const keepExpanded = panel.dataset.mobilePaperExpanded === 'true';
		summary.textContent = keepExpanded ? '收起' : paperLabel;
		panel.classList.add('mobile-paper-ready');
		panel.classList.toggle('mobile-paper-collapsed', !keepExpanded);
		toggle.setAttribute('aria-expanded', String(keepExpanded));
		toggle.setAttribute('aria-label', keepExpanded ? '收起试卷选择' : `展开试卷选择，当前${paperLabel}`);
		toggle.title = keepExpanded ? '收起试卷选择' : '展开试卷选择';
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

	private syncFloatingNavigationAlignment() {
		const commandBar = document.getElementById('exam-command-bar');
		if (commandBar) {
			const accountButton = document.getElementById('user-menu-trigger');
			const accountBox = accountButton?.getBoundingClientRect();
			const alignmentRight = accountBox && accountBox.width > 0
				? accountBox.right
				: commandBar.getBoundingClientRect().right;
			const rightOffset = Math.max(0, window.innerWidth - alignmentRight);
			document.documentElement.style.setProperty('--exam-floating-right-offset', `${rightOffset}px`);
		}
	}

	renderQuestionNavigation() {
		this.categoryNavigationManager.syncActiveCategory();
		const container = DOMUtils.safeGetElement("question-navigation", "renderQuestionNavigation");
		if (!container || !this.currentExam) { this.renderPracticeScrubber(); return; }

		DOMUtils.safeSetInnerHTML(container, "", "renderQuestionNavigation-clear");

		// 渲染底部导航按钮
		const currentCategory = this.getCurrentCategory();
		if (!currentCategory) { return; }

		const baseNavigationData = this.calculateNavigationData(currentCategory);
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
		const navElement = this.createNavigationElement(navigationData);

		container.appendChild(navElement);
		this.renderPracticeScrubber();
	}

	private renderPracticeScrubber(): void {
		const scoped = document.body.classList.contains('learning-shell-active')
			&& this.examMode === 'practice' && !!this.practiceScope && !this.wrongCorrectionContext && !this.isSubmitted;
		const positions = scoped ? this.getPracticeQuestions() : [];
		document.body.classList.toggle('practice-scrubber-active', scoped);
		let scrubber = document.getElementById('practice-scrubber');
		if (positions.length < 2) { scrubber?.remove(); return; }

		if (!scrubber) {
			scrubber = document.createElement('div');
			scrubber.id = 'practice-scrubber';
			scrubber.className = 'practice-scrubber';
			scrubber.setAttribute('role', 'slider');
			scrubber.setAttribute('aria-label', '预览并跳转练习题目');
			scrubber.setAttribute('aria-orientation', 'vertical');
			scrubber.tabIndex = 0;
			const track = document.createElement('div');
			track.className = 'practice-scrubber-track';
			const preview = document.createElement('div');
			preview.className = 'practice-scrubber-preview';
			preview.setAttribute('role', 'tooltip');
			const title = document.createElement('strong');
			const questionText = document.createElement('p');
			questionText.lang = 'ja';
			const context = document.createElement('p');
			context.className = 'practice-scrubber-context';
			context.lang = 'ja';
			const status = document.createElement('small');
			preview.append(title, questionText, context, status);
			scrubber.append(track, preview);
			const brief = (value: unknown, limit = 100) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
			const showPreview = (index: number, clientY: number) => {
				const questions = this.getPracticeQuestions();
				const item = questions[index];
				if (!item) return;
				const section = this.currentExam?.exam_info.sections[item.sectionIndex];
				const passage = item.question._groupPassage?.value || item.question.passage?.value || '';
				title.textContent = `${section?.section_name || section?.section_title || this.practiceScope?.label || '练习'} · 第 ${index + 1} 题`;
				questionText.textContent = brief(item.question.question || item.question.question_text || item.question.text || item.question.options?.[0] || '点击查看题目');
				context.textContent = brief(passage, 90);
				context.hidden = !context.textContent;
				const answer = this.answerManager.getAnswerComposite(item.sectionIndex, String(item.question.id));
				status.textContent = `${answer === undefined || answer === null || answer === '' ? '未作答' : '已作答'} · 点击跳转`;
				scrubber!.dataset.previewIndex = String(index);
				scrubber!.classList.add('has-preview');
				track.querySelectorAll('.is-preview, .is-wave-center').forEach(tick => tick.classList.remove('is-preview', 'is-wave-center'));
				track.children[index]?.classList.add('is-preview', 'is-wave-center');
				const bounds = scrubber!.getBoundingClientRect();
				const desiredTop = clientY - bounds.top - preview.offsetHeight / 2;
				preview.style.top = `${Math.max(8 - bounds.top, Math.min(window.innerHeight - preview.offsetHeight - 8 - bounds.top, desiredTop))}px`;
			};
			const hidePreview = () => {
				scrubber!.classList.remove('has-preview');
				delete scrubber!.dataset.previewIndex;
				track.querySelectorAll('.is-preview, .is-wave-center').forEach(tick => tick.classList.remove('is-preview', 'is-wave-center'));
			};
			const jump = (index: number) => {
				const questions = this.getPracticeQuestions();
				const target = questions[Math.max(0, Math.min(questions.length - 1, index))];
				if (target && (target.sectionIndex !== this.currentSectionIndex || target.questionIndex !== this.currentQuestionIndex)) {
					this.jumpToQuestion(target.sectionIndex, target.questionIndex);
				}
			};
			const indexAt = (clientY: number) => {
				const bounds = track.getBoundingClientRect();
				const count = this.getPracticeQuestions().length;
				return Math.round(Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)) * (count - 1));
			};
			track.addEventListener('pointerenter', event => showPreview(indexAt(event.clientY), event.clientY));
			track.addEventListener('pointermove', event => showPreview(indexAt(event.clientY), event.clientY));
			track.addEventListener('pointerleave', hidePreview);
			track.addEventListener('click', event => jump(indexAt(event.clientY)));
			scrubber.addEventListener('blur', hidePreview);
			scrubber.addEventListener('keydown', event => {
				const questions = this.getPracticeQuestions();
				const current = questions.findIndex(item => item.sectionIndex === this.currentSectionIndex && item.questionIndex === this.currentQuestionIndex);
				const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? current + 1
					: event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? current - 1
					: event.key === 'Home' ? 0 : event.key === 'End' ? questions.length - 1 : null;
				if (next === null) return;
				event.preventDefault();
				const tick = track.children[Math.max(0, Math.min(questions.length - 1, next))]?.getBoundingClientRect();
				if (tick) showPreview(Math.max(0, Math.min(questions.length - 1, next)), tick.top + tick.height / 2);
				jump(next);
			});
			document.body.appendChild(scrubber);
		}

		const track = scrubber.querySelector<HTMLElement>('.practice-scrubber-track')!;
		const current = positions.findIndex(item => item.sectionIndex === this.currentSectionIndex && item.questionIndex === this.currentQuestionIndex);
		const active = Math.max(0, current);
		track.style.height = `${Math.max(180, Math.min(440, positions.length * 12))}px`;
		track.style.setProperty('--scrubber-count', String(positions.length));
		track.replaceChildren(...positions.map((item, index) => {
			const tick = document.createElement('span');
			tick.className = 'practice-scrubber-tick';
			const answer = this.answerManager.getAnswerComposite(item.sectionIndex, String(item.question.id));
			if (answer !== undefined && answer !== null && answer !== '') tick.classList.add('is-answered');
			if (index === active) tick.classList.add('is-current');
			if (scrubber!.classList.contains('has-preview') && scrubber!.dataset.previewIndex === String(index)) tick.classList.add('is-preview', 'is-wave-center');
			return tick;
		}));
		scrubber.setAttribute('aria-valuemin', '1');
		scrubber.setAttribute('aria-valuemax', String(positions.length));
		scrubber.setAttribute('aria-valuenow', String(active + 1));
		scrubber.setAttribute('aria-valuetext', `第 ${active + 1} 题，共 ${positions.length} 题`);
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
		this.questionRenderer.renderCurrentQuestion();
		this.renderQuestionNavigation();
		this.renderWrongQuestionCorrectionBar();
		if (persistPosition) this.answerManager.saveCurrentDraft();
	}

	beginWrongQuestionCorrection(context: WrongCorrectionContext): void {
		this.wrongCorrectionContext = { ...context };
		this.wrongCorrectionResult = null;
		this.wrongCorrectionSubmitting = false;
		this.wrongCorrectionLoadPending = true;
		this.showAnswers = false;
		this.showExplanations = false;
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
			this.questionRenderer.renderCurrentQuestion();
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
		this.answerManager?.setAnswerComposite?.(context.sectionIndex, context.actualQuestionId, null);
		this.wrongCorrectionResult = null;
		this.showAnswers = false;
		this.showExplanations = false;
		this.isSubmitted = false;
		this.questionRenderer.renderCurrentQuestion();
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
		const isFinalExamQuestion = data.isFinalExamQuestion === true;

		const prevBtn = this.createNavigationButton({
			className: "nav-btn prev-btn",
			text: "上一题",
			disabled: !this.navigationManager.calculateNextPosition('prev'),
			onClick: () => {
				this.logger.debug('Right-bottom prev button clicked');
				this.navigateToPreviousQuestion();
			}
		});

		const nextBtn = this.createNavigationButton({
			className: `nav-btn next-btn${isFinalExamQuestion ? ' finish-btn' : ''}`,
			text: isFinalExamQuestion ? (this.savedPracticeMode === 'review' ? '已到最后一题' : this.examMode === 'mock' ? '检查并提交' : `完成${this.practiceScope?.label || '练习'}`) : "下一题",
			disabled: isFinalExamQuestion && this.savedPracticeMode === 'review',
			onClick: () => {
				if (isFinalExamQuestion) {
					this.finishPractice();
					return;
				}
				this.navigateToNextQuestion();
			}
		});

		const counter = DOMUtils.createElementWithClass(
			"span",
			"question-counter",
			`第${data.currentQuestionNumber}题/共${data.totalQuestions}题`
		);

		if (this.examMode === 'practice' && !this.wrongCorrectionContext) {
			const question = this.currentExam?.exam_info.sections[this.currentSectionIndex]?.questions?.[this.currentQuestionIndex];
			const answer = question && this.answerManager.getAnswerComposite(this.currentSectionIndex, String(question.id));
			const answered = answer !== undefined && answer !== null && answer !== '';
			const checked = this.isCurrentPracticeQuestionChecked();
			if (this.savedPracticeMode !== 'review') {
				const check = this.createNavigationButton({ className: 'nav-btn check-btn', text: checked ? (this.answerManager.evaluateQuestionAnswer(this.currentSectionIndex, this.currentQuestionIndex) ? '回答正确' : '回答错误') : '检查答案', disabled: !answered || checked || !question?.correct_answer,
					onClick: () => { this.audioManager.stopAllAudio(); this.checkedPracticeQuestions.add(`${this.currentSectionIndex}:${question!.id}`); this.renderExam(); } });
				navDiv.appendChild(check);
			}
			if (this.practiceScope) {
				const answeredCount = this.getPracticeQuestions().filter(item => { const value = this.answerManager.getAnswerComposite(item.sectionIndex, String(item.question.id)); return value !== undefined && value !== null && value !== ''; }).length;
				counter.textContent = `${this.practiceScope.label} · 第${data.currentQuestionNumber}/${data.totalQuestions}题 · 已答${answeredCount}/${data.totalQuestions}`;
			}
		}
		navDiv.appendChild(prevBtn);
		navDiv.appendChild(counter);
		navDiv.appendChild(nextBtn);
		if (this.examMode === 'practice' && this.practiceScope && !this.wrongCorrectionContext && this.savedPracticeMode !== 'review' && !isFinalExamQuestion) {
			navDiv.appendChild(this.createNavigationButton({ className: 'nav-btn end-practice-btn', text: '结束练习', onClick: () => this.finishPractice() }));
		}

		return navDiv;
	}

	createNavigationButton({ className, text, disabled, onClick }: NavigationButtonConfig) {
		const button = document.createElement('button');
		button.className = className;
		button.textContent = text;
		button.disabled = Boolean(disabled);
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
		if (!userId || userId === 'guest' || !examId || this.isSubmitted || this.savedPracticeMode) return;
		if (Object.values(this.userAnswers).some(answer => answer !== null && answer !== undefined && answer !== '')) return;
		const enabled = (window as Window & { isFeatureEnabled?: (key: string) => boolean }).isFeatureEnabled;
		if (enabled && !enabled('resume_draft')) return;
		const api = window.APIClient;
		if (!api || typeof api.getDraft !== 'function') return;
		const requestId = ++this._draftRestoreRequest;
		const answersAtRequest = JSON.stringify(this.userAnswers);
		try {
			const draft = await api.getDraft(userId) as {
				exam_id?: string;
				exam_mode?: ExamMode;
				answers?: Record<string, unknown>;
				answered_count?: number;
				last_section_index?: number;
				last_question_index?: number;
				revision?: number;
				attempt_id?: string;
			} | null;
			if (requestId !== this._draftRestoreRequest || this._currentExamId !== examId || JSON.stringify(this.userAnswers) !== answersAtRequest) return;
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
			this.examMode = draft.exam_mode;
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
		if (mode === 'mock' && this._currentExamId) {
			this.examTimerManager.startForExam(this._currentExamId, this.extractExamTimerLimits());
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
		return this.examMode === 'practice' || this.isSubmitted;
	}

	private updateLearningAssistAvailability() {
		const locked = !this.canUseLearningAssists();
		const controls = document.getElementById('exam-controls');
		controls?.classList.toggle('mock-active', locked);
		controls?.classList.toggle('practice-active', this.examMode === 'practice');
		const submitButton = document.getElementById('submit-exam') as HTMLButtonElement | null;
		if (submitButton) {
			submitButton.hidden = this.examMode !== 'mock';
			submitButton.setAttribute('aria-hidden', String(this.examMode !== 'mock'));
		}
		['toggle-answers', 'toggle-explanations', 'toggle-reading-kana', 'toggle-reading-zh'].forEach((id) => {
			const button = document.getElementById(id) as HTMLButtonElement | null;
			if (!button) return;
			if (!button.dataset.defaultTitle) button.dataset.defaultTitle = button.title;
			button.disabled = locked;
			button.hidden = locked;
			button.classList.toggle('learning-assist-locked', locked);
			button.title = locked ? '模拟考试提交后可以查看' : button.dataset.defaultTitle;
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
			if (this.examMode === 'mock') {
				this.examTimerManager.startForExam(this._currentExamId, this.extractExamTimerLimits());
			}
		}
	}

	toggleReadingKana(show: boolean | null = null) {
		if (!this.canUseLearningAssists()) return;
		this.showReadingKana = show !== null ? show : !this.showReadingKana;
		this.writeBooleanPreference('examViewer.showReadingKana', this.showReadingKana);
		this.renderExam();
		this.loadTranslationsForReadingAssist();
	}

	toggleReadingZh(show: boolean | null = null) {
		if (!this.canUseLearningAssists()) return;
		this.showReadingZh = show !== null ? show : !this.showReadingZh;
		this.writeBooleanPreference('examViewer.showReadingZh', this.showReadingZh);
		this.renderExam();

		const translationMgr = (window as unknown as {
			TranslationManager?: { loadForExam?: (id: string) => Promise<void> };
		}).TranslationManager;
		if (this.showReadingZh && this._currentExamId && translationMgr?.loadForExam) {
			void translationMgr.loadForExam(this._currentExamId).then(() => {
				this.questionRenderer.renderCurrentQuestion();
			});
		}
	}

	private updateReadingAssistButtonStates() {
		this.setToggleButtonActive('toggle-reading-kana', this.showReadingKana);
		this.setToggleButtonActive('toggle-reading-zh', this.showReadingZh);
		this.syncLearningToolsMenuState();
	}

	private syncLearningToolsMenuState() {
		const states: Record<string, boolean> = {
			'learning-menu-answers': this.showAnswers,
			'learning-menu-explanations': this.showExplanations,
			'learning-menu-kana': this.showReadingKana,
			'learning-menu-zh': this.showReadingZh
		};
		let activeCount = 0;
		for (const [id, active] of Object.entries(states)) {
			const button = document.getElementById(id);
			if (!button) continue;
			button.classList.toggle('active', active);
			button.setAttribute('aria-checked', String(active));
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
		const translationMgr = (window as unknown as {
			TranslationManager?: { loadForExam?: (id: string) => Promise<void> };
		}).TranslationManager;
		if ((!this.showReadingZh && !this.showReadingKana) || !this._currentExamId || !translationMgr?.loadForExam) {
			return;
		}
		void translationMgr.loadForExam(this._currentExamId).then(() => {
			this.questionRenderer.renderCurrentQuestion();
		});
	}

	beginPracticeReview(): () => void {
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
		this.showAnswers = show !== null ? show : !this.showAnswers;

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
		if (this.examMode === 'mock' && !options.automatic) {
			if (this.submitConfirmationPending) return;
			this.submitConfirmationPending = true;
			const answers = Object.values(this.userAnswers);
			const answered = answers.filter((answer) => answer !== null && answer !== undefined && answer !== '').length;
			const unanswered = Math.max(0, answers.length - answered);
			const message = unanswered > 0
				? `还有 ${unanswered} 题未作答。提交后不能继续修改，确定提交吗？`
				: '提交后不能继续修改，确定提交吗？';
			try {
				if (!await requestAppConfirmation(message, '确认交卷')) return;
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



