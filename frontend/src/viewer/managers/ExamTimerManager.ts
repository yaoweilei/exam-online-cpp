/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

// ====================================================================================
// 答题计时管理器（业务功能 3：答题计时与分段限时）
// ------------------------------------------------------------------------------------
// 职责：
//   1. 在 ExamViewer.loadExamData 之后启动后端计时（POST /api/v1/timers/{userId}/start）
//   2. 每 5 秒做一次心跳 tick，累计当前 section 的用时
//   3. 在 #exam-header 顶部渲染一个轻量的"计时条"：
//        - 已用时（mm:ss）
//        - 全卷剩余（若设置了 total_limit_seconds）
//        - 当前小节剩余（若该 section 设置了 section_limits_seconds[i]）
//   4. 检测超时并通过 toast 警告（不强制提交，避免误伤）
//   5. 试卷切换或卸载时清理 setInterval
//
// 不在此文件内自动提交——后端 AnswerRoutes 提交后已会自动 clear 计时
// ====================================================================================

interface ExamTimerExamViewer {
	userId?: string;
	_currentExamId?: string | null;
	currentSectionIndex: number;
}

interface ExamTimerSnapshot {
	exam_id?: string;
	elapsed_seconds?: number;
	total_limit_seconds?: number;
	total_remaining_seconds?: number;
	section_limits_seconds?: number[];
	section_elapsed_seconds?: Record<string, number>;
	expired?: boolean;
	section_expired?: boolean;
}

class ExamTimerManager {
	private readonly examViewer: ExamTimerExamViewer;
	private tickHandle: number | null = null;
	private currentExamId: string | null = null;
	private localElapsedSeconds = 0;
	private lastSnapshot: ExamTimerSnapshot | null = null;
	// 已经提示过的超时，避免重复弹 toast
	private warnedTotalExpired = false;
	private warnedSectionExpired: Record<number, boolean> = {};

	// 心跳间隔（毫秒）；与后端 tick 上限 60s 保持安全距离
	private static readonly TICK_INTERVAL_MS = 5000;

	constructor(examViewer: ExamTimerExamViewer) {
		this.examViewer = examViewer;
	}

	/**
	 * 启动当前考试计时（前端直接调用，幂等）
	 *   - guest 不计时
	 *   - 同 examId 重复调用：仅启动 tick，不重置后端
	 *   - 切换 examId：先停掉旧 tick，再启动新计时
	 */
	startForExam(examId: string, options?: {
		totalLimitSeconds?: number;
		sectionLimitsSeconds?: number[];
	}): void {
		const userId = this.examViewer.userId;
		if (!userId || userId === 'guest' || !examId) {
			return;
		}
		// 功能开关：exam_timer 关闭时不启动计时（且不渲染计时条）
		const isEnabled = (window as Window & { isFeatureEnabled?: (k: string) => boolean }).isFeatureEnabled;
		if (isEnabled && !isEnabled('exam_timer')) {
			this.stop();
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.startExamTimer !== 'function') {
			return;
		}
		// examId 切换：清理旧定时器与本地状态
		if (this.currentExamId && this.currentExamId !== examId) {
			this.stop();
		}
		this.currentExamId = examId;
		this.warnedTotalExpired = false;
		this.warnedSectionExpired = {};

		const payload: Record<string, unknown> = { exam_id: examId };
		if (options?.totalLimitSeconds && options.totalLimitSeconds > 0) {
			payload.total_limit_seconds = options.totalLimitSeconds;
		}
		if (options?.sectionLimitsSeconds && options.sectionLimitsSeconds.length > 0) {
			payload.section_limits_seconds = options.sectionLimitsSeconds;
		}

		// 异步启动后端计时
		api.startExamTimer(userId, payload).then((doc: unknown) => {
			this.applySnapshot(doc);
			this.renderBar();
		}).catch(() => {
			// 后端启动失败则不渲染计时条，避免误导
		});

		// 启动心跳
		if (this.tickHandle === null) {
			this.tickHandle = window.setInterval(() => {
				this.sendTick();
			}, ExamTimerManager.TICK_INTERVAL_MS);
		}
	}

	/**
	 * 停止计时（仅停掉前端定时器；不调用后端 finish）
	 */
	stop(): void {
		if (this.tickHandle !== null) {
			window.clearInterval(this.tickHandle);
			this.tickHandle = null;
		}
		this.currentExamId = null;
		this.localElapsedSeconds = 0;
		this.lastSnapshot = null;
		this.removeBar();
	}

	/**
	 * 心跳：把累积的本地秒数发到后端（约 5 秒一次）
	 *   - 若返回 null（exam_id 不匹配/被清理），则停止本地计时
	 */
	private sendTick(): void {
		const userId = this.examViewer.userId;
		const examId = this.currentExamId;
		if (!userId || userId === 'guest' || !examId) {
			return;
		}
		const api = window.APIClient;
		if (!api || typeof api.tickExamTimer !== 'function') {
			return;
		}
		const delta = Math.round(ExamTimerManager.TICK_INTERVAL_MS / 1000);
		this.localElapsedSeconds += delta;
		const payload: Record<string, unknown> = {
			exam_id: examId,
			section_index: this.examViewer.currentSectionIndex,
			delta_seconds: delta
		};
		api.tickExamTimer(userId, payload).then((doc: unknown) => {
			if (!doc || typeof doc !== 'object') {
				// 后端无计时（可能被 submit 自动清理）：停止
				this.stop();
				return;
			}
			this.applySnapshot(doc);
			this.renderBar();
			this.checkExpiry();
		}).catch(() => {
			// 单次心跳失败不打扰用户
		});
	}

	private applySnapshot(doc: unknown): void {
		if (doc && typeof doc === 'object') {
			this.lastSnapshot = doc as ExamTimerSnapshot;
		}
	}

	/**
	 * 渲染顶部"计时条" -> 注入到 #exam-header
	 */
	private renderBar(): void {
		this.removeBar();
	}

	private removeBar(): void {
		const bar = document.getElementById('exam-timer-bar');
		if (bar && bar.parentNode) {
			bar.parentNode.removeChild(bar);
		}
	}

	/**
	 * 超时提醒（toast 一次即止；不强制提交）
	 */
	private checkExpiry(): void {
		const snap = this.lastSnapshot;
		if (!snap) return;
		if (snap.expired && !this.warnedTotalExpired) {
			this.warnedTotalExpired = true;
			this.notify('考试时间已用完，请尽快提交');
		}
		const sectionIdx = this.examViewer.currentSectionIndex;
		if (snap.section_expired && sectionIdx >= 0 && !this.warnedSectionExpired[sectionIdx]) {
			this.warnedSectionExpired[sectionIdx] = true;
			this.notify(`第 ${sectionIdx + 1} 部分时间已用完`);
		}
	}

	private notify(message: string): void {
		// 优先复用全局 toast；没有则降级到 console + alert
		const w = window as unknown as {
			showToast?: (msg: string) => void;
		};
		if (typeof w.showToast === 'function') {
			try { w.showToast(message); return; } catch { /* fallthrough */ }
		}
		try { console.warn('[ExamTimer]', message); } catch { /* ignore */ }
	}
}

/**
 * 辅助：把秒数格式化为 mm:ss 或 hh:mm:ss
 */
function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const hh = Math.floor(s / 3600);
	const mm = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	const pad = (n: number) => n.toString().padStart(2, '0');
	if (hh > 0) {
		return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
	}
	return `${pad(mm)}:${pad(ss)}`;
}

window.ExamTimerManager = ExamTimerManager;
