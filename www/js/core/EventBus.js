export default class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(event, callback) {
        if (typeof callback !== 'function') throw new TypeError('Event listener must be a function');
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (!callbacks) return;
        callbacks.delete(callback);
        if (!callbacks.size) this.listeners.delete(event);
    }

    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (!callbacks) return;
        [...callbacks].forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(err);
            }
        });
    }
}
