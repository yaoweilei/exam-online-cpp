/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

// 阅读分句双语对照（B2）：
//  - 译文「众包式」存储在后端 data/system/translations/jlpt/{level}/{examId}.json
//  - 客户端按 exam 拉一次到 window.__TRANSLATIONS__[examId]
//  - 默认由阅读辅助开关显示假名/中文；管理编辑模式下可用「译」chip 编辑保存。
//
// passage_key 约定：
//   "{section_id}:{question_id}"  —  由 QuestionRenderer 在渲染 passage 时通过
//   data-passage-key 写到 .passage-content 上，本管理器 closest 查找即可。

interface TranslationSentenceEntry {
	text: string;
	kana?: string;
	ruby?: string;
	updated_by?: string;
	updated_at?: string;
}

interface TranslationDoc {
	exam_id?: string;
	items?: Record<string, Record<string, TranslationSentenceEntry>>;
	updated_at?: string;
}

class TranslationManager {
	private static readonly storeKey = '__TRANSLATIONS__' as const;
	private static delegationInstalled = false;

	/** 取全局 cache（不存在则懒建） */
	private static store(): Record<string, TranslationDoc> {
		const w = window as Window & { __TRANSLATIONS__?: Record<string, TranslationDoc> };
		if (!w.__TRANSLATIONS__) {
			w.__TRANSLATIONS__ = {};
		}
		return w.__TRANSLATIONS__;
	}

	/** 取某 exam 的整文档（可能为空对象） */
	static getDoc(examId: string): TranslationDoc {
		return this.store()[examId] || { items: {} };
	}

	/** 取一句译文，找不到返回空字符串 */
	static getSentence(examId: string, passageKey: string, pIdx: number, sIdx: number): string {
		const doc = this.getDoc(examId);
		const items = doc.items || {};
		const passage = items[passageKey];
		if (!passage) return '';
		const entry = passage[`${pIdx}.${sIdx}`];
		return entry ? entry.text || '' : '';
	}

	/** 取一句假名层，找不到返回空字符串 */
	static getKana(examId: string, passageKey: string, pIdx: number, sIdx: number): string {
		const doc = this.getDoc(examId);
		const items = doc.items || {};
		const passage = items[passageKey];
		if (!passage) return '';
		const entry = passage[`${pIdx}.${sIdx}`];
		return entry ? entry.kana || '' : '';
	}

	/** 取一句 ruby 原文 HTML，找不到返回空字符串 */
	static getRuby(examId: string, passageKey: string, pIdx: number, sIdx: number): string {
		const doc = this.getDoc(examId);
		const items = doc.items || {};
		const passage = items[passageKey];
		if (!passage) return '';
		const entry = passage[`${pIdx}.${sIdx}`];
		return entry ? entry.ruby || '' : '';
	}

	/** 加载某 exam 的全部译文到全局 cache */
	static async loadForExam(examId: string): Promise<void> {
		if (!examId) return;
		try {
			const apiClient = (window as unknown as { APIClient?: { getTranslations: (id: string) => Promise<unknown> } }).APIClient;
			if (!apiClient || typeof apiClient.getTranslations !== 'function') return;
			const doc = (await apiClient.getTranslations(examId)) as TranslationDoc | null;
			this.store()[examId] = doc || { items: {} };
		} catch (err) {
			console.warn('[TranslationManager] load failed', err);
			this.store()[examId] = { items: {} };
		}
	}

	/** 安装一次性的全局 click 委托：处理 chip 展开 + 保存 */
	static installDelegation(): void {
		if (this.delegationInstalled) return;
		this.delegationInstalled = true;
		document.addEventListener('click', (ev) => {
			const target = ev.target as HTMLElement | null;
			if (!target) return;
			if (target.classList.contains('translation-chip')) {
				this.handleChipClick(target);
				return;
			}
			if (target.classList.contains('translation-save-btn')) {
				void this.handleSaveClick(target);
			}
		});
	}

