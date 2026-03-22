"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
/**
 * 导航管理器 - 统一处理题目导航逻辑
 */
class NavigationManager {
    examViewer;
    logger;
    constructor(examViewer) {
        this.examViewer = examViewer;
        const loggerFactory = window.Logger;
        this.logger = loggerFactory?.getLogger?.('NavigationManager') ?? {
            debug: (...args) => console.debug(...args),
            info: (...args) => console.info(...args),
            error: (...args) => console.error(...args)
        };
    }
    calculateNextPosition(direction) {
        const { currentExam, currentSectionIndex, currentQuestionIndex, currentCategory } = this.examViewer;
        this.logger.debug('calculateNextPosition called with:', {
            direction,
            currentSectionIndex,
            currentQuestionIndex,
            currentCategory
        });
        if (!currentExam || !currentCategory) {
            this.logger.debug('Missing exam or category');
            return null;
        }
        const currentCategoryData = this.examViewer.getCurrentCategory();
        this.logger.debug('currentCategoryData:', currentCategoryData);
        if (!currentCategoryData) {
            return null;
        }
        const sections = currentExam.exam_info?.sections || [];
        const currentSection = sections[currentSectionIndex];
        this.logger.info('Current section:', currentSection);
        if (direction === 'next') {
            return this.calculateNextQuestionPosition(currentCategoryData, sections, currentSection) ?? null;
        }
        return this.calculatePrevQuestionPosition(currentCategoryData, sections, currentSection);
    }
    calculateNextQuestionPosition(currentCategoryData, sections, currentSection) {
        const { currentSectionIndex, currentQuestionIndex } = this.examViewer;
        if (currentSection &&
            Array.isArray(currentSection.questions) &&
            currentQuestionIndex < currentSection.questions.length - 1) {
            return {
                sectionIndex: currentSectionIndex,
                questionIndex: currentQuestionIndex + 1
            };
        }
        const currentSectionIndexInCategory = currentCategoryData.sectionIndexes.indexOf(currentSectionIndex);
        if (currentSectionIndexInCategory < currentCategoryData.sectionIndexes.length - 1) {
            const nextSectionIndex = currentCategoryData.sectionIndexes[currentSectionIndexInCategory + 1];
            return {
                sectionIndex: nextSectionIndex,
                questionIndex: 0
            };
        }
        const categories = this.examViewer.getCategories();
        const currentCategoryIndex = categories.findIndex((cat) => cat.id === this.examViewer.currentCategory);
        if (currentCategoryIndex < categories.length - 1) {
            const nextCategory = categories[currentCategoryIndex + 1];
            return {
                sectionIndex: nextCategory.sectionIndexes[0],
                questionIndex: 0,
                categoryId: nextCategory.id
            };
        }
        return null;
    }
    calculatePrevQuestionPosition(currentCategoryData, sections, _currentSection) {
        const { currentSectionIndex, currentQuestionIndex } = this.examViewer;
        if (currentQuestionIndex > 0) {
            return {
                sectionIndex: currentSectionIndex,
                questionIndex: currentQuestionIndex - 1
            };
        }
        const currentSectionIndexInCategory = currentCategoryData.sectionIndexes.indexOf(currentSectionIndex);
        this.logger.debug('calculatePrevQuestionPosition:', {
            currentSectionIndex,
            currentSectionIndexInCategory,
            sectionIndexes: currentCategoryData.sectionIndexes
        });
        if (currentSectionIndexInCategory > 0) {
            const prevSectionIndex = currentCategoryData.sectionIndexes[currentSectionIndexInCategory - 1];
            const prevSection = sections[prevSectionIndex];
            if (prevSection && Array.isArray(prevSection.questions) && prevSection.questions.length > 0) {
                return {
                    sectionIndex: prevSectionIndex,
                    questionIndex: prevSection.questions.length - 1
                };
            }
            for (let i = currentSectionIndexInCategory - 2; i >= 0; i -= 1) {
                const sectionIndex = currentCategoryData.sectionIndexes[i];
                const section = sections[sectionIndex];
                if (section && Array.isArray(section.questions) && section.questions.length > 0) {
                    return {
                        sectionIndex,
                        questionIndex: section.questions.length - 1
                    };
                }
            }
        }
        const categories = this.examViewer.getCategories();
        const currentCategoryIndex = categories.findIndex((cat) => cat.id === this.examViewer.currentCategory);
        if (currentCategoryIndex > 0) {
            const prevCategory = categories[currentCategoryIndex - 1];
            if (prevCategory.sectionIndexes.length > 0) {
                const lastSectionIndex = prevCategory.sectionIndexes[prevCategory.sectionIndexes.length - 1];
                const lastSection = sections[lastSectionIndex];
                if (lastSection && Array.isArray(lastSection.questions) && lastSection.questions.length > 0) {
                    return {
                        sectionIndex: lastSectionIndex,
                        questionIndex: lastSection.questions.length - 1,
                        categoryId: prevCategory.id
                    };
                }
            }
        }
        this.logger.debug('Already at first question of entire exam');
        return null;
    }
    navigateToQuestion(direction) {
        this.logger.debug('========== navigateToQuestion START ==========');
        this.logger.debug('navigateToQuestion called with:', {
            direction,
            examExists: !!this.examViewer.currentExam,
            currentCategory: this.examViewer.currentCategory
        });
        const newPosition = this.calculateNextPosition(direction);
        this.logger.debug('newPosition:', newPosition);
        if (!newPosition) {
            this.logger.debug('No new position found');
            this.logger.debug('========== navigateToQuestion END (no position) ==========');
            return false;
        }
        this.logger.debug('Calling stateManager.updateNavigationState with:', {
            sectionIndex: newPosition.sectionIndex,
            questionIndex: newPosition.questionIndex,
            categoryId: newPosition.categoryId,
            stateManagerExists: !!this.examViewer.stateManager
        });
        try {
            this.examViewer.stateManager.updateNavigationState(newPosition.sectionIndex, newPosition.questionIndex, newPosition.categoryId);
            this.logger.info('Navigation completed successfully');
        }
        catch (error) {
            this.logger.error('State update error:', error);
            this.logger.debug('========== navigateToQuestion END (error) ==========');
            return false;
        }
        this.logger.debug('========== navigateToQuestion END (success) ==========');
        return true;
    }
}
if (typeof module !== 'undefined' && module?.exports) {
    module.exports = NavigationManager;
}
window.NavigationManager = NavigationManager;
//# sourceMappingURL=NavigationManager.js.map