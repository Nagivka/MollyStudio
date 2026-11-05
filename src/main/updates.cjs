const fs = require('node:fs/promises');
const path = require('node:path');
const {CancellationToken} = require('builder-util-runtime');
const {atomicWrite, createQueue} = require('./storage.cjs');
const security = require('./update-security.cjs');
const {requestBuffer} = require('./update-network.cjs');
const {abortable,requestWithRetry,errorCode} = require('./update-operations.cjs');
const {updateTarget}=require('./update-targets.cjs');
const {installAppImage}=require('./appimage-install.cjs');

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL = 15 * 60 * 1000;
class UpdateService {
    constructor({app, windows, testMode = false, platform = process.platform, arch = process.arch,
        portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),appImage=process.env.APPIMAGE,macSigned=false, engineFactory,
        replaceAppImage = installAppImage,
        request = requestBuffer, publicKey = security.PUBLIC_KEY, now = Date.now,
        checkTimeout = 60000, downloadIdleTimeout = 120000, retryDelays = [0,500,1500]}) {
        Object.assign(this, {app, windows, appImage, replaceAppImage, request, publicKey, now,checkTimeout,downloadIdleTimeout,retryDelays});
        this.target=updateTarget(platform,arch);
        this.engineFactory = engineFactory || (() => {
            const updater = require('electron-updater');
            return this.target?.format === 'AppImage' ? new updater.AppImageUpdater() : updater.autoUpdater;
        });
        this.manualInstall = platform === 'darwin' && !macSigned;
        this.supported = !testMode && app.isPackaged && !!this.target && !portable && (platform==='win32'||platform==='linux'&&!!appImage||platform==='darwin');
        const unavailableReason=testMode||!app.isPackaged?'development':portable?'portable':!this.target?'platform':platform==='linux'&&!appImage?'linuxNative':'';
        this.preferencesFile = path.join(app.getPath('userData'), 'update-preferences.json');
        this.writePreferences = createQueue();
        this.configureQueue = createQueue();
        this.preferences = {autoCheck: true, autoDownload: false, lastChecked: 0};
        this.state = {status: 'idle', currentVersion: app.getVersion(), version: '', notes: '', percent: 0,
            downloaded: 0, total: 0, error: '', supported: this.supported, manualInstall: this.manualInstall, downloadUrl: '', unavailableReason, releaseUrl: security.RELEASES_URL, ...this.preferences};
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
    set(patch) { Object.assign(this.state, patch); if(!this.disposed)this.windows.broadcast('update-status', this.status()); }
    async savePreferences(patch = {}) {
        return this.writePreferences(async () => {
            const next = {...this.preferences, ...patch};
            await atomicWrite(this.preferencesFile, JSON.stringify(next));
            this.preferences = next;
            this.set(next);
        });
    }
    async configure(data) {
        await this.ready;
        if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['autoCheck', 'autoDownload'].includes(key)) ||
            Object.values(data).some(value => typeof value !== 'boolean')) throw Error('UPDATE_INVALID_PREFERENCE');
        return this.configureQueue(async () => {
            await this.savePreferences(data);
            if (data.autoCheck === false) clearTimeout(this.timer);
            else if (data.autoCheck === true) this.schedule(1000);
            if(data.autoDownload===true&&!this.manualInstall){this.cancelledVersion=null;if(this.state.status==='available')void this.download().catch(error=>this.fail(error));}
            return this.status();
        });
    }
    start() {
        // Begin in the background as soon as preferences are loaded. Repeated
        // startup calls share one check and cannot create competing timers.
        if (!this.starting) this.starting = this.ready.then(() => {
            if (this.disposed || !this.supported || !this.preferences.autoCheck) return this.status();
            return this.check().finally(() => this.schedule(this.state.status === 'error' ? RETRY_INTERVAL : CHECK_INTERVAL));
        });
        return this.starting;
    }
    schedule(delay = CHECK_INTERVAL) {
        clearTimeout(this.timer);
        if (!this.supported || !this.preferences.autoCheck || this.disposed) return;
        this.timer = setTimeout(() => { void this.check().catch(() => {}).finally(() => this.schedule(this.state.status==='error'?RETRY_INTERVAL:CHECK_INTERVAL)); }, Math.min(CHECK_INTERVAL, Math.max(0, delay)));
        this.timer.unref?.();
    }
    fail(error) {
        const code = errorCode(error);
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
            this.resetDownloadWatchdog?.();
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
            if (!this.manualInstall && this.preferences.autoDownload && this.state.version!==this.cancelledVersion && this.state.status === 'available' && !this.disposed) void this.download().catch(error => this.fail(error));
        });
        return this.checking;
    }
    async performCheck() {
        this.manifest = null; this.installer = null;
        this.set({status: 'checking', error: '', version: '', notes: '', downloadUrl: '', percent: 0, downloaded: 0});
        this.checkAbort = new AbortController();
        const signal=this.checkAbort.signal;
        const read=(url,limit)=>requestWithRetry(this.request,[url,limit],signal,this.retryDelays);
        const timeout = setTimeout(() => this.checkAbort?.abort(Error('UPDATE_CHECK_TIMEOUT')), this.checkTimeout); timeout.unref?.();
        try {
            const release = JSON.parse((await read(`https://api.github.com/repos/${security.REPOSITORY}/releases/latest`,512*1024)).toString('utf8'));
            const version = typeof release.tag_name === 'string' ? release.tag_name.slice(1) : '';
            if (release.tag_name !== `v${version}` || !security.stableVersion(version) || release.draft !== false || release.prerelease !== false) throw Error('UPDATE_INVALID_MANIFEST');
            if (security.compareVersions(version, this.app.getVersion()) <= 0) {
                const checkedAt = this.now();
                this.manifest = null; this.installer = null;
                this.set({status: 'up-to-date', version: '', notes: '', lastChecked: checkedAt});
                await this.savePreferences({lastChecked: checkedAt}).catch(()=>{}); return this.status();
            }
            const base = security.downloadBase(version);
            if (this.manualInstall) {
                const name = security.releaseNames(version, this.target)[0].replace(/\.zip$/, '.dmg');
                const candidates = Array.isArray(release.assets) ? release.assets.filter(asset => asset.name === name) : [];
                const asset = candidates[0];
                if (candidates.length !== 1 || asset.browser_download_url !== base + name ||
                    !Number.isSafeInteger(asset.size) || asset.size < 1_000_000 || asset.size > 1_000_000_000 || asset.state !== 'uploaded') throw Error('UPDATE_NOT_PUBLISHED');
                const checkedAt = this.now();
                this.set({status: 'available', version, notes: typeof release.body === 'string' ? release.body.slice(0, 10000) : '',
                    downloadUrl: base + name, total: asset.size, lastChecked: checkedAt,
                    releaseUrl: `https://github.com/${security.REPOSITORY}/releases/tag/v${version}`});
                await this.savePreferences({lastChecked: checkedAt}).catch(() => {});
                return this.status();
            }
            const names = [...security.releaseNames(version,this.target), this.target.manifest];
            if (!Array.isArray(release.assets) || names.some(name => release.assets.filter(asset => asset.name === name && asset.browser_download_url === base + name).length !== 1)) throw Error('UPDATE_UNSIGNED_RELEASE');
            const manifest = security.readManifest((await read(base+this.target.manifest,64*1024)).toString('utf8'),version,this.publicKey,this.target);
            const yaml = await read(base+this.target.metadata,64*1024);
            const {createHash} = require('node:crypto');
            if (createHash('sha256').update(yaml).digest('hex') !== manifest.files.at(-1).sha256) throw Error('UPDATE_UNTRUSTED_METADATA');
            for (const file of manifest.files) if (release.assets.find(asset => asset.name === file.name).size !== file.size) throw Error('UPDATE_INVALID_MANIFEST');
            const engine = this.getEngine();
            engine.setFeedURL({provider: 'generic', url: base,channel:this.target.channel, useMultipleRangeRequest: false});
            const result = await abortable(engine.checkForUpdates(),signal);
            if(signal.aborted||this.disposed)throw signal.reason || Error('UPDATE_STOPPED');
            if (!result?.isUpdateAvailable) throw Error('UPDATE_INVALID_VERSION');
            security.validateUpdateInfo(result.updateInfo, manifest);
            this.manifest = manifest; this.installer = null;
            const checkedAt = this.now();
            this.set({status: 'available', version, notes: manifest.notes, total: manifest.files[0].size,
                percent: 0, lastChecked: checkedAt, releaseUrl: `https://github.com/${security.REPOSITORY}/releases/tag/v${version}`});
            await this.savePreferences({lastChecked: checkedAt}).catch(()=>{});
            return this.status();
        } catch (error) { return this.fail(error); }
        finally { clearTimeout(timeout); this.checkAbort = null; }
    }
    async download() {
        await this.ready;
        if (this.downloading) return this.downloading;
        if (this.disposed || !this.supported || this.manualInstall || this.checking || !this.manifest || !['available', 'error'].includes(this.state.status)) return this.status();
        this.downloading = this.performDownload().finally(() => { this.downloading = null; });
        return this.downloading;
    }
    async performDownload() {
        this.downloadToken = new CancellationToken();
        this.downloadFailure=null;
        const abort=new AbortController();
        this.downloadToken.onCancel(()=>abort.abort(Error(this.downloadFailure||'UPDATE_CANCELLED')));
        let idleTimer;
        const stop=code=>{this.downloadFailure=code;this.downloadToken?.cancel();};
        this.resetDownloadWatchdog=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>stop('UPDATE_DOWNLOAD_TIMEOUT'),this.downloadIdleTimeout);idleTimer.unref?.();};
        this.resetDownloadWatchdog();
        const maximum=setTimeout(()=>stop('UPDATE_DOWNLOAD_TIMEOUT'),60*60*1000);maximum.unref?.();
        this.set({status: 'downloading', error: '', percent: 0, downloaded: 0});
        try {
            security.validateUpdateInfo(this.getEngine().updateInfoAndProvider?.info, this.manifest);
            const paths = await abortable(this.engine.downloadUpdate(this.downloadToken),abort.signal);
            if (this.downloadToken.cancelled) {if(this.downloadFailure)throw Error(this.downloadFailure);this.set({status:'available',percent:0,downloaded:0});return this.status();}
            if (!Array.isArray(paths) || paths.length !== 1 || typeof paths[0] !== 'string' || !path.isAbsolute(paths[0])) throw Error('UPDATE_INVALID_DOWNLOAD');
            await security.verifyFile(paths[0], this.manifest.files[0]);
            if(this.downloadToken.cancelled){if(this.downloadFailure)throw Error(this.downloadFailure);this.set({status:'available',percent:0,downloaded:0});return this.status();}
            this.installer = paths[0];
            this.set({status: 'downloaded', percent: 100, downloaded: this.manifest.files[0].size});
        } catch (error) {
            if (this.downloadToken.cancelled&&!this.downloadFailure) this.set({status: 'available', percent: 0, downloaded:0, error: ''});
            else {
                if (errorCode(error) === 'UPDATE_INVALID_DOWNLOAD') await this.engine.downloadedUpdateHelper?.clear?.().catch(() => {});
                this.fail(this.downloadFailure?Error(this.downloadFailure):error);
            }
        } finally {clearTimeout(idleTimer);clearTimeout(maximum);this.resetDownloadWatchdog=null;this.downloadToken = null;}
        return this.status();
    }
    cancelDownload() {this.cancelledVersion=this.state.version;this.downloadToken?.cancel();return this.status();}
    async install() {
        if (this.disposed || !this.supported || this.manualInstall || this.state.status !== 'downloaded' || !this.installer || !this.manifest || this.installing) return false;
        const main = this.windows.get('main');
        if (!main || this.windows.closing.has(main.id)) return false;
        this.installing = true;
        try { await security.verifyFile(this.installer, this.manifest.files[0]); }
        catch (error) { this.installing = false;this.installer=null;await this.engine.downloadedUpdateHelper?.clear?.().catch(()=>{});this.fail(error);return false; }
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
            void security.verifyFile(this.installer, this.manifest.files[0]).then(async () => {
                if (this.target.format === 'AppImage') {
                    await this.replaceAppImage({current: this.appImage, download: this.installer, expected: this.manifest.files[0],
                        relaunch: execPath => this.app.relaunch({execPath, args: [`--user-data-dir=${this.app.getPath('userData')}`]})});
                    cleanup();
                    this.app.quit();
                    return;
                }
                cleanup();
                this.engine.quitAndInstall(true, true);
                if ('quitAndInstallCalled' in this.engine && !this.engine.quitAndInstallCalled) throw Error('UPDATE_INSTALL_FAILED');
            }).catch(error => { cleanup(); this.fail(error); this.windows.create('main'); });
        };
        main.once('molly-close-cancelled', cancelled);
        main.once('closed', closed);
        this.app.on('will-quit', quit);
        main.close();
        return true;
    }
    dispose() {
        this.disposed = true; clearTimeout(this.timer); this.checkAbort?.abort(Error('UPDATE_STOPPED')); this.downloadToken?.cancel();
    }
}
module.exports = {UpdateService, CHECK_INTERVAL, RETRY_INTERVAL};
