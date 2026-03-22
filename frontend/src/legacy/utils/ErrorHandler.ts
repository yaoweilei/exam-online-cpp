/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

/**
 * 统一的错误处理器
 * 从 main.js 提取
 */
class ErrorHandler {
	/**
	 * 统一处理错误
	 */
	static handle(error: unknown, context: string, operation: string): void {
		console.error(`[${context}] ${operation} failed:`, error);
		this.showUserError(`${operation} failed, please retry`);
	}

	/**
	 * 显示用户友好的错误提示
	 */
	static showUserError(message: string): void {
		console.warn(`[User Message] ${message}`);
	}
}

if (typeof module !== 'undefined' && module?.exports) {
	module.exports = ErrorHandler;
}
window.ErrorHandler = ErrorHandler;
