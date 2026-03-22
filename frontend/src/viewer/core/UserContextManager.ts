/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface UserContext {
	guest: boolean;
	[key: string]: unknown;
}

type UserContextListener = (context: UserContext) => void;

/**
 * 用户上下文管理器（单例模式）
 * 从 main.js 提取
 */
class UserContextManager {
	private static instance: UserContextManager | null = null;
	private userContext: UserContext = { guest: true };
	private listeners: Set<UserContextListener> = new Set();

	/**
	 * 获取单例实例
	 */
	static getInstance(): UserContextManager {
		if (!this.instance) {
			this.instance = new UserContextManager();
		}
		return this.instance;
	}

	/**
	 * 设置用户上下文
	 */
	setUserContext(context: UserContext): void {
		this.userContext = { ...context };
		this.notifyChange();
	}

	/**
	 * 获取用户上下文
	 */
	getUserContext(): UserContext {
		return { ...this.userContext };
	}

	/**
	 * 通知上下文变更
	 */
	notifyChange(): void {
		window.dispatchEvent(
			new CustomEvent('userContextChanged', {
				detail: this.userContext
			})
		);

		try {
			if (typeof vscode !== 'undefined' && vscode) {
				vscode.postMessage({ type: 'userContext', data: this.userContext });
			}
		} catch (error) {
			console.warn('[UserContextManager] Failed to notify backend:', error);
		}

		this.listeners.forEach((listener) => {
			try {
				listener(this.userContext);
			} catch (error) {
				console.warn('[UserContextManager] Listener error:', error);
			}
		});
	}

	/**
	 * 添加上下文变更监听器
	 */
	addListener(listener: UserContextListener): void {
		this.listeners.add(listener);
	}

	/**
	 * 移除上下文变更监听器
	 */
	removeListener(listener: UserContextListener): void {
		this.listeners.delete(listener);
	}
}

if (typeof module !== 'undefined' && module?.exports) {
	module.exports = UserContextManager;
}
window.UserContextManager = UserContextManager;
