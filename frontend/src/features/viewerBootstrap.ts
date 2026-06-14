interface ViewerModule {
	name: string;
	path: string;
}

interface ViewerExamMeta {
	id: string;
	display: string;
	family?: string;
	level?: string;
	subject?: string;
	paper_type?: string;
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
	getExams: (options?: { family?: string; level?: string; year?: string; sort?: string }) => Promise<unknown[]>;
};

type ViewerExamGroups = Record<string, Record<string, ViewerExamMeta[]>>;

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
	{ name: 'ExamTimerManager', path: '../viewer/managers/ExamTimerManager.js' },
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
	'ExamTimerManager',
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

const DEFAULT_ENABLED_EXAM_FAMILIES = ['jlpt', 'eju'];
const LEVELED_EXAM_FAMILIES = new Set(['jlpt']);

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
	const family = typeof data.family === 'string' && data.family.trim() ? data.family.trim().toLowerCase() : 'jlpt';

	const year = typeof data.year === 'string' ? data.year : '';
	const session = typeof data.session === 'string' ? data.session : '';
	const subject = typeof data.subject === 'string' ? data.subject : '';
	const paperType = typeof data.paper_type === 'string' ? data.paper_type : '';
	const display =
		typeof data.display === 'string' && data.display.trim()
			? data.display
			: year && session
				? `${year}_${session}`
				: id;

	return {
		id,
		family,
		level,
		subject,
		paper_type: paperType,
		year,
		session,
		display,
		checked: Boolean(data.checked)
	};
}

function getEnabledExamFamilies(): string[] {
	const raw = (window as Window & { __ENABLED_EXAM_FAMILIES__?: unknown }).__ENABLED_EXAM_FAMILIES__;
	const values = Array.isArray(raw)
		? raw
		: typeof raw === 'string'
			? raw.split(',')
			: DEFAULT_ENABLED_EXAM_FAMILIES;
	const normalized = values
		.map((value) => String(value).trim().toLowerCase())
		.filter((value) => value.length > 0);
	return normalized.length > 0 ? [...new Set(normalized)] : DEFAULT_ENABLED_EXAM_FAMILIES;
}

function isEnabledExamFamily(family: string): boolean {
	return getEnabledExamFamilies().includes(family.toLowerCase());
}

function isLeveledExamFamily(family: string): boolean {
	return LEVELED_EXAM_FAMILIES.has(family.toLowerCase());
}

function filterEnabledExamGroups(examsByFamily: ViewerExamGroups): ViewerExamGroups {
	const enabledFamilies = getEnabledExamFamilies();
	const filtered: ViewerExamGroups = {};
	enabledFamilies.forEach((family) => {
		if (examsByFamily[family]) {
			filtered[family] = examsByFamily[family];
		}
	});
	return filtered;
}

function getDefaultFamily(examsByFamily: ViewerExamGroups): string {
	const enabledFamilies = getEnabledExamFamilies();
	const preferred = enabledFamilies.find((family) => examsByFamily[family]);
	if (preferred) {
		return preferred;
	}
	if (examsByFamily.jlpt && isEnabledExamFamily('jlpt')) {
		return 'jlpt';
	}
	return Object.keys(examsByFamily)[0] ?? 'jlpt';
}

function hasGroupedExams(examsByFamily: ViewerExamGroups): boolean {
	return Object.values(examsByFamily).some((levels) =>
		Object.values(levels).some((items) => Array.isArray(items) && items.length > 0)
	);
}

function hasExamsForFamilyLevel(examsByFamily: ViewerExamGroups, family?: string, level?: string): boolean {
	if (!family) {
		return hasGroupedExams(examsByFamily);
	}
	const levels = examsByFamily[family];
	if (!levels) {
		return false;
	}
	if (!level) {
		return Object.values(levels).some((items) => Array.isArray(items) && items.length > 0);
	}
	const exams = levels[level];
	return Array.isArray(exams) && exams.length > 0;
}

function getExamsByFamily(): ViewerExamGroups {
	return filterEnabledExamGroups(window.__EXAMS_BY_FAMILY__ ?? {});
}

function syncLegacyLevelCache(family: string): void {
	const examsByFamily = getExamsByFamily();
	window.__EXAMS_BY_LEVEL__ = examsByFamily[family] ?? {};
}

