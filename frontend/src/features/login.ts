import { ApiClient } from '../api/client.js';
import type { MeContext } from '../api/dto.js';
import { buildCurrentUser, persistSession } from './session.js';
import { AppStore } from '../state/store.js';

type LoginMode = 'wechat' | 'phone' | 'password';

export class LoginModal {
	private modal: HTMLElement;
	private currentMode: LoginMode = 'wechat';
	private pollTimer: number | null = null;
	private api: ApiClient;
	private store: AppStore;

	constructor(api: ApiClient, store: AppStore) {
		this.api = api;
		this.store = store;
		this.modal = document.getElementById('login-modal')!;
		this.bindEvents();
	}

	open(): void {
		this.modal.classList.add('active');
		this.switchMode(this.currentMode);
	}

	close(): void {
		this.stopPolling();
		this.modal.classList.remove('active');
	}

	private bindEvents(): void {
		// Close on backdrop click
		this.modal.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).id === 'login-modal') this.close();
		});

		// Mode switch icons
		this.modal.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
			el.addEventListener('mouseenter', () => {
				this.switchMode(el.dataset.mode as LoginMode);
			});
			el.addEventListener('click', () => {
				this.switchMode(el.dataset.mode as LoginMode);
			});
		});

		// Password login form
		this.modal.querySelector('#login-btn-password')?.addEventListener('click', () => {
			void this.submitPassword();
		});

		// Phone send code
		this.modal.querySelector('#login-btn-send-code')?.addEventListener('click', () => {
			void this.sendPhoneCode();
		});

		// Phone verify
		this.modal.querySelector('#login-btn-phone-verify')?.addEventListener('click', () => {
			void this.submitPhone();
		});
	}

	private switchMode(mode: LoginMode): void {
		this.stopPolling();
		this.currentMode = mode;

		// Update active icon
		this.modal.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
			el.classList.toggle('active', el.dataset.mode === mode);
		});

		// Show/hide panels
		this.modal.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => {
			el.style.display = el.dataset.panel === mode ? 'block' : 'none';
		});

		this.clearError();

		if (mode === 'wechat') {
			void this.startWechatLogin();
		}
	}

	// ─── WeChat ─────────────────────────────────────────────────────────────

	private async startWechatLogin(): Promise<void> {
		const statusEl = this.modal.querySelector<HTMLElement>('#wechat-status');
		const qrImg = this.modal.querySelector<HTMLImageElement>('#wechat-qr-img');
		const qrText = this.modal.querySelector<HTMLElement>('#wechat-qr-text');
		const testIdList = this.modal.querySelector<HTMLElement>('#wechat-test-id-list');

		if (statusEl) statusEl.textContent = '生成中…';
		if (qrText) qrText.textContent = '待扫码';
		if (testIdList) {
			testIdList.innerHTML = '';
			testIdList.style.display = 'none';
		}

		try {
			const data = await this.api.request<{ state: string; qrcode_url: string; stub?: boolean; test_ids?: string[] }>(
				'/auth/wechat/qrcode'
			);

			// In stub mode show a placeholder, in real mode use a QR library or img src trick
			if (qrImg) {
				if (data.stub) {
					qrImg.src = '/static/resource/qr-placeholder.svg';
					qrImg.alt = '[开发存根] 直接点击"模拟扫码"按钮';
				} else {
					// Real mode: encode qrcode_url as a QR code via a free API (no external JS needed)
					qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qrcode_url)}`;
				}
			}

			if (qrText) qrText.textContent = data.stub ? '开发存根模式' : '待扫码';
			if (statusEl) statusEl.textContent = '';

			// Show stub shortcut button if in stub mode
			const stubBtn = this.modal.querySelector<HTMLElement>('#wechat-stub-btn');
			if (stubBtn) stubBtn.style.display = data.stub ? 'block' : 'none';

			// Store state for stub button
			if (stubBtn) {
				stubBtn.textContent = '🔧 随机测试 ID 登录';
				stubBtn.onclick = () => {
					void this.simulateWechatScan(data.state);
				};
			}

			if (data.stub && Array.isArray(data.test_ids) && data.test_ids.length > 0 && testIdList) {
				if (statusEl) statusEl.textContent = '开发模式：点击测试 ID 模拟微信登录';
				testIdList.style.display = 'grid';
				for (const testId of data.test_ids) {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'login-test-id-item';
					button.textContent = testId;
					button.addEventListener('click', () => {
						void this.simulateWechatScan(data.state, testId);
					});
					testIdList.appendChild(button);
				}
			}

			this.startPolling(data.state);
		} catch (e) {
			if (statusEl) statusEl.textContent = '二维码加载失败，请刷新重试';
		}
	}

	private async simulateWechatScan(state: string, testId?: string): Promise<void> {
		const code = testId ?? ('stub_' + Math.random().toString(36).slice(2, 8));
		try {
			await fetch(`/api/v2/auth/wechat/callback?code=${code}&state=${state}`);
		} catch {
			// callback returns HTML page, fetch may "fail" due to content-type, that's ok
		}
	}

	private startPolling(state: string): void {
		this.pollTimer = window.setInterval(async () => {
			try {
				const result = await this.api.request<{
					done: boolean;
					token?: string;
					user_id?: string;
					username?: string;
					roles?: string[];
				}>(`/auth/wechat/poll?state=${state}`);

				if (result.done && result.token) {
					this.stopPolling();
					void this.onLoginSuccess({ token: result.token, user_id: result.user_id!, username: result.username!, roles: result.roles ?? [] });
				}
			} catch {
				// state expired or error — stop
				this.stopPolling();
			}
		}, 2000);
	}

	private stopPolling(): void {
		if (this.pollTimer !== null) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	// ─── Password ────────────────────────────────────────────────────────────

	private async submitPassword(): Promise<void> {
		const username = (this.modal.querySelector<HTMLInputElement>('#login-username'))?.value.trim() ?? '';
		const password = (this.modal.querySelector<HTMLInputElement>('#login-password'))?.value ?? '';

		if (!username) {
			this.showError('请输入用户名、user_id、member_no（学号/工号）或测试 ID');
			return;
		}

		try {
			const data = await this.api.request<{ token: string; user_id: string; username: string; roles: string[] }>(
				'/auth/login',
				{ method: 'POST', body: JSON.stringify({ username, password }) }
			);
			await this.onLoginSuccess(data);
		} catch (e) {
			this.showError((e as Error).message || '登录失败，请检查用户名和密码');
		}
	}

	// ─── Phone ───────────────────────────────────────────────────────────────

	private async sendPhoneCode(): Promise<void> {
		const phone = (this.modal.querySelector<HTMLInputElement>('#login-phone'))?.value.trim() ?? '';
		if (!phone) { this.showError('请输入手机号'); return; }

		const btn = this.modal.querySelector<HTMLButtonElement>('#login-btn-send-code');
		if (btn) btn.disabled = true;

		try {
			await this.api.request('/auth/phone/send-code', { method: 'POST', body: JSON.stringify({ phone }) });
			this.showError('验证码已发送（有效期10分钟）');
			let countdown = 60;
			const timer = setInterval(() => {
				if (btn) btn.textContent = `重新发送 (${--countdown}s)`;
				if (countdown <= 0) {
					clearInterval(timer);
					if (btn) { btn.disabled = false; btn.textContent = '发送验证码'; }
				}
			}, 1000);
		} catch (e) {
			if (btn) btn.disabled = false;
			this.showError((e as Error).message || '发送失败');
		}
	}

	private async submitPhone(): Promise<void> {
		const phone = (this.modal.querySelector<HTMLInputElement>('#login-phone'))?.value.trim() ?? '';
		const code = (this.modal.querySelector<HTMLInputElement>('#login-phone-code'))?.value.trim() ?? '';
		if (!phone || !code) { this.showError('请输入手机号和验证码'); return; }

		// Phone login: send-code + verify binds to guest then upgrades, or we treat it as registration
		// Here we do: login with phone if already registered, or register first
		try {
			// Try username=phone, password="" pattern via phone verify endpoint
			// The backend verify endpoint returns the full user object after binding
			const data = await this.api.request<{ token?: string; user_id?: string; username?: string; roles?: string[] }>(
				'/auth/phone/verify',
				{ method: 'POST', body: JSON.stringify({ user_id: 'guest', phone, code }) }
			);
			// After binding, do a proper login via phone-as-username pattern
			// For now, show success and reload so session is restored from profile
			this.showError('手机号绑定成功！请使用用户名登录');
			if (data.user_id) {
				// auto-login as the bound user if token available
				if (data.token) {
					await this.onLoginSuccess({ token: data.token, user_id: data.user_id, username: data.username ?? phone, roles: data.roles ?? [] });
				}
			}
		} catch (e) {
			this.showError((e as Error).message || '验证失败');
		}
	}

	// ─── Common ──────────────────────────────────────────────────────────────

	private async onLoginSuccess(payload: { token: string; user_id: string; username: string; roles: string[] }): Promise<void> {
		const context = (await this.api.getMeContext(payload.token)) as MeContext;
		const user = buildCurrentUser(context, payload.token);
		persistSession(user);
		this.store.setState({ user });
		this.close();
		(window as Window & {
			setUserContext?: (ctx: Record<string, unknown>) => void;
			__onLoginSuccess?: () => void;
		}).setUserContext?.(user as unknown as Record<string, unknown>);
		(window as Window & { __onLoginSuccess?: () => void }).__onLoginSuccess?.();
	}

	private showError(msg: string): void {
		const el = this.modal.querySelector<HTMLElement>('#login-error');
		if (el) { el.textContent = msg; el.style.display = 'block'; }
	}

	private clearError(): void {
		const el = this.modal.querySelector<HTMLElement>('#login-error');
		if (el) { el.textContent = ''; el.style.display = 'none'; }
	}
}
