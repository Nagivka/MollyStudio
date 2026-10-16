'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { initializeAutoUpdater } = require('../src/main/autoUpdater.js');
const { readSignedManifest, verifyReleaseFile, hashFileSync, releaseNames } = require('../src/main/updateSignature.js');
const { validateArtifacts } = require('../scripts/publish-release.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, response = 0) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-update-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const version = '1.3.2';
    const names = releaseNames(version);
    const installer = path.join(root, names[0]);
    fs.writeFileSync(installer, 'test installer bytes');
    fs.writeFileSync(path.join(root, names[1]), 'test blockmap bytes');
    const size = fs.statSync(installer).size;
    const checksum = Buffer.from(hashFileSync(installer), 'hex').toString('base64');
    fs.writeFileSync(path.join(root, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${names[0]}\n    sha512: ${checksum}\n    size: ${size}\npath: ${names[0]}\nsha512: ${checksum}\n`);
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const payload = { version, files: names.map(name => ({ name, size: fs.statSync(path.join(root, name)).size, sha512: hashFileSync(path.join(root, name)) })) };
    const bytes = Buffer.from(JSON.stringify(payload));
    const envelope = { schema: 1, payload: bytes.toString('base64'), signature: crypto.sign(null, bytes, privateKey).toString('base64') };
    const manifest = JSON.stringify(envelope);
    fs.writeFileSync(path.join(root, 'release-manifest.json'), manifest);
    const app = new EventEmitter(); app.isPackaged = true;
    const updater = new EventEmitter();
    const calls = [], errors = [];
    app.quit = () => { calls.push('request-quit'); app.emit('before-quit'); };
    updater.checkForUpdates = async () => { calls.push('check'); };
    updater.quitAndInstall = (...args) => calls.push(['install', ...args]);
    const options = { app, autoUpdater: updater, platform: 'win32', env: {}, publicKey,
        loadManifest: async () => manifest,
        dialog: { async showMessageBox() { calls.push('prompt'); return { response }; } },
        logger: { info() {}, error(...parts) { errors.push(parts.join(' ')); } },
        setTimeoutFn(callback) { options.timer = callback; return { unref() {} }; } };
    return { root, version, names, installer, publicKey, envelope, manifest, payload, options, app, updater, calls, errors,
        downloaded() { updater.emit('update-downloaded', { version, downloadedFile: installer }); } };
}

test('valid signature covers installer, blockmap and metadata; foreign key and changed version are rejected', t => {
    const f = fixture(t);
    assert.equal(readSignedManifest(f.manifest, f.publicKey, f.version).version, f.version);
    const foreign = crypto.generateKeyPairSync('ed25519');
    assert.throws(() => readSignedManifest(f.manifest, foreign.publicKey, f.version), /издателю/);
    assert.throws(() => readSignedManifest(f.manifest, f.publicKey, '9.9.9'), /Версия/);
    assert.deepEqual(validateArtifacts(f.root, f.version, f.publicKey), [...f.names, 'release-manifest.json']);
    fs.appendFileSync(f.installer, 'tampered');
    assert.throws(() => verifyReleaseFile(f.installer, f.payload), /повреждён/);
    assert.throws(() => validateArtifacts(f.root, f.version, f.publicKey), /повреждён/);
});

test('verified update waits for recovery and all windows to close before installation', async t => {
    const f = fixture(t);
    initializeAutoUpdater(f.options);
    assert.equal(f.updater.autoInstallOnAppQuit, false);
    assert.equal(f.updater.disableWebInstaller, true);
    f.options.timer();
    f.downloaded(); await tick();
    assert.deepEqual(f.calls, ['check', 'prompt', 'request-quit']);
    // before-quit alone is insufficient: an editor may cancel close or still be saving.
    f.app.emit('will-quit');
    assert.deepEqual(f.calls.at(-1), ['install', true, true]);
    f.app.emit('will-quit');
    assert.equal(f.calls.filter(call => Array.isArray(call)).length, 1);
});

test('cancelling editor close cancels forced restart; later exit can install safely', async t => {
    const f = fixture(t);
    const controller = initializeAutoUpdater(f.options);
    f.downloaded(); await tick();
    controller.cancelRestart();
    f.app.emit('will-quit');
    assert.deepEqual(f.calls.at(-1), ['install', true, false]);
});

test('installer changed after verification is rejected again at final quit', async t => {
    const f = fixture(t, 1);
    initializeAutoUpdater(f.options);
    f.downloaded(); await tick();
    fs.appendFileSync(f.installer, 'tampered');
    f.app.emit('will-quit');
    assert.equal(f.calls.some(call => Array.isArray(call)), false);
    assert.ok(f.errors.some(message => message.includes('заблокирована')));
});

test('missing or invalid detached signature never enables installation', async t => {
    const f = fixture(t);
    f.options.loadManifest = async () => JSON.stringify({ ...f.envelope, signature: Buffer.alloc(64).toString('base64') });
    initializeAutoUpdater(f.options);
    f.downloaded(); await tick(); f.app.emit('will-quit');
    assert.deepEqual(f.calls, []);
    assert.ok(f.errors.length);
});

test('startup never enrolls development, portable or unsupported platform builds', t => {
    const f = fixture(t);
    assert.equal(initializeAutoUpdater({ ...f.options, app: { isPackaged: false } }), false);
    assert.equal(initializeAutoUpdater({ ...f.options, platform: 'linux' }), false);
    assert.equal(initializeAutoUpdater({ ...f.options, env: { PORTABLE_EXECUTABLE_DIR: 'C:\\Portable' } }), false);
    assert.equal(initializeAutoUpdater({ ...f.options, env: { MOLLYSTUDIO_DISABLE_UPDATES: '1' } }), false);
});
