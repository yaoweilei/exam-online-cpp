/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface LoggerLike {
	debug: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
}

interface StateManagedExamViewer {
	currentSectionIndex: number;
	currentQuestionIndex: number;
	currentCategory: string | null;
	userAnswers: Record<string, unknown>;
	showAnswers: boolean;
	showExplanations: boolean;
	questionRenderer?: {
		renderCurrentQuestion: () => void;
	};
	renderQuestionNavigation: () => void;
	[key: string]: unknown;
}

/**
 * 状态管理器 - 统一管理ExamViewer状态
 * 从 main.js 提取
 */
class StateManager {
	private readonly examViewer: StateManagedExamViewer;
	private readonly logger: LoggerLike;

	constructor(examViewer: StateManagedExamViewer) {
		this.examViewer = examViewer;
		const loggerFactory = window.Logger as { getLogger?: (tag: string) => LoggerLike } | undefined;
		this.logger = loggerFactory?.getLogger?.('StateManager') ?? {
			debug: (...args: unknown[]) => console.debug(...args),
			info: (...args: unknown[]) => console.info(...args)
		};
	}

	/**
	 * 更新导航状态
	 */
	updateNavigationState(sectionIndex: number, questionIndex: number, categoryId: string | null = null): void {
		this.logger.debug('updateNavigationState called:', {
			sectionIndex,
			questionIndex,
			categoryId,
			currentCategoryBefore: this.examViewer.currentCategory
		});

		this.examViewer.currentSectionIndex = sectionIndex;
		this.examViewer.currentQuestionIndex = questionIndex;

		if (categoryId && categoryId !== this.examViewer.currentCategory) {
			this.logger.info('Updating category:', {
				from: this.examViewer.currentCategory,
				to: categoryId
			});
			this.examViewer.currentCategory = categoryId;
		}

		this.logger.debug('currentCategory after:', this.examViewer.currentCategory);
		this.refreshUI();
	}

	/**
	 * 重置试卷状态
	 */
	resetExamState(): void {
		Object.assign(this.examViewer, {
			currentSectionIndex: 0,
			currentQuestionIndex: 0,
			userAnswers: {},
			showAnswers: false,
			showExplanations: false
		});
	}

	/**
	 * 刷新UI
	 */
	refreshUI(): void {
		if (this.examViewer.questionRenderer) {
			this.examViewer.questionRenderer.renderCurrentQuestion();
		}
		this.examViewer.renderQuestionNavigation();
	}

	/**
	 * 批量更新状态
	 */
	batchUpdate(updates: Partial<StateManagedExamViewer>): void {
		Object.assign(this.examViewer, updates);
		this.refreshUI();
	}
}

if (typeof module !== 'undefined' && module?.exports) {
	module.exports = StateManager;
}
window.StateManager = StateManager;
