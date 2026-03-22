"use strict";
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
    static safeGetElement(id, context = null) {
        const element = document.getElementById(id);
        if (!element && context) {
            console.warn(`[DOMUtils] Element not found: ${id} in context:`, context);
        }
        return element;
    }
    /**
     * 创建带类名的元素
     */
    static createElementWithClass(tag, className, textContent = '') {
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
    static safeSetInnerHTML(element, html, context = '') {
        if (!element) {
            console.warn(`[DOMUtils] Cannot set innerHTML: element is null in context: ${context}`);
            return;
        }
        try {
            element.innerHTML = html;
        }
        catch (error) {
            if (window.ErrorHandler && typeof window.ErrorHandler.handle === 'function') {
                window.ErrorHandler.handle(error, 'DOMUtils', `设置HTML内容 (${context})`);
            }
            else {
                console.error('[DOMUtils] Error setting innerHTML:', error);
            }
        }
    }
}
if (typeof module !== 'undefined' && module?.exports) {
    module.exports = DOMUtils;
}
window.DOMUtils = DOMUtils;
//# sourceMappingURL=DOMUtils.js.map