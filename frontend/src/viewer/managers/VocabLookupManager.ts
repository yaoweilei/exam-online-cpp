/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * 生词查询 / 个人词本管理器
 * --------------------------------------------------------------------
 * 触发方式：用户在题面 / passage / transcript 中划选 1–8 个 CJK 字符，
 * 选区附近浮出一个小卡片，含：
 *   - 词形
 *   - 该词在本卷其他出现位置（数量 + 跳转）
 *   - 「加入生词本」按钮 + 笔记输入
 *
 * 弹卡是单例 DOM，复用同一节点。
 */
class VocabLookupManager {
	private readonly examViewer: any;
	private popup: HTMLDivElement | null;
	private currentSelection: string;

	constructor(examViewer: any) {
		this.examViewer = examViewer;
		this.popup = null;
		this.currentSelection = '';
	}

	/** 在 ExamViewer 完成初始化后调用一次：挂全局选区监听 */
	init(): void {
		document.addEventListener('mouseup', (ev) => this.onSelectionMaybeChanged(ev));
		document.addEventListener('touchend', (ev) => this.onSelectionMaybeChanged(ev));
		// 点击空白处关闭弹卡
		document.addEventListener('mousedown', (ev) => {
			if (this.popup && !this.popup.contains(ev.target as Node)) {
				const sel = window.getSelection?.()?.toString().trim();
				if (!sel) this.hide();
			}
		});
	}

	private onSelectionMaybeChanged(_ev: Event): void {
		if (this.examViewer?.examMode === 'mock' && !this.examViewer?.isSubmitted) {
			this.hide();
			return;
		}
		// 若用户开关 vocab_notebook 关闭，则不弹
		try {
			const enabled = (window as any).isFeatureEnabled?.('vocab_notebook', true) ?? true;
			if (!enabled) return;
		} catch {
			/* ignore */
		}

		const sel = window.getSelection?.();
		if (!sel || sel.isCollapsed) {
			return;
		}
		const raw = sel.toString().trim();
		if (!raw) return;

		// 仅处理短选区（长选区可能是用户在阅读，不打扰）
		if (raw.length > 16) return;

		// 必须含 CJK / 假名字符
		if (!/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(raw)) return;

		// 选区必须落在试卷正文区域内（避免在导航栏 / 弹窗里乱触发）
		const range = sel.getRangeAt(0);
		const anchor = range.commonAncestorContainer as Node;
		const anchorEl = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;
		if (!anchorEl) return;
		if (!anchorEl.closest(
			'.passage-content, .question-content, .script-container, .options-container, .answer-explanation'
		)) {
			return;
		}

		// 去掉首尾的常见标点和空白
		const word = raw.replace(/^[\s「」『』（）()【】［］\[\]、，。．,.\?！!？]+|[\s「」『』（）()【】［］\[\]、，。．,.\?！!？]+$/g, '');
		if (!word) return;
		if (this.popup && this.currentSelection === word && this.popup.style.display !== 'none') {
			return;  // 选了同一个词，避免闪烁
		}
		this.currentSelection = word;

		const rect = range.getBoundingClientRect();
		this.show(word, rect);
	}

	private ensurePopup(): HTMLDivElement {
		if (this.popup) return this.popup;
		const p = document.createElement('div');
		p.className = 'vocab-lookup-popup';
		p.style.display = 'none';
		document.body.appendChild(p);
		this.popup = p;
		return p;
	}

	private hide(): void {
		if (this.popup) this.popup.style.display = 'none';
		this.currentSelection = '';
	}

