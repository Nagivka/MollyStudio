import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopBridge } from '../www/js/core/DesktopBridge.js';

async function withElectronApi(api, callback) {
    const hadWindow = Object.hasOwn(globalThis, 'window');
    const previousWindow = globalThis.window;
    globalThis.window = { electronAPI: api };
    try {
        return await callback();
    } finally {
        if (hadWindow) globalThis.window = previousWindow;
        else delete globalThis.window;
    }
}

test('desktop bridge delegates native operations only to the Electron preload API', async () => {
    const calls = [];
    const api = {
        minimize: () => calls.push(['minimize']),
        maximize: () => Promise.resolve(true),
        close: () => calls.push(['close']),
        isMaximized: () => Promise.resolve(true),
        showSaveDialog: options => Promise.resolve({ canceled: false, filePath: options.defaultPath }),
        showOpenDialog: options => Promise.resolve({ canceled: false, filePaths: options.filePaths }),
        writeFile: (...args) => { calls.push(['writeFile', ...args]); return Promise.resolve(true); },
        readFile: (...args) => Promise.resolve(args),
        getPathForFile: file => `electron:${file.name}`
    };

    await withElectronApi(api, async () => {
        assert.equal(DesktopBridge.isElectron(), true);
        assert.equal(DesktopBridge.isNative(), true);
        DesktopBridge.minimize();
        DesktopBridge.close();
        assert.equal(await DesktopBridge.maximize(), true);
        assert.equal(await DesktopBridge.isMaximized(), true);
        assert.deepEqual(await DesktopBridge.showSaveDialog({ defaultPath: 'project.mlst' }), {
            canceled: false,
            filePath: 'project.mlst'
        });
        assert.deepEqual(await DesktopBridge.showOpenDialog({ filePaths: ['project.mlst'] }), {
            canceled: false,
            filePaths: ['project.mlst']
        });
        assert.deepEqual(await DesktopBridge.readFile('project.mlst', 'utf8'), ['project.mlst', 'utf8']);
        assert.equal(DesktopBridge.getPathForFile({ name: 'image.png' }), 'electron:image.png');
        assert.equal(await DesktopBridge.exportPng('image.png', 'data:image/png;base64,aGVsbG8='), true);
        assert.deepEqual(calls, [
            ['minimize'],
            ['close'],
            ['writeFile', 'image.png', 'aGVsbG8=', 'base64']
        ]);
    });
});

test('desktop bridge has safe browser fallbacks and rejects malformed PNG exports', async () => {
    await withElectronApi(undefined, async () => {
        assert.equal(DesktopBridge.isElectron(), false);
        assert.equal(DesktopBridge.isNative(), false);
        assert.deepEqual(await DesktopBridge.showSaveDialog(), { canceled: true });
        assert.deepEqual(await DesktopBridge.showOpenDialog(), { canceled: true, filePaths: [] });
        assert.equal(DesktopBridge.getPathForFile({ path: 'legacy.png' }), 'legacy.png');
        assert.throws(() => DesktopBridge.exportPng('image.png', 'data:text/plain;base64,aGVsbG8='), TypeError);
        assert.throws(() => DesktopBridge.writeFile('project.mlst', '{}'), /Electron file API is unavailable/);
    });
});
