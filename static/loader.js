/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

/**
 * ================================================================================================
 * 模块加载器 (重构版)
 * ================================================================================================
 *
 * 负责按正确顺序加载所有模块
 * 确保依赖关系正确处理
 */

(function () {
	'use strict';

	// 注意：项目原本是 VSCode 扩展，现已改为独立 Web 应用
	// VSCode API 的模拟由 web-app-adapter.js 提供
	console.log('[Loader] Starting module loading...');

	// 获取当前脚本的基础路径
	const currentScript = document.currentScript || document.querySelector('script[src*="loader"]');
	const scriptSrc = currentScript ? currentScript.src : '';
	const basePath = scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
	console.log('[Loader] Base path:', basePath);

	// 定义模块加载顺序
	// 注意：顺序很重要！被依赖的模块必须先加载
	const modules = [
		// ==================== 第1层：工具类（无依赖） ====================
		{ name: 'Logger', path: 'utils/Logger.js' },
		{ name: 'ErrorHandler', path: 'utils/ErrorHandler.js' },
		{ name: 'DOMUtils', path: 'utils/DOMUtils.js' },
		{ name: 'DOMHelpers', path: 'utils/DOMHelpers.js' },  // 合并的事件和渲染工具

		// ==================== 第2层：核心类（依赖工具类） ====================
		{ name: 'APIClient', path: 'core/APIClient.js' },
		{ name: 'ExamLoader', path: 'core/ExamLoader.js' },  // 合并的数据加载器
		{ name: 'UserContextManager', path: 'core/UserContextManager.js' },

		// ==================== 第3层：管理器类（依赖核心类） ====================
		{ name: 'StateManager', path: 'managers/StateManager.js' },
		{ name: 'NavigationManager', path: 'managers/NavigationManager.js' },

		// ==================== 第4层：功能管理器（依赖管理器类） ====================
		{ name: 'AudioManager', path: 'managers/AudioManager.js' },
		{ name: 'FuriganaManager', path: 'managers/FuriganaManager.js' },
		{ name: 'AnswerManager', path: 'managers/AnswerManager.js' },
		{ name: 'QuestionMapManager', path: 'managers/QuestionMapManager.js' },
		{ name: 'CategoryNavigationManager', path: 'managers/CategoryNavigationManager.js' },
		{ name: 'QuestionRenderer', path: 'renderers/QuestionRenderer.js' },

		// ==================== 第5层：主控制器（依赖所有模块） ====================
		{ name: 'ExamViewer', path: 'core/ExamViewer.js' }
	];

	// 跟踪加载状态
	let loadedCount = 0;
	const totalCount = modules.length;
	const loadedModules = new Set();
	const failedModules = new Set();

	/**
	 * 加载单个模块
	 */
	function loadModule(module) {
		return new Promise((resolve, reject) => {
			const script = document.createElement('script');
			// 使用绝对路径（基于 loader 的路径）
			script.src = basePath + module.path;
			script.async = false; // 保持顺序加载

			console.log(`[Loader] Loading ${module.name} from:`, script.src);

			script.onload = () => {
				loadedCount++;
				loadedModules.add(module.name);
				console.log(`[Loader] ✓ Loaded ${module.name} (${loadedCount}/${totalCount})`);

				// 验证模块是否正确加载
				if (module.name === 'ExamViewer') {
					// ExamViewer是类，不是全局对象
					if (typeof ExamViewer !== 'undefined') {
						console.log('[Loader] ✓ ExamViewer class is available');
					} else {
						console.warn('[Loader] ⚠ ExamViewer class not found in global scope');
					}
				} else if (window[module.name]) {
					console.log(`[Loader] ✓ ${module.name} is available in global scope`);
				} else {
					console.warn(`[Loader] ⚠ ${module.name} not found in global scope`);
				}

				resolve();
			};

			script.onerror = (error) => {
				failedModules.add(module.name);
				console.error(`[Loader] ✗ Failed to load ${module.name}:`, error);
				reject(new Error(`Failed to load ${module.name}`));
			};

			document.head.appendChild(script);
		});
	}

	/**
	 * 按顺序加载所有模块
	 */
	async function loadAllModules() {
		console.log(`[Loader] Loading ${totalCount} modules...`);

		try {
			// 按顺序加载每个模块
			for (const module of modules) {
				await loadModule(module);
			}

			console.log('[Loader] ✓ All modules loaded successfully');
			console.log('[Loader] Loaded modules:', Array.from(loadedModules));

			// 初始化应用
			initializeApp();

		} catch (error) {
			console.error('[Loader] ✗ Module loading failed:', error);
			console.error('[Loader] Failed modules:', Array.from(failedModules));

			// 显示错误信息给用户
			showLoadingError(error);
		}
	}

	/**
	 * 初始化应用
	 */
	function initializeApp() {
		console.log('[Loader] Initializing application...');

		// 等待DOM加载完成
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', createExamViewer);
		} else {
			createExamViewer();
		}
	}

	/**
	 * 创建ExamViewer实例
	 */
	function createExamViewer() {
		try {
			console.log('[Loader] Creating ExamViewer instance...');

			// 验证所有必需的类都已加载
			const requiredClasses = [
				'DOMUtils', 'DOMHelpers', 'ErrorHandler', 'ExamLoader',
				'UserContextManager', 'StateManager', 'NavigationManager',
				'AudioManager', 'AnswerManager', 'QuestionMapManager',
				'FuriganaManager', 'CategoryNavigationManager', 'QuestionRenderer'
			];

			const missingClasses = requiredClasses.filter(name => typeof window[name] === 'undefined');
			if (missingClasses.length > 0) {
				throw new Error(`Missing required classes: ${missingClasses.join(', ')}`);
			}

			// 创建ExamViewer实例
			window.examViewer = new ExamViewer();
			console.log('[Loader] ✓ ExamViewer instance created successfully');

			// 初始化试卷选择器
			initExamSelectors();

			// 触发自定义事件，通知应用已就绪
			window.dispatchEvent(new CustomEvent('examViewerReady', {
				detail: { examViewer: window.examViewer }
			}));

		} catch (error) {
			console.error('[Loader] ✗ Failed to create ExamViewer instance:', error);
			showLoadingError(error);
		}
	}

	/**
	 * 进度饼图图标映射
	 * 根据完成百分比返回对应的 Unicode 饼图字符
	 */
	const PROGRESS_ICONS = {
		none: '',        // 未check / 无数据
		ready: '⭘',     // 已check，未开始学习 (0%)
		quarter: '◔',   // 学习了 1~25%
		half: '◑',      // 学习了 26~50%
		three_quarter: '◕', // 学习了 51~75%
		full: '●',      // 学习了 76~100%
	};

	/**
	 * 根据完成度和check状态返回进度图标
	 * @param {boolean} checked - 试卷是否已check
	 * @param {number} completion - 完成度 0.0~1.0, -1 表示无数据
	 */
	function getProgressIcon(checked, completion) {
		if (!checked) return PROGRESS_ICONS.none;
		if (completion <= 0) return PROGRESS_ICONS.ready;
		if (completion <= 0.25) return PROGRESS_ICONS.quarter;
		if (completion <= 0.50) return PROGRESS_ICONS.half;
		if (completion <= 0.75) return PROGRESS_ICONS.three_quarter;
		return PROGRESS_ICONS.full;
	}

	/**
	 * 构建单个 option 的显示文本
	 */
	function buildOptionText(exam, userProgress) {
		const completion = userProgress[exam.id] !== undefined ? userProgress[exam.id] : -1;
		const icon = getProgressIcon(exam.checked || false, completion);
		return icon ? `${exam.display} ${icon}` : exam.display;
	}

	/**
	 * 构建试卷下拉列表 HTML
	 */
	function buildPaperOptions(exams, userProgress) {
		return '<option value="">-</option>' +
			exams.map(exam => {
				const text = buildOptionText(exam, userProgress);
				return `<option value="${exam.id}" data-checked="${exam.checked || false}">${text}</option>`;
			}).join('');
	}

	// 当前用户的学习进度缓存
	let _userProgress = {};

	/**
	 * 获取当前用户的学习进度
	 */
	async function fetchUserProgress() {
		try {
			// 获取当前用户ID
			const userId = (window.UserContextManager && UserContextManager.currentUser)
				? UserContextManager.currentUser.user_id || UserContextManager.currentUser.username
				: null;
			if (!userId || userId === 'guest') return {};

			const apiBase = window.__API_BASE__ || '/api/v2';
			const resp = await fetch(`${apiBase}/progress/${userId}/exams`);
			if (!resp.ok) return {};
			const payload = await resp.json();
			return payload && payload.data !== undefined ? payload.data : payload;
		} catch (e) {
			console.warn('[Loader] Failed to fetch user progress:', e);
			return {};
		}
	}

	/**
	 * 更新试卷下拉列表的进度图标（登录后调用）
	 */
	async function refreshPaperSelectIcons() {
		_userProgress = await fetchUserProgress();
		const paperSelect = document.getElementById('exam-paper-select');
		const levelSelect = document.getElementById('exam-level-select');
		if (!paperSelect || !levelSelect) return;

		const level = levelSelect.value;
		const examsByLevel = window.__EXAMS_BY_LEVEL__ || {};
		const exams = examsByLevel[level] || [];

		const currentValue = paperSelect.value;
		paperSelect.innerHTML = buildPaperOptions(exams, _userProgress);
		if (currentValue) paperSelect.value = currentValue;
	}

	// 暴露给外部（登录成功后可调用刷新图标）
	window.refreshPaperSelectIcons = refreshPaperSelectIcons;

	/**
	 * 初始化试卷选择器（处理下拉框事件）
	 */
	function initExamSelectors() {
		const levelSelect = document.getElementById('exam-level-select');
		const paperSelect = document.getElementById('exam-paper-select');

		if (!levelSelect || !paperSelect) {
			console.warn('[Loader] Exam selectors not found');
			return;
		}

		console.log('[Loader] Setting up exam selectors...');

		// 试卷选择变化时，加载试卷
		paperSelect.addEventListener('change', async function () {
			const examId = this.value;
			if (!examId) return;

			console.log('[Loader] Loading exam:', examId);

			try {
				const container = document.getElementById('current-question-container');
				if (container) {
					container.innerHTML = '<div style="padding: 40px; text-align: center; color: #666;">加载中...</div>';
				}

				const examData = await ExamLoader.getExam(examId);
				if (!examData) {
					throw new Error('试卷数据为空');
				}

				console.log('[Loader] Exam data loaded, calling loadExamData');
				window.examViewer.loadExamData(examData);

			} catch (error) {
				console.error('[Loader] Failed to load exam:', error);
				const container = document.getElementById('current-question-container');
				if (container) {
					container.innerHTML = `<div style="padding: 40px; text-align: center; color: red;">加载失败：${error.message}</div>`;
				}
			}
		});

		// 级别选择变化时，更新试卷列表
		levelSelect.addEventListener('change', function () {
			const level = this.value;
			console.log('[Loader] Level changed to:', level);

			const examsByLevel = window.__EXAMS_BY_LEVEL__ || {};
			const exams = examsByLevel[level] || [];

			paperSelect.innerHTML = buildPaperOptions(exams, _userProgress);
			
			// 自动选择并加载最新一期试卷
			if (exams.length > 0) {
				const latestExam = exams[0];
				paperSelect.value = latestExam.id;
				paperSelect.dispatchEvent(new Event('change'));
			}
		});

		// 初始化：加载当前选中级别的试卷列表
		const initialLevel = levelSelect.value;
		if (initialLevel) {
			console.log('[Loader] Initializing with level:', initialLevel);
			const examsByLevel = window.__EXAMS_BY_LEVEL__ || {};
			const exams = examsByLevel[initialLevel] || [];
			
			// 如果模板已经渲染了试卷列表，就不需要再次设置
			if (paperSelect.options.length <= 1) {
				paperSelect.innerHTML = buildPaperOptions(exams, _userProgress);
			}
			
			// 如果浏览器刷新后恢复了选中的试卷，直接加载该试卷
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

		// 异步获取用户进度并刷新图标
		fetchUserProgress().then(progress => {
			_userProgress = progress;
			if (Object.keys(progress).length > 0) {
				refreshPaperSelectIcons();
			}
		});

		console.log('[Loader] ✓ Exam selectors initialized');
	}

	/**
	 * 显示加载错误
	 */
	function showLoadingError(error) {
		const container = document.getElementById('exam-content') || document.body;
		const errorDiv = document.createElement('div');
		errorDiv.style.cssText = 'padding: 20px; text-align: center; color: red;';
		errorDiv.innerHTML = `
			<h2>加载失败</h2>
			<p>无法加载试卷查看器模块</p>
			<p style="font-size: 12px; color: #666;">${error.message}</p>
			<p style="font-size: 12px; color: #666;">请刷新页面重试</p>
		`;
		container.appendChild(errorDiv);
	}

	// 开始加载模块
	loadAllModules();

})();
