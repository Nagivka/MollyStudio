const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {ORIGIN, isAppPage} = require('./protocol.cjs');

const definitions = {
    main: {title: 'MollyStudio', page: 'index.html', width: 1280, height: 800, minWidth: 900, minHeight: 600},
    settings: {title: 'Параметры MollyStudio', page: 'settings.html', width: 960, height: 760, minWidth: 760, minHeight: 560},
    'new-project': {title: 'Новый проект', page: 'new-project.html', width: 560, height: 520, minWidth: 480, minHeight: 440},
    buttons: {title: 'Генератор кнопок', page: 'buttons.html', width: 1120, height: 760, minWidth: 880, minHeight: 580}
};

class Windows {
    constructor(electron, {testMode = false, showOnReady = !testMode, beforeClose = () => Promise.resolve()} = {}) {
        this.electron = electron;
        this.testMode = testMode;
        this.showOnReady = showOnReady;
        this.beforeClose = beforeClose;
        this.items = new Map();
        this.closing = new Map();
    }
    get(label) { const window = this.items.get(label); return window && !window.isDestroyed() ? window : null; }
    label(window) { return [...this.items].find(([, item]) => item === window)?.[0]; }
    send(label, name, data) {
        const window = this.get(label);
        if (!window || window.webContents.isDestroyed()) return;
        const deliver = () => { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(name, data); };
        // Child windows can be opened again before their first page finishes.
        // Delay messages until preload has installed its listeners.
        if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', deliver);
        else deliver();
    }
    broadcast(name, data) { for (const label of this.items.keys()) this.send(label, name, data); }
    show(window) { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    create(label, page) {
        if (!Object.hasOwn(definitions, label)) throw Error('Неизвестное окно.');
        const existing = this.get(label);
        if (existing) { this.show(existing); return existing; }
        const {BrowserWindow} = this.electron;
        const definition = definitions[label], parent = label !== 'main' ? this.get('main') : null;
        const {page: defaultPage, ...windowOptions} = definition;
        const window = new BrowserWindow({
            ...windowOptions, frame: false, show: false, backgroundColor: '#131314',
            ...(this.testMode ? {minWidth: 100, minHeight: 100} : {}),
            ...(parent ? {parent, modal: label === 'new-project' && !this.testMode} : {}),
            icon: path.join(__dirname, '../renderer/assets/images/icon/app.ico'),
            webPreferences: {preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true,
                nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
                spellcheck: false, backgroundThrottling: false}
        });
        this.items.set(label, window);
        window.setMenu(null);
        window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
        for (const eventName of ['will-navigate', 'will-redirect']) window.webContents.on(eventName, details => { if (!isAppPage(details.url)) details.preventDefault(); });
        window.webContents.on('will-attach-webview', event => event.preventDefault());
        window.webContents.on('render-process-gone', (_event, details) => {
            window.rendererGone = true;
            console.error('Renderer stopped:', label, details.reason, details.exitCode);
        });
        window.webContents.on('did-finish-load', () => { window.rendererGone = false; });
        window.webContents.on('did-fail-load', (_event, code, description, url) => { if (code !== -3) console.error('Window load:', label, code, description, url); });
        const state = () => this.send(label, 'window-state-changed', window.isMaximized() || window.isFullScreen());
        for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) window.on(event, state);
        const visibility = () => this.send(label, 'window-visibility-changed', window.isVisible() && !window.isMinimized());
        for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, visibility);
        window.once('ready-to-show', () => { if (this.showOnReady) window.show(); });
        window.on('close', event => {
            if (label !== 'main' || window.forceClose) return;
            event.preventDefault();
            if (window.rendererGone) {
                if (this.closing.get(window.id)?.phase === 'native-closing') return;
                clearTimeout(this.closing.get(window.id)?.timeout);
                const request = {phase: 'native-closing'};
                this.closing.set(window.id, request);
                Promise.resolve().then(() => this.beforeClose()).then(() => {
                    if (!window.isDestroyed() && this.closing.get(window.id) === request) { window.forceClose = true; window.destroy(); }
                }).catch(error => {
                    if (this.closing.get(window.id) === request) this.closing.delete(window.id);
                    console.error('Pending native writes:', error);
                    window.emit('molly-close-cancelled');
                });
                return;
            }
            if (this.closing.has(window.id)) return;
            const token = randomUUID();
            const timeout = setTimeout(() => {
                if (this.closing.get(window.id)?.token !== token) return;
                this.closing.delete(window.id);
                this.send(label, 'recovery-flush-failed');
                window.emit('molly-close-cancelled');
            }, 30000);
            this.closing.set(window.id, {token, timeout, phase: 'flushing'});
            const request = () => { if (this.closing.get(window.id)?.token === token) this.send(label, 'flush-recovery-drafts', {token}); };
            if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', request);
            else request();
        });
        window.once('closed', () => {
            clearTimeout(this.closing.get(window.id)?.timeout);
            this.closing.delete(window.id);
            if (this.items.get(label) === window) this.items.delete(label);
        });
        const url = new URL(page || defaultPage, ORIGIN + '/');
        window.loadURL(url.href).catch(error => console.error('Load window:', error.message));
        return window;
    }
    async completeClose(window, data) {
        const request = this.closing.get(window.id);
        if (!request || request.token !== data?.token || request.phase !== 'flushing') return false;
        clearTimeout(request.timeout);
        if (data.success !== true) {
            this.closing.delete(window.id);
            window.webContents.send('recovery-flush-failed');
            window.emit('molly-close-cancelled');
            return false;
        }
        request.phase = 'confirming';
        if (data.confirmClose === true) {
            let result;
            const english = this.language === 'en';
            try {
                result = await this.electron.dialog.showMessageBox(window, {type: 'question', title: english ? 'Close MollyStudio?' : 'Закрыть MollyStudio?',
                    message: english ? 'Some changes have not been saved to a file.' : 'Есть изменения, не сохранённые в файл.',
                    detail: english ? 'Recovery copies are saved and will be available next time you open the application.' : 'Автокопии сохранены и будут доступны при следующем запуске.',
                    buttons: english ? ['Go back', 'Close'] : ['Вернуться', 'Закрыть'], defaultId: 0, cancelId: 0, noLink: true});
            } catch (error) {
                if (this.closing.get(window.id) === request) this.closing.delete(window.id);
                window.emit('molly-close-cancelled');
                throw error;
            }
            if (result.response !== 1) {
                if (this.closing.get(window.id) === request) this.closing.delete(window.id);
                window.emit('molly-close-cancelled');
                return false;
            }
        }
        if (window.isDestroyed() || this.closing.get(window.id) !== request) return false;
        request.phase = 'closing';
        request.timeout = setTimeout(() => {
            if (this.closing.get(window.id) !== request) return;
            this.closing.delete(window.id);
            this.send(this.label(window), 'recovery-flush-failed');
            window.emit('molly-close-cancelled');
        }, 60000);
        try { await this.beforeClose(); }
        catch (error) {
            if (this.closing.get(window.id) === request) {
                this.closing.delete(window.id);
                if (!window.isDestroyed()) window.webContents.send('recovery-flush-failed');
                window.emit('molly-close-cancelled');
            }
            throw error;
        }
        finally { clearTimeout(request.timeout); }
        if (window.isDestroyed() || this.closing.get(window.id) !== request) return false;
        this.closing.delete(window.id);
        window.forceClose = true;
        // Destroying after the confirmed flush avoids a second close handshake.
        window.destroy();
        return true;
    }
}

module.exports = {Windows, definitions};
