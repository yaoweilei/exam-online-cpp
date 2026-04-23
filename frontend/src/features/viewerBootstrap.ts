interface ViewerModule {
	name: string;
	path: string;
}

interface ViewerExamMeta {
	id: string;
	display: string;
	level?: string;
	year?: string;
	session?: string;
	checked?: boolean;
	[key: string]: unknown;
}

interface ViewerCurrentUser {
	user_id?: string;
	username?: string;
	id?: string;
	[key: string]: unknown;
}

interface ViewerUserContextStatic {
	currentUser?: ViewerCurrentUser;
}

type ViewerExamViewerCtor = new () => {
	loadExamData: (examData: unknown) => void;
	[key: string]: unknown;
};

type ViewerExamApi = {
	getExam: (examId: string) => Promise<unknown>;
};

type ViewerExamListApi = {
	getExams: (options?: { level?: string; year?: string; sort?: string }) => Promise<unknown[]>;
};

const VIEWER_MODULES: ViewerModule[] = [
	{ name: 'Logger', path: '../viewer/utils/Logger.js' },
	{ name: 'ErrorHandler', path: '../viewer/utils/ErrorHandler.js' },
	{ name: 'DOMUtils', path: '../viewer/utils/DOMUtils.js' },
	{ name: 'DOMHelpers', path: '../viewer/utils/DOMHelpers.js' },
	{ name: 'APIClient', path: '../viewer/core/APIClient.js' },
	{ name: 'ExamLoader', path: '../viewer/core/ExamLoader.js' },
	{ name: 'UserContextManager', path: '../viewer/core/UserContextManager.js' },
	{ name: 'StateManager', path: '../viewer/managers/StateManager.js' },
	{ name: 'NavigationManager', path: '../viewer/managers/NavigationManager.js' },
	{ name: 'AudioManager', path: '../viewer/managers/AudioManager.js' },
	{ name: 'FuriganaManager', path: '../viewer/managers/FuriganaManager.js' },
	{ name: 'TranslationManager', path: '../viewer/managers/TranslationManager.js' },
	{ name: 'VocabLookupManager', path: '../viewer/managers/VocabLookupManager.js' },
	{ name: 'AnswerManager', path: '../viewer/managers/AnswerManager.js' },
	{ name: 'QuestionMapManager', path: '../viewer/managers/QuestionMapManager.js' },
	{ name: 'CategoryNavigationManager', path: '../viewer/managers/CategoryNavigationManager.js' },
	{ name: 'QuestionRenderer', path: '../viewer/renderers/QuestionRenderer.js' },
	{ name: 'ExamViewer', path: '../viewer/core/ExamViewer.js' },
	{ name: 'PersonalCenter', path: '../viewer/personalCenter.js' }
];

const REQUIRED_GLOBALS = [
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
	'TranslationManager',
	'VocabLookupManager',
	'CategoryNavigationManager',
	'QuestionRenderer',
	'ExamViewer'
] as const;

const PROGRESS_ICONS = {
	none: '',
	ready: '⭘',
	quarter: '◔',
	half: '◑',
	three_quarter: '◕',
	full: '●'
} as const;

let userProgressCache: Record<string, number> = {};

function getGlobalWindow(): Window & Record<string, unknown> {
	return window as unknown as Window & Record<string, unknown>;
}

async function loadViewerModules(): Promise<void> {
	for (const moduleDef of VIEWER_MODULES) {
		// Keep evaluation ordered because these modules communicate through window globals.
		// eslint-disable-next-line no-await-in-loop
		await import(moduleDef.path);
	}
}

