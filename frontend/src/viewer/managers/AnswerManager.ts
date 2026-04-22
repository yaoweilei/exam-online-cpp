/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

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
	[key: string]: unknown;
}

interface AnswerManagerExamViewer {
	currentSectionIndex: number;
	currentQuestionIndex: number;
	userId?: string;
	_currentExamId?: string;
	currentExam?: LegacyExam | null;
	userAnswers: Record<string, unknown>;
	showAnswers: boolean;
	questionMapManager?: {
		refreshQuestionMapAnswered: () => void;
	};
	renderExam: () => void;
}

/**
 * 答题管理器 - 负责答案选择、评分和答题状态管理
 */
class AnswerManager {
	private readonly examViewer: AnswerManagerExamViewer;

	// 业务功能 4：草稿自动保存的节流计时器（避免每次点击都打接口）
	private draftSaveTimer: number | null = null;

	constructor(examViewer: AnswerManagerExamViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 业务功能 4：节流保存草稿（自上次触发起 1.5 秒内合并）
	 * - 仅登录用户保存（guest 不写）
	 * - 仅有 _currentExamId 时保存
	 */
	private scheduleDraftSave(): void {
		const userId = this.examViewer.userId;
		const examId = this.examViewer._currentExamId;
		if (!userId || userId === 'guest' || !examId) {
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
		if (this.draftSaveTimer !== null) {
			window.clearTimeout(this.draftSaveTimer);
		}
		this.draftSaveTimer = window.setTimeout(() => {
			this.draftSaveTimer = null;
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
				void api.saveDraft(userId, {
					exam_id: examId,
					total_questions: total,
					answered_count: answered,
					last_section_index: this.examViewer.currentSectionIndex,
					last_question_index: this.examViewer.currentQuestionIndex,
					answers
				});
			} catch {
				// 草稿保存失败不打扰用户
			}
		}, 1500);
	}

	/**
	 * 选择选项
	 */
	selectOption(questionId: string, optionIndex: number): void {
		try {
			this.setAnswerComposite(this.examViewer.currentSectionIndex, questionId, optionIndex);
		} catch {
			this.examViewer.userAnswers[questionId] = optionIndex;
		}

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

		// 业务功能 4：每次答题变更后触发草稿节流保存
		this.scheduleDraftSave();
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

	/**
	 * 提交答案 - 使用后端 API 进行评分
	 */
	async submitAnswers(): Promise<void> {
		try {
			const result = window.APIClient
				? ((await window.APIClient.submitAnswers(
						this.examViewer.userId || 'guest',
						this.examViewer._currentExamId || 'unknown',
						this.examViewer.userAnswers
				  )) as ScoreResult)
				: await (async (): Promise<ScoreResult> => {
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
						const payload = (await response.json()) as Partial<ApiEnvelope<ScoreResult>> | ScoreResult;
						return (payload as Partial<ApiEnvelope<ScoreResult>>).data || (payload as ScoreResult);
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
		} catch (error) {
			console.error('[AnswerManager] Failed to submit answers:', error);
			alert('提交答案失败，请重试');
		}
	}

	/**
	 * 显示评分结果
	 */
	showResults(result: ScoreResult): void {
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
