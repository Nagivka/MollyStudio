const fs = require('node:fs/promises');
const path = require('node:path');
const {isAppPage} = require('./protocol.cjs');
const {registerFileAssociation} = require('./file-association.cjs');
const english = require('../renderer/locales/en.json');
const tabs = new Set(['appearance', 'effects', 'canvas', 'tools', 'export', 'discord', 'backup', 'hotkeys', 'about']);
const text = (data, key) => {
    if (typeof data?.[key] !== 'string') throw Error(`Не задан параметр ${key}.`);
    return data[key];
};

function dialogOptions(input = {}, language = 'ru') {
    if (!input || typeof input !== 'object') input = {};
    const options = {};
    if (typeof input.title === 'string') options.title = input.title.slice(0, 256);
    if (typeof input.defaultPath === 'string') options.defaultPath = input.defaultPath;
    if (Array.isArray(input.filters)) options.filters = input.filters.slice(0, 32).map(filter => ({
        name: String(filter?.name || 'Файлы').slice(0, 128),
        extensions: Array.isArray(filter?.extensions) ? filter.extensions.filter(value => typeof value === 'string' && /^(?:[a-z0-9]+|\*)$/i.test(value)).slice(0, 32) : []
    })).filter(filter => filter.extensions.length);
    else options.filters = [{name: 'Проекты MollyStudio', extensions: ['mlst']}];
    if (language === 'en') {
        if (options.title && Object.hasOwn(english,options.title)) options.title = english[options.title];
        for (const filter of options.filters || []) if (Object.hasOwn(english,filter.name)) filter.name = english[filter.name];
    }
    return options;
}

