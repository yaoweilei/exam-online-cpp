/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *
 *  This software is proprietary and confidential.
 *  Unauthorized copying, distribution, modification, or use of this software,
 *  via any medium, is strictly prohibited without prior written permission.
 *--------------------------------------------------------------------------------------------*/

interface AudioScriptLine {
	start?: string;
	end?: string;
	speaker?: string;
	text: string;
}

interface AudioQuestion {
	id: string | number;
	audio?: string;
	script?: AudioScriptLine[];
	script_layout_image?: string;
	[key: string]: unknown;
}

interface AudioSection {
	questions?: AudioQuestion[];
	[key: string]: unknown;
}

interface AudioManagedExam {
	exam_info?: {
		sections?: AudioSection[];
	};
}

interface AudioExamViewer {
	currentExam: AudioManagedExam;
	currentSectionIndex: number;
	showReadingKana?: boolean;
	canUseReadingAssists?: () => boolean;
	showReadingZh?: boolean;
	_currentExamId?: string | null;
}

type DragLikeEvent = MouseEvent | Touch;

// 业务功能 9：音频增强 —— 每个播放器的倍速与循环状态
interface AudioEnhanceState {
	speed: number;
	loop: boolean;
}

/**
 * 音频管理器 - 负责音频播放和脚本同步
 */
class AudioManager {
	private readonly examViewer: AudioExamViewer;
	private readonly audioPlayers: Map<string, HTMLAudioElement>;
	// 业务功能 9：音频增强状态表（key: questionId）
	private readonly enhanceStates: Map<string, AudioEnhanceState>;
	private readonly scriptLineSeekPrerollSeconds = 0.18;

	constructor(examViewer: AudioExamViewer) {
		this.examViewer = examViewer;
		this.audioPlayers = new Map();
		this.enhanceStates = new Map();
	}

	private keyOf(questionId: string | number): string {
		return String(questionId);
	}

	// 业务功能 9：取/初始化某题的增强状态
	private getEnhanceState(questionKey: string): AudioEnhanceState {
		let s = this.enhanceStates.get(questionKey);
		if (!s) {
			s = { speed: 1, loop: false };
			this.enhanceStates.set(questionKey, s);
		}
		return s;
	}

	// 业务功能 9：判断功能开关
	private isEnhanceEnabled(): boolean {
		try {
			return window.isFeatureEnabled?.('audio_enhancement', true) ?? true;
		} catch {
			return true;
		}
	}

	/**
	 * 创建音频播放器元素
	 */
	createAudioPlayerElement(question: AudioQuestion): HTMLDivElement {
		const questionKey = this.keyOf(question.id);
		const audioDiv = document.createElement('div');
		audioDiv.className = 'audio-player';
		audioDiv.dataset.questionId = questionKey;

		const controlsDiv = document.createElement('div');
		controlsDiv.className = 'audio-controls';

		const playBtn = document.createElement('button');
		playBtn.className = 'audio-btn';
		playBtn.dataset.questionId = questionKey;
		playBtn.dataset.playing = 'false';
		playBtn.type = 'button';
		playBtn.setAttribute('aria-label', '播放音频');
		playBtn.addEventListener('click', () => this.togglePlayPause(question, playBtn));

		const progressDiv = document.createElement('div');
		progressDiv.className = 'audio-progress';
		progressDiv.addEventListener('click', (event) => this.seekToProgress(event, question));
		this.addProgressDragSupport(progressDiv, question);

		const progressBar = document.createElement('div');
		progressBar.className = 'audio-progress-bar';
		progressBar.dataset.questionId = questionKey;
		progressDiv.appendChild(progressBar);

		const timeDisplay = document.createElement('span');
		timeDisplay.className = 'audio-time';
		timeDisplay.textContent = '0:00 / 0:00';
		timeDisplay.dataset.questionId = questionKey;
		timeDisplay.setAttribute('role', 'status');
		timeDisplay.setAttribute('aria-live', 'polite');

		controlsDiv.appendChild(playBtn);
		controlsDiv.appendChild(progressDiv);
		controlsDiv.appendChild(timeDisplay);

		// 业务功能 9：音频增强控件（受 audio_enhancement 开关控制）
		if (this.isEnhanceEnabled()) {
			controlsDiv.appendChild(this.createEnhanceControls(question));
		}
		audioDiv.appendChild(controlsDiv);

		return audioDiv;
	}

