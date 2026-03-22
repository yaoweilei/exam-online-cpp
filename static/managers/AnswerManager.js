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
	constructor(examViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 选择选项
	 */
	selectOption(questionId, optionIndex) {
		try {
			this.setAnswerComposite(this.examViewer.currentSectionIndex, questionId, optionIndex);
		} catch (_) {
			this.examViewer.userAnswers[questionId] = optionIndex;
		}

		const options = document.querySelectorAll(
			`[data-question-id="${questionId}"]`
		);
		options.forEach((option) => {
			option.classList.remove("selected");
		});

		const selectedOption = document.querySelector(
			`[data-question-id="${questionId}"][data-option-index="${optionIndex}"]`
		);
		if (selectedOption) {
			selectedOption.classList.add("selected");
		}

		try { this.examViewer.questionMapManager.refreshQuestionMapAnswered(); } catch (_) { }
		try { this.updateAnswerSummary(); } catch (_) { }
	}

	/**
	 * 初始化用户答案
	 */
	initializeUserAnswers() {
		this.examViewer.userAnswers = {};
		if (this.examViewer.currentExam && this.examViewer.currentExam.exam_info.sections) {
			this.examViewer.currentExam.exam_info.sections.forEach((section) => {
				section.questions?.forEach((question) => {
					this.examViewer.userAnswers[question.id] = null;
				});
			});
		}
	}

	/**
	 * 计算得分 - 已迁移到后端 API
	 * 使用 POST /api/v2/answers/submit 获取评分结果
	 */
	// calculateScore() - 已删除，使用后端 API

	/**
	 * 评估题目答案（客户端临时方法，用于答题卡显示）
	 * 注意：正式评分仍使用后端 API
	 */
	evaluateQuestionAnswer(sectionIndex, questionIndex) {
		if (!this.examViewer.currentExam) { return false; }
		
		const sections = this.examViewer.currentExam.exam_info?.sections || [];
		const section = sections[sectionIndex];
		if (!section || !section.questions) { return false; }
		
		const question = section.questions[questionIndex];
		if (!question) { return false; }
		
		// 获取用户答案
		const userAnswer = this.getAnswerComposite(sectionIndex, question.id);
		if (userAnswer === undefined || userAnswer === null) { return false; }
		
		// 获取正确答案
		const correctAnswer = question.correct_answer;
		if (correctAnswer === undefined || correctAnswer === null) { return false; }
		
		// 比较答案
		if (Array.isArray(correctAnswer)) {
			if (!Array.isArray(userAnswer)) { return false; }
			return this.arraysEqualShallow(userAnswer, correctAnswer);
		}
		
		return userAnswer === correctAnswer;
	}

	/**
	 * 浅比较数组
	 */
	arraysEqualShallow(arr1, arr2) {
		if (!Array.isArray(arr1) || !Array.isArray(arr2)) { return false; }
		if (arr1.length !== arr2.length) { return false; }
		
		const sorted1 = [...arr1].sort();
		const sorted2 = [...arr2].sort();
		
		for (let i = 0; i < sorted1.length; i++) {
			if (sorted1[i] !== sorted2[i]) { return false; }
		}
		
		return true;
	}

	/**
	 * 更新答题概览
	 */
	updateAnswerSummary() {
		const summary = document.getElementById("answer-summary");
		if (!summary) {
			return;
		}

		const answeredCount = Object.values(this.examViewer.userAnswers).filter(
			(answer) => answer !== null
		).length;
		const totalCount = Object.keys(this.examViewer.userAnswers).length;

		summary.innerHTML = `
			<p>已答题: ${answeredCount}/${totalCount}</p>
			<p>进度: ${Math.round((answeredCount / totalCount) * 100)}%</p>
		`;
	}

	/**
	 * 提交答案 - 使用后端 API 进行评分
	 */
	async submitAnswers() {
		try {
			const result = window.APIClient
				? await window.APIClient.submitAnswers(
					this.examViewer.userId || 'guest',
					this.examViewer._currentExamId || 'unknown',
					this.examViewer.userAnswers
				)
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
					const payload = await response.json();
					return payload.data !== undefined ? payload.data : payload;
				})();
			
			// 显示答案
			this.examViewer.showAnswers = true;
			this.examViewer.renderExam();

			// 显示评分结果
			this.showResults(result);

			// 通知 VSCode（如果在扩展环境中）
			if (typeof vscode !== 'undefined') {
				vscode.postMessage({
					type: "answersSubmitted",
					data: result
				});
			}
		} catch (error) {
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

	/**
	 * 复合键相关方法
	 */
	_makeKey(sectionIndex, questionId) {
		return `${sectionIndex}:${questionId}`;
	}

	isAnsweredComposite(sectionIndex, questionId) {
		const k = this._makeKey(sectionIndex, questionId);
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k)) { return true; }
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)) { return true; }
		return false;
	}

	getAnswerComposite(sectionIndex, questionId) {
		const k = this._makeKey(sectionIndex, questionId);
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k)) { return this.examViewer.userAnswers[k]; }
		if (Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)) { return this.examViewer.userAnswers[questionId]; }
		return undefined;
	}

	setAnswerComposite(sectionIndex, questionId, value) {
		const k = this._makeKey(sectionIndex, questionId);
		if (!Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, k) && Object.prototype.hasOwnProperty.call(this.examViewer.userAnswers, questionId)) {
			delete this.examViewer.userAnswers[questionId];
		}
		this.examViewer.userAnswers[k] = value;
	}
}
// Export to global scope
window.AnswerManager = AnswerManager;
