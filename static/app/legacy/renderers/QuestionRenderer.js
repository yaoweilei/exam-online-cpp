"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
class QuestionRenderer {
    examViewer;
    constructor(examViewer) {
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
                questionContent.appendChild(this.createPassageElement(currentSection.passage));
            }
        }
        if (currentQuestion._groupPassage) {
            const passageEl = this.createPassageElement(currentQuestion._groupPassage);
            if (currentQuestion._groupIndex || currentQuestion._groupTopic) {
                const meta = document.createElement("div");
                meta.className = "passage-group-meta";
                const parts = [];
                // if (currentQuestion._groupIndex) { parts.push(`第${currentQuestion._groupIndex}篇`); }
                // if (currentQuestion._groupTopic) { parts.push(currentQuestion._groupTopic); }
                meta.textContent = parts.join("  ");
                passageEl.prepend(meta);
            }
            questionContent.appendChild(passageEl);
        }
        questionContent.appendChild(this.createQuestionElement(currentQuestion, this.examViewer.currentSectionIndex, this.examViewer.currentQuestionIndex));
        questionDiv.appendChild(sectionInfo);
        questionDiv.appendChild(questionContent);
        container.appendChild(questionDiv);
    }
    /**
     * 创建材料元素
     */
    createPassageElement(passage, question = null) {
        const passageDiv = DOMUtils.createElementWithClass("div", "passage");
        if (passage.title) {
            const title = DOMUtils.createElementWithClass("div", "passage-title", passage.title);
            passageDiv.appendChild(title);
        }
        const content = DOMUtils.createElementWithClass("div", "passage-content");
        this.setPassageContent(content, passage, question);
        passageDiv.appendChild(content);
        return passageDiv;
    }
    /**
     * 设置材料内容
     */
    setPassageContent(contentElement, passage, question = null) {
        if (passage.type === "text") {
            // 优先使用passage自己的target_words，其次使用question的target_words
            let targetWords = passage.target_words || (question && question.target_words);
            let formattedText = passage.value;
            if (targetWords) {
                formattedText = this.highlightTargetWordsInText(passage.value, targetWords);
            }
            else {
                formattedText = this.formatTextWithTargetWords(passage.value);
            }
            DOMUtils.safeSetInnerHTML(contentElement, formattedText, "setPassageContent-text");
        }
        else if (passage.type === "image") {
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
    makeImageResizable(wrapper, handle) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        const onMouseDown = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = wrapper.offsetWidth;
            // 添加拖拽时的样式
            document.body.style.cursor = 'nwse-resize';
            wrapper.classList.add('resizing');
            e.preventDefault();
        };
        const onMouseMove = (e) => {
            if (!isResizing)
                return;
            const deltaX = e.clientX - startX;
            const newWidth = Math.max(200, Math.min(1200, startWidth + deltaX));
            wrapper.style.width = newWidth + 'px';
        };
        const onMouseUp = () => {
            if (!isResizing)
                return;
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
    createQuestionElement(question, sectionIndex, questionIndex) {
        const questionDiv = DOMUtils.createElementWithClass("div", "question");
        questionDiv.id = `question-${question.id}`;
        const questionText = DOMUtils.createElementWithClass("div", "question-text");
        // 使用题目的 id 作为题号
        const questionTextWithNumber = `<span class="question-number-inline">${question.id}. </span>${this.formatQuestionText(question)}`;
        DOMUtils.safeSetInnerHTML(questionText, questionTextWithNumber, "createQuestionElement-text");
        // 如果是管理员，添加编辑按钮
        if (this.isAdmin()) {
            const editBtn = this.createEditButton('question', question);
            questionText.appendChild(editBtn);
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
    createOptionsContainer(question) {
        const optionsContainer = DOMUtils.createElementWithClass("div", "options-container");
        if (question.options) {
            question.options.forEach((option, optionIndex) => {
                optionsContainer.appendChild(this.createOptionElement(question, option, optionIndex));
            });
        }
        // 音频播放器一直显示
        if (question.audio) {
            optionsContainer.appendChild(this.examViewer.audioManager.createAudioPlayerElement(question));
        }
        // 听力文本只在显示答案时显示
        if (question.script && this.examViewer.showAnswers) {
            optionsContainer.appendChild(this.examViewer.audioManager.createScriptElement(question));
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
    createOptionElement(question, option, optionIndex) {
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
        textSpan.innerHTML = formattedOption;
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
    appendAnswerAndExplanation(questionDiv, question) {
        // 不再显示"正确答案：X"文本，改为在选项上高亮显示
        // if (this.examViewer.showAnswers && question.correct_answer) {
        // 	questionDiv.appendChild(this.createAnswerElement(question));
        // }
        if (this.examViewer.showExplanations) {
            const coreText = ((question.explanation || "") || "").trim();
            const expandText = ((question.explanation_expand || "") || "").trim();
            if (!coreText && !expandText)
                return;
            const explanationWrapper = document.createElement("div");
            explanationWrapper.style.position = "relative";
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
        }
        else if (this.examViewer.showAnswers) {
            // 显示答案：展示题目解析（explanation），用于快速回看
            const answerText = ((question.explanation || "") || "").trim();
            if (!answerText)
                return;
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
    getChosenAnswerSummaryText(question) {
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
    getAnswerExtrasText(text) {
        if (!text)
            return "";
        const sections = this.splitExplanationIntoSections(text);
        if (sections.length === 0)
            return "";
        // 兼容旧题库：很多解析没有“知识拓展/相关词汇/常用搭配”标题
        // 在“显示答案”模式下也希望能看到：易错点、记忆技巧、例句、选项简析等
        const primaryRegex = /(知识拓展|相关词汇|常用搭配|常见搭配|搭配|词汇|易错点|注意|记忆|记忆技巧|选项简析|逐项分析|例句)/;
        const fallbackRegex = /(解析要点|题目解析)/;
        let selected = sections.filter(s => primaryRegex.test(s.title));
        if (selected.length === 0) {
            selected = sections.filter(s => fallbackRegex.test(s.title));
        }
        if (selected.length === 0)
            return "";
        // 只拼接选中的 section，保留原标题行，段落间空一行
        return selected
            .map(s => [s.headerLine, ...s.bodyLines].join('\n').trim())
            .filter(Boolean)
            .join('\n\n');
    }
    /**
     * 将解析按“【标题】”拆分为多个 section。
     */
    splitExplanationIntoSections(text) {
        const lines = (text || "").split('\n');
        const sections = [];
        let current = null;
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
    createAnswerElement(question) {
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
    formatQuestionText(question) {
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
            text = text.replace(targetWordRegex, `<span class="target-word">${question.target_word}</span>`);
        }
        return text;
    }
    /**
     * 判断当前用户是否是管理员
     */
    isAdmin() {
        const userContext = this.examViewer.userContextManager?.getUserContext();
        return userContext?.roles?.includes('superAdmin') || false;
    }
    /**
     * 创建编辑按钮
     */
    createEditButton(type, question) {
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
     * 打开编辑对话框
     */
    openEditDialog(type, question) {
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
        }
        else {
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
        const closeBtn = dialog.querySelector('.edit-dialog-close');
        const cancelBtn = dialog.querySelector('.edit-dialog-cancel');
        const saveBtn = dialog.querySelector('.edit-dialog-save');
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
            if (e.target === dialog) {
                closeDialog();
            }
        };
        if (saveBtn) {
            saveBtn.onclick = () => {
                if (type === 'question') {
                    const questionInput = dialog.querySelector('.edit-question');
                    const optionInputs = Array.from(dialog.querySelectorAll('.edit-option'));
                    const answerSelect = dialog.querySelector('.edit-answer');
                    const newQuestion = questionInput?.value ?? '';
                    const newOptions = optionInputs.map((input) => input.value);
                    const newAnswer = Number.parseInt(answerSelect?.value ?? '1', 10);
                    this.saveQuestionEdit(question, newQuestion, newOptions, newAnswer);
                }
                else {
                    const explanationInput = dialog.querySelector('.edit-textarea');
                    const newExplanation = explanationInput?.value ?? '';
                    this.saveEdit('explanation', question, newExplanation);
                }
                closeDialog();
            };
        }
        // 自动聚焦第一个输入框
        const firstInput = dialog.querySelector('textarea, input');
        if (firstInput) {
            firstInput.focus();
        }
    }
    /**
     * 保存题目编辑（包含题干、选项、答案）
     */
    saveQuestionEdit(question, newQuestion, newOptions, newAnswer) {
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
    saveEdit(type, question, newValue) {
        // 更新内存中的数据
        if (type === 'question') {
            question.question = newValue;
        }
        else {
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
    formatExplanationText(text) {
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
    formatOptionText(question, option) {
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
    formatTextWithTargetWords(text) {
        // 处理 **词** 标记
        text = text.replace(/\*\*(.*?)\*\*/g, '<span class="target-word">$1</span>');
        // 处理 &&词&& 标记
        text = text.replace(/&&(.*?)&&/g, '<span class="target-word">$1</span>');
        return text;
    }
    /**
     * 在文本中高亮target_words中的词汇
     */
    highlightTargetWordsInText(text, targetWords) {
        if (!text || !targetWords)
            return text;
        const words = Array.isArray(targetWords) ? targetWords : [targetWords];
        if (words.length === 0)
            return text;
        // 按长度降序排序，避免短词匹配到长词的一部分
        const sortedWords = [...words].sort((a, b) => b.length - a.length);
        // 转义特殊字符
        const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 创建正则表达式，匹配所有target words
        const pattern = sortedWords.map(escapeRegex).join('|');
        const regex = new RegExp(`(${pattern})`, 'g');
        // 替换匹配的词汇为高亮标记
        return text.replace(regex, '<span class="target-word">$1</span>');
    }
}
// Export to global scope
window.QuestionRenderer = QuestionRenderer;
//# sourceMappingURL=QuestionRenderer.js.map