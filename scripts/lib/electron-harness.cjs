const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWriteFile } = require('../../src/main/fileStore.js');
const { createRecoveryStore } = require('../../src/main/recoveryStore.js');
const root = path.resolve(__dirname, '../..');
const profile = process.env.MOLLY_TEST_PROFILE;
if (!profile || !path.basename(profile).startsWith('molly-electron-check-')) throw new Error('Run through scripts/run-electron-check.cjs');
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('lang', 'ru');
app.on('window-all-closed', () => {});

function setupIPC({ durable = false, beforeRecoveryWrite } = {}) {
    const store = durable ? createRecoveryStore(path.join(profile, 'recovery-drafts')) : null;
    for (const channel of ['discord-set-activity', 'discord-clear-activity', 'discord-set-enabled', 'discord-set-client-id', 'recovery-drafts-flushed']) ipcMain.handle(channel, () => true);
    ipcMain.handle('discord-get-status', () => ({ connected: false, isReady: false }));
    ipcMain.handle('get-app-version', () => '1.3.0');
    ipcMain.handle('window-is-maximized', () => false);
    ipcMain.handle('settings-broadcast', () => true);
    ipcMain.handle('recovery-draft-write', async (_event, draft) => {
        await beforeRecoveryWrite?.(draft);
        return store?.write(draft) ?? true;
    });
    ipcMain.handle('recovery-draft-read', (_event, id) => store?.read(id) ?? null);
    ipcMain.handle('recovery-draft-list', () => store?.list() ?? []);
    ipcMain.handle('recovery-draft-delete', (_event, id) => store?.delete(id) ?? true);
    const safePath = file => {
        const target = path.resolve(file), relative = path.relative(profile, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Test IO escaped its fixture directory');
        return target;
    };
    ipcMain.handle('dialog-save', (_event, options) => ({ canceled: false, filePath: path.join(profile, path.basename(options?.defaultPath || 'roundtrip.mlst')) }));
    ipcMain.handle('file-write', (_event, file, data, encoding = 'utf8') => atomicWriteFile(safePath(file), encoding === 'base64' ? Buffer.from(data, 'base64') : data));
    ipcMain.handle('file-read', (_event, file) => fs.readFile(safePath(file), 'utf8'));
    return store;
}

async function ready(options) {
    setupIPC(options);
    await app.whenReady();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
}

function makeWindow(width = 1280, height = 800) {
    const window = new BrowserWindow({ show: false, frame: false, useContentSize: true, width, height,
        webPreferences: { preload: path.join(root, 'src/preload/preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
    window.__testErrors = [];
    window.webContents.on('console-message', (_event, level, message) => {
        if (level === 3 && !/ERR_BLOCKED_BY_CLIENT/.test(message)) window.__testErrors.push(message);
    });
    return window;
}

async function settle(window) {
    await window.webContents.executeJavaScript(`Promise.race([(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter(image => {
            const box = image.getBoundingClientRect();
            return box.width && box.height && box.bottom > 0 && box.top < innerHeight;
        }).map(image => image.complete ? null : image.decode().catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })(), new Promise((_, reject) => setTimeout(() => reject(new Error('Page frames/fonts did not settle')), 4000))])`);
    // Offscreen Chromium swaps a painted frame after the DOM resize and zoom callbacks.
    window.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 120));
}

module.exports = { app, root, profile, ready, makeWindow, settle };
