"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/
/**
 * 用户上下文管理器（单例模式）
 * 从 main.js 提取
 */
class UserContextManager {
    static instance = null;
    userContext = { guest: true };
    listeners = new Set();
    /**
     * 获取单例实例
     */
    static getInstance() {
        if (!this.instance) {
            this.instance = new UserContextManager();
        }
        return this.instance;
    }
    /**
     * 设置用户上下文
     */
    setUserContext(context) {
        this.userContext = { ...context };
        this.notifyChange();
    }
    /**
     * 获取用户上下文
     */
    getUserContext() {
        return { ...this.userContext };
    }
    /**
     * 通知上下文变更
     */
    notifyChange() {
        window.dispatchEvent(new CustomEvent('userContextChanged', {
            detail: this.userContext
        }));
        try {
            if (typeof vscode !== 'undefined' && vscode) {
                vscode.postMessage({ type: 'userContext', data: this.userContext });
            }
        }
        catch (error) {
            console.warn('[UserContextManager] Failed to notify backend:', error);
        }
        this.listeners.forEach((listener) => {
            try {
                listener(this.userContext);
            }
            catch (error) {
                console.warn('[UserContextManager] Listener error:', error);
            }
        });
    }
    /**
     * 添加上下文变更监听器
     */
    addListener(listener) {
        this.listeners.add(listener);
    }
    /**
     * 移除上下文变更监听器
     */
    removeListener(listener) {
        this.listeners.delete(listener);
    }
}
if (typeof module !== 'undefined' && module?.exports) {
    module.exports = UserContextManager;
}
window.UserContextManager = UserContextManager;
//# sourceMappingURL=UserContextManager.js.map