export interface CommandContext {
    projectType: string | null;
    projectId?: string | null;
    closing: boolean;
}
export type CommandHandler = () => unknown;
export interface CommandDefinition {
    run: CommandHandler;
    enabled?: (context: CommandContext) => boolean;
    exclusive?: boolean;
}
export interface CommandEvent {
    id: string;
    state: 'done' | 'error' | 'blocked';
    durationMs: number;
}
export class CommandRegistry {
    private readonly commands = new Map<string, CommandDefinition>();
    private readonly pending = new Map<string, Promise<unknown>>();
    constructor(private readonly context: () => CommandContext, private readonly notify: (event: CommandEvent) => void = () => { }) { }
    register(id: string, definition: CommandDefinition): () => void {
        if (!id || this.commands.has(id))
            throw Error('Duplicate command: ' + id);
        this.commands.set(id, definition);
        return () => this.commands.delete(id);
    }
    has(id: string): boolean { return this.commands.has(id); }
    execute(id: string): unknown {
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
        const done = (state: CommandEvent['state']) => this.notify({ id, state, durationMs: performance.now() - start });
        try {
            const result = definition.run();
            if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
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
