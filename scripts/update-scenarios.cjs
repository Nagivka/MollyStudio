'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { NsisUpdater } = require('electron-updater');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { initializeAutoUpdater } = require('../src/main/autoUpdater.js');
const { releaseNames } = require('../src/main/updateSignature.js');
const profile = process.env.MOLLY_TEST_PROFILE;
if (!profile || !path.basename(profile).startsWith('molly-electron-check-')) throw new Error('Use run-electron-check.cjs');
app.setPath('userData', profile);
app.on('window-all-closed', () => {});

async function waitFor(condition) {
    const deadline = Date.now() + 8000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Updater scenario timed out');
        await new Promise(resolve => setTimeout(resolve, 20));
    }
}

(async () => {
    let server;
    const checks = [];
    const expect = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const watchdog = setTimeout(() => app.exit(1), 45_000);
    try {
        await app.whenReady();
        const version = '1.3.2', names = releaseNames(version);
        const installer = Buffer.from('isolated fixture; never executable');
        const hash = crypto.createHash('sha512').update(installer).digest();
        const metadata = Buffer.from(`version: ${version}\nfiles:\n  - url: ${names[0]}\n    sha512: ${hash.toString('base64')}\n    size: ${installer.length}\npath: ${names[0]}\nsha512: ${hash.toString('base64')}\n`);
        const blockmap = Buffer.from('unused fixture blockmap');
        const keys = crypto.generateKeyPairSync('ed25519');
        const payload = Buffer.from(JSON.stringify({ version, files: [installer, blockmap, metadata].map((bytes, index) => ({ name: names[index], size: bytes.length, sha512: crypto.createHash('sha512').update(bytes).digest('hex') })) }));
        const envelope = { schema: 1, payload: payload.toString('base64'), signature: crypto.sign(null, payload, keys.privateKey).toString('base64') };
        let installerRequests = 0;
        server = http.createServer((request, response) => {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            const bytes = pathname === '/latest.yml' ? metadata : pathname === `/${names[0]}` ? installer : null;
            if (!bytes) { response.writeHead(404); response.end(); return; }
            if (pathname.endsWith('.exe')) installerRequests++;
            response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream' }); response.end(bytes);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${server.address().port}`;
        const config = path.join(profile, 'app-update.yml');
        fs.writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: update-fixture-cache\n`);

        async function session({ invalidSignature = false } = {}) {
            const lifecycle = new EventEmitter();
            Object.assign(lifecycle, { version: '1.3.1', name: 'MollyUpdateQA', isPackaged: true, appUpdateConfigPath: config, userDataPath: profile, baseCachePath: profile,
                whenReady: () => app.whenReady(), onQuit: () => {}, relaunch: () => {}, quit: () => lifecycle.emit('before-quit') });
            const updater = new NsisUpdater(undefined, lifecycle);
            updater.httpExecutor = new ElectronHttpExecutor();
            updater.setFeedURL({ provider: 'generic', url });
            updater.logger = null;
            updater.disableDifferentialDownload = true;
            let installs = 0, prompt = false, rejected = false, downloadedFile;
            updater.doInstall = () => { installs++; return true; };
            updater.on('update-downloaded', info => { downloadedFile = info.downloadedFile; });
            initializeAutoUpdater({ app: lifecycle, autoUpdater: updater, platform: 'win32', env: {}, publicKey: keys.publicKey,
                loadManifest: async () => JSON.stringify(invalidSignature ? { ...envelope, signature: Buffer.alloc(64).toString('base64') } : envelope),
                dialog: { async showMessageBox() { prompt = true; return { response: 1 }; } },
                logger: { info() {}, error() { rejected = true; } }, setTimeoutFn: () => null });
            const result = await updater.checkForUpdates();
            await result.downloadPromise;
            await waitFor(() => prompt || rejected);
            return { lifecycle, updater, file: downloadedFile, get installs() { return installs; }, prompt, rejected };
        }

        const valid = await session();
        expect(installerRequests === 1 && valid.prompt && valid.installs === 0, 'Real electron-updater downloads fixture bytes and verifies the detached signature before offering installation');
        valid.lifecycle.emit('before-quit');
        expect(valid.installs === 0, 'Installer stays blocked while editor windows may still be saving');
        valid.lifecycle.emit('will-quit');
        expect(valid.installs === 1, 'Verified installer starts only at final application quit; fixture install is intercepted');
        const cached = await session({ invalidSignature: true });
        cached.lifecycle.emit('will-quit');
        expect(installerRequests === 1 && cached.rejected && cached.installs === 0, 'A cached installer still requires a valid detached signature; no cached installation bypass exists');
        const changed = await session();
        fs.appendFileSync(changed.file, 'tampered after download');
        changed.lifecycle.emit('will-quit');
        expect(changed.installs === 0, 'Modification of a previously verified installer blocks installation at quit');
        console.log(JSON.stringify({ electron: process.versions.electron, passed: checks.length, checks }, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(watchdog); if (server) await new Promise(resolve => server.close(resolve)); app.exit(process.exitCode || 0); }
})();
