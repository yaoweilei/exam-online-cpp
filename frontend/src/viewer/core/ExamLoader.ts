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
	 */
	static parseExamData(rawText: string): unknown | null {
		try {
			const stripped = rawText.replace(/^\/\*[^]*?\*\/\s*(?=\{)/, '');
			return JSON.parse(stripped);
		} catch (error) {
			if (window.ErrorHandler && typeof (window.ErrorHandler as { handle?: unknown }).handle === 'function') {
				(window.ErrorHandler as { handle: (error: unknown, context: string, op: string) => void }).handle(
					error,
					'ExamLoader',
					'解析试卷数据'
				);
			} else {
				console.error('[ExamLoader] Parse error:', error);
			}
			return null;
		}
	}

	/**
	 * 从脚本标签加载数据（VSCode 扩展模式）
	 */
	static loadFromScript(scriptId: string): unknown | null {
		const script = document.getElementById(scriptId);
		if (!script || !script.textContent) {
			console.warn(`[ExamLoader] Script ${scriptId} not found or empty`);
			return null;
		}
		return ExamLoader.parseExamData(script.textContent);
	}

	/**
	 * 获取所有试卷列表（Web 应用模式）
	 */
	static async getExamList(): Promise<unknown[]> {
		try {
			if (window.APIClient) {
				return await window.APIClient.getExams();
			}
			const apiBase = window.__API_BASE__ || '/api/v1';
			const response = await fetch(`${apiBase}/exams`);
			const payload = (await response.json()) as Partial<ApiEnvelope<unknown[]>> | unknown[];
			if (Array.isArray(payload)) {
				return payload;
			}
			return (payload as Partial<ApiEnvelope<unknown[]>>).data ?? [];
		} catch (error) {
			console.error('[ExamLoader] Failed to load exam list:', error);
			return [];
		}
	}

	/**
	 * 获取单个试卷数据（Web 应用模式）
	 */
	static async getExam(examId: string): Promise<unknown | null> {
		try {
			if (window.APIClient) {
				return await window.APIClient.getExam(examId);
			}
			const apiBase = window.__API_BASE__ || '/api/v1';
			const response = await fetch(`${apiBase}/exams/${examId}`);
			const payload = (await response.json()) as Partial<ApiEnvelope<unknown>>;
			return payload.data !== undefined ? payload.data : (payload as unknown);
		} catch (error) {
			const err = error as { status?: number; payload?: { code?: string; message?: string }; message?: string };
			if (err.status === 403 || err.payload?.code === 'EXAM_ACCESS_DENIED') {
				const accessError = new Error(err.payload?.message || err.message || '当前套餐无法访问这份试卷') as Error & {
					status?: number;
					code?: string;
					examId?: string;
				};
				accessError.status = err.status || 403;
				accessError.code = err.payload?.code || 'EXAM_ACCESS_DENIED';
				accessError.examId = examId;
				throw accessError;
			}
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
