const fs = require('node:fs/promises');
const path = require('node:path');
const {CancellationToken} = require('builder-util-runtime');
const {atomicWrite, createQueue} = require('./storage.cjs');
const security = require('./update-security.cjs');
const {requestBuffer} = require('./update-network.cjs');

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
class UpdateService {
    constructor({app, windows, testMode = false, platform = process.platform, arch = process.arch,
        portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE), engineFactory = () => require('electron-updater').autoUpdater,
        request = requestBuffer, publicKey = security.PUBLIC_KEY, now = Date.now}) {
        Object.assign(this, {app, windows, engineFactory, request, publicKey, now});
        this.supported = !testMode && app.isPackaged && platform === 'win32' && arch === 'x64' && !portable;
        this.preferencesFile = path.join(app.getPath('userData'), 'update-preferences.json');
        this.writePreferences = createQueue();
        this.configureQueue = createQueue();
        this.preferences = {autoCheck: true, autoDownload: false, lastChecked: 0};
        this.state = {status: 'idle', currentVersion: app.getVersion(), version: '', notes: '', percent: 0,
            downloaded: 0, total: 0, error: '', supported: this.supported, releaseUrl: security.RELEASES_URL, ...this.preferences};
        this.ready = this.load();
    }
    async load() {
        try {
            const stat = await fs.stat(this.preferencesFile);
            if (stat.size <= 4096) {
                const data = JSON.parse(await fs.readFile(this.preferencesFile, 'utf8'));
                for (const key of ['autoCheck', 'autoDownload']) if (typeof data[key] === 'boolean') this.preferences[key] = data[key];
                if (Number.isSafeInteger(data.lastChecked) && data.lastChecked >= 0 && data.lastChecked <= this.now()) this.preferences.lastChecked = data.lastChecked;
            }
        } catch { /* Defaults work when preferences are missing or damaged. */ }
        this.set(this.preferences);
    }
    status() { return {...this.state}; }
    set(patch) { Object.assign(this.state, patch); this.windows.broadcast('update-status', this.status()); }
    async savePreferences() {
        return this.writePreferences(() => atomicWrite(this.preferencesFile, JSON.stringify(this.preferences)));
    }
    async configure(data) {
        await this.ready;
        if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['autoCheck', 'autoDownload'].includes(key)) ||
            Object.values(data).some(value => typeof value !== 'boolean')) throw Error('UPDATE_INVALID_PREFERENCE');
        return this.configureQueue(async () => {
            const next = {...this.preferences, ...data};
            await this.writePreferences(() => atomicWrite(this.preferencesFile, JSON.stringify(next)));
            this.preferences = next;
            this.set(this.preferences);
            if (data.autoCheck === false) clearTimeout(this.timer);
            else if (data.autoCheck === true) this.schedule(1000);
            return this.status();
        });
    }
    async start() {
        await this.ready;
        this.schedule(Math.max(12000, this.preferences.lastChecked + CHECK_INTERVAL - this.now()));
    }
    schedule(delay = CHECK_INTERVAL) {
        clearTimeout(this.timer);
        if (!this.supported || !this.preferences.autoCheck || this.disposed) return;
        this.timer = setTimeout(() => { void this.check().catch(() => {}).finally(() => this.schedule()); }, Math.min(CHECK_INTERVAL, Math.max(0, delay)));
        this.timer.unref?.();
    }
    fail(error) {
        const code = String(error?.message || '').match(/^UPDATE_[A-Z_]+$/)?.[0] || 'UPDATE_NETWORK';
        this.set({status: 'error', error: code});
        return this.status();
    }
    getEngine() {
        if (this.engine) return this.engine;
        const engine = this.engineFactory();
        Object.assign(engine, {autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false,
            allowDowngrade: false, disableDifferentialDownload: true, disableWebInstaller: true});
        engine.logger = {info() {}, warn() {}, debug() {}, error() {}};
        engine.on('error', () => {}); // Async operations below report sanitized failures.
        engine.on('download-progress', progress => {
            if (this.state.status !== 'downloading') return;
            const time = this.now();
            if (time - (this.lastProgress || 0) < 200 && progress.percent < 100) return;
            this.lastProgress = time;
            this.set({percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
                downloaded: Math.max(0, Number(progress.transferred) || 0), total: this.manifest?.files[0].size || 0});
        });
        this.engine = engine;
        return engine;
    }
    async check() {
        await this.ready;
        if (this.disposed || !this.supported) return this.status();
        if (this.checking) return this.checking;
        if (this.downloading || this.state.status === 'installing' || this.state.status === 'downloaded') return this.status();
        if (this.lastAttempt && this.now() - this.lastAttempt < 30000) return this.status();
        this.lastAttempt = this.now();
        this.set({nextCheckAt: this.lastAttempt + 30000});
        this.checking = this.performCheck().finally(() => {
            this.checking = null;
            if (this.preferences.autoDownload && this.state.status === 'available' && !this.disposed) void this.download().catch(error => this.fail(error));
        });
        return this.checking;
    }
    async performCheck() {
        this.manifest = null; this.installer = null;
        this.set({status: 'checking', error: '', version: '', notes: '', percent: 0, downloaded: 0});
        this.checkAbort = new AbortController();
        const timeout = setTimeout(() => this.checkAbort?.abort(), 45000); timeout.unref?.();
        try {
            const release = JSON.parse((await this.request(`https://api.github.com/repos/${security.REPOSITORY}/releases/latest`, 512 * 1024, this.checkAbort.signal)).toString('utf8'));
            const version = typeof release.tag_name === 'string' ? release.tag_name.slice(1) : '';
            if (release.tag_name !== `v${version}` || !security.stableVersion(version) || release.draft !== false || release.prerelease !== false) throw Error('UPDATE_INVALID_MANIFEST');
            this.preferences.lastChecked = this.now();
            if (security.compareVersions(version, this.app.getVersion()) <= 0) {
                this.manifest = null; this.installer = null;
                this.set({status: 'up-to-date', version: '', notes: '', lastChecked: this.preferences.lastChecked});
                await this.savePreferences(); return this.status();
            }
            const base = security.downloadBase(version);
            const names = [...security.releaseNames(version), 'release-manifest.json'];
            if (!Array.isArray(release.assets) || names.some(name => release.assets.filter(asset => asset.name === name && asset.browser_download_url === base + name).length !== 1)) throw Error('UPDATE_UNSIGNED_RELEASE');
            const manifest = security.readManifest((await this.request(base + 'release-manifest.json', 64 * 1024, this.checkAbort.signal)).toString('utf8'), version, this.publicKey);
            const yaml = await this.request(base + 'latest.yml', 64 * 1024, this.checkAbort.signal);
            const {createHash} = require('node:crypto');
            if (createHash('sha256').update(yaml).digest('hex') !== manifest.files[2].sha256) throw Error('UPDATE_UNTRUSTED_METADATA');
            for (const file of manifest.files) if (release.assets.find(asset => asset.name === file.name).size !== file.size) throw Error('UPDATE_INVALID_MANIFEST');
            const engine = this.getEngine();
            engine.setFeedURL({provider: 'generic', url: base, useMultipleRangeRequest: false});
            const result = await engine.checkForUpdates();
            if (!result?.isUpdateAvailable) throw Error('UPDATE_INVALID_VERSION');
            security.validateUpdateInfo(result.updateInfo, manifest);
            this.manifest = manifest; this.installer = null;
            this.set({status: 'available', version, notes: manifest.notes, total: manifest.files[0].size,
                percent: 0, lastChecked: this.preferences.lastChecked, releaseUrl: `https://github.com/${security.REPOSITORY}/releases/tag/v${version}`});
            await this.savePreferences();
            return this.status();
        } catch (error) { return this.fail(error); }
        finally { clearTimeout(timeout); this.checkAbort = null; }
    }
    async download() {
        await this.ready;
        if (this.downloading) return this.downloading;
        if (this.disposed || !this.supported || this.checking || !this.manifest || !['available', 'error'].includes(this.state.status)) return this.status();
        this.downloading = this.performDownload().finally(() => { this.downloading = null; });
        return this.downloading;
    }
    async performDownload() {
        this.downloadToken = new CancellationToken();
        this.set({status: 'downloading', error: '', percent: 0, downloaded: 0});
        try {
            security.validateUpdateInfo(this.getEngine().updateInfoAndProvider?.info, this.manifest);
            const paths = await this.engine.downloadUpdate(this.downloadToken);
            if (this.downloadToken.cancelled) { this.set({status: 'available', percent: 0}); return this.status(); }
            if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string' || !path.isAbsolute(paths[0])) throw Error('UPDATE_INVALID_DOWNLOAD');
            await security.verifyFile(paths[0], this.manifest.files[0]);
            this.installer = paths[0];
            this.set({status: 'downloaded', percent: 100, downloaded: this.manifest.files[0].size});
        } catch (error) {
            if (this.downloadToken.cancelled) this.set({status: 'available', percent: 0, error: ''});
            else {
                if (error.message === 'UPDATE_INVALID_DOWNLOAD') await this.engine.downloadedUpdateHelper?.clear?.().catch(() => {});
                this.fail(error);
            }
        } finally { this.downloadToken = null; }
        return this.status();
    }
    cancelDownload() { this.downloadToken?.cancel(); return this.status(); }
    async install() {
        if (this.disposed || !this.supported || this.state.status !== 'downloaded' || !this.installer || !this.manifest || this.installing) return false;
        const main = this.windows.get('main');
        if (!main || this.windows.closing.has(main.id)) return false;
        this.installing = true;
        try { await security.verifyFile(this.installer, this.manifest.files[0]); }
        catch (error) { this.installing = false; this.fail(error); return false; }
        if (this.windows.get('main') !== main || main.isDestroyed?.() || this.windows.closing.has(main.id)) { this.installing = false; return false; }
        this.set({status: 'installing', error: ''});
        const cleanup = (removeQuit = true) => {
            main.removeListener('molly-close-cancelled', cancelled);
            main.removeListener('closed', closed);
            if (removeQuit) { this.app.removeListener('will-quit', quit); this.installing = false; }
        };
        const cancelled = () => { cleanup(); this.set({status: 'downloaded'}); };
        const closed = () => { this.app.quit(); };
        let finishing = false;
        const quit = event => {
            event.preventDefault();
            if (finishing) return;
            finishing = true; cleanup(false);
            // All editor flushes and native writes have completed at this point.
            void security.verifyFile(this.installer, this.manifest.files[0]).then(() => {
                cleanup();
                this.engine.quitAndInstall(true, true);
                if (!this.engine.quitAndInstallCalled) throw Error('UPDATE_INSTALL_FAILED');
            }).catch(error => { cleanup(); this.fail(error); this.windows.create('main'); });
        };
        main.once('molly-close-cancelled', cancelled);
        main.once('closed', closed);
        this.app.on('will-quit', quit);
        main.close();
        return true;
    }
    dispose() {
        this.disposed = true; clearTimeout(this.timer); this.checkAbort?.abort(); this.downloadToken?.cancel();
    }
}
module.exports = {UpdateService, CHECK_INTERVAL};
