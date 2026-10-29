/** Accepted work is serialized and drained before a document closes. */
export class DocumentTasks {
    pending = new Set();
    closing = false;
    tail = Promise.resolve();
    run(operation) {
        if (this.closing)
            return Promise.reject(new Error('Редактор закрывается. Отмените закрытие и повторите действие.'));
        const task = this.tail.then(operation, operation);
        this.tail = task.catch(() => { });
        this.pending.add(task);
        const remove = () => { this.pending.delete(task); };
        task.then(remove, remove);
        return task;
    }
    async idle() {
        while (this.pending.size)
            await Promise.allSettled([...this.pending]);
    }
}
