import { ApiClient } from '../api/client.js';
import type { MeContext } from '../api/dto.js';
import { buildCurrentUser, persistSession, readPendingReferralCode, clearPendingReferralCode } from './session.js';
import { AppStore } from '../state/store.js';
import { requestAppConfirmation, showAppToast } from '../ui/dialogs.js';

type LoginMode = 'wechat' | 'phone' | 'password';
const LAST_LOGIN_PHONE_KEY = 'exam_v2_last_login_phone';
const DEVELOPMENT_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export class LoginModal {
	private modal: HTMLElement;
	private currentMode: LoginMode = 'phone';
	private pollTimer: number | null = null;
	private previousFocus: HTMLElement | null = null;
	private api: ApiClient;
	private store: AppStore;

	constructor(api: ApiClient, store: AppStore) {
		this.api = api;
		this.store = store;
		this.modal = document.getElementById('login-modal')!;
		this.setupDevelopmentUsers();
		this.bindEvents();
		window.addEventListener('resize', () => this.updateLoginScale());
	}

	open(): void {
		this.previousFocus = document.activeElement as HTMLElement | null;
		this.prefillLastLoginPhone();
		this.modal.classList.add('active');
		this.modal.setAttribute('aria-hidden', 'false');
		this.switchMode(this.currentMode);
		this.updateLoginScale();
		requestAnimationFrame(() => { this.updateLoginScale(); this.focusInitialControl(); });
	}

	close(): void {
		this.stopPolling();
		this.modal.classList.remove('active');
		this.modal.setAttribute('aria-hidden', 'true');
		if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
	}

	private bindEvents(): void {
		// Close on backdrop click
		this.modal.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).id === 'login-modal') this.close();
		});
		this.modal.querySelector('[data-login-close]')?.addEventListener('click', () => {
			this.close();
		});
		this.modal.addEventListener('keydown', (event) => {
			if (!this.modal.classList.contains('active') || document.querySelector('.app-dialog-overlay')) return;
			if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
			if (event.key !== 'Tab') return;
			const focusable = Array.from(this.modal.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
				.filter((element) => element.offsetParent !== null);
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		});

		// Mode switch buttons
		this.modal.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => {
			el.addEventListener('click', () => {
				const mode = el.dataset.mode as LoginMode;
				if (mode === 'wechat') {
					void this.handleWechatEntry();
					return;
				}
				this.switchMode(mode);
			});
		});
		this.modal.querySelectorAll<HTMLElement>('[data-login-phone-back]').forEach((el) => {
			el.addEventListener('click', () => this.switchMode('phone'));
		});
		this.modal.querySelectorAll<HTMLButtonElement>('[data-password-view]').forEach((button) => {
			button.addEventListener('click', () => this.switchPasswordView(button.dataset.passwordView || 'login'));
		});
		this.modal.querySelectorAll<HTMLButtonElement>('[data-oauth]').forEach((btn) => {
			btn.addEventListener('click', () => {
				if (!this.ensureAgreementAccepted()) return;
				const provider = btn.dataset.oauth || '';
				if (!provider) return;
				window.location.href = `/api/v1/auth/oauth/${encodeURIComponent(provider)}/start`;
			});
		});

		// Password login form
		this.modal.querySelector('#login-btn-password')?.addEventListener('click', () => {
			void this.submitPassword();
		});
		this.modal.querySelector<HTMLButtonElement>('#login-password-toggle')?.addEventListener('click', () => {
			this.togglePasswordVisibility();
		});
		this.modal.querySelector('#login-btn-register')?.addEventListener('click', () => void this.submitRegistration());
		this.modal.querySelector('#login-btn-reset-send-code')?.addEventListener('click', () => void this.sendPasswordResetCode());
		this.modal.querySelector('#login-btn-reset-password')?.addEventListener('click', () => void this.submitPasswordReset());

		// Phone send code
		this.modal.querySelector('#login-btn-send-code')?.addEventListener('click', () => {
			void this.sendPhoneCode();
		});
		this.modal.querySelector<HTMLInputElement>('#login-phone')?.addEventListener('input', () => {
			this.syncPhoneInputs('phone');
			this.updatePhoneSendButtonState();
		});
		this.modal.querySelector<HTMLInputElement>('#login-password-phone')?.addEventListener('input', () => this.clearError());
		this.modal.querySelector<HTMLInputElement>('#login-agreement')?.addEventListener('change', () => {
			this.updatePhoneSendButtonState();
			this.clearError();
		});

		// Phone verify
		this.modal.querySelector('#login-btn-phone-verify')?.addEventListener('click', () => {
			void this.submitPhone();
		});

		this.modal.querySelectorAll<HTMLButtonElement>('[data-dev-login]').forEach((btn) => {
			btn.addEventListener('click', () => {
				void this.loginWithDevelopmentUser(btn.dataset.devLogin || '');
			});
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
			el.classList.toggle('is-active', el.dataset.panel === mode);
		});

		this.clearError();
		this.modal.classList.toggle('login-mode-phone', mode === 'phone');
		this.modal.classList.toggle('login-mode-password', mode === 'password');
		this.modal.classList.toggle('login-mode-wechat', mode === 'wechat');

		if (mode === 'wechat') {
			void this.startWechatLogin();
		}
		this.prefillLastLoginPhone();
		this.updatePhoneSendButtonState();
		this.updateLoginScale();
	}

	private focusInitialControl(): void {
		const selector = this.currentMode === 'password'
			? '#login-password-phone'
			: this.currentMode === 'wechat'
				? '#wechat-test-id-list button, .login-back-phone'
				: '#login-phone';
		this.modal.querySelector<HTMLElement>(selector)?.focus();
	}

	private beginLoginAction(button: HTMLButtonElement | null, busyLabel: string): (() => void) | null {
		if (!button) return () => {};
		if (button.disabled) return null;
		const label = button.textContent || '';
		button.disabled = true;
		button.setAttribute('aria-busy', 'true');
		button.textContent = busyLabel;
		return () => {
			button.disabled = false;
			button.removeAttribute('aria-busy');
			button.textContent = label;
		};
	}

	private updateLoginScale(): void {
		const box = this.modal.querySelector<HTMLElement>('.login-box');
		if (!box) return;
		const width = box.getBoundingClientRect().width;
		if (width <= 0) return;
		box.style.setProperty('--login-scale', `${width / 1170}px`);
	}

	private updatePhoneSendButtonState(): void {
		const input = this.modal.querySelector<HTMLInputElement>('#login-phone');
		const btn = this.modal.querySelector<HTMLButtonElement>('#login-btn-send-code');
		if (!btn || btn.dataset.counting === '1') return;
		const phoneDigits = (input?.value ?? '').replace(/\D/g, '');
		btn.disabled = phoneDigits.length !== 11 || !this.isAgreementAccepted();
	}

	private isAgreementAccepted(): boolean {
		return Boolean(this.modal.querySelector<HTMLInputElement>('#login-agreement')?.checked);
	}

	private ensureAgreementAccepted(): boolean {
		if (this.isAgreementAccepted()) return true;
		this.showError('请先阅读并同意《用户协议》和《隐私政策》');
		this.modal.querySelector<HTMLInputElement>('#login-agreement')?.focus();
		return false;
	}

	private readLastLoginPhone(): string {
		try {
			return (localStorage.getItem(LAST_LOGIN_PHONE_KEY) || '').replace(/\D/g, '');
		} catch {
			return '';
		}
	}

	private rememberLoginPhone(phone: string): void {
		const normalized = phone.replace(/\D/g, '');
		if (!normalized) return;
		try {
			localStorage.setItem(LAST_LOGIN_PHONE_KEY, normalized);
		} catch {
			// Ignore storage failures and keep login flow unaffected.
		}
	}

	private prefillLastLoginPhone(): void {
		const savedPhone = this.readLastLoginPhone();
		if (!savedPhone) return;
		const phoneInput = this.modal.querySelector<HTMLInputElement>('#login-phone');
		const passwordPhoneInput = this.modal.querySelector<HTMLInputElement>('#login-password-phone');
		if (phoneInput && !phoneInput.value.trim()) phoneInput.value = savedPhone;
		if (passwordPhoneInput && !passwordPhoneInput.value.trim()) passwordPhoneInput.value = savedPhone;
	}

	private syncPhoneInputs(source: 'phone' | 'password'): void {
		const phoneInput = this.modal.querySelector<HTMLInputElement>('#login-phone');
		const passwordPhoneInput = this.modal.querySelector<HTMLInputElement>('#login-password-phone');
		if (!phoneInput || !passwordPhoneInput) return;
		if (source === 'phone') {
			passwordPhoneInput.value = phoneInput.value.replace(/\D/g, '');
		} else {
			phoneInput.value = passwordPhoneInput.value.replace(/\D/g, '');
		}
	}

	private isDevelopmentHost(): boolean {
		const host = window.location.hostname;
		return DEVELOPMENT_HOSTS.has(host);
	}

	private setupDevelopmentUsers(): void {
		const devUsers = this.modal.querySelector<HTMLElement>('#login-dev-users');
		if (!devUsers) return;
		devUsers.hidden = !this.isDevelopmentHost();
	}

	private isMobileWechatLogin(): boolean {
		const ua = navigator.userAgent || '';
		return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
	}

	private async handleWechatEntry(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		if (!this.isMobileWechatLogin()) {
			this.switchMode('wechat');
			return;
		}
		const ok = await requestAppConfirmation('将打开微信完成授权登录。', '打开微信');
		if (!ok) return;
		try {
			const data = await this.api.request<{ auth_url?: string; qrcode_url?: string }>('/auth/wechat/authorize');
			const authUrl = data.auth_url || data.qrcode_url || '';
			if (!authUrl) {
				this.showError('微信授权地址生成失败，请稍后重试');
				return;
			}
			window.location.href = authUrl;
		} catch (e) {
			this.showError((e as Error).message || '微信授权暂时不可用，请使用手机号登录');
		}
	}

	// ─── WeChat ─────────────────────────────────────────────────────────────

	private async startWechatLogin(): Promise<void> {
		const statusEl = this.modal.querySelector<HTMLElement>('#wechat-status');
		const qrWrapper = this.modal.querySelector<HTMLElement>('#wechat-qr-wrapper');
		const qrImg = this.modal.querySelector<HTMLImageElement>('#wechat-qr-img');
		const qrText = this.modal.querySelector<HTMLElement>('#wechat-qr-text');
		const testIdList = this.modal.querySelector<HTMLElement>('#wechat-test-id-list');

		if (statusEl) statusEl.textContent = '生成中…';
		if (qrText) qrText.textContent = '待扫码';
		if (qrWrapper) qrWrapper.style.display = 'flex';
		if (testIdList) { testIdList.hidden = true; testIdList.replaceChildren(); }

		try {
			const data = await this.api.request<{ state: string; qrcode_url: string; stub?: boolean; test_ids?: string[] }>(
				'/auth/wechat/qrcode'
			);

			// In stub mode show a placeholder, in real mode use a QR library or img src trick
			if (qrImg) {
				if (data.stub) {
					qrImg.src = '';
					qrImg.alt = '微信登录未配置';
					if (qrWrapper) qrWrapper.style.display = 'none';
				} else {
					// Real mode: encode qrcode_url as a QR code via a free API (no external JS needed)
					qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qrcode_url)}`;
				}
			}

			if (qrText) qrText.textContent = data.stub ? '微信登录未配置' : '请使用微信扫码登录';
			if (statusEl) statusEl.textContent = data.stub ? '本地开发环境请使用下方测试账号，或配置 WECHAT_APP_ID 后使用正式微信登录。' : '';
			if (testIdList && data.stub && Array.isArray(data.test_ids) && data.test_ids.length > 0) {
				data.test_ids.forEach((loginId) => {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'login-test-id-item';
					button.textContent = loginId;
					button.addEventListener('click', () => void this.loginWithDevelopmentUser(loginId));
					testIdList.appendChild(button);
				});
				testIdList.hidden = false;
			}

			if (!data.stub) {
				this.startPolling(data.state);
			}
		} catch (e) {
			if (statusEl) statusEl.textContent = '二维码加载失败，请刷新重试';
		}
	}

	private async loginWithDevelopmentUser(loginId: string): Promise<void> {
		const statusEl = this.modal.querySelector<HTMLElement>('#wechat-status');
		const safeLoginId = loginId.trim();

		if (!safeLoginId) {
			this.showError('测试 ID 不能为空');
			return;
		}

		this.stopPolling();
		this.clearError();
		if (statusEl) statusEl.textContent = `正在登录 ${safeLoginId}...`;
		const sourceButton = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
		const finishAction = this.beginLoginAction(sourceButton, '登录中…');
		if (!finishAction) return;

		try {
			const data = await this.api.request<{ token: string; user_id: string; username: string; roles: string[] }>(
				'/auth/login',
				{ method: 'POST', body: JSON.stringify({ username: safeLoginId, password: '' }) }
			);
			if (statusEl) statusEl.textContent = '';
			await this.onLoginSuccess(data);
		} catch (e) {
			if (statusEl) statusEl.textContent = '';
			this.showError((e as Error).message || '测试 ID 登录失败');
		} finally { finishAction(); }
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

	private togglePasswordVisibility(): void {
		const input = this.modal.querySelector<HTMLInputElement>('#login-password');
		const button = this.modal.querySelector<HTMLButtonElement>('#login-password-toggle');
		if (!input || !button) return;
		const visible = input.type === 'text';
		input.type = visible ? 'password' : 'text';
		button.classList.toggle('is-visible', !visible);
		button.setAttribute('aria-pressed', String(!visible));
		button.setAttribute('aria-label', visible ? '显示密码' : '隐藏密码');
	}

	private switchPasswordView(view: string): void {
		this.modal.querySelectorAll<HTMLElement>('[data-password-panel]').forEach((panel) => {
			panel.classList.toggle('is-active', panel.dataset.passwordPanel === view);
		});
		this.clearError();
	}

	private async submitPassword(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const loginId = (this.modal.querySelector<HTMLInputElement>('#login-password-phone'))?.value.trim() ?? '';
		const password = (this.modal.querySelector<HTMLInputElement>('#login-password'))?.value ?? '';

		if (!loginId) {
			this.showError('请输入手机号、用户名或邮箱');
			return;
		}
		const submitButton = this.modal.querySelector<HTMLButtonElement>('#login-btn-password');
		const finishAction = this.beginLoginAction(submitButton, '登录中…');
		if (!finishAction) return;

		try {
			const data = await this.api.request<{ token?: string; user_id: string; username: string; roles: string[] }>(
				'/auth/login',
				{ method: 'POST', body: JSON.stringify({ username: loginId, password }) }
			);
			if (/^\d{11}$/.test(loginId)) this.rememberLoginPhone(loginId);
			await this.onLoginSuccess(data);
		} catch (e) {
			this.showError((e as Error).message || '登录失败，请检查手机号和密码');
		} finally { finishAction(); }
	}

	private async submitRegistration(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const username = this.modal.querySelector<HTMLInputElement>('#register-username')?.value.trim() || '';
		const email = this.modal.querySelector<HTMLInputElement>('#register-email')?.value.trim() || '';
		const password = this.modal.querySelector<HTMLInputElement>('#register-password')?.value || '';
		const confirmation = this.modal.querySelector<HTMLInputElement>('#register-password-confirm')?.value || '';
		if (!username || !email) { this.showError('请输入用户名和邮箱'); return; }
		if (password !== confirmation) { this.showError('两次输入的密码不一致'); return; }
		const button = this.modal.querySelector<HTMLButtonElement>('#login-btn-register');
		const finish = this.beginLoginAction(button, '注册中…'); if (!finish) return;
		try {
			const data = await this.api.request<{ token?: string; user_id: string; username: string; roles: string[] }>('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, referral_code: readPendingReferralCode() }) });
			await this.onLoginSuccess(data);
		} catch (e) { this.showError((e as Error).message || '注册失败'); } finally { finish(); }
	}

	private async sendPasswordResetCode(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const loginId = this.modal.querySelector<HTMLInputElement>('#reset-login-id')?.value.trim() || '';
		if (!loginId) { this.showError('请输入账号'); return; }
		const button = this.modal.querySelector<HTMLButtonElement>('#login-btn-reset-send-code');
		const finish = this.beginLoginAction(button, '发送中…'); if (!finish) return;
		try { await this.api.request('/auth/password/reset/send-code', { method: 'POST', body: JSON.stringify({ login_id: loginId }) }); this.showError('验证码已发送'); }
		catch (e) { this.showError((e as Error).message || '验证码发送失败'); } finally { finish(); }
	}

	private async submitPasswordReset(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const loginId = this.modal.querySelector<HTMLInputElement>('#reset-login-id')?.value.trim() || '';
		const code = this.modal.querySelector<HTMLInputElement>('#reset-code')?.value.trim() || '';
		const newPassword = this.modal.querySelector<HTMLInputElement>('#reset-new-password')?.value || '';
		if (!loginId || !code || !newPassword) { this.showError('请填写账号、验证码和新密码'); return; }
		const button = this.modal.querySelector<HTMLButtonElement>('#login-btn-reset-password');
		const finish = this.beginLoginAction(button, '重置中…'); if (!finish) return;
		try {
			const data = await this.api.request<{ token?: string; user_id: string; username: string; roles: string[] }>('/auth/password/reset', { method: 'POST', body: JSON.stringify({ login_id: loginId, code, new_password: newPassword }) });
			await this.onLoginSuccess(data);
		} catch (e) { this.showError((e as Error).message || '密码重置失败'); } finally { finish(); }
	}

	// ─── Phone ───────────────────────────────────────────────────────────────

	private async sendPhoneCode(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const phone = (this.modal.querySelector<HTMLInputElement>('#login-phone'))?.value.trim() ?? '';
		const phoneDigits = phone.replace(/\D/g, '');
		if (phoneDigits.length !== 11) { this.showError('请输入 11 位手机号'); return; }

		const btn = this.modal.querySelector<HTMLButtonElement>('#login-btn-send-code');
		if (btn) {
			btn.disabled = true;
			btn.dataset.counting = '1';
			btn.setAttribute('aria-busy', 'true');
			btn.textContent = '发送中…';
		}

		try {
			const normalizedPhone = phoneDigits;
			await this.api.request('/auth/phone/send-code', { method: 'POST', body: JSON.stringify({ phone: normalizedPhone }) });
			this.rememberLoginPhone(normalizedPhone);
			this.showError('验证码已发送（有效期10分钟）');
			btn?.removeAttribute('aria-busy');
			this.modal.classList.add('login-phone-code-sent');
			let countdown = 60;
			const timer = setInterval(() => {
				if (btn) btn.textContent = `重新发送 (${--countdown}s)`;
				if (countdown <= 0) {
					clearInterval(timer);
					if (btn) {
						btn.textContent = '发送验证码';
						delete btn.dataset.counting;
					}
					this.updatePhoneSendButtonState();
				}
			}, 1000);
		} catch (e) {
			if (btn) {
				delete btn.dataset.counting;
				btn.removeAttribute('aria-busy');
				btn.textContent = '发送验证码';
				this.updatePhoneSendButtonState();
			}
			this.showError((e as Error).message || '发送失败');
		}
	}

	private async submitPhone(): Promise<void> {
		if (!this.ensureAgreementAccepted()) return;
		const phone = (this.modal.querySelector<HTMLInputElement>('#login-phone'))?.value.trim() ?? '';
		const phoneDigits = phone.replace(/\D/g, '');
		const code = (this.modal.querySelector<HTMLInputElement>('#login-phone-code'))?.value.trim() ?? '';
		if (phoneDigits.length !== 11 || !code) { this.showError('请输入手机号和验证码'); return; }
		const submitButton = this.modal.querySelector<HTMLButtonElement>('#login-btn-phone-verify');
		const finishAction = this.beginLoginAction(submitButton, '登录中…');
		if (!finishAction) return;

		// Phone login: new users are created by verification, existing users are signed in.
		try {
			// Try username=phone, password="" pattern via phone verify endpoint
			// The backend verify endpoint returns the full user object after binding
			const data = await this.api.request<{ token?: string; user_id?: string; username?: string; roles?: string[] }>(
				'/auth/phone/verify',
				{ method: 'POST', body: JSON.stringify({ user_id: 'guest', phone: phoneDigits, code }) }
			);
			if (data.user_id) {
				this.rememberLoginPhone(phoneDigits);
				await this.onLoginSuccess({ token: data.token, user_id: data.user_id, username: data.username ?? phoneDigits, roles: data.roles ?? [] });
				return;
			}
			this.showError('手机号验证成功，但没有返回登录凭证，请刷新后重试');
		} catch (e) {
			this.showError((e as Error).message || '验证失败');
		} finally { finishAction(); }
	}

	// ─── Common ──────────────────────────────────────────────────────────────

	private async onLoginSuccess(payload: { token?: string; user_id: string; username: string; roles: string[] }): Promise<void> {
		const compatibilityToken = payload.token || '';
		let context = (await this.api.getMeContext(compatibilityToken)) as MeContext;
		const pendingReferralCode = readPendingReferralCode();
		const hasReferrer = Boolean(context.user?.referral?.hasReferrer ?? context.user?.referral?.has_referrer);
		const ownReferralCode = (context.user?.referral?.code || context.user?.referral?.referral_code || '').trim().toUpperCase();
		if (pendingReferralCode) {
			if (hasReferrer || (ownReferralCode && ownReferralCode === pendingReferralCode)) {
				clearPendingReferralCode();
			} else {
				try {
					await this.api.claimReferralCode(compatibilityToken, pendingReferralCode);
					clearPendingReferralCode();
					context = (await this.api.getMeContext(compatibilityToken)) as MeContext;
				} catch {
					// Keep the pending code for a later eligible sign-in.
				}
			}
		}
		const user = buildCurrentUser(context, compatibilityToken);
		const shouldPromptPhoneBinding = this.currentMode === 'wechat' && !user.phone_verified;
		if (user.phone) this.rememberLoginPhone(user.phone);
		persistSession(user);
		this.store.setState({ user });
		this.close();
		(window as Window & {
			setUserContext?: (ctx: Record<string, unknown>) => void;
			openPersonalCenter?: () => void;
			__onLoginSuccess?: () => void;
		}).setUserContext?.(user as unknown as Record<string, unknown>);
		(window as Window & { __onLoginSuccess?: () => void }).__onLoginSuccess?.();
		if (shouldPromptPhoneBinding) {
			window.setTimeout(() => {
				(window as Window & { openPersonalCenter?: () => void }).openPersonalCenter?.();
				showAppToast('微信登录需要绑定手机号，请在个人中心的“个人信息”里完成手机号验证。', 'info');
			}, 250);
		}
	}

	private showError(msg: string): void {
		const el = this.modal.querySelector<HTMLElement>('#login-error');
		if (el) {
			el.textContent = msg;
			el.style.display = 'block';
			el.classList.add('has-message');
		}
	}

	private clearError(): void {
		const el = this.modal.querySelector<HTMLElement>('#login-error');
		if (el) {
			el.textContent = '';
			el.style.display = 'block';
			el.classList.remove('has-message');
		}
	}
}
