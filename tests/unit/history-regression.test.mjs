import test from 'node:test';
import assert from 'node:assert/strict';
import History from '../../src/renderer/js/core/History.js';
import { estimateCommandBytes } from '../../src/renderer/js/core/History.js';
import { AddLayerCommand } from '../../src/renderer/js/core/Commands.js';

test('adding and removing image objects count their pristine master in the history budget',()=>{
    const layer={canvas:{width:10,height:10},sourceCanvas:{width:100,height:100}};
    assert.equal(estimateCommandBytes(new AddLayerCommand({layers:[layer]},layer)),40400);
});

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

test('shared immutable masters occupy the undo budget once across separate transformations', () => {
    const history = new History(new Bus());
    history.memoryBudgetBytes = 1.5 * 1024 * 1024;
    const sourceCanvas = {width: 512, height: 512};
    const make = () => ({
        beforeData: {data: new Uint8ClampedArray(256), mollySnapshot: {sourceCanvas}},
        afterData: {data: new Uint8ClampedArray(256), mollySnapshot: {sourceCanvas}},
        undo() {}, execute() {}
    });
    history.push(make()); history.push(make());
    assert.equal(history.undoStack.length, 2);
    assert.ok(history.getUndoMemoryBytes() > 1024 * 1024);
    assert.ok(history.getUndoMemoryBytes() < history.memoryBudgetBytes);
});

test('history counts structured prefix and text snapshots toward its memory budget', () => {
    const history=new History(new Bus());history.memoryBudgetBytes=1200;
    const make=()=>({before:{prefix:{blocks:[{text:'x'.repeat(150)}]}},after:{prefix:{blocks:[{text:'y'.repeat(150)}]}},undo(){},execute(){}});
    history.push(make());history.push(make());
    assert.equal(history.undoStack.length,1);
    assert.ok(history.getUndoMemoryBytes()>600&&history.getUndoMemoryBytes()<=1200);
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
