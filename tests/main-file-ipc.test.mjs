import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

// Execute the production entry point and its actual handlers; only Electron's
// window lifecycle and Discord are stubbed. No user profile or window is opened.
async function handlers(t) {
    const root = await mkdtemp(fileURLToPath(new URL('.molly-audit-main-', import.meta.url)));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5 }));
    const main = fileURLToPath(new URL('../src/main/main.js', import.meta.url));
    const localRequire = createRequire(main), registered = new Map();
    const electron = {
        app: { getPath: () => root, on() {}, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}) },
        ipcMain: { handle: (name, handler) => registered.set(name, handler) }
    };
    vm.runInNewContext(await readFile(main, 'utf8'), {
        require: name => name === 'electron' ? electron : name === './discordRPC' ? {} : localRequire(name),
        __dirname: path.dirname(main), Buffer, console: { ...console, error() {} },
        process: { on() {}, platform: process.platform, argv: [] }, setTimeout, clearTimeout
    }, { filename: main });
    return { root, invoke: (name, ...args) => registered.get(name)({}, ...args) };
}

test('production main IPC writes and reads a project from disk', async t => {
    const { root, invoke } = await handlers(t), file = path.join(root, 'project.mlst');
    const json = JSON.stringify({ name: 'Проверка', layers: [] });
    assert.equal(await invoke('file-write', file, json), true);
    assert.equal(await invoke('file-read', file), json);
    await assert.rejects(invoke('file-read', ''), /Invalid file path/);
});

test('production main IPC decodes exported PNG bytes', async t => {
    const { root, invoke } = await handlers(t), file = path.join(root, 'image.png');
    await invoke('file-write', file, 'data:image/png;base64,aGVsbG8=', 'base64');
    assert.equal(await readFile(file, 'utf8'), 'hello');
});

test('production recovery IPC retains independent drafts and deletes only the exact ID', async t => {
    const { invoke } = await handlers(t);
    const draft = id => ({ draftId: id, timestamp: 1, project: { name: id, layers: [] } });
    await invoke('recovery-draft-write', draft('First'));
    await invoke('recovery-draft-write', draft('second'));
    await assert.rejects(invoke('recovery-draft-delete', 'first'), /конфликтует/);
    assert.equal((await invoke('recovery-draft-read', 'First')).project.name, 'First');
    await invoke('recovery-draft-delete', 'First');
    assert.equal((await invoke('recovery-draft-list')).length, 1);
});