function normalizeExamMeta(raw: unknown): ViewerExamMeta | null {
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

function hasGroupedExams(examsByLevel: Record<string, ViewerExamMeta[]>): boolean {
	return Object.values(examsByLevel).some((items) => Array.isArray(items) && items.length > 0);
}

function hasExamsForLevel(examsByLevel: Record<string, ViewerExamMeta[]>, level: string): boolean {
	const exams = examsByLevel[level];
	return Array.isArray(exams) && exams.length > 0;
}

async function fetchExamsForFallback(): Promise<ViewerExamMeta[]> {
	try {
		const apiClient = window.APIClient as ViewerExamListApi | undefined;
		if (apiClient?.getExams) {
			const list = await apiClient.getExams({ sort: 'date_desc' });
			return (list as unknown[]).map(normalizeExamMeta).filter((item): item is ViewerExamMeta => item !== null);
		}
	} catch (error) {
		console.warn('[viewerBootstrap] APIClient.getExams fallback failed:', error);
	}

	try {
		const apiBase = window.__API_BASE__ || '/api/v2';
		const response = await fetch(`${apiBase}/exams?sort=date_desc`);
		if (!response.ok) {
			return [];
		}

		const payload = (await response.json()) as Partial<ApiEnvelope<unknown[]>> | unknown[];
		const rawList = Array.isArray(payload) ? payload : ((payload as Partial<ApiEnvelope<unknown[]>>).data ?? []);
		return (rawList as unknown[]).map(normalizeExamMeta).filter((item): item is ViewerExamMeta => item !== null);
	} catch (error) {
		console.warn('[viewerBootstrap] fetch /exams fallback failed:', error);
		return [];
	}
}

async function ensureExamsByLevelLoaded(requiredLevel?: string): Promise<void> {
	const current = window.__EXAMS_BY_LEVEL__ ?? {};
	if (requiredLevel ? hasExamsForLevel(current, requiredLevel) : hasGroupedExams(current)) {
		return;
	}

	const exams = await fetchExamsForFallback();
	if (exams.length === 0) {
		return;
	}

	const grouped: Record<string, ViewerExamMeta[]> = {};
	exams.forEach((exam) => {
		const level = exam.level || 'N1';
		if (!grouped[level]) {
			grouped[level] = [];
		}
		grouped[level].push(exam);
	});
	window.__EXAMS_BY_LEVEL__ = grouped;
}

async function syncPaperSelect(
	levelSelect: HTMLSelectElement,
	paperSelect: HTMLSelectElement,
	options: { dispatchChange?: boolean; preserveCurrentValue?: boolean } = {}
): Promise<void> {
	const { dispatchChange = false, preserveCurrentValue = false } = options;
	const level = levelSelect.value;
	if (!level) {
		paperSelect.innerHTML = buildPaperOptions([], userProgressCache);
		return;
	}

	await ensureExamsByLevelLoaded(level);
	const exams = window.__EXAMS_BY_LEVEL__?.[level] ?? [];
	const currentValue = preserveCurrentValue ? paperSelect.value : '';
	paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);

	if (currentValue && exams.some((exam) => exam.id === currentValue)) {
		paperSelect.value = currentValue;
	} else if (exams.length > 0) {
		paperSelect.value = exams[0].id;
	}

	if (dispatchChange && paperSelect.value) {
		paperSelect.dispatchEvent(new Event('change'));
	}
}

async function fetchUserProgress(): Promise<Record<string, number>> {
	try {
		const userContext = window.getUserContext?.() as ViewerCurrentUser | undefined;
		const userId = userContext?.user_id ?? userContext?.id ?? userContext?.username ?? null;
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
		console.warn('[viewerBootstrap] Failed to fetch user progress:', error);
		return {};
	}
}

function getProgressIcon(checked: boolean, completion: number): string {
	if (!checked) return PROGRESS_ICONS.none;
	if (completion <= 0) return PROGRESS_ICONS.ready;
	if (completion <= 0.25) return PROGRESS_ICONS.quarter;
	if (completion <= 0.5) return PROGRESS_ICONS.half;
	if (completion <= 0.75) return PROGRESS_ICONS.three_quarter;
	return PROGRESS_ICONS.full;
}

function buildOptionText(exam: ViewerExamMeta, userProgress: Record<string, number>): string {
	const completion = userProgress[exam.id] !== undefined ? userProgress[exam.id] : -1;
	const icon = getProgressIcon(Boolean(exam.checked), completion);
	return icon ? `${exam.display} ${icon}` : exam.display;
}

