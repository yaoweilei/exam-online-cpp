/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Yaoweilei. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function renderOutlineIcon(name: string, className = ''): string {
	const cls = className ? ` class="${className}"` : '';
	const svg = (paths: string) =>
		`<svg${cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
	switch (name) {
		case 'wallet':
			return svg('<path d="M4 8.5h16v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><path d="M7 8V6.8A1.8 1.8 0 0 1 8.8 5h9.2"/><path d="M20 11.5h-4.2a1.8 1.8 0 1 0 0 3.6H20"/>');
		case 'gift':
			return svg('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8v12"/><path d="M4 12h16"/><path d="M12 8c0-2-1-3-2.6-3-1.3 0-2.2.9-2.2 2.1 0 1.2.9 1.9 2.8 1.9H12Z"/><path d="M12 8c0-2 1-3 2.6-3 1.3 0 2.2.9 2.2 2.1 0 1.2-.9 1.9-2.8 1.9H12Z"/>');
		case 'ticket':
			return svg('<path d="M6 7.5h12A1.5 1.5 0 0 1 19.5 9v2a2 2 0 0 0 0 4v2a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 17v-2a2 2 0 0 0 0-4V9A1.5 1.5 0 0 1 6 7.5Z"/><path d="M12 9v2"/><path d="M12 13v2"/>');
		case 'community':
			return svg('<path d="M5 8.5A3.5 3.5 0 0 1 8.5 5h7A3.5 3.5 0 0 1 19 8.5v4a3.5 3.5 0 0 1-3.5 3.5H11l-3.8 3v-3H8.5A3.5 3.5 0 0 1 5 12.5Z"/><path d="M12 8.5v4"/><path d="M10 10.5h4"/>');
		case 'folder':
			return svg('<path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h3l1.6 2H17a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5Z"/>');
		case 'badge':
			return svg('<circle cx="12" cy="8" r="3"/><path d="M9 16.5h6"/><path d="M7 19l3-1.5 2-5"/><path d="M17 19l-3-1.5-2-5"/>');
		case 'chart':
			return svg('<path d="M5 18.5h14"/><path d="M7.5 15.5v-3"/><path d="M12 15.5v-6"/><path d="M16.5 15.5v-8"/><path d="M7.5 12.5 12 9.5 16.5 7.5"/>');
		case 'clock':
			return svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.4l3 1.8"/>');
		case 'heart':
			return svg('<path d="M19.2 6.9c-1.6-1.7-4.1-1.7-5.7 0L12 8.4l-1.5-1.5c-1.6-1.7-4.1-1.7-5.7 0-1.7 1.8-1.7 4.6 0 6.3L12 20l7.2-6.8c1.7-1.7 1.7-4.5 0-6.3Z"/>');
		case 'settings':
			return svg('<circle cx="12" cy="12" r="3"/><path d="M12 4.5v2"/><path d="M12 17.5v2"/><path d="M4.5 12h2"/><path d="M17.5 12h2"/><path d="M6.7 6.7l1.4 1.4"/><path d="M15.9 15.9l1.4 1.4"/><path d="M17.3 6.7l-1.4 1.4"/><path d="M8.1 15.9l-1.4 1.4"/>');
		case 'brandMark':
			return svg('<path d="M6 17.8V6.2"/><path d="M6 6.2c2.3 2.1 3.8 4.2 4.6 6.2"/><path d="M10.6 12.4c.9-2.5 2.4-4.6 4.5-6.2"/><path d="M15.1 6.2v11.6"/><path d="M7.8 17.8h5.8"/><path d="M16.9 6.4 18.2 5"/><path d="M17.2 6.7 19 6.4"/>');
		case 'login':
			return svg('<circle cx="10" cy="8" r="3"/><path d="M4.8 18.2c1.5-2.8 3.3-4.2 5.2-4.2 1.3 0 2.5.5 3.6 1.6"/><path d="M14.5 12h5"/><path d="M17 9.5 19.5 12 17 14.5"/>');
		case 'book':
			// 错题本图标（业务功能 1）
			return svg('<path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8.5A3.5 3.5 0 0 1 5 16Z"/><path d="M8.5 8.5h6"/><path d="M8.5 12h4"/>');
		case 'profileMark':
		default:
			return svg('<circle cx="12" cy="8" r="3.2"/><path d="M5.5 18.5c1.6-3 3.8-4.5 6.5-4.5s4.9 1.5 6.5 4.5"/>');
		case 'book':
			// 错题本图标（业务功能 1）
			return svg('<path d="M5 4.5h9.5A3.5 3.5 0 0 1 18 8v11.5H8.5A3.5 3.5 0 0 1 5 16Z"/><path d="M8.5 8.5h6"/><path d="M8.5 12h4"/>');
	}
}
