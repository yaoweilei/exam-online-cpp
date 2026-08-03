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
	private previousFocus: HTMLElement | null = null;

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

		if (!this.questionMapVisible) this.previousFocus = document.activeElement as HTMLElement | null;
		this.questionMapVisible = true;
		this.questionMapContainer.style.display = 'flex';
		this.questionMapContainer.setAttribute('aria-hidden', 'false');
		this.renderQuestionMap();
		requestAnimationFrame(() => this.questionMapContainer?.querySelector<HTMLButtonElement>('[data-question-map-close]')?.focus());
	}

	/**
	 * 隐藏答题卡
	 */
	hideQuestionMap(): void {
		if (this.questionMapContainer) {
			this.questionMapContainer.style.display = 'none';
			this.questionMapContainer.setAttribute('aria-hidden', 'true');
		}
		this.questionMapVisible = false;
		if (this.previousFocus?.isConnected) this.previousFocus.focus();
	}

	/**
	 * 创建答题卡覆盖层
	 */
	createQuestionMapOverlay(): void {
		this.questionMapContainer = document.createElement('div');
		this.questionMapContainer.id = 'question-map-overlay';
		this.questionMapContainer.setAttribute('role', 'presentation');
		this.questionMapContainer.setAttribute('aria-hidden', 'true');
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
		mapContent.className = 'question-map-dialog';
		mapContent.setAttribute('role', 'dialog');
		mapContent.setAttribute('aria-modal', 'true');
		mapContent.setAttribute('aria-labelledby', 'question-map-title');
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
			.question-map-dialog {
				box-sizing: border-box;
				position: relative;
			}

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
				grid-template-columns: repeat(8, 32px);
				gap: 5px;
				flex: 1;
			}

			.question-map-item {
				width: 32px;
				height: 32px;
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

			@media (max-width: 520px) {
				.question-map-dialog {
					width: calc(100vw - 16px) !important;
					max-width: none !important;
					max-height: min(70dvh, 560px) !important;
					padding: 8px !important;
					overflow-x: hidden !important;
				}

				#question-map-title {
					margin: 0 44px 8px 4px !important;
					min-height: 36px;
					line-height: 36px;
				}

				#question-map-content {
					box-sizing: border-box;
					width: 100%;
					margin-top: 0;
					padding: 0 2px;
					overflow-x: hidden;
				}

				.question-map-category {
					box-sizing: border-box;
					width: 100%;
					padding: 6px;
				}

				.question-map-section {
					align-items: flex-start;
					gap: 6px;
				}

				.question-map-section-label {
					width: 34px;
					min-width: 34px;
					line-height: 40px;
				}

				.question-map-section-questions {
					min-width: 0;
					grid-template-columns: repeat(6, minmax(0, 1fr));
					gap: 4px;
				}
				.question-map-item {
					width: auto;
					min-width: 0;
					height: 40px;
					box-sizing: border-box;
				}

				.question-map-item:hover {
					transform: none;
				}

				.question-map-item.current {
					outline: 0 !important;
					box-shadow: inset 0 0 0 2px var(--vscode-button-background, rgba(0,122,204,0.9)) !important;
				}
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
		closeBtn.type = 'button';
		closeBtn.dataset.questionMapClose = '';
		closeBtn.setAttribute('aria-label', '关闭');
		closeBtn.innerHTML = '✕';
		closeBtn.style.cssText = `
			position: absolute;
			top: 6px;
			right: 6px;
			width: 44px;
			height: 44px;
			line-height: 42px;
			border-radius: 22px;
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
		title.id = 'question-map-title';
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
		this.questionMapContainer.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
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
				const sectionLabel = match ? match[0] : '';
				const sectionLabelHtml = sectionLabel
					? `<span class="question-map-section-label">${sectionLabel}</span>`
					: '';

				html += `<div class="question-map-section">
					${sectionLabelHtml}
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

					html += `<button type="button" class="question-map-item ${statusClass}" data-section="${sectionIndex}" data-question="${questionIndex}" aria-label="第 ${questionIndex + 1} 题">
						${questionIndex + 1}
					</button>`;
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

		const sections = this.examViewer.currentExam?.exam_info?.sections || [];
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

			const question = sections[sectionIndex]?.questions?.[questionIndex];
			const questionId = String(question?.id ?? questionIndex);
			let isAnswered = false;
			try {
				const answer = this.examViewer.answerManager.getAnswerComposite(sectionIndex, questionId);
				isAnswered = answer !== undefined && answer !== null;
			} catch {
				isAnswered = this.examViewer.userAnswers[`${sectionIndex}:${questionId}`] !== undefined
					&& this.examViewer.userAnswers[`${sectionIndex}:${questionId}`] !== null;
			}

			const isCorrect = this.examViewer.answerManager.evaluateQuestionAnswer(sectionIndex, questionIndex);
			item.classList.remove('answered', 'correct', 'incorrect', 'unanswered');
			if (!isAnswered) {
				item.classList.add('unanswered');
			} else if (this.examViewer.showAnswers) {
				item.classList.add(isCorrect ? 'correct' : 'incorrect');
			} else {
				item.classList.add('answered');
			}
		});
	}
}

window.QuestionMapManager = QuestionMapManager;