function buildPaperOptions(exams: ViewerExamMeta[], userProgress: Record<string, number>): string {
	if (exams.length === 0) {
		return '<option value="">-</option>';
	}

	return exams
		.map((exam) => {
			const text = buildOptionText(exam, userProgress);
			return `<option value="${exam.id}" data-checked="${Boolean(exam.checked)}">${text}</option>`;
		})
		.join('');
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

function showBootError(error: unknown): void {
	const container = document.getElementById('exam-content') ?? document.body;
	const errorDiv = document.createElement('div');
	errorDiv.style.cssText = 'padding: 20px; text-align: center; color: red;';
	const message = error instanceof Error ? error.message : String(error);
	errorDiv.innerHTML = `
		<h2>加载失败</h2>
		<p>无法初始化试卷查看器</p>
		<p style="font-size: 12px; color: #666;">${message}</p>
		<p style="font-size: 12px; color: #666;">请刷新页面重试</p>
	`;
	container.appendChild(errorDiv);
}

async function initExamSelectors(): Promise<void> {
	const globalWindow = getGlobalWindow();
	const levelSelect = document.getElementById('exam-level-select') as HTMLSelectElement | null;
	const paperSelect = document.getElementById('exam-paper-select') as HTMLSelectElement | null;

	if (!levelSelect || !paperSelect) {
		console.warn('[viewerBootstrap] Exam selectors not found');
		return;
	}

	paperSelect.addEventListener('change', async () => {
		const examId = paperSelect.value;
		if (!examId) {
			return;
		}

		try {
			const container = document.getElementById('current-question-container');
			if (container) {
				container.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;">加载中...</div>';
			}

			const examLoader = globalWindow.ExamLoader as ViewerExamApi | undefined;
			const examData = examLoader ? await examLoader.getExam(examId) : null;
			if (!examData) {
				throw new Error('试卷数据为空');
			}

			// 业务功能 3：先把 examId 写到 viewer，loadExamData 末尾据此启动计时
			const viewerForTimer = globalWindow.examViewer as { _currentExamId?: string | null } | undefined;
			if (viewerForTimer) {
				viewerForTimer._currentExamId = examId;
			}
			globalWindow.examViewer?.loadExamData(examData);
			// B2：并行拉取该试卷的句级译文（失败不阻塞主流程）
			const translationMgr = (globalWindow as unknown as { TranslationManager?: { loadForExam: (id: string) => Promise<void>; installDelegation: () => void } }).TranslationManager;
			if (translationMgr) {
				translationMgr.installDelegation();
				void translationMgr.loadForExam(examId);
			}
		} catch (error) {
			console.error('[viewerBootstrap] Failed to load exam:', error);
			const container = document.getElementById('current-question-container');
			if (container) {
				const message = error instanceof Error ? error.message : String(error);
				container.innerHTML = `<div style="padding: 40px; text-align: center; color: red;">加载失败：${message}</div>`;
			}
		}
	});

	levelSelect.addEventListener('change', () => {
		void syncPaperSelect(levelSelect, paperSelect, { dispatchChange: true });
	});

	const repairPaperSelect = (): void => {
		if (paperSelect.options.length > 1) {
			return;
		}
		void syncPaperSelect(levelSelect, paperSelect, {
			dispatchChange: true,
			preserveCurrentValue: true
		});
	};

	window.addEventListener('pageshow', repairPaperSelect);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			repairPaperSelect();
		}
	});

	await syncPaperSelect(levelSelect, paperSelect, {
		dispatchChange: true,
		preserveCurrentValue: true
	});

	userProgressCache = await fetchUserProgress();
	if (Object.keys(userProgressCache).length > 0) {
		await refreshPaperSelectIcons();
	}

	repairPaperSelect();
}

function createExamViewer(): void {
	const globalWindow = getGlobalWindow();
	const missingGlobals = REQUIRED_GLOBALS.filter((name) => typeof globalWindow[name] === 'undefined');
	if (missingGlobals.length > 0) {
		throw new Error(`Missing required classes: ${missingGlobals.join(', ')}`);
	}

	const examViewerCtor = globalWindow.ExamViewer as ViewerExamViewerCtor | undefined;
	if (!examViewerCtor) {
		throw new Error('ExamViewer constructor not found');
	}

	globalWindow.examViewer = new examViewerCtor();
	window.dispatchEvent(
		new CustomEvent('examViewerReady', {
			detail: { examViewer: globalWindow.examViewer }
		})
	);
}

export async function bootViewerApp(): Promise<void> {
	const globalWindow = getGlobalWindow();
	if (globalWindow.__VIEWER_BOOTED__) {
		return;
	}

	globalWindow.__VIEWER_BOOTED__ = true;

	try {
		await loadViewerModules();
		createExamViewer();
		window.refreshPaperSelectIcons = refreshPaperSelectIcons;
		await initExamSelectors();
	} catch (error) {
		globalWindow.__VIEWER_BOOTED__ = false;
		console.error('[viewerBootstrap] boot failed:', error);
		showBootError(error);
		throw error;
	}
}
