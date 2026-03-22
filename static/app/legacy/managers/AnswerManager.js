"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
/**
 * 答题管理器 - 负责答案选择、评分和答题状态管理
 */
class AnswerManager {
    examViewer;
    constructor(examViewer) {
        this.examViewer = examViewer;
    }
    /**
     * 选择选项
     */
    selectOption(questionId, optionIndex) {
        try {
            this.setAnswerComposite(this.examViewer.currentSectionIndex, questionId, optionIndex);
        }
        catch {
            this.examViewer.userAnswers[questionId] = optionIndex;
        }
        const options = document.querySelectorAll(`[data-question-id="${questionId}"]`);
        options.forEach((option) => {
            option.classList.remove('selected');
        });
        const selectedOption = document.querySelector(`[data-question-id="${questionId}"][data-option-index="${optionIndex}"]`);
        if (selectedOption) {
            selectedOption.classList.add('selected');
        }
        try {
            this.examViewer.questionMapManager?.refreshQuestionMapAnswered();
        }
        catch {
            // ignore
        }
        try {
            this.updateAnswerSummary();
        }
        catch {
            // ignore
        }
    }
    /**
     * 初始化用户答案
     */
    initializeUserAnswers() {
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
    evaluateQuestionAnswer(sectionIndex, questionIndex) {
        if (!this.examViewer.currentExam)
            return false;
        const sections = this.examViewer.currentExam.exam_info?.sections || [];
        const section = sections[sectionIndex];
        if (!section || !section.questions)
            return false;
        const question = section.questions[questionIndex];
        if (!question)
            return false;
        const userAnswer = this.getAnswerComposite(sectionIndex, String(question.id));
        if (userAnswer === undefined || userAnswer === null)
            return false;
        const correctAnswer = question.correct_answer;
        if (correctAnswer === undefined || correctAnswer === null)
            return false;
        if (Array.isArray(correctAnswer)) {
            if (!Array.isArray(userAnswer))
                return false;
            return this.arraysEqualShallow(userAnswer, correctAnswer);
        }
        return userAnswer === correctAnswer;
    }
    /**
     * 浅比较数组
     */
    arraysEqualShallow(arr1, arr2) {
        if (!Array.isArray(arr1) || !Array.isArray(arr2))
            return false;
        if (arr1.length !== arr2.length)
            return false;
        const sorted1 = [...arr1].map(String).sort();
        const sorted2 = [...arr2].map(String).sort();
        for (let i = 0; i < sorted1.length; i += 1) {
            if (sorted1[i] !== sorted2[i])
                return false;
        }
        return true;
    }
    /**
     * 更新答题概览
     */
    updateAnswerSummary() {
        const summary = document.getElementById('answer-summary');
        if (!summary)
            return;
        const answeredCount = Object.values(this.examViewer.userAnswers).filter((answer) => answer !== null).length;
        const totalCount = Object.keys(this.examViewer.userAnswers).length;
        const progress = totalCount > 0 ? Math.round((answeredCount / totalCount) * 100) : 0;
        summary.innerHTML = `
			<p>已答题: ${answeredCount}/${totalCount}</p>
			<p>进度: ${progress}%</p>
		`;
    }
    /**
     * 提交答案 - 使用后端 API 进行评分
     */
    async submitAnswers() {
        try {
            const result = window.APIClient
                ? (await window.APIClient.submitAnswers(this.examViewer.userId || 'guest', this.examViewer._currentExamId || 'unknown', this.examViewer.userAnswers))
                : await (async () => {
                    const apiBase = window.__API_BASE__ || '/api/v2';
                    const response = await fetch(`${apiBase}/answers/submit`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            user_id: this.examViewer.userId || 'guest',
                            exam_id: this.examViewer._currentExamId || 'unknown',
                            answers: this.examViewer.userAnswers
                        })
                    });
                    const payload = (await response.json());
                    return payload.data || payload;
                })();
            this.examViewer.showAnswers = true;
            this.examViewer.renderExam();
            this.showResults(result);
            if (typeof vscode !== 'undefined' && vscode) {
                vscode.postMessage({
                    type: 'answersSubmitted',
                    data: result
                });
            }
        }
        catch (error) {
            console.error('[AnswerManager] Failed to submit answers:', error);
            alert('提交答案失败，请重试');
        }
    }
    /**
     * 显示评分结果
     */
    showResults(result) {
        const message = `
评分结果：
━━━━━━━━━━━━━━━━
总题数：${result.total_questions}
正确：${result.correct_count} 题
错误：${result.wrong_count} 题
未答：${result.unanswered_count} 题
━━━━━━━━━━━━━━━━
得分：${result.score} 分
正确率：${result.accuracy}%
完成度：${result.completion}%
		`.trim();
        alert(message);
    }
    _makeKey(sectionIndex, questionId) {
        return `${sectionIndex}:${questionId}`;
    }
    isAnsweredComposite(sectionIndex, questionId) {
        const k = this._makeKey(sectionIndex, questionId);
        if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k))
            return true;
        if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId))
            return true;
        return false;
    }
    getAnswerComposite(sectionIndex, questionId) {
        const k = this._makeKey(sectionIndex, questionId);
        if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k))
            return this.examViewer.userAnswers[k];
        if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId))
            return this.examViewer.userAnswers[questionId];
        return undefined;
    }
    setAnswerComposite(sectionIndex, questionId, value) {
        const k = this._makeKey(sectionIndex, questionId);
        if (!Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k) &&
            Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)) {
            delete this.examViewer.userAnswers[questionId];
        }
        this.examViewer.userAnswers[k] = value;
    }
}
window.AnswerManager = AnswerManager;
//# sourceMappingURL=AnswerManager.js.map