import type { CurrentUser } from '../api/dto.js';

export interface AppState {
	user: CurrentUser | { guest: true };
	examsByLevel: Record<string, unknown[]>;
	currentLevel: string;
}

export type Listener = (state: AppState) => void;

export class AppStore {
	private state: AppState = {
		user: { guest: true },
		examsByLevel: {},
		currentLevel: 'N1'
	};
	private listeners = new Set<Listener>();

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getState(): AppState {
		return this.state;
	}

	setState(patch: Partial<AppState>): void {
		this.state = { ...this.state, ...patch };
		this.listeners.forEach((listener) => listener(this.state));
	}
}
