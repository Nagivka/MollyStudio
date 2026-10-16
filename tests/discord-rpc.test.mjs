import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';

async function createRpc() {
    const sockets = [], timers = new Set();
    class Socket extends EventEmitter {
        writes = [];
        destroyed = false;
        setTimeout() {}
        write(value) { this.writes.push(value); }
        destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('close'); }
    }
    const context = { module: { exports: {} }, Buffer, console, process: { platform: 'win32', pid: 1 },
        require: name => name === 'net' ? { createConnection() { const socket = new Socket(); sockets.push(socket); return socket; } } : EventEmitter,
        setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn) };
    vm.runInNewContext(await readFile(new URL('../src/main/discordRPC.js', import.meta.url), 'utf8'), context);
    return { rpc: context.module.exports, sockets, timers };
}

function frame(op, value) {
    const payload = Buffer.from(value), result = Buffer.alloc(payload.length + 8);
    result.writeUInt32LE(op); result.writeUInt32LE(payload.length, 4); payload.copy(result, 8);
    return result;
}

test('Discord RPC has one pending connection and ignores late connect events after disabling', async () => {
    const { rpc, sockets, timers } = await createRpc();
    rpc.connect(); rpc.connect(); rpc.setActivity({});
    assert.equal(sockets.length, 1);
    rpc.setEnabled(false); sockets[0].emit('connect');
    assert.equal(rpc.connected, false); assert.equal(rpc.socket, null); assert.equal(timers.size, 0);
});

test('Discord RPC parses split frames, echoes ping, and rejects oversized frame headers', async () => {
    const { rpc, sockets, timers } = await createRpc();
    rpc.connect(); const socket = sockets[0]; socket.emit('connect');
    const ready = frame(1, JSON.stringify({ evt: 'READY', data: { user: { username: 'Test' } } }));
    socket.emit('data', ready.subarray(0, 6)); socket.emit('data', ready.subarray(6));
    assert.equal(rpc.isReady, true);
    socket.emit('data', frame(3, 'ping'));
    assert.deepEqual(socket.writes.at(-1), frame(4, 'ping'));
    const invalid = Buffer.alloc(8); invalid.writeUInt32LE(1); invalid.writeUInt32LE(0xffffffff, 4);
    socket.emit('data', invalid);
    assert.equal(socket.destroyed, true); assert.equal(rpc.connected, false); assert.equal(timers.size, 1);
    rpc.cleanup(); assert.equal(timers.size, 0);
});
