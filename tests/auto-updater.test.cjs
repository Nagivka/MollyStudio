'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { initializeAutoUpdater, UPDATE_CHECK_DELAY_MS } = require('../src/main/autoUpdater.js');

function createHarness({ packaged = true, env = {} } = {}) {
    const autoUpdater = new EventEmitter();
    const calls = [];
    autoUpdater.checkForUpdates = () => { calls.push('check'); return Promise.resolve(); };
    autoUpdater.quitAndInstall = (...args) => calls.push(['install', ...args]);
    let onTimer;
    const dialog = { showMessageBox: (...args) => { calls.push(['dialog', ...args]); return Promise.resolve({ response: 0 }); } };
    const logger = { info() {}, error() {} };
    const app = { isPackaged: packaged };
    const timer = callback => { onTimer = callback; return { unref() {} }; };
    const previous = { disabled: process.env.MOLLYSTUDIO_DISABLE_UPDATES, portable: process.env.PORTABLE_EXECUTABLE_DIR };
    if ('MOLLYSTUDIO_DISABLE_UPDATES' in env) process.env.MOLLYSTUDIO_DISABLE_UPDATES = env.MOLLYSTUDIO_DISABLE_UPDATES;
    else delete process.env.MOLLYSTUDIO_DISABLE_UPDATES;
    if ('PORTABLE_EXECUTABLE_DIR' in env) process.env.PORTABLE_EXECUTABLE_DIR = env.PORTABLE_EXECUTABLE_DIR;
    else delete process.env.PORTABLE_EXECUTABLE_DIR;
    return {
        autoUpdater, calls, dialog, logger, app, setTimeoutFn: timer,
        fireTimer: () => onTimer(),
        restore: () => {
            if (previous.disabled === undefined) delete process.env.MOLLYSTUDIO_DISABLE_UPDATES;
            else process.env.MOLLYSTUDIO_DISABLE_UPDATES = previous.disabled;
            if (previous.portable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
            else process.env.PORTABLE_EXECUTABLE_DIR = previous.portable;
        }
    };
}

test('does not start updater for unpackaged development builds', () => {
    const h = createHarness({ packaged: false });
    try {
        assert.equal(initializeAutoUpdater(h), false);
        assert.equal(h.autoUpdater.listenerCount('update-available'), 0);
    } finally { h.restore(); }
});

test('does not start updater when explicitly disabled', () => {
    const h = createHarness({ env: { MOLLYSTUDIO_DISABLE_UPDATES: '1' } });
    try { assert.equal(initializeAutoUpdater(h), false); }
    finally { h.restore(); }
});

test('automatically checks a packaged install after a short delay', async () => {
    const h = createHarness();
    try {
        assert.equal(initializeAutoUpdater(h), true);
        assert.equal(h.autoUpdater.autoDownload, true);
        assert.equal(h.autoUpdater.autoInstallOnAppQuit, true);
        assert.equal(h.autoUpdater.allowPrerelease, false);
        assert.equal(h.autoUpdater.allowDowngrade, false);
        h.fireTimer();
        await Promise.resolve();
        assert.equal(h.calls[0], 'check');
        assert.equal(UPDATE_CHECK_DELAY_MS, 15_000);
    } finally { h.restore(); }
});

test('prompts to restart after download and installs when accepted', async () => {
    const h = createHarness();
    try {
        initializeAutoUpdater(h);
        h.autoUpdater.emit('update-downloaded', { version: '1.3.1' });
        await Promise.resolve();
        await Promise.resolve();
        assert.deepEqual(h.calls.at(-1), ['install', false, true]);
    } finally { h.restore(); }
});

test('portable Windows builds are not enrolled in installer-based updates', () => {
    const h = createHarness({ env: { PORTABLE_EXECUTABLE_DIR: 'C:\\Portable' } });
    try { assert.equal(initializeAutoUpdater(h), false); }
    finally { h.restore(); }
});
