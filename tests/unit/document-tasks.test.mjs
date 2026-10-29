import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentTasks} from '../../src/renderer/js/core/DocumentTasks.mjs';

test('accepted image jobs run in order and closing waits for the complete queue', async () => {
    const tasks = new DocumentTasks(), order = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const first = tasks.run(async () => { order.push('first-start'); await gate; order.push('first-end'); });
    const second = tasks.run(() => { order.push('second'); return 7; });
    tasks.closing = true;
    await assert.rejects(tasks.run(() => { throw Error('Must never start'); }), /закрывается/);
    let idle = false;
    const waiting = tasks.idle().then(() => { idle = true; });
    await Promise.resolve();
    assert.equal(idle, false); assert.deepEqual(order, ['first-start']);
    release(); await Promise.all([first, second, waiting]);
    assert.deepEqual(order, ['first-start', 'first-end', 'second']);
    assert.equal(tasks.pending.size, 0); assert.equal(idle, true);
});

test('one failed import does not strand later jobs or recovery flushing', async () => {
    const tasks = new DocumentTasks();
    const failure = tasks.run(() => { throw Error('decode failed'); });
    const next = tasks.run(() => 42);
    await assert.rejects(failure, /decode failed/);
    assert.equal(await next, 42);
    await tasks.idle();
    assert.equal(tasks.pending.size, 0);
});
