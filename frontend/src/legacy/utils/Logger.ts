/**
 * 统一日志系统
 * 支持日志级别控制：DEBUG < INFO < WARN < ERROR
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogMethod = (...args: unknown[]) => void;

interface LoggerInstance {
	debug: LogMethod;
	info: LogMethod;
	warn: LogMethod;
	error: LogMethod;
	styled: (level: LogLevel, ...args: unknown[]) => void;
}

class Logger {
	static LEVELS: Record<LogLevel, number> = {
		DEBUG: 0,
		INFO: 1,
		WARN: 2,
		ERROR: 3
	};

	static LEVEL_NAMES: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

	static LEVEL_COLORS: Record<LogLevel, string> = {
		DEBUG: '#999',
		INFO: '#2196F3',
		WARN: '#FF9800',
		ERROR: '#F44336'
	};

	static currentLevel = Logger.LEVELS.INFO;

	static init(level: string = 'INFO'): void {
		const upperLevel = level.toUpperCase() as LogLevel;
		if (Object.prototype.hasOwnProperty.call(Logger.LEVELS, upperLevel)) {
			Logger.currentLevel = Logger.LEVELS[upperLevel];
			console.log(`[Logger] 日志级别设置为: ${upperLevel}`);
		} else {
			console.warn(`[Logger] 无效的日志级别: ${level}，使用默认级别 INFO`);
		}
	}

	static initFromConfig(): void {
		const level = window.__LOG_LEVEL__ || 'INFO';
		Logger.init(level);
	}

	static shouldLog(level: number): boolean {
		return level >= Logger.currentLevel;
	}

	static formatMessage(tag: string, levelName: LogLevel, args: unknown[]): unknown[] {
		const timestamp = new Date().toLocaleTimeString();
		const prefix = `[${timestamp}] [${levelName}] [${tag}]`;
		return [prefix, ...args];
	}

	static getLogger(tag: string): LoggerInstance {
		return {
			debug: (...args: unknown[]) => {
				if (Logger.shouldLog(Logger.LEVELS.DEBUG)) {
					console.log(...Logger.formatMessage(tag, 'DEBUG', args));
				}
			},
			info: (...args: unknown[]) => {
				if (Logger.shouldLog(Logger.LEVELS.INFO)) {
					console.log(...Logger.formatMessage(tag, 'INFO', args));
				}
			},
			warn: (...args: unknown[]) => {
				if (Logger.shouldLog(Logger.LEVELS.WARN)) {
					console.warn(...Logger.formatMessage(tag, 'WARN', args));
				}
			},
			error: (...args: unknown[]) => {
				if (Logger.shouldLog(Logger.LEVELS.ERROR)) {
					console.error(...Logger.formatMessage(tag, 'ERROR', args));
				}
			},
			styled: (level: LogLevel, ...args: unknown[]) => {
				const levelNum = Logger.LEVELS[level];
				if (Logger.shouldLog(levelNum)) {
					const color = Logger.LEVEL_COLORS[level];
					const timestamp = new Date().toLocaleTimeString();
					console.log(`%c[${timestamp}] [${level}] [${tag}]`, `color: ${color}; font-weight: bold;`, ...args);
				}
			}
		};
	}

	static setLevel(level: string): void {
		Logger.init(level);
	}

	static getCurrentLevel(): LogLevel {
		return Logger.LEVEL_NAMES[Logger.currentLevel];
	}
}

window.Logger = Logger;

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => Logger.initFromConfig());
} else {
	Logger.initFromConfig();
}