function registerIpc(electron, runtime) {
    const {app, ipcMain, BrowserWindow, dialog, shell} = electron;
    const {windows, files, recovery, requests, discord, testMode} = runtime;
    const ensureEditorOpen = () => {
        const main = windows.get('main');
        if (!main || windows.closing.has(main.id)) throw Error('Редактор закрывается. Отмените закрытие и повторите действие.');
    };
    async function dispatch(window, label, action, data = null) {
        switch (action) {
        case 'language-set':
            if (!['ru', 'en'].includes(data?.language)) throw Error('Unsupported interface language.');
            windows.language = data.language;
            return true;
        case 'project-open-pending': return label === 'main' ? requests.pending() : [];
        case 'project-open-ack':
            if (label !== 'main' || !Number.isSafeInteger(data?.id)) throw Error('Некорректный запрос открытия проекта.');
            requests.acknowledge(data.id); return true;
        case 'register-file-association': return !testMode && registerFileAssociation(app);
        case 'window-minimize': window.minimize(); return null;
        case 'window-maximize':
            if (window.isFullScreen()) { window.setFullScreen(false); return window.isMaximized(); }
            if (window.isMaximized()) { window.unmaximize(); return false; }
            window.maximize(); return true;
        case 'window-toggle-fullscreen': { const next = !window.isFullScreen(); window.setFullScreen(next); return next; }
        case 'window-is-maximized': return window.isMaximized() || window.isFullScreen();
        case 'window-is-visible': return window.isVisible() && !window.isMinimized();
        case 'window-close': window.close(); return null;
        case 'recovery-drafts-flushed': return windows.completeClose(window, data);
        case 'window-open-settings': {
            const tab = tabs.has(data?.tab) ? data.tab : 'appearance';
            const existing = windows.get('settings');
            windows.create('settings', `settings.html?tab=${tab}`);
            if (existing) windows.send('settings', 'settings-tab-requested', tab);
            return true;
        }
        case 'window-open-new-project': windows.create('new-project'); return true;
        case 'window-open-button-generator': windows.create('buttons'); return true;
        case 'settings-broadcast':
            if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) throw Error('Слишком большие настройки.');
            windows.broadcast('settings-updated', data); return true;
        case 'button-generated':
            ensureEditorOpen();
            if (label !== 'buttons') throw Error('Запрос предназначен генератору кнопок.');
            if (Buffer.byteLength(JSON.stringify(data)) > 64 * 1024 * 1024) throw Error('Слишком большой результат генератора.');
            await runtime.transfers.request(windows.get('main'), window, action, data);
            windows.show(windows.get('main')); return true;
        case 'project-created':
            ensureEditorOpen();
            if (label !== 'new-project') throw Error('Запрос предназначен окну нового проекта.');
            if (Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) throw Error('Слишком большие параметры проекта.');
            windows.send('main', action, data); windows.show(windows.get('main')); return true;
        case 'dialog-save': {
            const options = dialogOptions(data, windows.language);
            const result = testMode && !runtime.manual ? await runtime.testSavePath(options) : await dialog.showSaveDialog(window, options);
            if (!result.canceled && result.filePath) result.filePath = await files.grant(result.filePath, true);
            return result;
        }
        case 'dialog-open': {
            const options = dialogOptions(data, windows.language);
            const allowed = ['openFile', 'openDirectory', 'multiSelections', 'showHiddenFiles', 'createDirectory'];
            options.properties = Array.isArray(data?.properties) ? data.properties.filter(value => allowed.includes(value)) : ['openFile'];
            const result = testMode && !runtime.manual ? {canceled: true, filePaths: []} : await dialog.showOpenDialog(window, options);
            if (!result.canceled) result.filePaths = await Promise.all(result.filePaths.map(file => files.grant(file)));
            return result;
        }
        case 'file-read':
            if (testMode) await runtime.safeTestPath(text(data, 'filePath'));
            return files.read(text(data, 'filePath'), data.encoding);
        case 'file-write': case 'project-file-write':
            if (testMode) await runtime.safeTestPath(text(data, 'filePath'));
            return files.write(text(data, 'filePath'), text(data, 'data'), data.encoding,
                action === 'project-file-write' ? data.revision ?? null : null, action === 'project-file-write');
        case 'recovery-draft-write': return recovery.write(data);
        case 'recovery-draft-read': return recovery.read(text(data, 'draftId'));
        case 'recovery-draft-list': return recovery.list();
        case 'recovery-draft-delete': return recovery.delete(text(data, 'draftId'));
        case 'get-app-version': return app.getVersion();
        case 'update-status': await runtime.updates.ready; return runtime.updates.status();
        case 'update-check': return runtime.updates.check();
        case 'update-download': return runtime.updates.download();
        case 'update-cancel': return runtime.updates.cancelDownload();
        case 'update-install': return runtime.updates.install();
        case 'update-configure': return runtime.updates.configure(data);
        case 'get-app-info': return {
            name: 'MollyStudio', version: app.getVersion(), buildVersion: app.getVersion() + '.0', author: 'nagivka', license: 'MIT',
            copyright: 'Copyright © 2026 nagivka', platform: process.platform, arch: process.arch, runtime: 'electron',
            electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
            distribution: !app.isPackaged ? 'development' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed'
        };
        case 'get-documents-path': return app.getPath('documents');
        case 'shell-show-in-folder': case 'shell-open-path': {
            if (testMode) return false;
            const file = await fs.realpath(text(data, 'filePath'));
            if (action === 'shell-show-in-folder') { shell.showItemInFolder(file); return true; }
            if (!(await fs.stat(file)).isDirectory()) throw Error('Открывать разрешено только папки.');
            return shell.openPath(file);
        }
        case 'shell-open-external': {
            const url = new URL(text(data, 'url'));
            if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw Error('Разрешены только ссылки HTTPS без учётных данных.');
            if (!testMode) await shell.openExternal(url.href);
            return true;
        }
        case 'discord-set-activity': if (!testMode) discord.setActivity(data); return true;
        case 'discord-clear-activity': discord.clearActivity(); return true;
        case 'discord-set-enabled': discord.setEnabled(!testMode && data === true); return true;
        case 'discord-set-client-id': return true;
        case 'discord-get-status': return discord.getStatus();
        case 'discord-reconnect': if (!testMode) discord.reconnect(); return discord.getStatus();
        case 'test-control':
            if (!testMode || runtime.manual) throw Error('Неизвестная системная команда.');
            return runtime.testControl(data);
        default: throw Error('Неизвестная системная команда.');
        }
    }
    function senderWindow(event) {
        const window = BrowserWindow.fromWebContents(event.sender), label = windows.label(window);
        if (!label || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !isAppPage(event.senderFrame.url)) throw Error('Системный запрос из недоверенного окна.');
        return {window, label};
    }
    ipcMain.handle('molly:renderer-result', (event, result) => {
        const {label} = senderWindow(event);
        if (label !== 'main') throw Error('Подтверждение предназначено редактору.');
        return runtime.transfers.complete(event.sender, result);
    });
    ipcMain.handle('molly:invoke', async (event, action, data) => {
        try {
            const {window, label} = senderWindow(event);
            if (typeof action !== 'string' || action.length > 80) throw Error('Некорректная системная команда.');
            return {ok: true, value: await dispatch(window, label, action, data)};
        } catch (error) { return {ok: false, error: error.message || String(error)}; }
    });
    return dispatch;
}

module.exports = {registerIpc, dialogOptions};