	private createManagedAudio(
		question: AudioQuestion,
		questionKey: string,
		playBtn: HTMLButtonElement | null
	): HTMLAudioElement {
		const audio = new Audio(question.audio || '');
		audio.preload = 'metadata';
		audio.setAttribute('playsinline', '');
		this.applyEnhanceToAudio(questionKey, audio);

		const refreshDuration = () => {
			if (Number.isFinite(audio.duration) && audio.duration > 0) {
				this.updateProgressBar(questionKey, audio.currentTime, audio.duration);
			}
		};
		audio.addEventListener('loadedmetadata', refreshDuration);
		audio.addEventListener('durationchange', refreshDuration);
		audio.addEventListener('timeupdate', () => {
			this.updateScriptHighlight(questionKey, audio.currentTime);
			this.updateProgressBar(questionKey, audio.currentTime, audio.duration);
		});
		audio.addEventListener('playing', () => this.setPlaybackState(playBtn, true));
		audio.addEventListener('pause', () => this.setPlaybackState(playBtn, false));
		audio.addEventListener('ended', () => {
			this.setPlaybackState(playBtn, false);
			this.updateProgressBar(questionKey, 0, audio.duration);
		});
		audio.addEventListener('error', () => {
			this.reportAudioFailure(questionKey, playBtn, question.audio || '', audio.error);
		});
		return audio;
	}

	private setPlaybackState(playBtn: HTMLButtonElement | null, playing: boolean): void {
		if (!playBtn) return;
		const currentButton = document.querySelector<HTMLButtonElement>(
			`.audio-btn[data-question-id="${playBtn.dataset.questionId}"]`
		) || playBtn;
		currentButton.dataset.playing = String(playing);
		currentButton.setAttribute('aria-label', playing ? '暂停音频' : '播放音频');
		if (playing) delete currentButton.dataset.audioError;
	}

	private reportAudioFailure(
		questionKey: string,
		playBtn: HTMLButtonElement | null,
		audioUrl: string,
		error: MediaError | null = null
	): void {
		this.setPlaybackState(playBtn, false);
		if (playBtn) playBtn.dataset.audioError = 'true';
		const timeDisplay = document.querySelector(
			`.audio-time[data-question-id="${questionKey}"]`
		) as HTMLSpanElement | null;
		if (timeDisplay) {
			timeDisplay.textContent = '音频加载失败';
			timeDisplay.classList.add('is-error');
			timeDisplay.title = '请检查网络后重试';
		}
		console.warn('[AudioManager] Audio playback failed', {
			audioUrl,
			mediaErrorCode: error?.code ?? 0,
			mediaErrorMessage: error?.message ?? ''
		});
	}

	private playManagedAudio(
		audio: HTMLAudioElement,
		questionKey: string,
		playBtn: HTMLButtonElement | null
	): void {
		const timeDisplay = document.querySelector(
			`.audio-time[data-question-id="${questionKey}"]`
		) as HTMLSpanElement | null;
		if (timeDisplay) {
			timeDisplay.classList.remove('is-error');
			timeDisplay.title = '';
		}
		void audio.play().then(() => {
			this.setPlaybackState(playBtn, !audio.paused);
		}).catch((error: unknown) => {
			if (error instanceof DOMException && error.name === 'AbortError' && audio.paused) {
				this.setPlaybackState(playBtn, false);
				return;
			}
			this.reportAudioFailure(questionKey, playBtn, audio.src, audio.error);
		});
	}

