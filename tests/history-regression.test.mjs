import test from 'node:test';
import assert from 'node:assert/strict';
import History from '../www/js/core/History.js';

class Bus {
    listeners = new Map();
    on(name, listener) {
        const list = this.listeners.get(name) || [];
        list.push(listener);
        this.listeners.set(name, list);
    }
    emit(name, value) {
        for (const listener of this.listeners.get(name) || []) listener(value);
    }
}

function command(bytes, undo = () => {}, execute = () => {}) {
    return {
        beforeData: { data: new Uint8ClampedArray(bytes / 2) },
        afterData: { data: new Uint8ClampedArray(bytes / 2) },
        undo,
        execute
    };
}

test('history uses a byte budget in addition to its action count', () => {
    const history = new History(new Bus());
    history.memoryBudgetBytes = 32;
    history.push(command(16));
    history.push(command(16));
    history.push(command(16));
    assert.equal(history.undoStack.length, 2);
    assert.equal(history.getUndoMemoryBytes(), 32);
});

test('failed undo and redo keep the action on its original stack', () => {
    const history = new History(new Bus());
    history.push(command(8, () => { throw new Error('undo failed'); }));
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
        assert.equal(history.undo(), false);
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);

    const redoHistory = new History(new Bus());
    redoHistory.push(command(8));
    assert.equal(redoHistory.undo(), true);
    redoHistory.redoStack[0].execute = () => { throw new Error('redo failed'); };
    console.error = () => {};
    try {
        assert.equal(redoHistory.redo(), false);
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(redoHistory.canUndo(), false);
    assert.equal(redoHistory.canRedo(), true);
});
