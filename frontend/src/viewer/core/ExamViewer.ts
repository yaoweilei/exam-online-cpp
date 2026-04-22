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

type LegacyAnyRecord = Record<string, any>;

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
	currentCategory: string | null = 'vocab';
	userAnswers: Record<string, unknown> = {};
	showAnswers = false;
	showExplanations = false;
	contentWidthPx = 0;
	private _kbBound = false;
	_currentExamId: string | null = null;
	constructor() {
		// 初始化日志记录器
		this.logger = Logger.getLogger('ExamViewer');
		this.logger.info('Initializing exam viewer');

		// ==================== 核心状态管理 ====================
		this.currentExam = null;
		this.currentSectionIndex = 0;
		this.currentQuestionIndex = 0;
		this.currentCategory = 'vocab';
		this.userAnswers = {};
		this.showAnswers = false;
		this.showExplanations = false;
		this.contentWidthPx = 0;

		// ==================== 初始化管理器 ====================
		// 注意：初始化顺序很重要，某些管理器依赖其他管理器

		// 1. 基础管理器（无依赖）
		this.userContextManager = UserContextManager.getInstance();
		this.stateManager = new StateManager(this as any);
		this.navigationManager = new NavigationManager(this as any);

		// 2. 功能管理器（可能有依赖）
		this.audioManager = new AudioManager(this as any);
		this.furiganaManager = new FuriganaManager(this as any);
		this.answerManager = new AnswerManager(this as any);
		this.questionMapManager = new QuestionMapManager(this as any);
		this.categoryNavigationManager = new CategoryNavigationManager(this as any);
		this.questionRenderer = new QuestionRenderer(this as any);
		// 答题计时管理器（业务功能 3）
		this.examTimerManager = new ExamTimerManager(this as any);

		// ==================== 初始化各个子系统 ====================
		this.initializeEventListeners();
		this.loadExamData();
		
		// Web 应用模式下不自动调用 initExamLibrary（由 loader.js 处理）
		if (!window.__WEB_APP_MODE__) {
			this.initExamLibrary();
		}
		
		this.initWidthControl();
		this.questionMapManager.initQuestionMap();
		this.categoryNavigationManager.initCategoryDropdowns();
		this.furiganaManager.loadExternalFuriganaDict();
		this.furiganaManager.initFuriganaDebugBadge();

		// ==================== 后端通信设置 ====================
		this.setupBackendCommunication();
		this.userContextManager.addListener(this.onUserContextChanged.bind(this));

		// ==================== 延迟初始化 ====================
		setTimeout(() => {
			this.unifyTopAndCategoryButtonWidths();
		}, 100);

		console.log('[ExamViewer] Initialization completed');
	}

	// ==================== 后端通信管理 ====================

	onUserContextChanged(userContext: LegacyAnyRecord) {
		// 可以在这里添加需要响应用户上下文变更的逻辑
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
		console.log('[ExamViewer] Starting to load exam data:', examData ? 'external data' : 'inline data');

		try {
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
				
				this.resetExamState();
				
				// 恢复显示状态
				this.showAnswers = prevShowAnswers;
				this.showExplanations = prevShowExplanations;
				
				this.renderExam();
				this.updateNavigation();
				this.categoryNavigationManager.initCategoryDropdowns();
				console.log('[ExamViewer] Render completed');

				// 业务功能 3：试卷渲染完成后启动答题计时（仅登录用户 + 有 examId 时）
				try {
					if (this._currentExamId && this.examTimerManager) {
						const limits = this.extractExamTimerLimits();
						this.examTimerManager.startForExam(this._currentExamId, limits);
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
			// 如果 section 有 passages 但没有 questions，需要展平
			if (section.passages && Array.isArray(section.passages) && section.passages.length > 0) {
				const sectionQuestions = section.questions ?? (section.questions = []);

				// 遍历每篇文章
				const hasMultiplePassages = section.passages.length > 1;

				section.passages.forEach((passage: ExamViewerPassageGroup) => {
					if (passage.questions && Array.isArray(passage.questions)) {
						// 将文章信息附加到每道题目上
						passage.questions.forEach((question: ExamViewerQuestion) => {
							question._groupPassage = passage.passage;
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
		this.questionRenderer.renderCurrentQuestion();
		this.renderQuestionNavigation();
		this.renderAnswerPanel();

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
			return;
		}

		const examInfo = this.currentExam.exam_info;
		const headerHTML = this.createExamHeaderHTML(examInfo);
		DOMUtils.safeSetInnerHTML(container, headerHTML, 'renderExamHeader');
	}

	createExamHeaderHTML(examInfo: LegacyAnyRecord) {
		return `
			<h1 class="exam-title">${examInfo.title || '试卷'}</h1>
		`;
	}

	renderControls() {
		const controls = document.getElementById("exam-controls");
		if (!controls) {
			return;
		}
		// HTML模板中已经定义了所有需要的按钮
	}

	renderQuestionNavigation() {
		const container = DOMUtils.safeGetElement("question-navigation", "renderQuestionNavigation");
		if (!container || !this.currentExam) { return; }

		DOMUtils.safeSetInnerHTML(container, "", "renderQuestionNavigation-clear");

		// 渲染底部导航按钮
		const currentCategory = this.getCurrentCategory();
		if (!currentCategory) { return; }

		const navigationData = this.calculateNavigationData(currentCategory);
		const navElement = this.createNavigationElement(navigationData);

		container.appendChild(navElement);
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
				const sectionLabel = match ? match[0] : `Section ${section.section_id}`;

				// Section 标签
				const sectionLabelDiv = document.createElement('span');
				sectionLabelDiv.className = 'answer-card-section-label';
				sectionLabelDiv.textContent = sectionLabel;
				sectionDiv.appendChild(sectionLabelDiv);

				// 题号容器
				const questionsDiv = document.createElement('div');
				questionsDiv.className = 'answer-card-questions';

				// 渲染每道题的编号
				section.questions.forEach((question: ExamViewerQuestion, qIndex: number) => {
					const questionBtn = document.createElement('button');
					questionBtn.className = 'answer-card-question-btn';
					questionBtn.textContent = String(qIndex + 1);

					// 标记当前题目
					if (sectionIndex === this.currentSectionIndex && qIndex === this.currentQuestionIndex) {
						questionBtn.classList.add('current');
					}

					// 标记已答题目
					if (this.userAnswers[String(question.id)] !== undefined) {
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
	jumpToQuestion(sectionIndex: number, questionIndex: number) {
		if (!this.currentExam) {
			return;
		}
		// 停止所有正在播放的音频
		this.audioManager.stopAllAudio();

		this.currentSectionIndex = sectionIndex;
		this.currentQuestionIndex = questionIndex;

		// 更新分类
		const section = this.currentExam.exam_info.sections[sectionIndex];
		if (section && section.section_type) {
			const categoryMap: Record<string, string> = {
				'vocabulary': 'vocab',
				'reading': 'reading',
				'listening': 'listening'
			};
			this.currentCategory = categoryMap[section.section_type] || this.currentCategory;
		}

		// 重新渲染
		this.questionRenderer.renderCurrentQuestion();
		this.renderQuestionNavigation();
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

		const prevBtn = this.createNavigationButton({
			className: "nav-btn prev-btn",
			text: "上一题",
			disabled: false,
			onClick: () => {
				this.logger.debug('Right-bottom prev button clicked');
				this.navigateToPreviousQuestion();
			}
		});

		const nextBtn = this.createNavigationButton({
			className: "nav-btn next-btn",
			text: "下一题",
			disabled: false,
			onClick: () => this.navigateToNextQuestion()
		});

		const counter = DOMUtils.createElementWithClass(
			"span",
			"question-counter",
			`第${data.currentQuestionNumber}题/共${data.totalQuestions}题`
		);

		navDiv.appendChild(prevBtn);
		navDiv.appendChild(counter);
		navDiv.appendChild(nextBtn);

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
		const categories: Record<'vocabulary' | 'reading' | 'listening', CategoryItem> = {
			vocabulary: { id: 'vocab', label: '词汇', sectionIndexes: [] as number[] },
			reading: { id: 'reading', label: '阅读', sectionIndexes: [] as number[] },
			listening: { id: 'listening', label: '听力', sectionIndexes: [] as number[] }
		};

		// 根据 section_type 分类（新逻辑）
		sections.forEach((section: ExamViewerSection, index: number) => {
			const sectionType = section.section_type;
			if (sectionType === 'vocabulary' && categories.vocabulary) {
				categories.vocabulary.sectionIndexes.push(index);
			} else if (sectionType === 'reading' && categories.reading) {
				categories.reading.sectionIndexes.push(index);
			} else if (sectionType === 'listening' && categories.listening) {
				categories.listening.sectionIndexes.push(index);
			}
			// 如果没有 section_type，使用旧的 section_id 逻辑作为后备
			else if (!sectionType && typeof section.section_id === 'number') {
				const sectionId = section.section_id;
				if (sectionId >= 1.01 && sectionId <= 1.06) {
					categories.vocabulary.sectionIndexes.push(index);
				} else if (sectionId >= 1.07 && sectionId <= 1.99) {
					categories.reading.sectionIndexes.push(index);
				} else if (Math.floor(sectionId) === 2) {
					categories.listening.sectionIndexes.push(index);
				}
			}
		});

		return Object.values(categories);
	}

	getCurrentCategory() {
		const categories = this.getCategories();
		const result = categories.find(cat => cat.id === this.currentCategory) || categories[0];
		this.logger.debug('getCurrentCategory called:', {
			currentCategory: this.currentCategory,
			foundCategory: result
		});
		return result;
	}

	updateNavigation() {
		const prevBtn = document.getElementById('top-prev') as HTMLButtonElement | null;
		const nextBtn = document.getElementById('top-next') as HTMLButtonElement | null;

		if (prevBtn) {
			prevBtn.disabled = false;
		}

		if (nextBtn) {
			const nextPosition = this.navigationManager ?
				this.navigationManager.calculateNextPosition('next') : null;
			const canGoNext = nextPosition !== null;

			nextBtn.disabled = !canGoNext;
		}
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
	}

	setupGlobalEventDelegation() {
		const eventMap: Record<string, () => void> = {
			'#top-prev': () => this.navigateToPreviousQuestion(),
			'#top-next': () => this.navigateToNextQuestion(),
			'#toggle-answers': () => this.toggleAnswers(),
			'#toggle-explanations': () => this.toggleExplanations(),
			'#open-question-map': () => this.questionMapManager.showQuestionMap()
		};

		document.addEventListener('click', (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
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
			if (e.altKey || e.ctrlKey || e.metaKey) { return; }

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
	}

	toggleExplanations() {
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
				const success = this.navigationManager.navigateToQuestion('next');
				this.logger.debug('Navigation result:', success);
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

		container.innerHTML = `
			<div style="padding: 20px; text-align: center;">
				<h3>试卷已锁定</h3>
				<p>原因: ${reason}</p>
				<p>试卷 ID: ${examId}</p>
			</div>
		`;
	}

	// ==================== 宽度控制 ====================

	initWidthControl() {
		let slider = document.getElementById('width-slider') as HTMLInputElement | null;
		if (!slider) {
			const after = document.getElementById('exam-controls') || document.body.firstElementChild;
			const wrap = document.createElement('div');
			wrap.id = 'width-control';
			wrap.innerHTML = `<input id="width-slider" type="range" min="0" max="1800" step="10" />`;
			(after && after.parentNode) ? after.parentNode.insertBefore(wrap, after.nextSibling) : document.body.appendChild(wrap);
			slider = wrap.querySelector('#width-slider') as HTMLInputElement | null;
		}
		if (!slider) { return; }
		const STORAGE_KEY = 'examViewer.contentWidthPx';

		const apply = (px: number) => {
			this.contentWidthPx = px;
			const wrapper = document.getElementById('exam-workarea');
			if (!wrapper) { return; }
			const wc = document.getElementById('width-control');
			if (px <= 0) {
				wrapper.style.setProperty('--exam-content-width-internal', 'auto');
				wrapper.classList.add('unlimited');
				wrapper.classList.remove('limited');
				wrapper.dataset.width = 'auto';
				if (wc) { wc.style.removeProperty('max-width'); }
			} else {
				const effective = Math.max(390, px);
				if (effective !== px) {
					const sliderEl = document.getElementById('width-slider') as HTMLInputElement | null;
					if (sliderEl) { sliderEl.value = String(effective); }
					this.contentWidthPx = effective;
				}
				wrapper.style.setProperty('--exam-content-width-internal', this.contentWidthPx + 'px');
				wrapper.classList.remove('unlimited');
				wrapper.classList.add('limited');
				wrapper.dataset.width = String(this.contentWidthPx);
				if (wc) { wc.style.maxWidth = this.contentWidthPx + 'px'; }
			}
			const label = document.getElementById('width-value-label');
			if (label) { label.textContent = this.contentWidthPx > 0 ? (this.contentWidthPx + 'px') : '自动'; }
		};

		let stored: number;
		let raw: string | null = null;
		try { raw = localStorage.getItem(STORAGE_KEY); } catch { raw = null; }
		if (raw === null || raw === '') {
			stored = 1133;
		} else {
			stored = parseInt(raw, 10);
			if (isNaN(stored) || stored < 0) {
				stored = 1133;
			}
		}
		slider.value = String(stored);

		let label = document.getElementById('width-value-label') as HTMLSpanElement | null;
		if (!label) {
			label = document.createElement('span');
			label.id = 'width-value-label';
			label.style.cssText = 'margin-left:6px;font:12px monospace;color:var(--vscode-descriptionForeground);user-select:none;';
			if (slider.parentElement) { slider.parentElement.appendChild(label); }
		}
		apply(stored);

		let handle = document.getElementById('width-drag-handle') as HTMLElement | null;
		if (!handle) {
			handle = document.createElement('div');
			handle.id = 'width-drag-handle';
			handle.title = '拖拽调整宽度';
			const workarea = document.getElementById('exam-workarea');
			if (workarea) { workarea.appendChild(handle); }
		}
		if (handle && !handle._dragBound) {
			handle._dragBound = true;
			let dragging = false;
			let startX = 0;
			let startWidth = 0;
			const onMove = (ev: MouseEvent) => {
				if (!dragging) { return; }
				const dx = ev.clientX - startX;
				let newWidth = startWidth + dx;
				if (newWidth < 390) { newWidth = 390; }
				if (newWidth > 1800) { newWidth = 1800; }
				apply(newWidth);
				if (slider) { slider.value = String(newWidth); }
				try { localStorage.setItem('examViewer.contentWidthPx', String(newWidth)); } catch { }
			};
			const onUp = () => { dragging = false; document.body.classList.remove('resizing-width'); };
			handle.addEventListener('mousedown', (ev: MouseEvent) => {
				ev.preventDefault();
				const workarea = document.getElementById('exam-workarea');
				if (!workarea) { return; }
				dragging = true;
				startX = ev.clientX;
				startWidth = workarea.getBoundingClientRect().width;
				document.body.classList.add('resizing-width');
			});
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		}
		slider.addEventListener('input', () => {
			const px = parseInt(slider.value, 10) || 0;
			apply(px);
			try { localStorage.setItem(STORAGE_KEY, String(px)); } catch { }
		});
		slider.addEventListener('change', () => {
			const px = parseInt(slider.value, 10) || 0;
			if (px !== this.contentWidthPx) {
				apply(px);
				try { localStorage.setItem(STORAGE_KEY, String(px)); } catch { }
			}
		});
	}

	unifyTopAndCategoryButtonWidths() {
		// 统一顶部和分类按钮的宽度
		// 实现细节保持不变
	}

	// ==================== 考试控制 ====================

	startExam() {
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

	submitAnswers() {
		this.answerManager.submitAnswers();
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



