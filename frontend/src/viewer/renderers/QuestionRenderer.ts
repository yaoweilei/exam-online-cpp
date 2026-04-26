/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/


type RendererAnyRecord = Record<string, any>;

interface RendererExamViewer {
	[key: string]: any;
	currentExam: RendererAnyRecord | null;
	currentSectionIndex: number;
	currentQuestionIndex: number;
	showAnswers: boolean;
	showExplanations: boolean;
	showReadingKana: boolean;
	showReadingZh: boolean;
	userAnswers: Record<string, any>;
	audioManager: RendererAnyRecord;
	answerManager: RendererAnyRecord;
	furiganaManager?: {
		annotateFurigana?: (text: string) => string;
	};
}
class QuestionRenderer {
	private readonly examViewer: RendererExamViewer;
	constructor(examViewer: RendererExamViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 渲染当前题目
	 */
	renderCurrentQuestion() {
		const container = document.getElementById("current-question-container");
		if (!container || !this.examViewer.currentExam) {
			return;
		}

		container.innerHTML = "";

		const currentSection = this.examViewer.currentExam.exam_info.sections[this.examViewer.currentSectionIndex];
		if (!currentSection || !currentSection.questions || currentSection.questions.length === 0) {
			container.innerHTML = '<div class="no-content">当前章节没有可用的题目</div>';
			return;
		}

		const currentQuestion = (currentSection && Array.isArray(currentSection.questions))
			? currentSection.questions[this.examViewer.currentQuestionIndex]
			: undefined;

		if (!currentQuestion) {
			return;
		}

		const questionDiv = document.createElement("div");
		questionDiv.className = "current-question";

		const questionNumber = currentQuestion.id;

		const sectionInfo = document.createElement("div");
		sectionInfo.className = "section-info";
		const sectionTitle = currentSection.section_title || '';
		sectionInfo.innerHTML = `
			<h3>${sectionTitle}</h3>
		`;

		const questionContent = document.createElement("div");
		questionContent.className = "question-content";

		if (currentSection.passage) {
			if (!currentSection.questions || !currentSection.questions[this.examViewer.currentQuestionIndex] || !currentSection.questions[this.examViewer.currentQuestionIndex]._groupPassage) {
				const passageKey = `${currentSection.section_id || ''}:passage`;
				questionContent.appendChild(this.createPassageElement(currentSection.passage, null, passageKey));
			}
		}

		if (currentQuestion._groupPassage) {
			const passageKey = currentQuestion._groupPassageKey || `${currentSection.section_id || ''}:${currentQuestion.id ?? ''}`;
			const passageEl = this.createPassageElement(currentQuestion._groupPassage, null, passageKey);
			if (currentQuestion._groupIndex || currentQuestion._groupTopic) {
				const meta = document.createElement("div");
				meta.className = "passage-group-meta";
				const parts: string[] = [];
				// if (currentQuestion._groupIndex) { parts.push(`第${currentQuestion._groupIndex}篇`); }
				// if (currentQuestion._groupTopic) { parts.push(currentQuestion._groupTopic); }
				meta.textContent = parts.join("  ");
				passageEl.prepend(meta);
			}
			questionContent.appendChild(passageEl);
		}

		questionContent.appendChild(
			this.createQuestionElement(
				currentQuestion,
				this.examViewer.currentSectionIndex,
				this.examViewer.currentQuestionIndex
			)
		);

		questionDiv.appendChild(sectionInfo);
		questionDiv.appendChild(questionContent);
		container.appendChild(questionDiv);
	}

	/**
	 * 创建材料元素
	 *  passageKey: 用于句级译文（B2）的稳定键，推荐 "{section_id}:{question_id}" 或 "{section_id}:passage"
	 */
	createPassageElement(passage: RendererAnyRecord, question: RendererAnyRecord | null = null, passageKey: string = "") {
		const passageDiv = DOMUtils.createElementWithClass("div", "passage");
		if (passageKey) {
			passageDiv.dataset.passageKey = passageKey;
		}
		// examId 也挂在 passage 上，便于句级译文 chip 通过 closest('[data-exam-id]') 找回
		const viewerExamId = (this.examViewer as { _currentExamId?: string | null })._currentExamId || '';
		if (viewerExamId) {
			passageDiv.dataset.examId = viewerExamId;
		}

		if (passage.title) {
			const title = DOMUtils.createElementWithClass("div", "passage-title", passage.title);
			passageDiv.appendChild(title);
		}

		const content = DOMUtils.createElementWithClass("div", "passage-content");
		this.setPassageContent(content, passage, question, passageKey);

		passageDiv.appendChild(content);
		return passageDiv;
	}

	/**
	 * 设置材料内容
	 */
	setPassageContent(
		contentElement: HTMLElement,
		passage: RendererAnyRecord,
		question: RendererAnyRecord | null = null,
		passageKey: string = ""
	) {
		if (passage.type === "text") {
			// 优先使用passage自己的target_words，其次使用question的target_words
			const targetWords = passage.target_words || (question && question.target_words);
			const rawText: string = String(passage.value || "");
			// 按段（\n）和句（。！？!?…）切分，方便：
			//   1. 自学者按句精读 / 按段把握结构
			//   2. 解释面板的「答案出处第 N 段第 M 句」按钮可定位高亮
			// 字段不存在时 spans 仍然渲染，零侵入。
			const formattedHtml = this.buildSentenceWrappedHtml(rawText, targetWords, passageKey);
			DOMUtils.safeSetInnerHTML(contentElement, formattedHtml, "setPassageContent-text");
		} else if (passage.type === "image") {
			const wrapper = DOMUtils.createElementWithClass("div", "exam-image-wrapper");
			const img = DOMUtils.createElementWithClass("img", "exam-image");
			img.src = passage.url || "";
			img.alt = passage.alt_text || "";
			
			// 从localStorage读取保存的图片尺寸
			const savedWidth = localStorage.getItem('exam-image-width');
			if (savedWidth) {
				wrapper.style.width = savedWidth + 'px';
			}
			
			// 创建右下角拖拽手柄
			const resizeHandle = DOMUtils.createElementWithClass("div", "exam-image-resize-handle");
			resizeHandle.title = "拖动调整图片大小";
			
			// 添加拖拽功能
			this.makeImageResizable(wrapper, resizeHandle);
			
			wrapper.appendChild(img);
			wrapper.appendChild(resizeHandle);
			contentElement.appendChild(wrapper);
		}
	}

	/**
	 * 使图片可通过拖拽调整大小
	 */
	makeImageResizable(wrapper: HTMLElement, handle: HTMLElement) {
		let isResizing = false;
		let startX = 0;
		let startWidth = 0;

		const onMouseDown = (e: MouseEvent) => {
			isResizing = true;
			startX = e.clientX;
			startWidth = wrapper.offsetWidth;
			
			// 添加拖拽时的样式
			document.body.style.cursor = 'nwse-resize';
			wrapper.classList.add('resizing');
			
			e.preventDefault();
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!isResizing) return;
			
			const deltaX = e.clientX - startX;
			const newWidth = Math.max(200, Math.min(1200, startWidth + deltaX));
			
			wrapper.style.width = newWidth + 'px';
		};

		const onMouseUp = () => {
			if (!isResizing) return;
			
			isResizing = false;
			document.body.style.cursor = '';
			wrapper.classList.remove('resizing');
			
			// 保存到localStorage
			localStorage.setItem('exam-image-width', String(wrapper.offsetWidth));
		};

		handle.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	/**
	 * 创建题目元素
	 */
	createQuestionElement(question: RendererAnyRecord, sectionIndex: number, questionIndex: number) {
		const questionDiv = DOMUtils.createElementWithClass("div", "question");
		questionDiv.id = `question-${question.id}`;

		const questionText = DOMUtils.createElementWithClass("div", "question-text");
		// 使用题目的 id 作为题号
		const questionBody = this.renderInlineTranslationAssist(
			this.buildTextScopeKey(question, 'question'),
			this.formatQuestionText(question)
		);
		const questionTextWithNumber = `<span class="question-number-inline">${question.id}. </span>${questionBody}`;
		DOMUtils.safeSetInnerHTML(questionText, questionTextWithNumber, "createQuestionElement-text");

		// 如果是管理员，添加编辑按钮
		if (this.isAdmin()) {
			const editBtn = this.createEditButton('question', question);
			questionText.appendChild(editBtn);
		}

		// 题目反馈/纠错按钮（业务功能 5）：受 question_feedback 开关控制，默认开启
		if (typeof window.isFeatureEnabled !== 'function' || window.isFeatureEnabled('question_feedback', true)) {
			const feedbackBtn = this.createFeedbackButton(question);
			questionText.appendChild(feedbackBtn);
		}

		questionDiv.appendChild(questionText);

		// 如果题目有passage（题干相关的补充图片），在题干后、选项前渲染
		if (question.passage) {
			const questionPassageDiv = DOMUtils.createElementWithClass("div", "question-passage");
			questionPassageDiv.appendChild(this.createPassageElement(question.passage, question));
			questionDiv.appendChild(questionPassageDiv);
		}

		const optionsContainer = this.createOptionsContainer(question);
		questionDiv.appendChild(optionsContainer);

		this.appendAnswerAndExplanation(questionDiv, question);

		return questionDiv;
	}

	/**
	 * 创建选项容器
	 */
	createOptionsContainer(question: RendererAnyRecord) {
		const optionsContainer = DOMUtils.createElementWithClass("div", "options-container");

		if (question.options) {
			question.options.forEach((option: string, optionIndex: number) => {
				optionsContainer.appendChild(
					this.createOptionElement(question, option, optionIndex)
				);
			});
		}

		// 音频播放器一直显示
		if (question.audio) {
			optionsContainer.appendChild(this.examViewer.audioManager.createAudioPlayerElement(question));
		}

		// 听力文本：
		//  - 显示答案模式（复盘）下直接展示完整 transcript
		//  - 否则进入「三段式练习」流程：盲听 → 看原文 → 再盲听，由 AudioManager 控制显隐
		if (question.script) {
			if (this.examViewer.showAnswers) {
				optionsContainer.appendChild(this.examViewer.audioManager.createScriptElement(question));
			} else if (question.audio) {
				optionsContainer.appendChild(this.examViewer.audioManager.createPracticeStageElement(question));
				const scriptEl = this.examViewer.audioManager.createScriptElement(question);
				// 默认隐藏，由阶段切换控制
				scriptEl.classList.add('script-stage-hidden');
				scriptEl.dataset.stageWrap = String(question.id);
				optionsContainer.appendChild(scriptEl);
			}
		}

		return optionsContainer;
	}

	/**
	 * 创建选项元素
	 * @param {Object} question - 题目对象
	 * @param {string} option - 选项文本内容（如 "1. 花火の迫力に..."）
	 * @param {number} optionIndex - 选项索引（0-3，对应选项 1-4）
	 * @returns {HTMLElement} 返回创建的选项 DOM 元素
	 */
	createOptionElement(question: RendererAnyRecord, option: string, optionIndex: number) {
		// 创建选项容器 div
		const optionDiv = document.createElement("div");
		optionDiv.className = "option"; // 添加 CSS 类名用于样式

		// 存储数据属性，用于后续识别和操作
		optionDiv.dataset.questionId = String(question.id); // 题目 ID
		optionDiv.dataset.optionIndex = String(optionIndex + 1); // 选项编号（1-4）

		// 创建选项文本元素
		const textSpan = document.createElement("span");
		textSpan.className = "option-text"; // 添加 CSS 类名

		// 格式化选项文本（处理 && 标记）
		const formattedOption = this.formatOptionText(question, option);
		textSpan.innerHTML = this.shouldSkipReadingChoiceAssist(formattedOption)
			? formattedOption
			: this.renderInlineTranslationAssist(
				this.buildTextScopeKey(question, `option${optionIndex + 1}`),
				formattedOption
			);

		// 将文本元素添加到选项容器中
		optionDiv.appendChild(textSpan);

		// 添加点击事件监听器
		// 当用户点击选项时，调用答题管理器记录用户的选择
		optionDiv.addEventListener("click", () => {
			this.examViewer.answerManager.selectOption(question.id, optionIndex + 1);
		});

		// 如果用户已经选择了这个选项，添加 "selected" 类名以高亮显示
		if (this.examViewer.userAnswers[question.id] === optionIndex + 1) {
			optionDiv.classList.add("selected");
		}

		// 显示答案模式下，给用户勾选的选项加一个显式标记（区分于正确答案的✔）
		if (this.examViewer.showAnswers && this.examViewer.userAnswers[question.id] === optionIndex + 1) {
			optionDiv.classList.add("chosen-option");
		}

		// 如果显示答案，给正确选项添加 "correct-option" 类名
		if (this.examViewer.showAnswers && question.correct_answer === optionIndex + 1) {
			optionDiv.classList.add("correct-option");
		}

		// 返回创建好的选项元素
		return optionDiv;
	}

	/**
	 * 添加答案和解析
	 */
	appendAnswerAndExplanation(questionDiv: HTMLElement, question: RendererAnyRecord) {
		// 不再显示"正确答案：X"文本，改为在选项上高亮显示
		// if (this.examViewer.showAnswers && question.correct_answer) {
		// 	questionDiv.appendChild(this.createAnswerElement(question));
		// }

		if (this.examViewer.showExplanations) {
			const coreText = ((question.explanation || "") || "").trim();
			const expandText = ((question.explanation_expand || "") || "").trim();
			if (!coreText && !expandText) return;

			const explanationWrapper = document.createElement("div");
			explanationWrapper.style.position = "relative";

			// 答案出处回链（B1）：question.explanation_source = { paragraph: N, sentence: M }
			// 字段不存在时不渲染，零侵入
			const sourceBtn = this.createExplanationSourceButton(question);
			if (sourceBtn) {
				explanationWrapper.appendChild(sourceBtn);
			}

			// 显示详解：先显示题目解析（explanation），再追加拓展内容（explanation_expand）
			if (coreText) {
				const explanation = DOMUtils.createElementWithClass("div", "explanation");
				explanation.innerHTML = this.formatExplanationText(coreText);
				explanationWrapper.appendChild(explanation);
			}
			if (expandText) {
				const explanationExpand = DOMUtils.createElementWithClass("div", "explanation answer-extras");
				explanationExpand.innerHTML = this.formatExplanationText(expandText);
				explanationWrapper.appendChild(explanationExpand);
			}

			// 如果是管理员，添加编辑按钮
			if (this.isAdmin()) {
				const editBtn = this.createEditButton('explanation', question);
				explanationWrapper.appendChild(editBtn);
			}

			questionDiv.appendChild(explanationWrapper);
		} else if (this.examViewer.showAnswers) {
			// 显示答案：展示题目解析（explanation），用于快速回看
			const answerText = ((question.explanation || "") || "").trim();
			if (!answerText) return;

			const explanationWrapper = document.createElement("div");
			explanationWrapper.style.position = "relative";

			const explanation = DOMUtils.createElementWithClass("div", "explanation answer-extras");
			explanation.innerHTML = this.formatExplanationText(answerText);
			explanationWrapper.appendChild(explanation);

			// 如果是管理员，添加编辑按钮（编辑 explanation）
			if (this.isAdmin()) {
				const editBtn = this.createEditButton('explanation', question);
				explanationWrapper.appendChild(editBtn);
			}

			questionDiv.appendChild(explanationWrapper);
		}
	}

	/**
	 * 在“显示答案”模式下输出用户勾选的选项（文本），方便回看。
	 */
	getChosenAnswerSummaryText(question: RendererAnyRecord) {
		const chosenIndex = this.examViewer.userAnswers?.[question.id];
		if (!chosenIndex) {
			return "【你选择的选项】\n（未作答）";
		}
		const optionText = Array.isArray(question.options) ? question.options[chosenIndex - 1] : "";
		const display = (optionText || "").trim() || String(chosenIndex);
		return `【你选择的选项】\n${display}`;
	}

	/**
	 * 从完整解析中提取“答案模式”需要展示的精简内容。
	 * 优先：知识拓展 / 相关词汇 / 常用搭配
	 * 退化：解析要点
	 */
	getAnswerExtrasText(text: string) {
		if (!text) return "";

		const sections = this.splitExplanationIntoSections(text);
		if (sections.length === 0) return "";

		// 兼容旧题库：很多解析没有“知识拓展/相关词汇/常用搭配”标题
		// 在“显示答案”模式下也希望能看到：易错点、记忆技巧、例句、选项简析等
		const primaryRegex = /(知识拓展|相关词汇|常用搭配|常见搭配|搭配|词汇|易错点|注意|记忆|记忆技巧|选项简析|逐项分析|例句)/;
		const fallbackRegex = /(解析要点|题目解析)/;

		let selected = sections.filter(s => primaryRegex.test(s.title));
		if (selected.length === 0) {
			selected = sections.filter(s => fallbackRegex.test(s.title));
		}
		if (selected.length === 0) return "";

		// 只拼接选中的 section，保留原标题行，段落间空一行
		return selected
			.map(s => [s.headerLine, ...s.bodyLines].join('\n').trim())
			.filter(Boolean)
			.join('\n\n');
	}

	/**
	 * 将解析按“【标题】”拆分为多个 section。
	 */
	splitExplanationIntoSections(text: string) {
		const lines = (text || "").split('\n');
		interface ExplanationSection {
			title: string;
			headerLine: string;
			bodyLines: string[];
		}

		const sections: ExplanationSection[] = [];
		let current: ExplanationSection | null = null;
		for (const line of lines) {
			const trimmed = (line || "").trim();
			const match = trimmed.match(/^【([^】]+)】$/);
			if (match) {
				if (current) {
					sections.push(current);
				}
				current = {
					title: match[1],
					headerLine: line,
					bodyLines: []
				};
				continue;
			}

			if (!current) {
				// 解析开头若没有【标题】，统一放到一个匿名 section
				current = { title: "", headerLine: "", bodyLines: [] };
			}
			current.bodyLines.push(line);
		}

		if (current) {
			sections.push(current);
		}

		// 去掉全空 body 的 section
		return sections.map(s => ({
			title: s.title || "",
			headerLine: s.headerLine || "",
			bodyLines: (s.bodyLines || []).filter(l => l !== undefined)
		}));
	}

	/**
	 * 创建答案元素
	 */
	createAnswerElement(question: RendererAnyRecord) {
		const answerDiv = document.createElement("div");
		answerDiv.className = "answer-item";

		const correctAnswer = document.createElement("div");
		correctAnswer.className = "correct-answer";
		correctAnswer.textContent = `正确答案: ${question.correct_answer}`;

		answerDiv.appendChild(correctAnswer);

		return answerDiv;
	}

	/**
	 * 格式化题干文本
	 */
	formatQuestionText(question: RendererAnyRecord) {
		let text = question.question || "";

		// 支持新的target_words数组格式
		if (question.target_words) {
			const targetWords = Array.isArray(question.target_words) 
				? question.target_words 
				: [question.target_words];
			
			// 按长度降序排序，避免短词匹配到长词的一部分
			const sortedWords = targetWords.sort((a, b) => b.length - a.length);
			
			sortedWords.forEach(word => {
				// 转义特殊字符
				const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const regex = new RegExp(escapedWord, 'g');
				text = text.replace(regex, `<span class="target-word">${word}</span>`);
			});
		}
		// 兼容旧的target_word单数格式
		else if (question.target_word) {
			const targetWordRegex = new RegExp(question.target_word, "g");
			text = text.replace(
				targetWordRegex,
				`<span class="target-word">${question.target_word}</span>`
			);
		}

		return text;
	}

	/**
	 * 判断当前用户是否是管理员
	 */
	isAdmin() {
		const userContext = this.examViewer.userContextManager?.getUserContext();
		const roles = Array.isArray(userContext?.roles) ? userContext.roles : [];
		return roles.some((role: string) => ['teacher', 'orgAdmin', 'systemAdmin', 'superAdmin'].includes(role));
	}

	/**
	 * 创建编辑按钮
	 */
	createEditButton(type: string, question: RendererAnyRecord) {
		const btn = document.createElement("button");
		btn.className = "edit-btn";
		btn.innerHTML = "✏️ 编辑";
		btn.title = type === 'question' ? '编辑题目' : '编辑详解';
		btn.onclick = (e) => {
			e.stopPropagation();
			this.openEditDialog(type, question);
		};
		return btn;
	}

	/**
	 * 创建「题目反馈/报错」按钮（业务功能 5）
	 *   - 普通用户也可见，点击后弹窗提交反馈
	 *   - 后端入口：POST /api/v2/feedback，需登录
	 */
	createFeedbackButton(question: RendererAnyRecord) {
		const btn = document.createElement("button");
		btn.className = "feedback-btn";
		btn.style.cssText = 'margin-left:6px;font-size:12px;padding:2px 8px;cursor:pointer;border:1px solid #d0d0d0;border-radius:4px;background:#fafafa;';
		btn.innerHTML = "🐛 报错";
		btn.title = '反馈题目错误或建议';
		btn.onclick = (e) => {
			e.stopPropagation();
			this.openFeedbackDialog(question);
		};
		return btn;
	}

	/**
	 * 弹出反馈表单（业务功能 5）
	 *   - 类别下拉 + 描述 textarea
	 *   - 提交时调用 window.APIClient.submitFeedback
	 */
	openFeedbackDialog(question: RendererAnyRecord) {
		// 必须已登录
		const userId = this.examViewer.userId;
		if (!userId || userId === 'guest') {
			alert('请先登录后再提交反馈');
			return;
		}

		// 简单 modal：覆盖层 + 卡片
		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:9999;';
		const card = document.createElement('div');
		card.style.cssText = 'background:#fff;border-radius:8px;padding:20px;min-width:360px;max-width:520px;box-shadow:0 6px 24px rgba(0,0,0,0.2);';
		card.innerHTML = `
			<h3 style="margin:0 0 12px;font-size:16px;">反馈题目问题（题号：${question.id}）</h3>
			<label style="display:block;margin-bottom:6px;font-size:13px;">问题类别</label>
			<select class="fb-category" style="width:100%;padding:6px;margin-bottom:12px;">
				<option value="wrong_answer">答案错误</option>
				<option value="typo">文字错误</option>
				<option value="translation">翻译/释义问题</option>
				<option value="audio">音频问题</option>
				<option value="other" selected>其他</option>
			</select>
			<label style="display:block;margin-bottom:6px;font-size:13px;">详细描述（最多 1000 字）</label>
			<textarea class="fb-desc" rows="5" maxlength="1000" style="width:100%;padding:6px;box-sizing:border-box;" placeholder="请描述您发现的问题…"></textarea>
			<div style="text-align:right;margin-top:14px;">
				<button class="fb-cancel" style="margin-right:8px;padding:6px 14px;">取消</button>
				<button class="fb-submit" style="padding:6px 14px;background:#1976d2;color:#fff;border:0;border-radius:4px;cursor:pointer;">提交</button>
			</div>
		`;
		overlay.appendChild(card);
		document.body.appendChild(overlay);

		const close = () => overlay.remove();
		(card.querySelector('.fb-cancel') as HTMLButtonElement).onclick = close;
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) close();
		});

		(card.querySelector('.fb-submit') as HTMLButtonElement).onclick = async () => {
			const category = (card.querySelector('.fb-category') as HTMLSelectElement).value;
			const description = (card.querySelector('.fb-desc') as HTMLTextAreaElement).value.trim();
			const examId = this.examViewer._currentExamId || '';
			try {
				if (!window.APIClient) {
					alert('客户端未初始化');
					return;
				}
				await window.APIClient.submitFeedback({
					// 后端会用 session 覆盖 user_id，这里仅作为占位
					user_id: userId,
					paper_id: examId,
					exam_id: examId,
					question_id: String(question.id),
					category,
					description
				});
				alert('反馈已提交，感谢您的帮助！');
				close();
			} catch (err) {
				console.error('[QuestionRenderer] submitFeedback failed', err);
				alert('提交失败：' + (err instanceof Error ? err.message : String(err)));
			}
		};
	}

	/**
	 * 打开编辑对话框
	 */
	openEditDialog(type: string, question: RendererAnyRecord) {
		const title = type === 'question' ? '编辑题目' : '编辑详解';

		// 创建编辑对话框
		const dialog = document.createElement("div");
		dialog.className = "edit-dialog-overlay";

		if (type === 'question') {
			// 题目编辑：包含题干、选项、正确答案
			const opts = question.options || [];
			dialog.innerHTML = `
				<div class="edit-dialog edit-dialog-large">
					<div class="edit-dialog-header">
						<h3>${title} (ID: ${question.id})</h3>
						<button class="edit-dialog-close">✕</button>
					</div>
					<div class="edit-dialog-body">
						<div class="edit-field">
							<label>题干：</label>
							<textarea class="edit-textarea edit-question" rows="3">${question.question || ''}</textarea>
						</div>
						<div class="edit-field">
							<label>选项1：</label>
							<input type="text" class="edit-input edit-option" data-index="0" value="${opts[0] || ''}" />
						</div>
						<div class="edit-field">
							<label>选项2：</label>
							<input type="text" class="edit-input edit-option" data-index="1" value="${opts[1] || ''}" />
						</div>
						<div class="edit-field">
							<label>选项3：</label>
							<input type="text" class="edit-input edit-option" data-index="2" value="${opts[2] || ''}" />
						</div>
						<div class="edit-field">
							<label>选项4：</label>
							<input type="text" class="edit-input edit-option" data-index="3" value="${opts[3] || ''}" />
						</div>
						<div class="edit-field">
							<label>正确答案：</label>
							<select class="edit-select edit-answer">
								<option value="1" ${question.correct_answer === 1 ? 'selected' : ''}>选项1</option>
								<option value="2" ${question.correct_answer === 2 ? 'selected' : ''}>选项2</option>
								<option value="3" ${question.correct_answer === 3 ? 'selected' : ''}>选项3</option>
								<option value="4" ${question.correct_answer === 4 ? 'selected' : ''}>选项4</option>
							</select>
						</div>
					</div>
					<div class="edit-dialog-footer">
						<button class="edit-dialog-cancel">取消</button>
						<button class="edit-dialog-save">保存</button>
					</div>
				</div>
			`;
		} else {
			// 详解编辑：只有文本框
			dialog.innerHTML = `
				<div class="edit-dialog">
					<div class="edit-dialog-header">
						<h3>${title} (ID: ${question.id})</h3>
						<button class="edit-dialog-close">✕</button>
					</div>
					<div class="edit-dialog-body">
						<textarea class="edit-textarea">${question.explanation || ''}</textarea>
					</div>
					<div class="edit-dialog-footer">
						<button class="edit-dialog-cancel">取消</button>
						<button class="edit-dialog-save">保存</button>
					</div>
				</div>
			`;
		}

		document.body.appendChild(dialog);

		// 绑定事件
		const closeBtn = dialog.querySelector('.edit-dialog-close') as HTMLButtonElement | null;
		const cancelBtn = dialog.querySelector('.edit-dialog-cancel') as HTMLButtonElement | null;
		const saveBtn = dialog.querySelector('.edit-dialog-save') as HTMLButtonElement | null;

		const closeDialog = () => {
			document.body.removeChild(dialog);
		};

		if (closeBtn) {
			closeBtn.onclick = closeDialog;
		}
		if (cancelBtn) {
			cancelBtn.onclick = closeDialog;
		}
		dialog.onclick = (e) => {
			if (e.target === dialog) { closeDialog(); }
		};

		if (saveBtn) {
			saveBtn.onclick = () => {
				if (type === 'question') {
					const questionInput = dialog.querySelector('.edit-question') as HTMLTextAreaElement | null;
					const optionInputs = Array.from(dialog.querySelectorAll('.edit-option')) as HTMLInputElement[];
					const answerSelect = dialog.querySelector('.edit-answer') as HTMLSelectElement | null;
					const newQuestion = questionInput?.value ?? '';
					const newOptions = optionInputs.map((input) => input.value);
					const newAnswer = Number.parseInt(answerSelect?.value ?? '1', 10);

					this.saveQuestionEdit(question, newQuestion, newOptions, newAnswer);
				} else {
					const explanationInput = dialog.querySelector('.edit-textarea') as HTMLTextAreaElement | null;
					const newExplanation = explanationInput?.value ?? '';
					this.saveEdit('explanation', question, newExplanation);
				}
				closeDialog();
			};
		}

		// 自动聚焦第一个输入框
		const firstInput = dialog.querySelector('textarea, input') as HTMLTextAreaElement | HTMLInputElement | null;
		if (firstInput) { firstInput.focus(); }
	}

	/**
	 * 保存题目编辑（包含题干、选项、答案）
	 */
	saveQuestionEdit(question: RendererAnyRecord, newQuestion: string, newOptions: string[], newAnswer: number) {
		// 更新内存中的数据
		question.question = newQuestion;
		question.options = newOptions;
		question.correct_answer = newAnswer;

		// 通知后端保存
		if (typeof vscode !== 'undefined') {
			vscode.postMessage({
				type: 'saveQuestionEdit',
				data: {
					examId: this.examViewer._currentExamId,
					questionId: question.id,
					question: newQuestion,
					options: newOptions,
					correct_answer: newAnswer
				}
			});
		}

		// 重新渲染当前题目
		this.examViewer.questionRenderer.renderCurrentQuestion();

		console.log(`[QuestionRenderer] Saved question ${question.id}`);
	}

	/**
	 * 保存编辑
	 */
	saveEdit(type: string, question: RendererAnyRecord, newValue: string) {
		// 更新内存中的数据
		if (type === 'question') {
			question.question = newValue;
		} else {
			question.explanation = newValue;
		}

		// 通知后端保存
		if (typeof vscode !== 'undefined') {
			vscode.postMessage({
				type: 'saveQuestionEdit',
				data: {
					examId: this.examViewer._currentExamId,
					questionId: question.id,
					field: type,
					value: newValue
				}
			});
		}

		// 重新渲染当前题目
		this.examViewer.questionRenderer.renderCurrentQuestion();

		console.log(`[QuestionRenderer] Saved ${type} for question ${question.id}`);
	}

	/**
	 * 格式化解析文本（高亮【】包围的标题）
	 */
	formatExplanationText(text: string) {
		// 按行分割
		const lines = text.split('\n');
		const formattedLines = lines.map(line => {
			const trimmedLine = line.trim();
			// 匹配只包含【】的行（如"【题目解析】"、"【解析要点】"等）
			// 确保整行只有【】内容，前后可以有空格
			if (/^【[^】]+】$/.test(trimmedLine)) {
				return `<span class="explain-label">${line}</span>`;
			}
			return line;
		});
		return formattedLines.join('\n');
	}

	/**
	 * 格式化选项文本，高亮target_words中的词汇
	 */
	formatOptionText(question: RendererAnyRecord, option: string) {
		let text = option;
		
		// 如果question有target_words字段，高亮这些词
		if (question.target_words) {
			const targetWords = Array.isArray(question.target_words) 
				? question.target_words 
				: [question.target_words];
			
			// 按长度降序排序，避免短词匹配到长词的一部分
			const sortedWords = targetWords.sort((a, b) => b.length - a.length);
			
			// 对每个target_word进行高亮
			sortedWords.forEach(word => {
				// 转义特殊字符
				const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// 使用全局匹配替换所有出现的词
				const regex = new RegExp(escapedWord, 'g');
				text = text.replace(regex, `<mark class="target-word">${word}</mark>`);
			});
		}
		
		return text;
	}

	/**
	 * 格式化文本中的目标词汇（保留用于向后兼容）
	 */
	formatTextWithTargetWords(text: string) {
		// 处理 **词** 标记
		text = text.replace(/\*\*(.*?)\*\*/g, '<span class="target-word">$1</span>');
		// 处理 &&词&& 标记
		text = text.replace(/&&(.*?)&&/g, '<span class="target-word">$1</span>');
		return text;
	}

	/**
	 * 在文本中高亮target_words中的词汇
	 */
	highlightTargetWordsInText(text: string, targetWords: string[]) {
		if (!text || !targetWords) return text;
		
		const words = Array.isArray(targetWords) ? targetWords : [targetWords];
		if (words.length === 0) return text;
		
		// 按长度降序排序，避免短词匹配到长词的一部分
		const sortedWords = [...words].sort((a, b) => b.length - a.length);
		
		// 转义特殊字符
		const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		
		// 创建正则表达式，匹配所有target words
		const pattern = sortedWords.map(escapeRegex).join('|');
		const regex = new RegExp(`(${pattern})`, 'g');
		
		// 替换匹配的词汇为高亮标记
		return text.replace(regex, '<span class="target-word">$1</span>');
	}

	private escapeHtml(text: string): string {
		return text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
	}

	private getCurrentSection(): RendererAnyRecord | null {
		const sections = this.examViewer.currentExam?.exam_info?.sections || [];
		return sections[this.examViewer.currentSectionIndex] || null;
	}

	private getViewerExamId(): string {
		return (this.examViewer as { _currentExamId?: string | null })._currentExamId || '';
	}

	private buildTextScopeKey(question: RendererAnyRecord, kind: string): string {
		const currentSection = this.getCurrentSection();
		const sectionId = currentSection?.section_id || '';
		const base = question._groupPassageKey || sectionId;
		return `${base}:q${question.id ?? ''}:${kind}`;
	}

	private shouldSkipReadingChoiceAssist(sourceHtml: string): boolean {
		const currentSection = this.getCurrentSection();
		if (!currentSection) {
			return false;
		}

		const sectionId = String(currentSection.section_id || '');
		const sectionName = [
			currentSection.section_name,
			currentSection.section_title,
			currentSection.description
		].filter(Boolean).join(' ');
		if (sectionId !== '1.01' && !/(漢字読み|読み方)/.test(sectionName)) {
			return false;
		}

		const plain = sourceHtml
			.replace(/<[^>]*>/g, '')
			.replace(/^\s*\d+\s*[.．、]\s*/, '')
			.trim();
		return plain.length > 0 && !/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(plain);
	}

	private renderInlineTranslationAssist(scopeKey: string, sourceHtml: string, pIdx: number = 0, sIdx: number = 0): string {
		const showKana = Boolean(this.examViewer.showReadingKana);
		const showZh = Boolean(this.examViewer.showReadingZh);
		if (!showKana && !showZh) {
			return sourceHtml;
		}

		const examId = this.getViewerExamId();
		const source = showKana ? this.buildRubyForScope(examId, scopeKey, pIdx, sIdx, sourceHtml) || sourceHtml : sourceHtml;
		const zh = showZh ? this.buildZhForScope(examId, scopeKey, pIdx, sIdx) : '';
		if (!zh) {
			return source;
		}
		return `<span class="text-assist-wrap"><span class="text-assist-source">${source}</span><span class="sentence-zh">${zh}</span></span>`;
	}

	private buildRubyForScope(examId: string, scopeKey: string, pIdx: number, sIdx: number, formattedText: string): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getRuby?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const explicitRuby = translationMgr?.getRuby?.(examId, scopeKey, pIdx, sIdx) || '';
		if (explicitRuby.trim()) {
			return explicitRuby;
		}
		const annotator = this.examViewer.furiganaManager?.annotateFurigana;
		return typeof annotator === 'function' ? annotator.call(this.examViewer.furiganaManager, formattedText) : '';
	}

	private buildZhForScope(examId: string, scopeKey: string, pIdx: number, sIdx: number): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getSentence?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const zh = translationMgr?.getSentence?.(examId, scopeKey, pIdx, sIdx) || '';
		return zh.trim() ? this.escapeHtml(zh).replace(/\n/g, '<br>') : '';
	}

	/**
	 * 创建「📍 答案出处：第 N 段第 M 句」按钮。
	 * 仅当 question.explanation_source = { paragraph: N, sentence: M } 存在时渲染。
	 * 编号使用「以 1 起」的人类可读编号；data-pidx/data-sidx 使用「以 0 起」的下标。
	 * 兼容老字段名：source_paragraph / source_sentence。
	 */
	private createExplanationSourceButton(question: RendererAnyRecord): HTMLButtonElement | null {
		const src =
			(question.explanation_source as RendererAnyRecord | undefined) ||
			(question.source as RendererAnyRecord | undefined) ||
			null;
		const pRaw = src
			? src.paragraph ?? src.p ?? src.pidx ?? null
			: question.source_paragraph ?? null;
		const sRaw = src
			? src.sentence ?? src.s ?? src.sidx ?? null
			: question.source_sentence ?? null;
		if (pRaw == null && sRaw == null) return null;

		const pHuman = Number.isFinite(Number(pRaw)) ? Number(pRaw) : null;
		const sHuman = Number.isFinite(Number(sRaw)) ? Number(sRaw) : null;
		if (pHuman == null && sHuman == null) return null;

		const pIdx = pHuman != null ? pHuman - 1 : null;
		const sIdx = sHuman != null ? sHuman - 1 : null;

		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "explanation-source-btn";
		const label =
			pHuman != null && sHuman != null
				? `📍 答案出处：第 ${pHuman} 段第 ${sHuman} 句`
				: pHuman != null
					? `📍 答案出处：第 ${pHuman} 段`
					: `📍 答案出处：第 ${sHuman} 句`;
		btn.textContent = label;
		btn.title = "点击跳转到原文并高亮";

		btn.addEventListener("click", () => {
			let target: HTMLElement | null = null;
			if (pIdx != null && sIdx != null) {
				target = document.querySelector(
					`.passage-sentence[data-pidx="${pIdx}"][data-sidx="${sIdx}"]`
				);
			}
			if (!target && pIdx != null) {
				target = document.querySelector(`.passage-paragraph[data-pidx="${pIdx}"]`);
			}
			if (!target) return;
			try {
				target.scrollIntoView({ behavior: "smooth", block: "center" });
			} catch {
				target.scrollIntoView();
			}
			target.classList.add("passage-sentence-flash");
			window.setTimeout(() => target!.classList.remove("passage-sentence-flash"), 1800);
		});
		return btn;
	}

	/**
	 * 把整段长文按段（\n）+ 句（。！？!?…）切分，每段包成 <div class="passage-paragraph" data-pidx="N">，
	 * 每句包成 <span class="passage-sentence" data-pidx="N" data-sidx="M">，再对每句单独应用 target_words / 高亮。
	 *
	 * 设计要点：
	 *  - target_words / **...** / &&...&& 这类替换在「单句」上做，避免跨句匹配，结果与原行为等价
	 *  - 不会破坏 furigana（FuriganaManager 是按需对显式调用文本做处理，不自动遍历 passage DOM）
	 *  - data-pidx / data-sidx 给 explanation 出处回链按钮使用
	 */
	private buildSentenceWrappedHtml(rawText: string, targetWords: string[] | null, passageKey: string): string {
		if (!rawText) return "";
		const examId = (this.examViewer as { _currentExamId?: string | null })._currentExamId || '';
		const showKana = Boolean(this.examViewer.showReadingKana);
		const showZh = Boolean(this.examViewer.showReadingZh);
		const showTranslationChip = this.shouldShowTranslationChips();
		const formatSentence = (s: string): string => {
			if (!s) return "";
			// 与原有 setPassageContent 行为保持一致：直接对原始字符串做正则替换，不预先做 HTML escape
			// （原 formatTextWithTargetWords / highlightTargetWordsInText 也是这么做的）
			let html = s;
			if (targetWords && (Array.isArray(targetWords) ? targetWords.length : 0)) {
				html = this.highlightTargetWordsInText(html, targetWords as string[]);
			} else {
				html = this.formatTextWithTargetWords(html);
			}
			return html;
		};

		// 段落切分：按 \n 切，过滤掉纯空行（但保留段内换行作为换行符）
		const paragraphs = rawText.split(/\n/);
		const out: string[] = [];
		paragraphs.forEach((para, pIdx) => {
			const trimmed = para;
			if (trimmed.trim() === "") {
				// 空行变为分段间距占位，不参与编号
				out.push('<div class="passage-paragraph passage-paragraph-blank"></div>');
				return;
			}
			// 句切分：以 [。！？!?…] 为终止符（含终止符随前一句）；剩余尾巴作为最后一句
			const sentenceParts: string[] = [];
			const re = /[^。！？!?…]*[。！？!?…]+|[^。！？!?…]+$/g;
			let m: RegExpExecArray | null;
			while ((m = re.exec(trimmed)) !== null) {
				if (m[0]) sentenceParts.push(m[0]);
			}
			if (sentenceParts.length === 0) sentenceParts.push(trimmed);

			const inner = sentenceParts
				.map((sentenceRaw, sIdx) => {
					const formatted = formatSentence(sentenceRaw);
					const sentenceHtml = showKana
						? this.buildSentenceRubyHtml(examId, passageKey, pIdx, sIdx, formatted)
						: formatted;
					const sentenceCore = `<span class="passage-sentence" data-pidx="${pIdx}" data-sidx="${sIdx}">${sentenceHtml || formatted}</span>`;
					// 句子 + 「译」chip（B2）。chip 是否显示由 CSS / feature flag 控制；
					// 点击行为由 TranslationManager 全局委托接管。
					const chip = showTranslationChip
						? `<button type="button" class="translation-chip" data-pidx="${pIdx}" data-sidx="${sIdx}" title="查看/编辑该句中文译文">译</button>`
						: '';
					if (!showKana && !showZh) {
						return sentenceCore + chip;
					}

					const layers: string[] = [];
					layers.push(sentenceCore);
					if (showZh) {
						const zhHtml = this.buildSentenceZhHtml(examId, passageKey, pIdx, sIdx);
						if (zhHtml) {
							layers.push(`<span class="sentence-zh">${zhHtml}</span>`);
						}
					}

					const classes = [
						'passage-sentence-wrap',
						showKana ? 'has-kana' : '',
						showZh ? 'has-zh' : ''
					].filter(Boolean).join(' ');
					return `<span class="${classes}" data-pidx="${pIdx}" data-sidx="${sIdx}">${layers.join('')}</span>${chip}`;
				})
				.join("");
			out.push(`<div class="passage-paragraph" data-pidx="${pIdx}">${inner}</div>`);
		});
		return out.join("");
	}

	private buildSentenceRubyHtml(examId: string, passageKey: string, pIdx: number, sIdx: number, formattedSentence: string): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getRuby?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const explicitRuby = translationMgr?.getRuby?.(examId, passageKey, pIdx, sIdx) || '';
		if (explicitRuby.trim()) {
			return explicitRuby;
		}
		const annotator = this.examViewer.furiganaManager?.annotateFurigana;
		return typeof annotator === 'function' ? annotator.call(this.examViewer.furiganaManager, formattedSentence) : '';
	}

	private shouldShowTranslationChips(): boolean {
		const w = window as Window & { __TRANSLATION_EDIT_MODE__?: boolean };
		if (w.__TRANSLATION_EDIT_MODE__ === true) {
			return true;
		}
		if (typeof window.isFeatureEnabled === 'function') {
			return window.isFeatureEnabled('translation_edit_chips', false) && this.isAdmin();
		}
		return false;
	}

	private buildSentenceZhHtml(examId: string, passageKey: string, pIdx: number, sIdx: number): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getSentence?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const zh = translationMgr?.getSentence?.(examId, passageKey, pIdx, sIdx) || '';
		return zh.trim() ? this.escapeHtml(zh).replace(/\n/g, '<br>') : '';
	}
}
// Export to global scope
window.QuestionRenderer = QuestionRenderer;



