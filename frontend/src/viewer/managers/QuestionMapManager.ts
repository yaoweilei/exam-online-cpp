/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface QuestionMapQuestion {
	id: string | number;
	[key: string]: unknown;
}

interface QuestionMapSection {
	section_id?: string | number;
	section_title?: string;
	questions?: QuestionMapQuestion[];
	[key: string]: unknown;
}

interface QuestionMapCategory {
	id: string;
	label: string;
	sectionIndexes: number[];
}

interface QuestionMapExamViewer {
	currentExam?: {
		exam_info?: {
			sections?: QuestionMapSection[];
		};
	} | null;
	currentSectionIndex: number;
	currentQuestionIndex: number;
	userAnswers: Record<string, unknown>;
	showAnswers: boolean;
	getCategories: () => QuestionMapCategory[];
	audioManager: {
		stopAllAudio: () => void;
	};
	stateManager: {
		updateNavigationState: (sectionIndex: number, questionIndex: number, categoryId?: string | null) => void;
	};
	answerManager: {
		getAnswerComposite: (sectionIndex: number, questionId: string) => unknown;
		evaluateQuestionAnswer: (sectionIndex: number, questionIndex: number) => boolean;
	};
}

class QuestionMapManager {
	private readonly examViewer: QuestionMapExamViewer;
	private questionMapVisible = false;
	private questionMapContainer: HTMLDivElement | null = null;
	private questionMapContent: HTMLDivElement | null = null;