	/**
	 * 业务功能 9：创建音频增强控件区
	 *   - 倍速下拉
	 *   - 循环开关
	 */
	private createEnhanceControls(question: AudioQuestion): HTMLDivElement {
		const questionKey = this.keyOf(question.id);
		const state = this.getEnhanceState(questionKey);

		const wrap = document.createElement('div');
		wrap.className = 'audio-enhance';

		// 倍速
		const speedLabel = document.createElement('label');
		speedLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;';
		const speedSel = document.createElement('select');
		speedSel.style.cssText = 'padding:2px 4px;font-size:12px;';
		speedSel.setAttribute('aria-label', '播放倍速');
		[0.5, 0.75, 1, 1.25, 1.5, 2].forEach((v) => {
			const opt = document.createElement('option');
			opt.value = String(v);
			opt.textContent = `${v}x`;
			if (v === state.speed) opt.selected = true;
			speedSel.appendChild(opt);
		});
		speedSel.addEventListener('change', () => {
			const v = Number.parseFloat(speedSel.value);
			state.speed = Number.isFinite(v) ? v : 1;
			const audio = this.audioPlayers.get(questionKey);
			if (audio) audio.playbackRate = state.speed;
		});
		speedLabel.appendChild(speedSel);

		// 循环
		const loopLabel = document.createElement('label');
		loopLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;cursor:pointer;';
		const loopCb = document.createElement('input');
		loopCb.type = 'checkbox';
		loopCb.checked = state.loop;
		loopCb.addEventListener('change', () => {
			state.loop = loopCb.checked;
			const audio = this.audioPlayers.get(questionKey);
			if (audio) audio.loop = state.loop;
		});
		loopLabel.appendChild(loopCb);
		loopLabel.appendChild(document.createTextNode('循环'));

		wrap.appendChild(speedLabel);
		wrap.appendChild(loopLabel);
		return wrap;
	}

	// 业务功能 9：在音频元素上应用倍速与循环设置
	private applyEnhanceToAudio(questionKey: string, audio: HTMLAudioElement): void {
		const state = this.getEnhanceState(questionKey);
		audio.playbackRate = state.speed;
		audio.loop = state.loop;
	}

	/**
	 * 创建脚本元素
	 */
	createScriptElement(question: AudioQuestion): HTMLDivElement {
		const questionKey = this.keyOf(question.id);
		const scriptDiv = document.createElement('div');
		scriptDiv.className = 'script-container';
		scriptDiv.style.cssText = 'margin-top:10px;';

		const layoutImageEl = this.createScriptLayoutImageElement(question);
		if (layoutImageEl) {
			scriptDiv.appendChild(layoutImageEl);
		}

		if (question.script && Array.isArray(question.script)) {
			const scriptScopeKey = this.buildScriptScopeKey(question);
			question.script.forEach((line, lineIndex) => {
				const lineEl = this.createScriptLineElement(questionKey, scriptScopeKey, line, lineIndex);
				scriptDiv.appendChild(lineEl);
			});
		}

		return scriptDiv;
	}

	private createScriptLayoutImageElement(question: AudioQuestion): HTMLDivElement | null {
		if (!question.script_layout_image || this.isEjuListeningQuestion(question)) {
			return null;
		}

		const wrap = document.createElement('div');
		wrap.className = 'script-layout-image-wrap';
		wrap.style.cssText =
			'padding:10px 12px;border:1px solid #ece6d8;border-radius:10px;background:#fffdf8;box-shadow:0 1px 2px rgba(0,0,0,.03);';

		const caption = document.createElement('div');
		caption.className = 'script-layout-image-caption';
		caption.textContent = '原文版式';
		caption.style.cssText = 'margin-bottom:8px;font-size:12px;font-weight:700;color:#8a4b08;letter-spacing:.02em;';
		wrap.appendChild(caption);

		const image = document.createElement('img');
		image.src = question.script_layout_image;
		image.alt = '听力原文版式';
		image.loading = 'lazy';
		image.style.cssText =
			'display:block;width:100%;max-width:860px;height:auto;margin:0 auto;border-radius:6px;background:#fff;';
		wrap.appendChild(image);
		return wrap;
	}

	private isEjuListeningQuestion(question: AudioQuestion): boolean {
		const tags = [
			...(Array.isArray(question.tags) ? question.tags.map(String) : []),
			...(Array.isArray(question.skill_tags) ? question.skill_tags.map(String) : [])
		];
		if (tags.includes('eju.listening_reading') || tags.includes('eju.listening')) {
			return true;
		}

		const section = this.examViewer.currentExam?.exam_info?.sections?.[this.examViewer.currentSectionIndex];
		const sectionType = String((section as Record<string, unknown> | undefined)?.section_type || '');
		return sectionType === 'listening_reading' || sectionType === 'listening';
	}

