import test from 'node:test';
import assert from 'node:assert/strict';

test('an unavailable worker falls back without losing a large project or leaving pending work', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
    let terminated = 0;
    globalThis.Worker = class {
        postMessage() { queueMicrotask(() => this.onerror()); }
        terminate() { terminated++; }
    };
    try {
        const codec = await import('../../src/renderer/js/core/ProjectCodec.mjs?unavailable-fixture');
        const source = {layers: [{dataUrl: 'A'.repeat(300000), sourceDataUrl: 'original'}]};
        const json = await codec.encodeProject(source);
        assert.deepEqual(await codec.decodeProject(json), source);
        assert.deepEqual(codec.codecStatus(), {worker: false, disabled: true, pending: 0, threshold: 262144});
        assert.equal(terminated, 1);
        await assert.rejects(codec.decodeProject(' '.repeat(300000) + '{broken}'), SyntaxError);
        assert.equal(await codec.encodeCanvasPNG({}), null);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'Worker', previous);
        else delete globalThis.Worker;
    }
});
