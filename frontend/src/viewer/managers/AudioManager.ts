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
}

type DragLikeEvent = MouseEvent | Touch;

/**
 * 音频管理器 - 负责音频播放和脚本同步
 */
class AudioManager {
	private readonly examViewer: AudioExamViewer;
	private readonly audioPlayers: Map<string, HTMLAudioElement>;

	constructor(examViewer: AudioExamViewer) {
		this.examViewer = examViewer;
		this.audioPlayers = new Map();
	}

	private keyOf(questionId: string | number): string {
		return String(questionId);
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

		controlsDiv.appendChild(playBtn);
		controlsDiv.appendChild(progressDiv);
		controlsDiv.appendChild(timeDisplay);
		audioDiv.appendChild(controlsDiv);

		return audioDiv;
	}

	/**
	 * 创建脚本元素
	 */
	createScriptElement(question: AudioQuestion): HTMLDivElement {
		const questionKey = this.keyOf(question.id);
		const scriptDiv = document.createElement('div');
		scriptDiv.className = 'script-container';

		if (question.script && Array.isArray(question.script)) {
			question.script.forEach((line) => {
				const lineDiv = document.createElement('div');
				lineDiv.dataset.start = line.start ?? '';
				lineDiv.dataset.end = line.end ?? '';
				lineDiv.dataset.questionId = questionKey;

				if (line.speaker) {
					const speakerPattern = new RegExp(`^(${line.speaker})[：:]\\s*`);
					const match = line.text.match(speakerPattern);
					lineDiv.className = 'script-line';

					const speakerSpan = document.createElement('span');
					speakerSpan.className = 'speaker';
					speakerSpan.textContent = line.speaker;
					lineDiv.appendChild(speakerSpan);

					const textSpan = document.createElement('span');
					textSpan.className = 'script-text';
					textSpan.textContent = match ? line.text.substring(match[0].length) : line.text;
					lineDiv.appendChild(textSpan);
				} else {
					lineDiv.className = 'script-line no-speaker';
					const textSpan = document.createElement('span');
					textSpan.className = 'script-text';
					textSpan.textContent = line.text;
					lineDiv.appendChild(textSpan);
				}

				lineDiv.addEventListener('click', () => {
					this.seekToScriptLine(lineDiv, questionKey);
				});

				scriptDiv.appendChild(lineDiv);
			});
		}

		return scriptDiv;
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

			const createdAudio = new Audio(question.audio);
			audio = createdAudio;
			this.audioPlayers.set(questionKey, createdAudio);

			createdAudio.addEventListener('timeupdate', () => {
				this.updateScriptHighlight(questionKey, createdAudio.currentTime);
				this.updateProgressBar(questionKey, createdAudio.currentTime, createdAudio.duration);
			});

			createdAudio.addEventListener('ended', () => {
				playBtn.dataset.playing = 'false';
				this.updateProgressBar(questionKey, 0, createdAudio.duration);
			});

			void createdAudio.play();
			playBtn.dataset.playing = 'true';
			return;
		}

		if (audio.paused) {
			void audio.play();
			playBtn.dataset.playing = 'true';
		} else {
			audio.pause();
			playBtn.dataset.playing = 'false';
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
					this.scrollScriptLineIntoView(line);
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
	 * 清除活动脚本行
	 */
	clearActiveScriptLines(questionId: string): void {
		let active = document.querySelectorAll(`.script-line[data-question-id="${questionId}"] .active`);
		if (!active.length) {
			active = document.querySelectorAll(`.script-line[data-question-id="${questionId}"]`);
		}
		active.forEach((line) => (line as HTMLElement).classList.remove('active'));
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

			const createdAudio = new Audio(question.audio);
			audio = createdAudio;
			this.audioPlayers.set(questionId, createdAudio);

			createdAudio.addEventListener('timeupdate', () => {
				this.updateScriptHighlight(questionId, createdAudio.currentTime);
				this.updateProgressBar(questionId, createdAudio.currentTime, createdAudio.duration);
			});

			createdAudio.addEventListener('ended', () => {
				if (playBtn) {
					playBtn.dataset.playing = 'false';
				}
				this.updateProgressBar(questionId, 0, createdAudio.duration);
			});
		}

		const activeAudio = audio;
		const start = this.parseTimeToSeconds(lineDiv.dataset.start ?? '');
		const wasPlaying = !activeAudio.paused;
		activeAudio.pause();

		document.querySelectorAll(`.script-line[data-question-id="${questionId}"]`).forEach((el) => {
			(el as HTMLElement).classList.remove('active');
		});

		lineDiv.classList.add('active');
		this.scrollScriptLineIntoView(lineDiv);
		activeAudio.currentTime = start;

		if (wasPlaying || activeAudio.paused) {
			void activeAudio.play().catch(() => {
				console.log('Audio play failed');
			});
			if (playBtn) {
				playBtn.dataset.playing = 'true';
			}
		}
	}

	/**
	 * 滚动脚本行到视图
	 */
	scrollScriptLineIntoView(lineEl: HTMLElement | null): void {
		if (!lineEl) {
			return;
		}
		try {
			lineEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
		} catch {
			lineEl.scrollIntoView();
		}
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