	private createScriptLineElement(
		questionKey: string,
		scriptScopeKey: string,
		line: AudioScriptLine,
		lineIndex: number
	): HTMLSpanElement {
		const lineEl = document.createElement('span');
		lineEl.dataset.start = line.start ?? '';
		lineEl.dataset.end = line.end ?? '';
		lineEl.dataset.questionId = questionKey;
		lineEl.dataset.translationScope = scriptScopeKey;
		lineEl.dataset.sidx = String(lineIndex);
		lineEl.className = line.speaker ? 'script-line script-segment' : 'script-line no-speaker script-segment';
		lineEl.style.cssText = '';

		let displayText = line.text;
		if (line.speaker) {
			const speakerPattern = new RegExp(`^(${line.speaker})[：:]\\s*`);
			const match = line.text.match(speakerPattern);
			displayText = match ? line.text.substring(match[0].length) : line.text;
		}

		const textSpan = document.createElement('span');
		textSpan.className = 'script-text';
		textSpan.innerHTML = this.renderScriptTextAssist(scriptScopeKey, lineIndex, displayText);
		if (line.speaker) {
			const speakerSpan = document.createElement('span');
			speakerSpan.className = 'speaker';
			speakerSpan.textContent = line.speaker;
			(textSpan.querySelector('.text-assist-source') || textSpan).prepend(speakerSpan);
		}
		lineEl.appendChild(textSpan);

		lineEl.addEventListener('click', () => {
			this.seekToScriptLine(lineEl, questionKey);
		});
		return lineEl;
	}

	private buildScriptScopeKey(question: AudioQuestion): string {
		const section = this.examViewer.currentExam?.exam_info?.sections?.[this.examViewer.currentSectionIndex] || {};
		const sectionId = String((section as Record<string, unknown>).section_id || '');
		const groupKey = typeof question._groupPassageKey === 'string' ? question._groupPassageKey : '';
		const base = groupKey || sectionId;
		return `${base}:q${question.id}:script`;
	}

	private renderScriptTextAssist(scopeKey: string, lineIndex: number, text: string): string {
		const allowed = this.examViewer.canUseReadingAssists?.() !== false;
		const showKana = allowed && Boolean(this.examViewer.showReadingKana);
		const showZh = allowed && Boolean(this.examViewer.showReadingZh);
		const sourceHtml = this.escapeHtml(text);
		if (!showKana && !showZh) {
			return sourceHtml;
		}

		const examId = this.examViewer._currentExamId || '';
		const source = showKana ? this.buildRubyForScope(examId, scopeKey, 0, lineIndex, sourceHtml) || sourceHtml : sourceHtml;
		const zh = showZh ? this.buildZhForScope(examId, scopeKey, 0, lineIndex) : '';
		if (!zh) {
			return source;
		}
		return `<span class="text-assist-wrap"><span class="text-assist-source">${source}</span><span class="sentence-zh">${zh}</span></span>`;
	}

