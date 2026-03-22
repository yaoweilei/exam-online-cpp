/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface LoaderModule {
	name: string;
	path: string;
}

interface LoaderExamMeta {
	id: string;
	display: string;
	level?: string;
	year?: string;
	session?: string;
	checked?: boolean;
	[key: string]: unknown;
}

interface LoaderCurrentUser {
	user_id?: string;
	username?: string;
	[key: string]: unknown;
}

interface LoaderUserContextStatic {
	currentUser?: LoaderCurrentUser;
}

type LoaderExamViewerCtor = new () => {
	loadExamData: (examData: unknown) => void;
	[key: string]: unknown;
};

type LoaderExamApi = {
	getExam: (examId: string) => Promise<unknown>;
};

type LoaderExamListApi = {
	getExams: (options?: { level?: string; year?: string; sort?: string }) => Promise<unknown[]>;
};

(function () {
	'use strict';

	console.log('[Loader] Starting module loading...');

	const globalWindow = window as unknown as Window & {
		[key: string]: unknown;
	};

	const currentScriptNode =
		document.currentScript ??
		(document.querySelector('script[src*="loader"]') as HTMLScriptElement | SVGScriptElement | null);
	const currentScript = currentScriptNode instanceof HTMLScriptElement ? currentScriptNode : null;
	const scriptSrc = currentScript?.src ?? '';
	const basePath = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
	console.log('[Loader] Base path:', basePath);

	const modules: LoaderModule[] = [
		{ name: 'Logger', path: 'utils/Logger.js' },
		{ name: 'ErrorHandler', path: 'utils/ErrorHandler.js' },
		{ name: 'DOMUtils', path: 'utils/DOMUtils.js' },
		{ name: 'DOMHelpers', path: 'utils/DOMHelpers.js' },
		{ name: 'APIClient', path: 'core/APIClient.js' },
		{ name: 'ExamLoader', path: 'core/ExamLoader.js' },
		{ name: 'UserContextManager', path: 'core/UserContextManager.js' },
		{ name: 'StateManager', path: 'managers/StateManager.js' },
		{ name: 'NavigationManager', path: 'managers/NavigationManager.js' },
		{ name: 'AudioManager', path: 'managers/AudioManager.js' },
		{ name: 'FuriganaManager', path: 'managers/FuriganaManager.js' },
		{ name: 'AnswerManager', path: 'managers/AnswerManager.js' },
		{ name: 'QuestionMapManager', path: 'managers/QuestionMapManager.js' },
		{ name: 'CategoryNavigationManager', path: 'managers/CategoryNavigationManager.js' },
		{ name: 'QuestionRenderer', path: 'renderers/QuestionRenderer.js' },
		{ name: 'ExamViewer', path: 'core/ExamViewer.js' }
	];

	let loadedCount = 0;
	const totalCount = modules.length;
	const loadedModules = new Set<string>();
	const failedModules = new Set<string>();

	function loadModule(moduleDef: LoaderModule): Promise<void> {
		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = basePath + moduleDef.path;
			script.async = false;

			console.log(`[Loader] Loading ${moduleDef.name} from:`, script.src);

			script.onload = () => {
				loadedCount += 1;
				loadedModules.add(moduleDef.name);
				console.log(`[Loader] ✓ Loaded ${moduleDef.name} (${loadedCount}/${totalCount})`);

				if (moduleDef.name === 'ExamViewer') {
					if (typeof globalWindow.ExamViewer !== 'undefined') {
						console.log('[Loader] ✓ ExamViewer class is available');
					} else {
						console.warn('[Loader] ⚠ ExamViewer class not found in global scope');
					}
				} else if (globalWindow[moduleDef.name]) {
					console.log(`[Loader] ✓ ${moduleDef.name} is available in global scope`);
				} else {
					console.warn(`[Loader] ⚠ ${moduleDef.name} not found in global scope`);
				}

				resolve();
			};

			script.onerror = () => {
				failedModules.add(moduleDef.name);
				console.error(`[Loader] ✗ Failed to load ${moduleDef.name}`);
				reject(new Error(`Failed to load ${moduleDef.name}`));
			};

			document.head.appendChild(script);
		});
	}

	async function loadAllModules(): Promise<void> {
		console.log(`[Loader] Loading ${totalCount} modules...`);

		try {
			for (const moduleDef of modules) {
				// 保证按顺序串行加载
				// eslint-disable-next-line no-await-in-loop
				await loadModule(moduleDef);
			}

			console.log('[Loader] ✓ All modules loaded successfully');
			console.log('[Loader] Loaded modules:', Array.from(loadedModules));

			initializeApp();
		} catch (error) {
			console.error('[Loader] ✗ Module loading failed:', error);
			console.error('[Loader] Failed modules:', Array.from(failedModules));
			showLoadingError(error);
		}
	}

	function initializeApp(): void {
		console.log('[Loader] Initializing application...');
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', createExamViewer);
		} else {
			createExamViewer();
		}
	}

	function createExamViewer(): void {
		try {
			console.log('[Loader] Creating ExamViewer instance...');

			const requiredClasses = [
				'DOMUtils',
				'DOMHelpers',
				'ErrorHandler',
				'ExamLoader',
				'UserContextManager',
				'StateManager',
				'NavigationManager',
				'AudioManager',
				'AnswerManager',
				'QuestionMapManager',
				'FuriganaManager',
				'CategoryNavigationManager',
				'QuestionRenderer'
			];

			const missingClasses = requiredClasses.filter((name) => typeof globalWindow[name] === 'undefined');
			if (missingClasses.length > 0) {
				throw new Error(`Missing required classes: ${missingClasses.join(', ')}`);
			}

			const examViewerCtor = globalWindow.ExamViewer as LoaderExamViewerCtor | undefined;
			if (!examViewerCtor) {
				throw new Error('ExamViewer constructor not found');
			}

			globalWindow.examViewer = new examViewerCtor();
			console.log('[Loader] ✓ ExamViewer instance created successfully');

			initExamSelectors();
			window.dispatchEvent(
				new CustomEvent('examViewerReady', {
					detail: { examViewer: globalWindow.examViewer }
				})
			);
		} catch (error) {
			console.error('[Loader] ✗ Failed to create ExamViewer instance:', error);
			showLoadingError(error);
		}
	}

	const PROGRESS_ICONS = {
		none: '',
		ready: '⭘',
		quarter: '◔',
		half: '◑',
		three_quarter: '◕',
		full: '●'
	} as const;

	function getProgressIcon(checked: boolean, completion: number): string {
		if (!checked) return PROGRESS_ICONS.none;
		if (completion <= 0) return PROGRESS_ICONS.ready;
		if (completion <= 0.25) return PROGRESS_ICONS.quarter;
		if (completion <= 0.5) return PROGRESS_ICONS.half;
		if (completion <= 0.75) return PROGRESS_ICONS.three_quarter;
		return PROGRESS_ICONS.full;
	}

	function buildOptionText(exam: LoaderExamMeta, userProgress: Record<string, number>): string {
		const completion = userProgress[exam.id] !== undefined ? userProgress[exam.id] : -1;
		const icon = getProgressIcon(Boolean(exam.checked), completion);
		return icon ? `${exam.display} ${icon}` : exam.display;
	}

	function buildPaperOptions(exams: LoaderExamMeta[], userProgress: Record<string, number>): string {
		return (
			'<option value="">-</option>' +
			exams
				.map((exam) => {
					const text = buildOptionText(exam, userProgress);
					return `<option value="${exam.id}" data-checked="${Boolean(exam.checked)}">${text}</option>`;
				})
				.join('')
		);
	}

	function normalizeExamMeta(raw: unknown): LoaderExamMeta | null {
		if (!raw || typeof raw !== 'object') {
			return null;
		}
		const data = raw as Record<string, unknown>;
		const id = typeof data.id === 'string' ? data.id : '';
		if (!id) {
			return null;
		}

		let level = typeof data.level === 'string' ? data.level : '';
		if (!level) {
			const match = id.match(/^(N[1-5])[_-]/);
			level = match?.[1] ?? '';
		}

		const year = typeof data.year === 'string' ? data.year : '';
		const session = typeof data.session === 'string' ? data.session : '';
		const display =
			typeof data.display === 'string' && data.display.trim()
				? data.display
				: year && session
					? `${year}_${session}`
					: id;

		return {
			id,
			level,
			year,
			session,
			display,
			checked: Boolean(data.checked)
		};
	}

	function hasGroupedExams(examsByLevel: Record<string, LoaderExamMeta[]>): boolean {
		return Object.values(examsByLevel).some((items) => Array.isArray(items) && items.length > 0);
	}

	async function fetchExamsForFallback(): Promise<LoaderExamMeta[]> {
		try {
			const apiClient = window.APIClient as LoaderExamListApi | undefined;
			if (apiClient?.getExams) {
				const list = await apiClient.getExams({ sort: 'date_desc' });
				return (list as unknown[]).map(normalizeExamMeta).filter((item): item is LoaderExamMeta => item !== null);
			}
		} catch (error) {
			console.warn('[Loader] APIClient.getExams fallback failed:', error);
		}

		try {
			const apiBase = window.__API_BASE__ || '/api/v2';
			const response = await fetch(`${apiBase}/exams?sort=date_desc`);
			if (!response.ok) {
				return [];
			}
			const payload = (await response.json()) as Partial<ApiEnvelope<unknown[]>> | unknown[];
			const rawList = Array.isArray(payload) ? payload : ((payload as Partial<ApiEnvelope<unknown[]>>).data ?? []);
			return (rawList as unknown[]).map(normalizeExamMeta).filter((item): item is LoaderExamMeta => item !== null);
		} catch (error) {
			console.warn('[Loader] fetch /exams fallback failed:', error);
			return [];
		}
	}

	async function ensureExamsByLevelLoaded(): Promise<void> {
		const current = window.__EXAMS_BY_LEVEL__ ?? {};
		if (hasGroupedExams(current)) {
			return;
		}

		const exams = await fetchExamsForFallback();
		if (exams.length === 0) {
			return;
		}

		const grouped: Record<string, LoaderExamMeta[]> = {};
		exams.forEach((exam) => {
			const level = exam.level || 'N1';
			if (!grouped[level]) {
				grouped[level] = [];
			}
			grouped[level].push(exam);
		});
		window.__EXAMS_BY_LEVEL__ = grouped;
	}

	let userProgressCache: Record<string, number> = {};

	async function fetchUserProgress(): Promise<Record<string, number>> {
		try {
			const userContextManager = globalWindow.UserContextManager as LoaderUserContextStatic | undefined;
			const userId = userContextManager?.currentUser?.user_id ?? userContextManager?.currentUser?.username ?? null;
			if (!userId || userId === 'guest') {
				return {};
			}

			const apiBase = window.__API_BASE__ || '/api/v2';
			const resp = await fetch(`${apiBase}/progress/${userId}/exams`);
			if (!resp.ok) {
				return {};
			}
			const payload = (await resp.json()) as Partial<ApiEnvelope<Record<string, number>>> | Record<string, unknown>;
			const progress = (payload as Partial<ApiEnvelope<Record<string, number>>>).data ?? payload;
			if (typeof progress !== 'object' || progress === null || Array.isArray(progress)) {
				return {};
			}

			const normalized: Record<string, number> = {};
			Object.entries(progress).forEach(([examId, value]) => {
				if (typeof value === 'number' && Number.isFinite(value)) {
					normalized[examId] = value;
				}
			});
			return normalized;
		} catch (error) {
			console.warn('[Loader] Failed to fetch user progress:', error);
			return {};
		}
	}

	async function refreshPaperSelectIcons(): Promise<void> {
		userProgressCache = await fetchUserProgress();
		const paperSelect = document.getElementById('exam-paper-select') as HTMLSelectElement | null;
		const levelSelect = document.getElementById('exam-level-select') as HTMLSelectElement | null;
		if (!paperSelect || !levelSelect) {
			return;
		}

		const level = levelSelect.value;
		const examsByLevel = window.__EXAMS_BY_LEVEL__ ?? {};
		const exams = examsByLevel[level] ?? [];

		const currentValue = paperSelect.value;
		paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);
		if (currentValue) {
			paperSelect.value = currentValue;
		}
	}

	window.refreshPaperSelectIcons = refreshPaperSelectIcons;

	function initExamSelectors(): void {
		const levelSelect = document.getElementById('exam-level-select') as HTMLSelectElement | null;
		const paperSelect = document.getElementById('exam-paper-select') as HTMLSelectElement | null;

		if (!levelSelect || !paperSelect) {
			console.warn('[Loader] Exam selectors not found');
			return;
		}

		console.log('[Loader] Setting up exam selectors...');

		paperSelect.addEventListener('change', async () => {
			const examId = paperSelect.value;
			if (!examId) return;

			console.log('[Loader] Loading exam:', examId);

			try {
				const container = document.getElementById('current-question-container');
				if (container) {
					container.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;">加载中...</div>';
				}

				const examLoader = globalWindow.ExamLoader as LoaderExamApi | undefined;
				const examData = examLoader ? await examLoader.getExam(examId) : null;
				if (!examData) {
					throw new Error('试卷数据为空');
				}

				console.log('[Loader] Exam data loaded, calling loadExamData');
				globalWindow.examViewer?.loadExamData(examData);
			} catch (error) {
				console.error('[Loader] Failed to load exam:', error);
				const container = document.getElementById('current-question-container');
				if (container) {
					const message = error instanceof Error ? error.message : String(error);
					container.innerHTML = `<div style="padding: 40px; text-align: center; color: red;">加载失败：${message}</div>`;
				}
			}
		});

		levelSelect.addEventListener('change', () => {
			const level = levelSelect.value;
			console.log('[Loader] Level changed to:', level);

			const examsByLevel = window.__EXAMS_BY_LEVEL__ ?? {};
			const exams = examsByLevel[level] ?? [];
			if (exams.length === 0) {
				void ensureExamsByLevelLoaded().then(() => {
					const refreshed = window.__EXAMS_BY_LEVEL__?.[level] ?? [];
					paperSelect.innerHTML = buildPaperOptions(refreshed, userProgressCache);
					if (refreshed.length > 0) {
						paperSelect.value = refreshed[0].id;
						paperSelect.dispatchEvent(new Event('change'));
					}
				});
				return;
			}

			paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);

			if (exams.length > 0) {
				const latestExam = exams[0];
				paperSelect.value = latestExam.id;
				paperSelect.dispatchEvent(new Event('change'));
			}
		});

		const initialLevel = levelSelect.value;
		if (initialLevel) {
			console.log('[Loader] Initializing with level:', initialLevel);
			const examsByLevel = window.__EXAMS_BY_LEVEL__ ?? {};
			const exams = examsByLevel[initialLevel] ?? [];

			if (paperSelect.options.length <= 1) {
				paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);
			}

			if (paperSelect.value) {
				console.log('[Loader] Restoring previously selected exam:', paperSelect.value);
				paperSelect.dispatchEvent(new Event('change'));
			} else if (exams.length > 0) {
				const latestExam = exams[0];
				paperSelect.value = latestExam.id;
				console.log('[Loader] Auto-selecting latest exam:', latestExam.id);
				paperSelect.dispatchEvent(new Event('change'));
			}
		}

		fetchUserProgress().then((progress) => {
			userProgressCache = progress;
			if (Object.keys(progress).length > 0) {
				void refreshPaperSelectIcons();
			}
		});

		void ensureExamsByLevelLoaded().then(() => {
			const level = levelSelect.value;
			const exams = window.__EXAMS_BY_LEVEL__?.[level] ?? [];
			if (paperSelect.options.length <= 1 && exams.length > 0) {
				paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);
				if (!paperSelect.value) {
					paperSelect.value = exams[0].id;
					paperSelect.dispatchEvent(new Event('change'));
				}
			}
		});

		console.log('[Loader] ✓ Exam selectors initialized');
	}

	function showLoadingError(error: unknown): void {
		const container = document.getElementById('exam-content') ?? document.body;
		const errorDiv = document.createElement('div');
		errorDiv.style.cssText = 'padding: 20px; text-align: center; color: red;';
		const message = error instanceof Error ? error.message : String(error);
		errorDiv.innerHTML = `
			<h2>加载失败</h2>
			<p>无法加载试卷查看器模块</p>
			<p style="font-size: 12px; color: #666;">${message}</p>
			<p style="font-size: 12px; color: #666;">请刷新页面重试</p>
		`;
		container.appendChild(errorDiv);
	}

	void loadAllModules();
})();
