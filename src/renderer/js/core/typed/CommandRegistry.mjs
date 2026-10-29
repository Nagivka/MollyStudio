export class CommandRegistry {
    context;
    notify;
    commands = new Map();
    pending = new Map();
    constructor(context, notify = () => { }) {
        this.context = context;
        this.notify = notify;
    }
    register(id, definition) {
        if (!id || this.commands.has(id))
            throw Error('Duplicate command: ' + id);
        this.commands.set(id, definition);
        return () => this.commands.delete(id);
    }
    has(id) { return this.commands.has(id); }
    execute(id) {
        const definition = this.commands.get(id);
        if (!definition)
            throw Error('Unknown command: ' + id);
        const context = this.context(), start = performance.now(), pendingKey = id + "\0" + (context.projectId ?? "");
        if (context.closing || definition.enabled?.(context) === false) {
            this.notify({ id, state: 'blocked', durationMs: 0 });
            return false;
        }
        if (definition.exclusive && this.pending.has(pendingKey))
            return this.pending.get(pendingKey);
        const done = (state) => this.notify({ id, state, durationMs: performance.now() - start });
        try {
            const result = definition.run();
            if (result && typeof result.then === 'function') {
                const task = Promise.resolve(result).then(value => { done('done'); return value; }, error => { done('error'); throw error; });
                this.pending.set(pendingKey, task);
                const clear = () => {
                    if (this.pending.get(pendingKey) === task)
                        this.pending.delete(pendingKey);
                };
                task.then(clear, clear);
                return task;
            }
            done('done');
            return result;
        }
        catch (error) {
            done('error');
            throw error;
        }
    }
}
