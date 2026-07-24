type DialogTextOptions = {
	initialValue?: string;
	placeholder?: string;
	confirmText?: string;
	maxLength?: number;
};

function focusableElements(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
}

function createDialog(message: string, title: string): { overlay: HTMLDivElement; dialog: HTMLDivElement; previousFocus: HTMLElement | null } {
	const previousFocus = document.activeElement as HTMLElement | null;
	const overlay = document.createElement('div');
	overlay.className = 'app-dialog-overlay';
	overlay.setAttribute('role', 'presentation');
	const dialog = document.createElement('div');
	dialog.className = 'app-dialog';
	dialog.setAttribute('role', 'dialog');
	dialog.setAttribute('aria-modal', 'true');
	dialog.setAttribute('aria-labelledby', 'app-dialog-title');
	dialog.innerHTML = `<h2 id="app-dialog-title" class="app-dialog-title"></h2><div class="app-dialog-message"></div>`;
	(dialog.querySelector('.app-dialog-title') as HTMLElement).textContent = title;
	(dialog.querySelector('.app-dialog-message') as HTMLElement).textContent = message;
	overlay.appendChild(dialog);
	document.body.appendChild(overlay);
	return { overlay, dialog, previousFocus };
}

function bindDialogKeyboard(overlay: HTMLElement, dialog: HTMLElement, close: () => void): () => void {
	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = focusableElements(dialog);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	};
	overlay.addEventListener('keydown', onKeydown);
	return () => overlay.removeEventListener('keydown', onKeydown);
}

export function requestAppConfirmation(message: string, confirmText = '确认', title = '请确认操作'): Promise<boolean> {
	return new Promise((resolve) => {
		const { overlay, dialog, previousFocus } = createDialog(message, title);
		const actions = document.createElement('div');
		actions.className = 'app-dialog-actions';
		actions.innerHTML = '<button type="button" class="app-dialog-secondary" data-app-dialog-cancel>取消</button><button type="button" class="app-dialog-primary" data-app-dialog-confirm></button>';
		const cancel = actions.querySelector<HTMLButtonElement>('[data-app-dialog-cancel]')!;
		const confirm = actions.querySelector<HTMLButtonElement>('[data-app-dialog-confirm]')!;
		confirm.textContent = confirmText;
		dialog.appendChild(actions);
		let finished = false;
		let unbind = () => {};
		const finish = (accepted: boolean) => {
			if (finished) return;
			finished = true;
			unbind();
			overlay.remove();
			if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
			resolve(accepted);
		};
		unbind = bindDialogKeyboard(overlay, dialog, () => finish(false));
		cancel.addEventListener('click', () => finish(false));
		confirm.addEventListener('click', () => finish(true));
		overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
		cancel.focus();
	});
}

export function requestAppText(message: string, options: DialogTextOptions = {}): Promise<string | null> {
	return new Promise((resolve) => {
		const { overlay, dialog, previousFocus } = createDialog(message, '请输入信息');
		const form = document.createElement('form');
		form.className = 'app-dialog-form';
		form.innerHTML = '<input class="app-dialog-input" type="text" /><div class="app-dialog-field-error" role="alert" hidden></div><div class="app-dialog-actions"><button type="button" class="app-dialog-secondary" data-app-dialog-cancel>取消</button><button type="submit" class="app-dialog-primary" data-app-dialog-confirm></button></div>';
		const input = form.querySelector<HTMLInputElement>('.app-dialog-input')!;
		const error = form.querySelector<HTMLElement>('.app-dialog-field-error')!;
		const cancel = form.querySelector<HTMLButtonElement>('[data-app-dialog-cancel]')!;
		const confirm = form.querySelector<HTMLButtonElement>('[data-app-dialog-confirm]')!;
		input.value = options.initialValue || '';
		input.placeholder = options.placeholder || '';
		if (options.maxLength) input.maxLength = options.maxLength;
		confirm.textContent = options.confirmText || '确定';
		dialog.appendChild(form);
		let finished = false;
		let unbind = () => {};
		const finish = (value: string | null) => {
			if (finished) return;
			finished = true;
			unbind();
			overlay.remove();
			if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
			resolve(value);
		};
		unbind = bindDialogKeyboard(overlay, dialog, () => finish(null));
		cancel.addEventListener('click', () => finish(null));
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			const value = input.value.trim();
			if (!value) { error.textContent = '请输入内容'; error.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
			finish(value);
		});
		overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(null); });
		input.focus();
		input.select();
	});
}

export function showAppToast(message: string, tone: 'info' | 'success' | 'error' = 'info'): void {
	let toast = document.getElementById('app-toast') as HTMLDivElement | null;
	if (!toast) {
		toast = document.createElement('div');
		toast.id = 'app-toast';
		toast.className = 'app-toast';
		toast.setAttribute('role', 'status');
		toast.setAttribute('aria-live', 'polite');
		document.body.appendChild(toast);
	}
	toast.dataset.tone = tone;
	toast.textContent = message;
	toast.classList.add('app-toast-visible');
	window.clearTimeout(Number(toast.dataset.timer || 0));
	toast.dataset.timer = String(window.setTimeout(() => toast?.classList.remove('app-toast-visible'), 2800));
}
