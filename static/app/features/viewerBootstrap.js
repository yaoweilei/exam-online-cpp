const VIEWER_MODULES = [
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
    'CategoryNavigationManager',
    'QuestionRenderer',
    'ExamViewer'
];
const PROGRESS_ICONS = {
    none: '',
    ready: '⭘',
    quarter: '◔',
    half: '◑',
    three_quarter: '◕',
    full: '●'
};
let userProgressCache = {};
function getGlobalWindow() {
    return window;
}
async function loadViewerModules() {
    for (const moduleDef of VIEWER_MODULES) {
        // Keep evaluation ordered because these modules communicate through window globals.
        // eslint-disable-next-line no-await-in-loop
        await import(moduleDef.path);
    }
}
function normalizeExamMeta(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const data = raw;
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
    const display = typeof data.display === 'string' && data.display.trim()
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
function hasGroupedExams(examsByLevel) {
    return Object.values(examsByLevel).some((items) => Array.isArray(items) && items.length > 0);
}
async function fetchExamsForFallback() {
    try {
        const apiClient = window.APIClient;
        if (apiClient?.getExams) {
            const list = await apiClient.getExams({ sort: 'date_desc' });
            return list.map(normalizeExamMeta).filter((item) => item !== null);
        }
    }
    catch (error) {
        console.warn('[viewerBootstrap] APIClient.getExams fallback failed:', error);
    }
    try {
        const apiBase = window.__API_BASE__ || '/api/v2';
        const response = await fetch(`${apiBase}/exams?sort=date_desc`);
        if (!response.ok) {
            return [];
        }
        const payload = (await response.json());
        const rawList = Array.isArray(payload) ? payload : (payload.data ?? []);
        return rawList.map(normalizeExamMeta).filter((item) => item !== null);
    }
    catch (error) {
        console.warn('[viewerBootstrap] fetch /exams fallback failed:', error);
        return [];
    }
}
async function ensureExamsByLevelLoaded() {
    const current = window.__EXAMS_BY_LEVEL__ ?? {};
    if (hasGroupedExams(current)) {
        return;
    }
    const exams = await fetchExamsForFallback();
    if (exams.length === 0) {
        return;
    }
    const grouped = {};
    exams.forEach((exam) => {
        const level = exam.level || 'N1';
        if (!grouped[level]) {
            grouped[level] = [];
        }
        grouped[level].push(exam);
    });
    window.__EXAMS_BY_LEVEL__ = grouped;
}
async function fetchUserProgress() {
    try {
        const userContextManager = getGlobalWindow().UserContextManager;
        const userId = userContextManager?.currentUser?.user_id ?? userContextManager?.currentUser?.username ?? null;
        if (!userId || userId === 'guest') {
            return {};
        }
        const apiBase = window.__API_BASE__ || '/api/v2';
        const resp = await fetch(`${apiBase}/progress/${userId}/exams`);
        if (!resp.ok) {
            return {};
        }
        const payload = (await resp.json());
        const progress = payload.data ?? payload;
        if (typeof progress !== 'object' || progress === null || Array.isArray(progress)) {
            return {};
        }
        const normalized = {};
        Object.entries(progress).forEach(([examId, value]) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                normalized[examId] = value;
            }
        });
        return normalized;
    }
    catch (error) {
        console.warn('[viewerBootstrap] Failed to fetch user progress:', error);
        return {};
    }
}
function getProgressIcon(checked, completion) {
    if (!checked)
        return PROGRESS_ICONS.none;
    if (completion <= 0)
        return PROGRESS_ICONS.ready;
    if (completion <= 0.25)
        return PROGRESS_ICONS.quarter;
    if (completion <= 0.5)
        return PROGRESS_ICONS.half;
    if (completion <= 0.75)
        return PROGRESS_ICONS.three_quarter;
    return PROGRESS_ICONS.full;
}
function buildOptionText(exam, userProgress) {
    const completion = userProgress[exam.id] !== undefined ? userProgress[exam.id] : -1;
    const icon = getProgressIcon(Boolean(exam.checked), completion);
    return icon ? `${exam.display} ${icon}` : exam.display;
}
function buildPaperOptions(exams, userProgress) {
    return ('<option value="">-</option>' +
        exams
            .map((exam) => {
            const text = buildOptionText(exam, userProgress);
            return `<option value="${exam.id}" data-checked="${Boolean(exam.checked)}">${text}</option>`;
        })
            .join(''));
}
async function refreshPaperSelectIcons() {
    userProgressCache = await fetchUserProgress();
    const paperSelect = document.getElementById('exam-paper-select');
    const levelSelect = document.getElementById('exam-level-select');
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
function showBootError(error) {
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
async function initExamSelectors() {
    const globalWindow = getGlobalWindow();
    const levelSelect = document.getElementById('exam-level-select');
    const paperSelect = document.getElementById('exam-paper-select');
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
            const examLoader = globalWindow.ExamLoader;
            const examData = examLoader ? await examLoader.getExam(examId) : null;
            if (!examData) {
                throw new Error('试卷数据为空');
            }
            globalWindow.examViewer?.loadExamData(examData);
        }
        catch (error) {
            console.error('[viewerBootstrap] Failed to load exam:', error);
            const container = document.getElementById('current-question-container');
            if (container) {
                const message = error instanceof Error ? error.message : String(error);
                container.innerHTML = `<div style="padding: 40px; text-align: center; color: red;">加载失败：${message}</div>`;
            }
        }
    });
    levelSelect.addEventListener('change', () => {
        const level = levelSelect.value;
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
            paperSelect.value = exams[0].id;
            paperSelect.dispatchEvent(new Event('change'));
        }
    });
    const initialLevel = levelSelect.value;
    if (initialLevel) {
        const examsByLevel = window.__EXAMS_BY_LEVEL__ ?? {};
        const exams = examsByLevel[initialLevel] ?? [];
        if (paperSelect.options.length <= 1) {
            paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);
        }
        if (paperSelect.value) {
            paperSelect.dispatchEvent(new Event('change'));
        }
        else if (exams.length > 0) {
            paperSelect.value = exams[0].id;
            paperSelect.dispatchEvent(new Event('change'));
        }
    }
    userProgressCache = await fetchUserProgress();
    if (Object.keys(userProgressCache).length > 0) {
        await refreshPaperSelectIcons();
    }
    await ensureExamsByLevelLoaded();
    const exams = window.__EXAMS_BY_LEVEL__?.[levelSelect.value] ?? [];
    if (paperSelect.options.length <= 1 && exams.length > 0) {
        paperSelect.innerHTML = buildPaperOptions(exams, userProgressCache);
        if (!paperSelect.value) {
            paperSelect.value = exams[0].id;
            paperSelect.dispatchEvent(new Event('change'));
        }
    }
}
function createExamViewer() {
    const globalWindow = getGlobalWindow();
    const missingGlobals = REQUIRED_GLOBALS.filter((name) => typeof globalWindow[name] === 'undefined');
    if (missingGlobals.length > 0) {
        throw new Error(`Missing required classes: ${missingGlobals.join(', ')}`);
    }
    const examViewerCtor = globalWindow.ExamViewer;
    if (!examViewerCtor) {
        throw new Error('ExamViewer constructor not found');
    }
    globalWindow.examViewer = new examViewerCtor();
    window.dispatchEvent(new CustomEvent('examViewerReady', {
        detail: { examViewer: globalWindow.examViewer }
    }));
}
export async function bootViewerApp() {
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
    }
    catch (error) {
        globalWindow.__VIEWER_BOOTED__ = false;
        console.error('[viewerBootstrap] boot failed:', error);
        showBootError(error);
        throw error;
    }
}
//# sourceMappingURL=viewerBootstrap.js.map