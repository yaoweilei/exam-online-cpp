import { ApiClient } from '../api/client.js';
import { AppStore } from '../state/store.js';
import { renderOutlineIcon } from '../viewer/personalCenter/icons.js';
import { consumeGuestTrial, guestPracticeRecords, guestTrialStatus, practiceTrialKind, type GuestPracticeRecord, type GuestTrialKind } from './guestTrialRecords.js';

type Sample = { examId: string; sectionIndex: number; passage: string; question: { id: number; question: string; options: string[]; correct_answer: number; explanation: string; explanation_expand?: string } };
type Attempt = { sample: number; answer: number; checked: boolean; savedAt: number; id: string };
type Paper = { id?: string; exam_id?: string; title?: string };
const key = 'japanese.guest-experience.v1';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function initGuestWelcome(api: ApiClient, store: AppStore, login: () => void): void {
	const root = document.createElement('main');
	root.id = 'guest-welcome';
	document.body.append(root);
	let samples: Sample[] = [];
	let attempt: Attempt | null = null;
	let completed: Attempt[] = [];
	let storageAvailable = true;
	let importing = false;
	let active = false;
	try {
		const saved = JSON.parse(localStorage.getItem(key) || 'null');
		if (saved && Date.now() - saved.savedAt < 7 * 86400000 && [0, 1].includes(saved.sample) && Number.isInteger(saved.answer) && saved.answer >= 0 && saved.answer <= 4 && typeof saved.id === 'string') {
			attempt = { sample: saved.sample, answer: saved.answer, checked: saved.checked === true, savedAt: saved.savedAt, id: saved.id };
			completed = (Array.isArray(saved.completed) ? saved.completed : []).filter((item: Attempt) => item.checked && [0, 1].includes(item.sample) && item.answer >= 1 && item.answer <= 4 && typeof item.id === 'string' && Date.now() - item.savedAt < 7 * 86400000).slice(-1);
			if (attempt.checked && attempt.answer > 0 && !completed.some((item) => item.id === attempt!.id)) completed = [...completed, { ...attempt }].sort((left, right) => left.savedAt - right.savedAt).slice(-1);
		}
		else localStorage.removeItem(key);
	} catch { storageAvailable = false; }
	function persist(): void {
		try { localStorage.setItem(key, JSON.stringify({ ...attempt, completed })); } catch { storageAvailable = false; }
	}
	function show(): void { active = true; document.body.classList.add('guest-welcome-open'); root.hidden = false; }
	function hide(): void { active = false; root.hidden = true; document.body.classList.remove('guest-welcome-open'); announce('paper'); }
	function announce(view: string): void {
		root.dataset.view = view;
		root.dataset.family = view === 'exams' || view === 'paper' ? expandedFamily : '';
		window.dispatchEvent(new CustomEvent('guestWelcomeChanged', { detail: { view } }));
	}
	function frame(content: string, back = false, view = 'home'): void {
		show();
		root.innerHTML = `<header class="gw-header${back ? ' gw-has-back' : ''}"><button data-gw="home" class="gw-text">${back ? '← 返回' : '日语学习'}</button><button data-gw="login" class="gw-account-trigger" aria-label="登录账号" title="登录账号">${renderOutlineIcon('profileMark', 'pc-trigger-icon')}</button></header><div class="gw-content">${view === 'experience' ? '<div class="gw-reading-sheet">' : ''}${content}${view === 'experience' ? '</div>' : ''}</div>`;
		root.scrollTop = 0;
		announce(view);
	}
	let expandedFamily = '';
	let selectedLevel = '';
	let selectionRequest = 0;
	function practiceChoices(value: string): string {
		return `<div class="gw-practice"><strong>选择练习内容</strong><p class="gw-description gw-next-step">接下来选择年份和试卷，再开始作答。</p><div class="gw-directions">${(value.startsWith('EJU') ? ['记述', '读解', '听解', '听读解'] : ['词汇 / 语法', '阅读', '听力']).map((name) => `<button data-gw="browse" data-target="${escape(value)}" data-domain="${name}">${name}</button>`).join('')}<button data-gw="browse" data-target="${escape(value)}">完整试卷</button></div><button data-gw="diagnosis" data-target="${escape(value)}" class="gw-text">登录后测一测，找到适合的学习起点 →</button></div>`;
	}
	function pendingPracticeRecords(): GuestPracticeRecord[] {
		try { return guestPracticeRecords().slice(-3).reverse(); } catch { return []; }
	}
	function practiceHistoryMarkup(): string {
		const records = pendingPracticeRecords();
		const rows = [
			...records.map((item) => ({
				createdAt: item.created_at,
				markup: `<div class="gw-history-row"><span><strong>${escape(item.label || '题组练习')}</strong><small>${escape(item.exam_id)} · ${escape(new Date(item.created_at).toLocaleString('zh-CN'))}</small></span><button type="button" data-gw="review-practice" data-id="${escape(item.submission_id)}">查看原题</button></div>`
			})),
			...completed.map((item) => ({
				createdAt: item.savedAt,
				markup: `<div class="gw-history-row"><span><strong>体验题 · ${item.sample === 0 ? 'N3 短篇阅读' : 'N3 阅读'}</strong><small>${escape(new Date(item.savedAt).toLocaleString('zh-CN'))}</small></span><button type="button" data-gw="review-experience" data-id="${escape(item.id)}">查看原题</button></div>`
			}))
		].sort((left, right) => right.createdAt - left.createdAt).slice(0, 3);
		if (!rows.length) return '';
		return `<section class="gw-history"><div><h2>临时练习记录</h2><p>当前临时记录中每类保留 1 次，7 天内可在此浏览器回看；登录转存或记录到期后，可再次体验。</p></div>${rows.map((row) => row.markup).join('')}<button type="button" data-gw="login" class="gw-text">登录并保存这些记录 →</button></section>`;
	}
	function home(): void {
		selectionRequest++;
		const quota = guestTrialStatus('experience');
		if (attempt?.checked && quota.remaining) { attempt = null; completed = []; }
		frame(`<section class="gw-intro"><h1>把日语一点点学会</h1><p class="gw-description">真题练习、详细解析，按自己的节奏学习。访客可体验 N3 单题、JLPT、EJU 各 1 次；登录后可继续练习。</p></section><section class="gw-experience"><div><h2>先试一道 N3 短篇阅读</h2><p>无需登录，体验作答和解析，约 2 分钟。</p></div><button data-gw="${quota.remaining || attempt?.checked ? 'experience' : 'login'}" class="gw-primary">${quota.remaining ? (attempt ? '继续体验' : '开始体验') : (attempt?.checked ? '查看最近体验' : '登录后继续')}</button></section><h2 class="gw-exams-heading">选择考试</h2><div class="gw-goals">${['jlpt', 'eju'].map(family => `<section class="gw-goal"><button class="gw-goal-trigger" data-gw="${family}" aria-expanded="${expandedFamily === family}" aria-controls="gw-${family}-content"><strong>${family.toUpperCase()}</strong><span>${family === 'jlpt' ? '日本语能力考试 · N3 / N2 / N1' : '日本留学考试 · 日本语'} · ${guestTrialStatus(family as GuestTrialKind).remaining ? '可体验 1 次' : '体验已用完'}</span><b aria-hidden="true"></b></button><div id="gw-${family}-content" class="gw-inline" ${expandedFamily !== family ? 'hidden' : ''}>${family === 'jlpt' ? `<span class="gw-eyebrow">选择备考等级</span><div class="gw-levels">${['N3', 'N2', 'N1'].map(level => `<button data-gw="target" data-target="JLPT ${level}" aria-pressed="${selectedLevel === level}">${level}</button>`).join('')}</div>${selectedLevel ? practiceChoices('JLPT ' + selectedLevel) : ''}` : practiceChoices('EJU 日本語')}</div></section>`).join('')}</div>${practiceHistoryMarkup()}`, false, expandedFamily ? 'exams' : 'home');
	}
	function showTrialLimit(kind: GuestTrialKind): void {
		const label = { experience: 'N3 单题', jlpt: 'JLPT', eju: 'EJU' }[kind];
		frame(`<h1>${label}体验已用完</h1><p class="gw-description">当前临时记录中已完成这类体验。登录转存后，或记录 7 天到期后，可再次以访客身份体验。</p><button data-gw="login" class="gw-primary">登录／注册后继续</button><button data-gw="home" class="gw-text">选择其他考试</button>`, true, 'exams');
	}
	async function reviewPractice(id: string): Promise<void> {
		const record = pendingPracticeRecords().find((item) => item.submission_id === id);
		if (!record) { home(); return; }
		try {
			const exam = await api.getExam(record.exam_id) as Record<string, unknown>;
			const sections = (exam.exam_info as { sections?: unknown[] } | undefined)?.sections;
			if (!Array.isArray(sections) || !record.section_indexes.length || record.section_indexes.some((section) => !Number.isInteger(section) || section < 0 || section >= sections.length)) throw new Error();
			const viewer = (window as unknown as { examViewer?: { openSavedPracticeAttempt?: (id: string, data: Record<string, unknown>, attempt: { label: string; sectionIndexes: number[]; answers: Record<string, unknown> }, mode: 'review') => void } }).examViewer;
			if (!viewer?.openSavedPracticeAttempt) throw new Error();
			viewer.openSavedPracticeAttempt(record.exam_id, exam, { label: record.label, sectionIndexes: record.section_indexes, answers: record.answers || {} }, 'review');
			hide();
		} catch { frame('<h1>暂时无法打开这次练习</h1><p>原试卷可能已更新，请稍后重试。</p><button data-gw="home">返回首页</button>', true); }
	}
	function goHome(): void { expandedFamily = ''; home(); }
	function levels(): void { expandedFamily = 'jlpt'; home(); }
	function target(value: string): void { expandedFamily = value.startsWith('EJU') ? 'eju' : 'jlpt'; selectedLevel = value.startsWith('JLPT') ? value.slice(-2) : selectedLevel; home(); }
	async function experience(next = false): Promise<void> {
		selectionRequest++;
		const previousScroll = !next && root.querySelector('.gw-options') ? root.scrollTop : 0;
		if (!samples.length) frame('<p role="status">正在准备体验题…</p>', true, 'experience');
		try {
			if (!samples.length) {
				const response = await fetch('/static/data/guest-experience.json');
				if (!response.ok) throw new Error();
				samples = await response.json() as Sample[];
			}
			if (!attempt || next) {
				const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
				if (guestTrialStatus('experience').remaining === 0) { showTrialLimit('experience'); return; }
				attempt = { sample: next ? (attempt!.sample + 1) % samples.length : 0, answer: 0, checked: false, savedAt: Date.now(), id };
				persist();
			}
			const item = samples[attempt.sample];
			const q = item.question;
			frame(`<span class="gw-eyebrow">体验题 · JLPT N3 · 2010年7月 · 题 ${q.id}</span><h1 class="gw-question-title">短篇阅读</h1><div class="gw-passage" lang="ja">${escape(item.passage)}</div><h2 lang="ja">${escape(q.question)}</h2><div class="gw-options">${q.options.map((option, index) => `<button data-gw="answer" data-answer="${index + 1}" ${attempt!.checked ? 'disabled' : ''} class="${attempt!.answer === index + 1 ? 'is-selected' : ''} ${attempt!.checked && q.correct_answer === index + 1 ? 'is-correct' : ''}" aria-pressed="${attempt!.answer === index + 1}" lang="ja">${escape(option)}</button>`).join('')}</div>${attempt.checked ? `<section class="gw-result"><strong>${attempt.answer === q.correct_answer ? '答对了' : `正确答案：${q.correct_answer}`}</strong><div class="gw-explanation">${escape(q.explanation)}</div>${q.explanation_expand ? `<details><summary>补充解析</summary><div class="gw-explanation">${escape(q.explanation_expand)}</div></details>` : ''}</section><section class="gw-save"><strong>保存这次练习，之后接着学</strong><button data-gw="login" class="gw-primary">登录 / 注册</button><button data-gw="home" class="gw-text">继续浏览</button></section><div class="gw-actions"><button data-gw="login">登录后再试</button><button data-gw="jlpt">选择等级</button></div>` : `<button data-gw="check" class="gw-primary" ${!attempt.answer ? 'disabled' : ''}>检查答案</button>`}<p class="gw-storage" role="status">${storageAvailable ? '本次练习暂存在当前浏览器，保留 7 天；登录后可保存到账号。' : '当前浏览器无法暂存，离开页面后可能丢失本次练习。'}</p>`, true, 'experience');
			root.scrollTop = previousScroll;
		} catch { frame('<h1>体验题暂时未能加载</h1><button data-gw="experience" class="gw-primary">重试</button>', true); }
	}
	let pendingTarget = '';
	function paperYears(items: Paper[], value: string, domain: string): string {
		const years = new Map<string, { item: Paper; session: number; label: string }[]>();
		const other: Paper[] = [];
		for (const item of items) {
			const id = String(item.id || item.exam_id || '');
			if (id.toUpperCase().includes('DIAGNOSTIC')) continue;
			const date = id.match(/(20\d{2})[_-](\d{2})(?:$|[_-])/);
			if (!date) { other.push(item); continue; }
			const session = Number(date[2]);
			const label = value.startsWith('EJU') && [1, 2].includes(session) ? `第${session}回` : `${session}月`;
			const group = years.get(date[1]) || [];
			group.push({ item, session, label });
			years.set(date[1], group);
		}
		const button = (item: Paper, label: string, context: string) => `<button type="button" data-gw="paper" data-exam="${escape(item.id || item.exam_id)}" data-domain="${escape(domain)}" aria-label="${escape(context)}" title="${escape(item.title || item.id || item.exam_id)}">${escape(label)} <span aria-hidden="true">→</span></button>`;
		const ordered = [...years.keys()].sort((a, b) => Number(b) - Number(a));
		const group = (year: string) => `<section class="gw-year-group" data-year="${year}"><h2>${year}年</h2><div class="gw-year-sessions">${years.get(year)!.sort((a, b) => a.session - b.session).map(({ item, label }) => button(item, label, `${value} · ${year}年 · ${label}${domain ? ` · ${domain}` : ''}`)).join('')}</div></section>`;
		const recent = ordered.filter(year => Number(year) >= 2021);
		const older = ordered.filter(year => Number(year) < 2021);
		return `<div class="gw-paper-years">${recent.map(group).join('')}</div>${older.length ? `<details class="gw-earlier-years"><summary><span class="gw-expand-years">展开更早试卷</span><span class="gw-collapse-years">收起更早试卷</span><small>${older.length}个年份</small></summary><div class="gw-paper-years">${older.map(group).join('')}</div></details>` : ''}${other.length ? `<section class="gw-other-papers"><h2>其他试卷</h2><div class="gw-year-sessions">${other.map(item => button(item, String(item.title || item.id || item.exam_id), String(item.title || item.id || item.exam_id))).join('')}</div></section>` : ''}${!ordered.length && !other.length ? '<p>当前暂无可用试卷。</p>' : ''}`;
	}
	async function browse(value: string, domain = ''): Promise<void> {
		const kind = value.startsWith('EJU') ? 'eju' : 'jlpt';
		if (guestTrialStatus(kind).remaining === 0) { showTrialLimit(kind); return; }
		const request = ++selectionRequest;
		expandedFamily = value.startsWith('EJU') ? 'eju' : 'jlpt';
		if (expandedFamily === 'jlpt') selectedLevel = value.slice(-2);
		frame('<p role="status">正在读取试卷…</p>', true, 'exams');
		try {
			const items = await api.getExams({ family: value.startsWith('EJU') ? 'eju' : 'jlpt', level: value.startsWith('EJU') ? undefined : value.slice(-2) }) as Paper[];
			if (request !== selectionRequest || !store.getState().user.guest) return;
			frame(`<span class="gw-eyebrow gw-selected-context">${escape(value)}${domain ? ` · ${escape(domain)}` : ''}</span><h1>选择试卷</h1>${paperYears(items, value, domain)}`, true, 'exams');
		} catch {
			if (request !== selectionRequest) return;
			frame('<h1>试卷列表暂时未能加载</h1><button data-gw="home">返回首页</button>', true, 'exams');
		}
	}
	async function openPaper(id: string, domain: string): Promise<void> {
		const kind = practiceTrialKind(id);
		if (guestTrialStatus(kind).remaining === 0) { showTrialLimit(kind); return; }
		for (const button of document.querySelectorAll<HTMLElement>('#guest-welcome [data-gw="paper"]')) {
			button.setAttribute('aria-pressed', String(button.dataset.exam === id));
		}
		try {
			const exam = await api.getExam(id);
			const viewer = (window as unknown as { examViewer: { _currentExamId: string; examMode: string; loadExamData: (data: unknown) => void; renderPracticeSetup: (host: HTMLElement, domain: string, onStart: () => void) => void; selectCategory: (category: string) => void; jumpToQuestion: (section: number, question: number) => void } }).examViewer;
			viewer._currentExamId = id;
			viewer.examMode = id.includes('DIAGNOSTIC') ? 'mock' : 'practice';
			viewer.loadExamData(exam);
			if (id.includes('DIAGNOSTIC')) { hide(); return; }
			const date = id.match(/(20\d{2})[_-](\d{2})/);
			const family = (exam as { family?: string }).family === 'eju' ? 'EJU' : `JLPT ${id.match(/N[1-3]/)?.[0] || ''}`;
			const context = `${family}${date ? ` · ${date[1]}年${family === 'EJU' ? `第${Number(date[2])}回` : `${Number(date[2])}月`}` : ''}`;
			frame(`<span class="gw-eyebrow gw-selected-context">${escape(context)} · ${escape(domain || '完整试卷')}</span><h1>选择题组</h1><p class="gw-description">默认选择第一个题组，可勾选其他题组。开始后练习范围固定。</p><div class="gw-range-setup"></div>`, true, 'exams');
			viewer.renderPracticeSetup(root.querySelector<HTMLElement>('.gw-range-setup')!, domain, () => {
				window.dispatchEvent(new CustomEvent('selectExamTarget', { detail: { target: id.match(/N[1-3]/)?.[0] ? `JLPT ${id.match(/N[1-3]/)![0]}` : 'EJU 日本語', examId: id } }));
				hide();
			});
		} catch { frame('<h1>这份试卷暂时无法打开</h1><button data-gw="home">返回首页</button>', true); }
	}
	function selectPractice(action: string, data: { target?: string; domain?: string; exam?: string }): boolean {
		if (action === 'target' && data.target) target(data.target);
		else if (action === 'browse' && data.target) void browse(data.target, data.domain);
		else if (action === 'paper' && data.exam) void openPaper(data.exam, data.domain || '');
		else return false;
		return true;
	}
	root.addEventListener('click', (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-gw]');
		if (!button || button.disabled) return;
		const action = button.dataset.gw;
		if (action && selectPractice(action, button.dataset)) return;
		if (action === 'home') goHome();
		if (action === 'login') login();
		if (action === 'review-practice') void reviewPractice(button.dataset.id || '');
		if (action === 'review-experience') {
			const saved = completed.find((item) => item.id === button.dataset.id);
			if (saved) { attempt = { ...saved }; persist(); void experience(); }
		}
		if (action === 'jlpt' || action === 'eju') {
			if (button.classList.contains('gw-goal-trigger')) {
				const scroll = root.scrollTop;
				expandedFamily = expandedFamily === action ? '' : action;
				home(); root.scrollTop = scroll;
				root.querySelector<HTMLButtonElement>(`[data-gw="${action}"]`)?.focus({ preventScroll: true });
			} else levels();
		}
		if (action === 'experience' || action === 'next') void experience(action === 'next');
		if (action === 'answer' && attempt) { attempt.answer = Number(button.dataset.answer); attempt.savedAt = Date.now(); persist(); void experience(); }
		if (action === 'check' && attempt?.answer) { if (!consumeGuestTrial('experience', `experience:${attempt.id}`)) { showTrialLimit('experience'); return; } attempt.checked = true; attempt.savedAt = Date.now(); if (!completed.some(item => item.id === attempt!.id)) completed = [...completed, { ...attempt }].slice(-1); persist(); void experience(); }
		if (action === 'diagnosis') { pendingTarget = button.dataset.target!; login(); }
	});
	window.addEventListener('guestWelcomeNavigate', ((event: CustomEvent<{ action: string }>) => {
		if (!store.getState().user.guest) return;
		const action = event.detail.action;
		if (action === 'home') goHome();
		else if (action === 'experience') void experience();
		else if (action === 'login') login();
		else {
			expandedFamily = action === 'eju' ? 'eju' : 'jlpt';
			home();
		}
	}) as EventListener);
	const returnButton = document.createElement('button');
	returnButton.className = 'gw-return';
	returnButton.textContent = '← 返回首页';
	returnButton.onclick = goHome;
	document.getElementById('exam-library-panel')?.prepend(returnButton);
	async function authenticated(): Promise<void> {
		returnButton.hidden = true;
		if (!active && !attempt?.checked && !completed.length) return;
		if ((attempt?.checked || completed.length) && !importing) {
			importing = true;
			try {
				const records = completed.length ? completed : [attempt!];
				for (const record of records) await api.request('/me/experience', { method: 'POST', body: JSON.stringify({ question_id: record.sample === 0 ? 59 : 62, answer: record.answer, submission_id: record.id }) });
				localStorage.removeItem(key); attempt = null; completed = [];
			} catch {
				frame('<h1>练习记录还未保存</h1><p>临时记录仍保留在此浏览器，可重试保存。</p><button data-gw="retry-save" class="gw-primary">重试保存</button><button data-gw="dismiss" class="gw-text">稍后再试</button>', true);
				root.querySelector('[data-gw="retry-save"]')?.addEventListener('click', () => void authenticated());
				root.querySelector('[data-gw="dismiss"]')?.addEventListener('click', hide);
				return;
			} finally { importing = false; }
		}
		hide();
		if (pendingTarget) {
			const examId = pendingTarget.startsWith('EJU') ? 'EJU_JAPANESE_DIAGNOSTIC_V1' : `${pendingTarget.slice(-2)}_DIAGNOSTIC_V1`;
			pendingTarget = '';
			await openPaper(examId, '');
		}
	}
	store.subscribe((state) => { if (!state.user.guest) void authenticated(); else { returnButton.hidden = false; home(); } });
	if (store.getState().user.guest) { returnButton.hidden = false; if (!location.hash.includes('exam=')) home(); else hide(); }
	else { returnButton.hidden = true; root.hidden = true; if (attempt?.checked || completed.length) void authenticated(); }
}
