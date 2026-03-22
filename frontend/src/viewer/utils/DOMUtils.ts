/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

/**
 * DOM操作工具类
 * 从 main.js 提取
 */
class DOMUtils {
	/**
	 * 安全获取DOM元素
	 */
	static safeGetElement<T extends HTMLElement = HTMLElement>(id: string, context: string | null = null): T | null {
		const element = document.getElementById(id) as T | null;
		if (!element && context) {
			console.warn(`[DOMUtils] Element not found: ${id} in context:`, context);
		}
		return element;
	}

	/**
	 * 创建带类名的元素
	 */
	static createElementWithClass<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		className: string,
		textContent = ''
	): HTMLElementTagNameMap[K] {
		const element = document.createElement(tag);
		if (className) {
			element.className = className;
		}
		if (textContent) {
			element.textContent = textContent;
		}
		return element;
	}

	/**
	 * 安全设置innerHTML
	 */
	static safeSetInnerHTML(element: HTMLElement | null, html: string, context = ''): void {
		if (!element) {
			console.warn(`[DOMUtils] Cannot set innerHTML: element is null in context: ${context}`);
			return;
		}
		try {
			element.innerHTML = html;
		} catch (error) {
			if (window.ErrorHandler && typeof (window.ErrorHandler as { handle?: unknown }).handle === 'function') {
				(window.ErrorHandler as { handle: (error: unknown, context: string, op: string) => void }).handle(
					error,
					'DOMUtils',
					`设置HTML内容 (${context})`
				);
			} else {
				console.error('[DOMUtils] Error setting innerHTML:', error);
			}
		}
	}
}

if (typeof module !== 'undefined' && module?.exports) {
	module.exports = DOMUtils;
}
window.DOMUtils = DOMUtils;