async function fetchExamsForFallback(): Promise<ViewerExamMeta[]> {
	try {
		const apiClient = window.APIClient as ViewerExamListApi | undefined;
		if (apiClient?.getExams) {
			const list = await apiClient.getExams({ sort: 'date_desc' });
			return (list as unknown[])
				.map(normalizeExamMeta)
				.filter((item): item is ViewerExamMeta => item !== null && isEnabledExamFamily(item.family || 'jlpt'));
		}
	} catch (error) {
		console.warn('[viewerBootstrap] APIClient.getExams fallback failed:', error);
	}

	try {
		const apiBase = window.__API_BASE__ || '/api/v1';
		const response = await fetch(`${apiBase}/exams?sort=date_desc`);
		if (!response.ok) {
			return [];
		}

		const payload = (await response.json()) as Partial<ApiEnvelope<unknown[]>> | unknown[];
		const rawList = Array.isArray(payload) ? payload : ((payload as Partial<ApiEnvelope<unknown[]>>).data ?? []);
		return (rawList as unknown[])
			.map(normalizeExamMeta)
			.filter((item): item is ViewerExamMeta => item !== null && isEnabledExamFamily(item.family || 'jlpt'));
	} catch (error) {
		console.warn('[viewerBootstrap] fetch /exams fallback failed:', error);
		return [];
	}
}

async function ensureExamsByLevelLoaded(requiredLevel?: string): Promise<void> {
	const current = getExamsByFamily();
	const currentFamily = getDefaultFamily(current);
	if (requiredLevel ? hasExamsForFamilyLevel(current, currentFamily, requiredLevel) : hasGroupedExams(current)) {
		return;
	}

	const exams = await fetchExamsForFallback();
	if (exams.length === 0) {
		return;
	}

	const grouped: ViewerExamGroups = {};
	exams.forEach((exam) => {
		const family = exam.family || 'jlpt';
		if (!isEnabledExamFamily(family)) {
			return;
		}
		const level = exam.level || 'DEFAULT';
		if (!grouped[family]) {
			grouped[family] = {};
		}
		if (!grouped[family][level]) {
			grouped[family][level] = [];
		}
		grouped[family][level].push(exam);
	});
	const defaultFamily = getDefaultFamily(grouped);
	window.__EXAMS_BY_FAMILY__ = grouped;
	syncLegacyLevelCache(defaultFamily);
}

function toFamilyLabel(family: string): string {
	const labels: Record<string, string> = {
		jlpt: 'JLPT',
		eju: 'EJU',
		cet: 'CET'
	};
	return labels[family] || family.toUpperCase();
}

function buildFamilyOptions(examsByFamily: ViewerExamGroups): string {
	const families = getEnabledExamFamilies().filter((family) => examsByFamily[family]);
	if (families.length === 0) {
		const fallback = getEnabledExamFamilies()[0] || 'jlpt';
		return `<option value="${fallback}">${toFamilyLabel(fallback)}</option>`;
	}
	return families
		.map((family) => `<option value="${family}">${toFamilyLabel(family)}</option>`)
		.join('');
}

function buildLevelOptions(levelMap: Record<string, ViewerExamMeta[]>): string {
	const levels = Object.keys(levelMap);
	if (levels.length === 0) {
		return '<option value="">-</option>';
	}
	return levels
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.map((level) => `<option value="${level}">${level}</option>`)
		.join('');
}

function setLevelSelectMode(levelSelect: HTMLSelectElement, family: string): void {
	const isLeveled = isLeveledExamFamily(family);
	levelSelect.disabled = !isLeveled;
	levelSelect.style.display = isLeveled ? '' : 'none';
}

function collectFamilyExams(levelMap: Record<string, ViewerExamMeta[]>): ViewerExamMeta[] {
	return Object.values(levelMap).flatMap((items) => items);
}

