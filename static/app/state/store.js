export class AppStore {
    state = {
        user: { guest: true },
        examsByLevel: {},
        currentLevel: 'N1'
    };
    listeners = new Set();
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    getState() {
        return this.state;
    }
    setState(patch) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((listener) => listener(this.state));
    }
}
//# sourceMappingURL=store.js.map