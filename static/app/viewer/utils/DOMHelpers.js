"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
/**
 * DOM 辅助工具 - 统一处理 DOM 操作、事件和渲染
 * 合并了 EventManager 和 RenderManager
 */
class DOMHelpers {
    // ==================== 事件管理 ====================
    static addEventListeners(element, events) {
        if (!element)
            return;
        Object.entries(events).forEach(([eventType, handler]) => {
            element.addEventListener(eventType, handler);
        });
    }
    static createElement(options) {
        const { tag, className, textContent, events = {}, attributes = {} } = options;
        const element = document.createElement(tag);
        if (className)
            element.className = className;
        if (textContent)
            element.textContent = textContent;
        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, value);
        });
        this.addEventListeners(element, events);
        return element;
    }
    static delegate(parent, selector, eventType, handler) {
        if (!parent)
            return;
        parent.addEventListener(eventType, (e) => {
            const target = e.target?.closest(selector);
            if (target) {
                handler.call(target, e);
            }
        });
    }
    // ==================== 渲染管理 ====================
    static safeRender(containerId, renderFunction, context) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`[DOMHelpers] Container not found: ${containerId} in ${context}`);
            return null;
        }
        try {
            return renderFunction(container);
        }
        catch (error) {
            console.error(`[DOMHelpers] Render failed in ${context}:`, error);
            return null;
        }
    }
    static setAttributes(element, attributes) {
        if (!element)
            return;
        Object.entries(attributes).forEach(([key, value]) => {
            if (value === null || value === undefined) {
                return;
            }
            if (key === 'textContent') {
                element.textContent = String(value);
            }
            else if (key === 'innerHTML') {
                element.innerHTML = String(value);
            }
            else if (key === 'className') {
                element.className = String(value);
            }
            else {
                element.setAttribute(key, String(value));
            }
        });
    }
}
window.DOMHelpers = DOMHelpers;
window.EventManager = DOMHelpers;
window.RenderManager = DOMHelpers;
//# sourceMappingURL=DOMHelpers.js.map