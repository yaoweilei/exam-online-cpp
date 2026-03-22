/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface FuriganaDictItem {
	w: string;
	r: string;
}

interface FuriganaExamViewer {
	showExplanations: boolean;
	questionRenderer: {
		renderCurrentQuestion: () => void;
	};
	[key: string]: unknown;
}

/**
 * 振假名管理器 - 负责日语振假名标注
 */
class FuriganaManager {
	private readonly examViewer: FuriganaExamViewer;
	private furiganaDict: FuriganaDictItem[] | null;
	private _furiganaLoading: boolean;
	private _furiganaVersion: number;
	private _furiganaRegex: RegExp | null;
	private _furiganaMap: Map<string, string> | null;
	private _furiganaBadge: HTMLDivElement | null;
	preferBackendProcessing: boolean;

	constructor(examViewer: FuriganaExamViewer) {
		this.examViewer = examViewer;
		this.furiganaDict = null;
		this._furiganaLoading = false;
		this._furiganaVersion = 0;
		this._furiganaRegex = null;
		this._furiganaMap = null;
		this._furiganaBadge = null;
		this.preferBackendProcessing = true;
	}

	initFuriganaDebugBadge(): void {
		try {
			if (!document.getElementById('furigana-debug-badge')) {
				const badge = document.createElement('div');
				badge.id = 'furigana-debug-badge';
				badge.textContent = 'Furigana: init';
				badge.style.cssText =
					'position:fixed;z-index:9999;right:6px;bottom:6px;font:11px/1.2 monospace;padding:4px 6px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;cursor:pointer;user-select:none;max-width:42vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
				badge.title = '点击复制字典 URL / 双击隐藏';

				badge.addEventListener('click', () => {
					if (window.__FURIGANA_DICT_URL__) {
						navigator.clipboard?.writeText(window.__FURIGANA_DICT_URL__).catch(() => undefined);
						badge.textContent = 'URL 已复制';
						setTimeout(() => this.updateFuriganaStatus(), 1200);
					}
				});

				badge.addEventListener('dblclick', () => {
					badge.style.display = 'none';
				});

				document.addEventListener('keydown', (ev: KeyboardEvent) => {
					if (ev.altKey && ev.key.toLowerCase() === 'f') {
						badge.style.display = 'block';
					}
				});

				document.body.appendChild(badge);
				this._furiganaBadge = badge;
				this.updateFuriganaStatus();
			}
		} catch (error) {
			console.warn('[FuriganaManager] Debug badge initialization failed:', error);
		}
	}

	loadExternalFuriganaDict(): void {
		if (this._furiganaLoading) return;
		const url = window.__FURIGANA_DICT_URL__;
		if (!url) return;
		this._furiganaLoading = true;
		fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json() as Promise<unknown>;
			})
			.then((json: unknown) => {
				if (Array.isArray(json)) {
					const normalized = json
						.filter((d): d is FuriganaDictItem => Boolean(d) && typeof d === 'object' && 'w' in d && 'r' in d)
						.map((d) => ({ w: String(d.w), r: String(d.r) }));
					this.furiganaDict = normalized;
					this._furiganaVersion += 1;
					normalized.sort((a, b) => b.w.length - a.w.length);
					this._furiganaMap = new Map(normalized.map((d) => [d.w, d.r]));
					const escaped = normalized.map((d) => d.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
					this._furiganaRegex = escaped.length > 0 ? new RegExp(`(${escaped.join('|')})`, 'g') : null;
					if (this.examViewer.showExplanations) {
						this.examViewer.questionRenderer.renderCurrentQuestion();
					}
					this.updateFuriganaStatus();
				}
			})
			.catch((err) => console.warn('[FuriganaManager] Failed to load furigana dictionary', err));
	}

	annotateFurigana(text: string): string {
		if (!text) return text;
		let dictSource: FuriganaDictItem[] = this.furiganaDict ?? [];
		if (dictSource.length === 0) {
			dictSource = [
				{ w: '絶叫', r: 'ぜっきょう' },
				{ w: '背後', r: 'はいご' }
			];
		}

		let result = text.replace(/<ruby[^>]*data-auto-furi="1"[^>]*><rb>(.*?)<\/rb><rt>.*?<\/rt><\/ruby>/g, '$1');
		const manualRubyPlaceholders: string[] = [];
		result = result.replace(/<ruby(?![^>]*data-auto-furi)[^>]*>.*?<\/ruby>/g, (m: string) => {
			const idx = manualRubyPlaceholders.length;
			manualRubyPlaceholders.push(m);
			return `__RUBY_MANUAL_${idx}__`;
		});

		if (this._furiganaRegex && this._furiganaMap) {
			result = result.replace(this._furiganaRegex, (m: string) => {
				const kana = this._furiganaMap?.get(m);
				return kana ? `<ruby data-auto-furi="1"><rb>${m}</rb><rt>${kana}</rt></ruby>` : m;
			});
		} else {
			const normalized = dictSource.filter((d) => d && d.w && d.r);
			normalized.sort((a, b) => b.w.length - a.w.length);
			const escaped = normalized.map((d) => d.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
			if (escaped.length) {
				const re = new RegExp(`(${escaped.join('|')})`, 'g');
				result = result.replace(re, (m: string) => {
					const entry = normalized.find((d) => d.w === m);
					return entry ? `<ruby data-auto-furi="1"><rb>${m}</rb><rt>${entry.r}</rt></ruby>` : m;
				});
			}
		}

		result = result.replace(/__RUBY_MANUAL_(\d+)__/g, (_: string, i: string) => manualRubyPlaceholders[Number(i)] || '');
		return result;
	}

	updateFuriganaStatus(): void {
		const badge = this._furiganaBadge || (document.getElementById('furigana-debug-badge') as HTMLDivElement | null);
		if (!badge) return;
		let label = 'Furigana: ';
		if (this._furiganaLoading && !this.furiganaDict) {
			label += 'loading...';
		} else if (this.furiganaDict && Array.isArray(this.furiganaDict) && this.furiganaDict.length > 0) {
			label += `ok ${this.furiganaDict.length}`;
			if (this._furiganaVersion) label += ` v${this._furiganaVersion}`;
		} else {
			label += 'fallback';
		}
		badge.textContent = label;
	}
}

window.FuriganaManager = FuriganaManager;
