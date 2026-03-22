const USER_KEY = 'exam_v2_user';
const TOKEN_KEY = 'exam_v2_token';
export function restoreSession(store) {
    try {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw)
            return;
        const user = JSON.parse(raw);
        store.setState({ user: { ...user, guest: false } });
    }
    catch {
        // ignore invalid local cache
    }
}
export function persistSession(payload) {
    localStorage.setItem(USER_KEY, JSON.stringify(payload));
    const token = payload.token ?? '';
    localStorage.setItem(TOKEN_KEY, token);
}
export function clearSession(store) {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    store.setState({ user: { guest: true } });
}
//# sourceMappingURL=session.js.map