	private static handleChipClick(chip: HTMLElement): void {
		const previous = chip.previousElementSibling as HTMLElement | null;
		const sentenceSpan = previous?.classList.contains('passage-sentence')
			? previous
			: previous?.querySelector<HTMLElement>('.passage-sentence') || null;
		if (!sentenceSpan || !sentenceSpan.classList.contains('passage-sentence')) return;
		const paragraph = sentenceSpan.closest('.passage-paragraph') as HTMLElement | null;
		if (!paragraph) return;
		const examId = this.resolveExamId(sentenceSpan);
		const passageKey = this.resolvePassageKey(sentenceSpan);
		const pIdx = Number(sentenceSpan.dataset.pidx || '0');
		const sIdx = Number(sentenceSpan.dataset.sidx || '0');
		if (!examId || !passageKey) {
			console.warn('[TranslationManager] missing examId/passageKey on sentence', { examId, passageKey });
			return;
		}

		// 切换：再次点击关闭
		const existing = paragraph.querySelector<HTMLElement>(
			`.translation-panel[data-pidx="${pIdx}"][data-sidx="${sIdx}"]`
		);
		if (existing) {
			existing.remove();
			chip.classList.remove('is-active');
			return;
		}
		// 关闭其他打开的（同段保持只开一个，避免段内堆叠）
		paragraph.querySelectorAll('.translation-panel').forEach((el) => el.remove());
		paragraph.querySelectorAll('.translation-chip.is-active').forEach((el) => el.classList.remove('is-active'));

		chip.classList.add('is-active');
		const existingText = this.getSentence(examId, passageKey, pIdx, sIdx);
		const panel = this.buildPanel(examId, passageKey, pIdx, sIdx, existingText);
		// 插到段的末尾，避免破坏内联流
		paragraph.appendChild(panel);
	}

	private static buildPanel(
		examId: string,
		passageKey: string,
		pIdx: number,
		sIdx: number,
		existingText: string
	): HTMLDivElement {
		const panel = document.createElement('div');
		panel.className = 'translation-panel';
		panel.dataset.pidx = String(pIdx);
		panel.dataset.sidx = String(sIdx);
		panel.dataset.examId = examId;
		panel.dataset.passageKey = passageKey;

		const header = document.createElement('div');
		header.className = 'translation-panel-header';
		header.textContent = `第 ${pIdx + 1} 段第 ${sIdx + 1} 句 · 中文`;
		panel.appendChild(header);

		const textarea = document.createElement('textarea');
		textarea.className = 'translation-textarea';
		textarea.rows = 2;
		textarea.placeholder = existingText ? '编辑译文…' : '暂无译文，写下你的理解再保存（登录后生效）';
		textarea.value = existingText;
		panel.appendChild(textarea);

		const actions = document.createElement('div');
		actions.className = 'translation-panel-actions';

		const saveBtn = document.createElement('button');
		saveBtn.type = 'button';
		saveBtn.className = 'translation-save-btn';
		saveBtn.textContent = '保存';
		actions.appendChild(saveBtn);

		const status = document.createElement('span');
		status.className = 'translation-panel-status';
		actions.appendChild(status);

		panel.appendChild(actions);
		return panel;
	}

	private static async handleSaveClick(saveBtn: HTMLElement): Promise<void> {
		const panel = saveBtn.closest('.translation-panel') as HTMLElement | null;
		if (!panel) return;
		const textarea = panel.querySelector<HTMLTextAreaElement>('.translation-textarea');
		const status = panel.querySelector<HTMLElement>('.translation-panel-status');
		if (!textarea || !status) return;
		const text = textarea.value.trim();
		if (!text) {
			status.textContent = '内容为空';
			return;
		}
		const examId = panel.dataset.examId || '';
		const passageKey = panel.dataset.passageKey || '';
		const pIdx = Number(panel.dataset.pidx || '0');
		const sIdx = Number(panel.dataset.sidx || '0');
		if (!examId || !passageKey) {
			status.textContent = '上下文缺失';
			return;
		}
		const apiClient = (window as unknown as {
			APIClient?: {
				upsertTranslationSentence: (
					examId: string,
					passageKey: string,
					p: number,
					s: number,
					text: string
				) => Promise<unknown>;
			};
		}).APIClient;
		if (!apiClient) {
			status.textContent = 'API 不可用';
			return;
		}
		status.textContent = '保存中…';
		try {
			const updated = (await apiClient.upsertTranslationSentence(examId, passageKey, pIdx, sIdx, text)) as
				| TranslationDoc
				| null;
			if (updated) {
				this.store()[examId] = updated;
			}
			status.textContent = '已保存';
			window.setTimeout(() => {
				if (status.textContent === '已保存') status.textContent = '';
			}, 1500);
		} catch (err) {
			console.warn('[TranslationManager] save failed', err);
			const msg = err instanceof Error ? err.message : String(err);
			status.textContent = `失败：${msg}`;
		}
	}

	private static resolveExamId(node: HTMLElement): string {
		const wrap = node.closest('[data-exam-id]') as HTMLElement | null;
		if (wrap) return wrap.dataset.examId || '';
		const viewer = (window as unknown as { examViewer?: { _currentExamId?: string | null } }).examViewer;
		return viewer?._currentExamId || '';
	}

	private static resolvePassageKey(node: HTMLElement): string {
		const wrap = node.closest('[data-passage-key]') as HTMLElement | null;
		return wrap ? wrap.dataset.passageKey || '' : '';
	}
}

// Export to global scope
(window as unknown as { TranslationManager: typeof TranslationManager }).TranslationManager = TranslationManager;