	constructor(examViewer: QuestionMapExamViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 初始化答题卡
	 */
	initQuestionMap(): void {
		this.questionMapVisible = false;
		this.questionMapContainer = null;
	}

	/**
	 * 显示答题卡
	 */
	showQuestionMap(): void {
		if (!this.examViewer.currentExam) {
			return;
		}

		if (!this.questionMapContainer) {
			this.createQuestionMapOverlay();
		}

		if (!this.questionMapContainer) {
			return;
		}

		this.questionMapVisible = true;
		this.questionMapContainer.style.display = 'flex';
		this.renderQuestionMap();
	}

	/**
	 * 隐藏答题卡
	 */
	hideQuestionMap(): void {
		if (this.questionMapContainer) {
			this.questionMapContainer.style.display = 'none';
		}
		this.questionMapVisible = false;
	}

	/**
	 * 创建答题卡覆盖层
	 */
	createQuestionMapOverlay(): void {
		this.questionMapContainer = document.createElement('div');
		this.questionMapContainer.id = 'question-map-overlay';
		this.questionMapContainer.style.cssText = `
			position: fixed;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			background: rgba(0, 0, 0, 0.5);
			z-index: 1000;
			display: flex;
			align-items: center;
			justify-content: center;
		`;
		document.body.appendChild(this.questionMapContainer);

		const mapContent = document.createElement('div');
		mapContent.style.cssText = `
			background: white;
			border-radius: 8px;
			padding: 12px;
			width: 350px;
			max-width: 90vw;
			max-height: 45vh;
			overflow-y: auto;
			box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
		`;

		const style = document.createElement('style');
		style.textContent = `
			#question-map-content {
				margin-top: 6px;
				padding: 0 4px;
			}

			.question-map-category {
				margin-bottom: 12px;
				border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.12));
				border-radius: 6px;
				padding: 8px;
				background: var(--vscode-input-background, rgba(0,0,0,0.02));
			}

			.question-map-category:last-child {
				margin-bottom: 0;
			}

			.question-map-category-title {
				margin: 0 0 10px 0;
				font-size: 14px;
				font-weight: 700;
				color: var(--vscode-foreground, rgba(0,0,0,0.85));
				padding: 4px 8px;
				background: var(--vscode-button-background, rgba(0,122,204,0.08));
				border-radius: 4px;
				border-left: 3px solid var(--vscode-button-background, rgba(0,122,204,0.6));
			}

			.question-map-section {
				display: flex;
				gap: 10px;
				margin-bottom: 8px;
				align-items: center;
			}

			.question-map-section:last-child {
				margin-bottom: 0;
			}

			.question-map-section-label {
				font-size: 13px;
				font-weight: 600;
				color: var(--vscode-foreground, rgba(0,0,0,0.75));
				white-space: nowrap;
				text-align: left;
				padding: 0;
				min-width: 36px;
				width: 36px;
				flex-shrink: 0;
			}

			.question-map-section-questions {
				display: grid;
				grid-template-columns: repeat(8, 26px);
				gap: 5px;
				flex: 1;
			}

			.question-map-item {
				width: 26px;
				height: 26px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 10px;
				font-weight: 500;
				border-radius: 4px;
				border: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.15));
				cursor: pointer;
				user-select: none;
				transition: all 0.2s ease;
				background: var(--vscode-editor-background, white);
				color: var(--vscode-foreground, black);
			}

			.question-map-item:hover {
				background: var(--vscode-list-hoverBackground, rgba(0,122,204,0.1));
				border-color: var(--vscode-button-background, rgba(0,122,204,0.4));
				transform: translateY(-2px);
				box-shadow: 0 2px 4px rgba(0,0,0,0.1);
			}

			.question-map-item.current {
				outline: 2px solid var(--vscode-button-background, rgba(0,122,204,0.9));
				background: var(--vscode-button-background, rgba(0,122,204,0.2));
				font-weight: 700;
				color: var(--vscode-button-foreground, white);
			}

			.question-map-item.correct {
				background: rgba(0, 200, 0, 0.12);
				border-color: var(--vscode-testing-iconPassed, rgba(0, 200, 0, 0.4));
				color: var(--vscode-testing-iconPassed, rgba(0, 150, 0, 1));
			}

			.question-map-item.incorrect {
				background: rgba(255, 0, 0, 0.1);
				border-color: var(--vscode-testing-iconFailed, rgba(255, 0, 0, 0.3));
				color: var(--vscode-testing-iconFailed, rgba(200, 0, 0, 1));
			}

			.question-map-item.unanswered {
				background: var(--vscode-editor-background, white);
				color: var(--vscode-foreground, black);
			}

			.question-map-item.answered {
				background: var(--vscode-button-background, rgba(0, 122, 204, 0.2));
				border-color: var(--vscode-button-background, rgba(0, 122, 204, 0.6));
				color: var(--vscode-button-foreground, white);
			}
		`;

		mapContent.appendChild(style);

		const closeBtn = document.createElement('button');
		closeBtn.setAttribute('aria-label', '关闭');
		closeBtn.innerHTML = '✕';
		closeBtn.style.cssText = `
			position: absolute;
			top: 6px;
			right: 6px;
			width: 20px;
			height: 20px;
			line-height: 18px;
			border-radius: 10px;
			border: none;
			background: rgba(0,0,0,0.05);
			font-size: 12px;
			cursor: pointer;
			color: rgba(0,0,0,0.6);
			transition: all 0.2s ease;
		`;
		closeBtn.onmouseover = () => {
			closeBtn.style.background = 'rgba(255,0,0,0.1)';
			closeBtn.style.color = 'rgba(255,0,0,0.8)';
		};
		closeBtn.onmouseout = () => {
			closeBtn.style.background = 'rgba(0,0,0,0.05)';
			closeBtn.style.color = 'rgba(0,0,0,0.6)';
		};
		closeBtn.onclick = (event) => {
			event.stopPropagation();
			this.hideQuestionMap();
		};
		mapContent.appendChild(closeBtn);

		const title = document.createElement('h3');
		title.textContent = '答题卡';
		title.style.marginTop = '0';
		mapContent.appendChild(title);

		this.questionMapContent = document.createElement('div');
		this.questionMapContent.id = 'question-map-content';
		mapContent.appendChild(this.questionMapContent);

		this.questionMapContainer.appendChild(mapContent);
		this.questionMapContainer.addEventListener('click', (event) => {
			if (event.target === this.questionMapContainer) {
				this.hideQuestionMap();
			}
		});
	}

	/**
	 * 渲染答题卡（按分类显示）
	 */
	renderQuestionMap(): void {
		if (!this.questionMapContent || !this.examViewer.currentExam) {
			console.warn('[QuestionMapManager] Cannot render: missing content or exam');
			return;
		}

		const sections = this.examViewer.currentExam.exam_info?.sections || [];
		const categories = this.examViewer.getCategories();

		console.log('[QuestionMapManager] Rendering question map:', {
			sectionsCount: sections.length,
			categoriesCount: categories.length,
			categories: categories.map((category) => ({
				id: category.id,
				label: category.label,
				sections: category.sectionIndexes.length
			}))
		});

		let html = '';

		categories.forEach((category) => {
			if (category.sectionIndexes.length === 0) {
				console.log(`[QuestionMapManager] Skipping empty category: ${category.label}`);
				return;
			}

			html += `<div class="question-map-category">
				<h3 class="question-map-category-title">${category.label}</h3>`;

			category.sectionIndexes.forEach((sectionIndex) => {
				const section = sections[sectionIndex];
				if (!section?.questions?.length) {
					console.log(`[QuestionMapManager] Skipping empty section at index ${sectionIndex}`);
					return;
				}

				console.log(`[QuestionMapManager] Rendering section ${sectionIndex}: ${section.questions.length} questions`);
				const sectionTitle = section.section_title || '';
				const match = sectionTitle.match(/問題\d+/);
				const sectionLabel = match ? match[0] : `Section ${section.section_id}`;

				html += `<div class="question-map-section">
					<span class="question-map-section-label">${sectionLabel}</span>
					<div class="question-map-section-questions">`;

				section.questions.forEach((question, questionIndex) => {
					const key = `${sectionIndex}:${String(question.id ?? questionIndex)}`;
					const isCurrent =
						sectionIndex === this.examViewer.currentSectionIndex &&
						questionIndex === this.examViewer.currentQuestionIndex;

					let isAnswered = false;
					try {
						const userAnswer = this.examViewer.answerManager.getAnswerComposite(sectionIndex, String(question.id));
						isAnswered = userAnswer !== undefined && userAnswer !== null;
					} catch {
						isAnswered = this.examViewer.userAnswers[key] !== undefined && this.examViewer.userAnswers[key] !== null;
					}

					let isCorrect = false;
					if (isAnswered && this.examViewer.showAnswers) {
						try {
							isCorrect = this.examViewer.answerManager.evaluateQuestionAnswer(sectionIndex, questionIndex);
						} catch (error) {
							console.warn('[QuestionMapManager] Failed to evaluate answer:', error);
							isCorrect = false;
						}
					}

					let statusClass = 'unanswered';
					if (isAnswered) {
						statusClass = this.examViewer.showAnswers ? (isCorrect ? 'correct' : 'incorrect') : 'answered';
					}
					if (isCurrent) {
						statusClass += ' current';
					}

					html += `<span class="question-map-item ${statusClass}" data-section="${sectionIndex}" data-question="${questionIndex}">
						${questionIndex + 1}
					</span>`;
				});

				html += '</div></div>';
			});

			html += '</div>';
		});

		console.log('[QuestionMapManager] Generated HTML length:', html.length);
		this.questionMapContent.innerHTML = html;

		this.questionMapContent.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			const item = target?.closest('.question-map-item') as HTMLElement | null;
			if (!item) {
				return;
			}

			const sectionValue = item.getAttribute('data-section');
			const questionValue = item.getAttribute('data-question');
			if (sectionValue === null || questionValue === null) {
				return;
			}

			const sectionIndex = Number.parseInt(sectionValue, 10);
			const questionIndex = Number.parseInt(questionValue, 10);
			if (Number.isNaN(sectionIndex) || Number.isNaN(questionIndex)) {
				return;
			}
			this.selectQuestion(sectionIndex, questionIndex, true);
		});
	}

	/**
	 * 选择题目
	 */
	selectQuestion(sectionIndex: number, questionIndex: number, keepOpen = false): void {
		this.examViewer.audioManager.stopAllAudio();
		this.examViewer.stateManager.updateNavigationState(sectionIndex, questionIndex);
		this.refreshQuestionMapHighlight();
		if (!keepOpen) {
			this.hideQuestionMap();
		}
	}

	/**
	 * 刷新答题卡高亮
	 */
	refreshQuestionMapHighlight(): void {
		if (!this.questionMapVisible || !this.questionMapContent) {
			return;
		}

		this.questionMapContent.querySelectorAll('.question-map-item').forEach((item) => {
			(item as HTMLElement).classList.remove('current');
		});

		const currentItem = this.questionMapContent.querySelector(
			`.question-map-item[data-section="${this.examViewer.currentSectionIndex}"][data-question="${this.examViewer.currentQuestionIndex}"]`
		) as HTMLElement | null;
		if (currentItem) {
			currentItem.classList.add('current');
		}
	}

	/**
	 * 刷新答题状态
	 */
	refreshQuestionMapAnswered(): void {
		this.evaluateAnswersInMap();
	}

	/**
	 * 评估答题卡中的答案
	 */
	evaluateAnswersInMap(): void {
		if (!this.questionMapContent) {
			return;
		}

		const items = this.questionMapContent.querySelectorAll('.question-map-item');
		items.forEach((itemNode) => {
			const item = itemNode as HTMLElement;
			const sectionValue = item.getAttribute('data-section');
			const questionValue = item.getAttribute('data-question');
			if (sectionValue === null || questionValue === null) {
				return;
			}

			const sectionIndex = Number.parseInt(sectionValue, 10);
			const questionIndex = Number.parseInt(questionValue, 10);
			if (Number.isNaN(sectionIndex) || Number.isNaN(questionIndex)) {
				return;
			}

			const isCorrect = this.examViewer.answerManager.evaluateQuestionAnswer(sectionIndex, questionIndex);
			item.classList.remove('correct', 'incorrect');
			if (this.examViewer.userAnswers[`${sectionIndex}:${questionIndex}`] !== undefined) {
				item.classList.add(isCorrect ? 'correct' : 'incorrect');
			}
		});
	}
}

window.QuestionMapManager = QuestionMapManager;
