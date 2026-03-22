/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

/**
 * 试卷加载器 - 统一处理试卷数据加载
 * 合并了 ExamDataLoader 和 ExamAPILoader
 */
class ExamLoader {
	/**
	 * 解析试卷数据（去除注释）
	 * @param {string} rawText - 原始文本
	 * @returns {Object} 解析后的试卷数据
	 */
	static parseExamData(rawText) {
		try {
			const stripped = rawText.replace(/^\/\*[^]*?\*\/\s*(?=\{)/, '');
			return JSON.parse(stripped);
		} catch (error) {
			if (typeof ErrorHandler !== 'undefined') {
				ErrorHandler.handle(error, 'ExamLoader', '解析试卷数据');
			} else {
				console.error('[ExamLoader] Parse error:', error);
			}
			return null;
		}
	}

	/**
	 * 从脚本标签加载数据（VSCode 扩展模式）
	 * @param {string} scriptId - 脚本标签ID
	 * @returns {Object|null} 解析后的数据或null
	 */
	static loadFromScript(scriptId) {
		const script = document.getElementById(scriptId);
		if (!script || !script.textContent) {
			console.warn(`[ExamLoader] Script ${scriptId} not found or empty`);
			return null;
		}
		return ExamLoader.parseExamData(script.textContent);
	}

	/**
	 * 获取所有试卷列表（Web 应用模式）
	 * @returns {Promise<Array>} 试卷列表
	 */
	static async getExamList() {
		try {
			if (window.APIClient) {
				return await window.APIClient.getExams();
			}
			const apiBase = window.__API_BASE__ || '/api/v2';
			const response = await fetch(`${apiBase}/exams`);
			const payload = await response.json();
			return payload.data !== undefined ? payload.data : payload;
		} catch (error) {
			console.error('[ExamLoader] Failed to load exam list:', error);
			return [];
		}
	}

	/**
	 * 获取单个试卷数据（Web 应用模式）
	 * @param {string} examId - 试卷ID
	 * @returns {Promise<Object|null>} 试卷数据
	 */
	static async getExam(examId) {
		try {
			if (window.APIClient) {
				return await window.APIClient.getExam(examId);
			}
			const apiBase = window.__API_BASE__ || '/api/v2';
			const response = await fetch(`${apiBase}/exams/${examId}`);
			const payload = await response.json();
			return payload.data !== undefined ? payload.data : payload;
		} catch (error) {
			console.error(`[ExamLoader] Failed to load exam ${examId}:`, error);
			return null;
		}
	}
}

// 导出到全局作用域
window.ExamLoader = ExamLoader;

// 向后兼容
window.ExamDataLoader = ExamLoader;
window.ExamAPILoader = ExamLoader;