	private buildRubyForScope(examId: string, scopeKey: string, pIdx: number, sIdx: number, formattedText: string): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getRuby?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const explicitRuby = translationMgr?.getRuby?.(examId, scopeKey, pIdx, sIdx) || '';
		if (explicitRuby.trim()) {
			return explicitRuby;
		}
		return formattedText;
	}

	private buildZhForScope(examId: string, scopeKey: string, pIdx: number, sIdx: number): string {
		const translationMgr = (window as unknown as {
			TranslationManager?: { getSentence?: (examId: string, passageKey: string, pIdx: number, sIdx: number) => string };
		}).TranslationManager;
		const zh = translationMgr?.getSentence?.(examId, scopeKey, pIdx, sIdx) || '';
		return zh.trim() ? this.escapeHtml(zh).replace(/\n/g, '<br>') : '';
	}

	private escapeHtml(text: string): string {
		return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char));
	}

	/**
	 * 切换播放/暂停
	 */
	togglePlayPause(question: AudioQuestion, playBtn: HTMLButtonElement): void {
		const questionKey = this.keyOf(question.id);
		let audio = this.audioPlayers.get(questionKey);

		if (!audio) {
			if (!question.audio) {
				return;
			}

			const createdAudio = this.createManagedAudio(question, questionKey, playBtn);
			audio = createdAudio;
			this.audioPlayers.set(questionKey, createdAudio);
			this.playManagedAudio(createdAudio, questionKey, playBtn);
			return;
		}

		if (audio.paused) {
			this.playManagedAudio(audio, questionKey, playBtn);
		} else {
			audio.pause();
			this.setPlaybackState(playBtn, false);
		}
	}

	/**
	 * 更新进度条
	 */
	updateProgressBar(questionId: string, currentTime: number, duration: number): void {
		const progressBar = document.querySelector(
			`.audio-progress-bar[data-question-id="${questionId}"]`
		) as HTMLDivElement | null;
		const timeDisplay = document.querySelector(`.audio-time[data-question-id="${questionId}"]`) as
			| HTMLSpanElement
			| null;

		if (progressBar && duration > 0) {
			const percentage = (currentTime / duration) * 100;
			progressBar.style.width = `${percentage}%`;
		}

		if (timeDisplay) {
			const current = this.formatTime(currentTime);
			const total = this.formatTime(duration);
			timeDisplay.textContent = `${current} / ${total}`;
		}
	}

	/**
	 * 格式化时间显示
	 */
	formatTime(seconds: number): string {
		if (Number.isNaN(seconds)) {
			return '0:00';
		}
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	/**
	 * 点击进度条跳转
	 */
	seekToProgress(event: MouseEvent, question: AudioQuestion): void {
		const questionKey = this.keyOf(question.id);
		const audio = this.audioPlayers.get(questionKey);
		if (!audio) {
			return;
		}

		const progressDiv = event.currentTarget as HTMLDivElement | null;
		if (!progressDiv) {
			return;
		}

		const rect = progressDiv.getBoundingClientRect();
		const clickX = event.clientX - rect.left;
		const percentage = clickX / rect.width;
		audio.currentTime = percentage * audio.duration;
	}

	/**
	 * 更新脚本高亮
	 */
	updateScriptHighlight(questionId: string, currentTime: number): void {
		const scriptLines = document.querySelectorAll(`.script-line[data-question-id="${questionId}"]`);
		let foundActive = false;

		scriptLines.forEach((lineElement) => {
			const line = lineElement as HTMLElement;
			const start = this.parseTimeToSeconds(line.dataset.start ?? '');
			const end = this.parseTimeToSeconds(line.dataset.end ?? '');

			if (currentTime >= start && currentTime < end && !foundActive) {
				if (!line.classList.contains('active')) {
					line.classList.add('active');
				}
				foundActive = true;
			} else {
				line.classList.remove('active');
			}
		});
	}

	/**
	 * 解析时间字符串为秒数
	 */
	parseTimeToSeconds(timeString: string): number {
		if (!timeString) {
			return 0;
		}

		const parts = timeString.split(':').map((part) => Number.parseFloat(part));
		if (parts.length === 3) {
			return parts[0] * 3600 + parts[1] * 60 + parts[2];
		}
		if (parts.length === 2) {
			return parts[0] * 60 + parts[1];
		}
		return 0;
	}

	/**
	 * 跳转到脚本行
	 */
	seekToScriptLine(lineDiv: HTMLElement, questionId: string): void {
		let audio = this.audioPlayers.get(questionId);
		const playBtn = document.querySelector(`.audio-btn[data-question-id="${questionId}"]`) as
			| HTMLButtonElement
			| null;

		if (!audio) {
			const sections = this.examViewer.currentExam.exam_info?.sections ?? [];
			const currentSection = sections[this.examViewer.currentSectionIndex];
			const question = currentSection?.questions?.find((q) => this.keyOf(q.id) === questionId);

			if (!question || !question.audio) {
				console.log('No audio found for question:', questionId);
				return;
			}

			const createdAudio = this.createManagedAudio(question, questionId, playBtn);
			audio = createdAudio;
			this.audioPlayers.set(questionId, createdAudio);
		}

		const activeAudio = audio;
		const start = this.getScriptLineSeekStart(lineDiv);
		const wasPlaying = !activeAudio.paused;
		activeAudio.pause();

		document.querySelectorAll(`.script-line[data-question-id="${questionId}"]`).forEach((el) => {
			(el as HTMLElement).classList.remove('active');
		});

		lineDiv.classList.add('active');
		this.seekAndPlayScriptLine(activeAudio, start, questionId, playBtn, wasPlaying || activeAudio.paused);
	}

	private getScriptLineSeekStart(lineDiv: HTMLElement): number {
		const rawStart = this.parseTimeToSeconds(lineDiv.dataset.start ?? '');
		return Math.max(0, rawStart - this.scriptLineSeekPrerollSeconds);
	}

	private seekAndPlayScriptLine(
		audio: HTMLAudioElement,
		start: number,
		questionKey: string,
		playBtn: HTMLButtonElement | null,
		shouldPlay: boolean
	): void {
		let started = false;
		let fallbackTimer: number | undefined;
		let metadataFallbackTimer: number | undefined;

		const startPlayback = () => {
			if (started) return;
			started = true;
			if (fallbackTimer !== undefined) {
				window.clearTimeout(fallbackTimer);
			}
			if (metadataFallbackTimer !== undefined) {
				window.clearTimeout(metadataFallbackTimer);
			}
			if (!shouldPlay) return;
			this.playManagedAudio(audio, questionKey, playBtn);
		};

		const seekThenPlay = () => {
			if (metadataFallbackTimer !== undefined) {
				window.clearTimeout(metadataFallbackTimer);
				metadataFallbackTimer = undefined;
			}
			audio.currentTime = start;
			audio.addEventListener('seeked', startPlayback, { once: true });
			fallbackTimer = window.setTimeout(startPlayback, 160);
		};

		if (audio.readyState === HTMLMediaElement.HAVE_NOTHING) {
			audio.addEventListener('loadedmetadata', seekThenPlay, { once: true });
			audio.load();
			metadataFallbackTimer = window.setTimeout(() => {
				try {
					audio.currentTime = start;
				} catch {
					/* wait for metadata */
				}
				startPlayback();
			}, 500);
			return;
		}

		seekThenPlay();
	}

	/**
	 * 添加进度条拖动支持
	 */
	addProgressDragSupport(progressDiv: HTMLDivElement, question: AudioQuestion): void {
		let isDragging = false;

		progressDiv.addEventListener('mousedown', (event) => {
			isDragging = true;
			this.handleProgressDrag(event, progressDiv, question);
			event.preventDefault();
		});

		document.addEventListener('mousemove', (event) => {
			if (!isDragging) {
				return;
			}
			this.handleProgressDrag(event, progressDiv, question);
			event.preventDefault();
		});

		document.addEventListener('mouseup', () => {
			isDragging = false;
		});

		progressDiv.addEventListener('touchstart', (event) => {
			isDragging = true;
			const touch = event.touches[0];
			if (touch) {
				this.handleProgressDrag(touch, progressDiv, question);
			}
			event.preventDefault();
		});

		document.addEventListener('touchmove', (event) => {
			if (!isDragging) {
				return;
			}
			const touch = event.touches[0];
			if (touch) {
				this.handleProgressDrag(touch, progressDiv, question);
			}
			event.preventDefault();
		});

		document.addEventListener('touchend', () => {
			isDragging = false;
		});
	}

	/**
	 * 处理进度条拖动
	 */
	handleProgressDrag(event: DragLikeEvent, progressDiv: HTMLDivElement, question: AudioQuestion): void {
		const questionKey = this.keyOf(question.id);
		const audio = this.audioPlayers.get(questionKey);
		if (!audio || !audio.duration) {
			return;
		}

		const rect = progressDiv.getBoundingClientRect();
		const clickX = event.clientX - rect.left;
		const percentage = Math.max(0, Math.min(1, clickX / rect.width));
		const newTime = percentage * audio.duration;
		audio.currentTime = newTime;
		this.updateProgressBar(questionKey, newTime, audio.duration);
	}

	/**
	 * 跳转到指定时间
	 */
	jumpToAudioTime(timeString: string): void {
		const firstAudio = Array.from(this.audioPlayers.values())[0];
		if (!firstAudio) {
			return;
		}
		firstAudio.currentTime = this.parseTimeToSeconds(timeString);
	}

	/**
	 * 停止所有音频播放
	 */
	stopAllAudio(): void {
		this.audioPlayers.forEach((audio, questionId) => {
			audio.pause();
			audio.currentTime = 0;

			const playBtn = document.querySelector(`.audio-btn[data-question-id="${questionId}"]`) as
				| HTMLButtonElement
				| null;
			if (playBtn) {
				playBtn.dataset.playing = 'false';
			}

			const progressBar = document.querySelector(
				`.audio-progress-bar[data-question-id="${questionId}"]`
			) as HTMLDivElement | null;
			if (progressBar) {
				progressBar.style.width = '0%';
			}

			const timeDisplay = document.querySelector(`.audio-time[data-question-id="${questionId}"]`) as
				| HTMLSpanElement
				| null;
			if (timeDisplay) {
				timeDisplay.textContent = '0:00 / 0:00';
			}
		});

		this.audioPlayers.clear();
		document.querySelectorAll('.script-line.active').forEach((el) => {
			(el as HTMLElement).classList.remove('active');
		});
	}
}

window.AudioManager = AudioManager;