	private show(word: string, anchorRect: DOMRect): void {
		const popup = this.ensurePopup();
		const reading = '';
		const occurrences = this.findOccurrences(word);
		const examId = this.examViewer._currentExamId || this.examViewer.currentExam?.exam_info?.id || '';
		const questionId = this.examViewer.currentQuestion?.id ?? '';

		popup.innerHTML = '';

		// 头部：词 + 读音
		const head = document.createElement('div');
		head.className = 'vocab-lookup-head';
		const wordSpan = document.createElement('span');
		wordSpan.className = 'vocab-lookup-word';
		wordSpan.textContent = word;
		head.appendChild(wordSpan);
		if (reading && reading !== word) {
			const r = document.createElement('span');
			r.className = 'vocab-lookup-reading';
			r.textContent = reading;
			head.appendChild(r);
		}
		const closeBtn = document.createElement('button');
		closeBtn.type = 'button';
		closeBtn.className = 'vocab-lookup-close';
		closeBtn.textContent = '×';
		closeBtn.title = '关闭';
		closeBtn.addEventListener('click', () => this.hide());
		head.appendChild(closeBtn);
		popup.appendChild(head);

		// 出现次数
		const occLine = document.createElement('div');
		occLine.className = 'vocab-lookup-occ';
		occLine.textContent = occurrences > 0
			? `本卷出现 ${occurrences} 次`
			: '本卷仅此一处';
		popup.appendChild(occLine);

		// 笔记输入
		const noteWrap = document.createElement('div');
		noteWrap.className = 'vocab-lookup-note-wrap';
		const noteInput = document.createElement('textarea');
		noteInput.className = 'vocab-lookup-note';
		noteInput.placeholder = '可选：写下释义 / 例句 / 助记…';
		noteInput.rows = 2;
		noteWrap.appendChild(noteInput);
		popup.appendChild(noteWrap);

		// 操作按钮
		const actions = document.createElement('div');
		actions.className = 'vocab-lookup-actions';
		const addBtn = document.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'vocab-lookup-add';
		addBtn.textContent = '加入生词本';
		addBtn.addEventListener('click', () => {
			void this.addWord(word, reading, noteInput.value, String(examId || ''), String(questionId || ''), addBtn);
		});
		actions.appendChild(addBtn);

		const status = document.createElement('span');
		status.className = 'vocab-lookup-status';
		actions.appendChild(status);
		popup.appendChild(actions);

		// 定位：尽量贴近选区下方；超出右边界向左修正
		popup.style.display = 'block';
		const POPUP_W = 280;
		let left = anchorRect.left + window.scrollX;
		const top = anchorRect.bottom + window.scrollY + 6;
		if (left + POPUP_W > window.scrollX + window.innerWidth - 8) {
			left = window.scrollX + window.innerWidth - POPUP_W - 8;
		}
		if (left < window.scrollX + 8) left = window.scrollX + 8;
		popup.style.left = `${left}px`;
		popup.style.top = `${top}px`;
		popup.style.width = `${POPUP_W}px`;
	}

	/** 统计该词在当前 currentExam 的全部 question/passage/script 文本里出现次数 */
	private findOccurrences(word: string): number {
		const exam = this.examViewer.currentExam;
		if (!exam || !exam.exam_info || !Array.isArray(exam.exam_info.sections)) return 0;
		let count = 0;
		const visit = (text: unknown) => {
			if (typeof text !== 'string' || !text) return;
			let idx = 0;
			while ((idx = text.indexOf(word, idx)) !== -1) {
				count++;
				idx += word.length;
			}
		};
		for (const section of exam.exam_info.sections as any[]) {
			const passages = section?.passages || [];
			for (const passage of passages) {
				if (passage?.passage?.value) visit(passage.passage.value);
				const questions = passage?.questions || [];
				for (const q of questions) {
					visit(q?.question);
					if (Array.isArray(q?.options)) for (const o of q.options) visit(o);
					if (Array.isArray(q?.script)) for (const s of q.script) visit(s?.text);
				}
			}
		}
		return count;
	}

	private async addWord(
		word: string,
		reading: string,
		note: string,
		examId: string,
		questionId: string,
		btn: HTMLButtonElement
	): Promise<void> {
		const status = this.popup?.querySelector('.vocab-lookup-status') as HTMLSpanElement | null;
		btn.disabled = true;
		if (status) {
			status.textContent = '保存中...';
			status.style.color = '';
		}
		try {
			const Api = (window as any).APIClient;
			if (!Api?.addVocabWord) {
				throw new Error('APIClient 未加载');
			}
			await Api.addVocabWord({ word, reading, note, examId, questionId });
			if (status) {
				status.textContent = '✓ 已加入';
				status.style.color = 'var(--vscode-testing-iconPassed, #3fb950)';
			}
			btn.textContent = '已收藏';
			setTimeout(() => this.hide(), 1200);
		} catch (err: any) {
			btn.disabled = false;
			if (status) {
				status.textContent = err?.message || '保存失败';
				status.style.color = 'var(--vscode-errorForeground, #f85149)';
			}
		}
	}
}

(window as any).VocabLookupManager = VocabLookupManager;
