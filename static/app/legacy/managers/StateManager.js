"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
/**
 * 状态管理器 - 统一管理ExamViewer状态
 * 从 main.js 提取
 */
class StateManager {
    examViewer;
    logger;
    constructor(examViewer) {
        this.examViewer = examViewer;
        const loggerFactory = window.Logger;
        this.logger = loggerFactory?.getLogger?.('StateManager') ?? {
            debug: (...args) => console.debug(...args),
            info: (...args) => console.info(...args)
        };
    }
    /**
     * 更新导航状态
     */
    updateNavigationState(sectionIndex, questionIndex, categoryId = null) {
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
    resetExamState() {
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
    refreshUI() {
        if (this.examViewer.questionRenderer) {
            this.examViewer.questionRenderer.renderCurrentQuestion();
        }
        this.examViewer.renderQuestionNavigation();
    }
    /**
     * 批量更新状态
     */
    batchUpdate(updates) {
        Object.assign(this.examViewer, updates);
        this.refreshUI();
    }
}
if (typeof module !== 'undefined' && module?.exports) {
    module.exports = StateManager;
}
window.StateManager = StateManager;
//# sourceMappingURL=StateManager.js.map