async function syncFamilyAndLevelSelects(
	familySelect: HTMLSelectElement,
	levelSelect: HTMLSelectElement,
	paperSelect: HTMLSelectElement,
	options: { dispatchChange?: boolean; preserveCurrentValue?: boolean } = {}
): Promise<void> {
	const { dispatchChange = false, preserveCurrentValue = false } = options;
	await ensureExamsByLevelLoaded();
	const examsByFamily = getExamsByFamily();
	const currentFamily = preserveCurrentValue ? familySelect.value : '';
	familySelect.innerHTML = buildFamilyOptions(examsByFamily);
	familySelect.value = currentFamily && examsByFamily[currentFamily] ? currentFamily : getDefaultFamily(examsByFamily);

	syncLegacyLevelCache(familySelect.value);
	setLevelSelectMode(levelSelect, familySelect.value);
	const levelMap = window.__EXAMS_BY_LEVEL__ ?? {};
	const currentLevel = preserveCurrentValue ? levelSelect.value : '';
	levelSelect.innerHTML = buildLevelOptions(levelMap);
	if (!isLeveledExamFamily(familySelect.value)) {
		levelSelect.value = '';
	} else if (currentLevel && levelMap[currentLevel]) {
		levelSelect.value = currentLevel;
	} else {
		levelSelect.value = Object.keys(levelMap)[0] ?? '';
	}

	await syncPaperSelect(levelSelect, paperSelect, {
		dispatchChange,
		preserveCurrentValue,
		family: familySelect.value
	});
}

async function syncPaperSelect(
	levelSelect: HTMLSelectElement,
	paperSelect: HTMLSelectElement,
	options: { dispatchChange?: boolean; preserveCurrentValue?: boolean; family?: string } = {}
): Promise<void> {
	const { dispatchChange = false, preserveCurrentValue = false, family = 'jlpt' } = options;
	const level = levelSelect.value;
	await ensureExamsByLevelLoaded(isLeveledExamFamily(family) ? level : undefined);
	const levelMap = window.__EXAMS_BY_LEVEL__ ?? {};
	const exams = isLeveledExamFamily(family) ? (level ? (levelMap[level] ?? []) : []) : collectFamilyExams(levelMap);
	if (exams.length === 0) {
		paperSelect.innerHTML = buildPaperOptions([], userProgressCache);
		return;
	}

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

		const apiBase = window.__API_BASE__ || '/api/v1';
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
	const text = exam.display;
	return icon ? `${text} ${icon}` : text;
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
	const familySelect = document.getElementById('exam-family-select') as HTMLSelectElement | null;
	const levelSelect = document.getElementById('exam-level-select') as HTMLSelectElement | null;
	if (!paperSelect || !levelSelect || !familySelect) {
		return;
	}

	const level = levelSelect.value;
	syncLegacyLevelCache(familySelect.value || getDefaultFamily(getExamsByFamily()));
	const examsByLevel = window.__EXAMS_BY_LEVEL__ ?? {};
	const exams = isLeveledExamFamily(familySelect.value) ? (examsByLevel[level] ?? []) : collectFamilyExams(examsByLevel);

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
	const familySelect = document.getElementById('exam-family-select') as HTMLSelectElement | null;
	const levelSelect = document.getElementById('exam-level-select') as HTMLSelectElement | null;
	const paperSelect = document.getElementById('exam-paper-select') as HTMLSelectElement | null;

	if (!familySelect || !levelSelect || !paperSelect) {
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
				void translationMgr.loadForExam(examId).then(() => {
					const viewer = globalWindow.examViewer as
						| { showReadingZh?: boolean; questionRenderer?: { renderCurrentQuestion?: () => void } }
						| undefined;
					if (viewer?.showReadingZh) {
						viewer.questionRenderer?.renderCurrentQuestion?.();
					}
				});
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

	familySelect.addEventListener('change', () => {
		void syncFamilyAndLevelSelects(familySelect, levelSelect, paperSelect, {
			dispatchChange: true,
			preserveCurrentValue: true
		});
	});

	levelSelect.addEventListener('change', () => {
		void syncPaperSelect(levelSelect, paperSelect, { dispatchChange: true, family: familySelect.value });
	});

	const repairPaperSelect = (): void => {
		if (paperSelect.options.length > 1) {
			return;
		}
		void syncPaperSelect(levelSelect, paperSelect, {
			dispatchChange: true,
			preserveCurrentValue: true,
			family: familySelect.value
		});
	};

	window.addEventListener('pageshow', repairPaperSelect);
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			repairPaperSelect();
		}
	});

	await syncFamilyAndLevelSelects(familySelect, levelSelect, paperSelect, {
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
