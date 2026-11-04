const {contextBridge, ipcRenderer, webUtils} = require('electron');

const flushHandlers = new Set();
const buffered = new Map(['settings-tab-requested', 'project-created','native-menu-action'].map(name => [name, {callbacks: new Set(), pending: []}]));
const requestCallbacks = new Map(), activeTransfers = new Set();
const closeStateHandlers = new Set();
let activeFlush = null;
function releaseFlush(flush) {
    if (activeFlush !== flush) return;
    activeFlush = null;
    if (flush.body) flush.body.inert = flush.wasInert;
    for (const callback of closeStateHandlers) { try { callback(false); } catch (error) { console.error('Close state:', error); } }
}
async function call(action, data = null) {
    const result = await ipcRenderer.invoke('molly:invoke', action, data);
    if (!result?.ok) throw Error(result?.error || 'Не удалось выполнить системную команду.');
    return result.value;
}
function listen(name, callback) {
    if (typeof callback !== 'function') return () => {};
    const buffer = buffered.get(name);
    if (buffer) {
        buffer.callbacks.add(callback);
        const pending = buffer.pending.splice(0);
        for (const data of pending) Promise.resolve().then(() => { if (buffer.callbacks.has(callback)) return callback(data); }).catch(console.error);
        return () => buffer.callbacks.delete(callback);
    }
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(name, handler);
    return () => ipcRenderer.removeListener(name, handler);
}

for (const [name, buffer] of buffered) ipcRenderer.on(name, (_event, data) => {
    if (!buffer.callbacks.size) {
        if (name === 'settings-tab-requested') buffer.pending = [data];
        else if (buffer.pending.length < 32) buffer.pending.push(data);
        return;
    }
    for (const callback of buffer.callbacks) Promise.resolve().then(() => callback(data)).catch(console.error);
});

ipcRenderer.on('molly:renderer-cancel', (_event, {id}) => activeTransfers.delete(id));
ipcRenderer.on('molly:renderer-request', async (_event, {id, name, data}) => {
    let success = false, error;
    activeTransfers.add(id);
    try {
        const callback = requestCallbacks.get(name);
        if (!callback) throw Error('Редактор ещё загружается. Повторите вставку через несколько секунд.');
        success = await callback({...data, transferId: id}) === true;
        if (!success) throw Error('Редактор не смог вставить кнопку. Проверьте выбранный проект и завершите текущую операцию.');
    } catch (failure) { error = failure.message || String(failure); }
    try { await ipcRenderer.invoke('molly:renderer-result', {id, success, error}); }
    catch (failure) { console.error('Editor acknowledgement:', failure); }
    finally { activeTransfers.delete(id); }
});

function listenRequest(name, callback) {
    if (typeof callback !== 'function') return () => {};
    requestCallbacks.set(name, callback);
    const stop = listen(name, callback);
    return () => { if (requestCallbacks.get(name) === callback) requestCallbacks.delete(name); stop(); };
}

const api = {
    runtime: 'electron',
    platform: process.platform,
    arch: process.arch,
    onNativeMenuAction: callback=>listen('native-menu-action',callback),
    nativeEdit: action=>call('native-edit',{action}),
    setNativeShortcuts: bindings=>call('native-shortcuts',{bindings}),
    setLanguage: language => call('language-set', {language}),
    getPendingProjectOpens: () => call('project-open-pending'),
    acknowledgeProjectOpen: id => call('project-open-ack', {id}),
    onProjectOpenRequested: callback => listen('project-open-requested', callback),
    registerFileAssociation: () => call('register-file-association'),
    minimize: () => call('window-minimize'),
    maximize: () => call('window-maximize'),
    toggleFullScreen: () => call('window-toggle-fullscreen'),
    close: () => call('window-close'),
    isMaximized: () => call('window-is-maximized'),
    isVisible: () => call('window-is-visible'),
    onWindowVisibilityChange: callback => listen('window-visibility-changed', callback),
    onWindowStateChange: callback => listen('window-state-changed', callback),
    openSettingsWindow: tab => call('window-open-settings', {tab}),
    onSettingsTabRequested: callback => listen('settings-tab-requested', callback),
    openNewProjectWindow: () => call('window-open-new-project'),
    openButtonGeneratorWindow: () => call('window-open-button-generator'),
    notifyButtonGenerated: data => call('button-generated', data),
    onButtonGenerated: callback => listenRequest('button-generated', callback),
    isTransferActive: id => activeTransfers.has(id),
    broadcastSettings: data => call('settings-broadcast', data),
    onSettingsUpdated: callback => listen('settings-updated', callback),
    notifyProjectCreated: data => call('project-created', data),
    onProjectCreated: callback => listen('project-created', callback),
    showSaveDialog: options => call('dialog-save', options),
    showOpenDialog: options => call('dialog-open', options),
    writeFile: (filePath, data, encoding = 'utf-8') => call('file-write', {filePath, data, encoding}),
    writeProjectFile: (filePath, data, revision) => call('project-file-write', {filePath, data, revision}),
    readFile: (filePath, encoding = 'utf-8') => call('file-read', {filePath, encoding}),
    writeRecoveryDraft: data => call('recovery-draft-write', data),
    readRecoveryDraft: draftId => call('recovery-draft-read', {draftId}),
    listRecoveryDrafts: () => call('recovery-draft-list'),
    deleteRecoveryDraft: draftId => call('recovery-draft-delete', {draftId}),
    onFlushRecoveryDrafts: callback => {
        if (typeof callback !== 'function') return () => {};
        flushHandlers.add(callback);
        return () => flushHandlers.delete(callback);
    },
    onCloseStateChange: callback => {
        if (typeof callback !== 'function') return () => {};
        closeStateHandlers.add(callback);
        return () => closeStateHandlers.delete(callback);
    },
    getAppVersion: () => call('get-app-version'),
    getUpdateStatus: () => call('update-status'),
    checkForUpdates: () => call('update-check'),
    downloadUpdate: () => call('update-download'),
    cancelUpdateDownload: () => call('update-cancel'),
    installUpdate: () => call('update-install'),
    configureUpdates: data => call('update-configure', data),
    onUpdateStatus: callback => listen('update-status', callback),
    getAppInfo: () => call('get-app-info'),
    showItemInFolder: filePath => call('shell-show-in-folder', {filePath}),
    openPath: filePath => call('shell-open-path', {filePath}),
    openExternal: url => call('shell-open-external', {url}),
    getDocumentsPath: () => call('get-documents-path'),
    getPathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
    updateDiscordPresence: data => call('discord-set-activity', data),
    clearDiscordPresence: () => call('discord-clear-activity'),
    setDiscordEnabled: enabled => call('discord-set-enabled', Boolean(enabled)),
    setDiscordClientId: clientId => call('discord-set-client-id', clientId),
    getDiscordStatus: () => call('discord-get-status'),
    reconnectDiscord: () => call('discord-reconnect')
};
contextBridge.exposeInMainWorld('desktopAPI', api);
const markPlatform=()=>{if(document.documentElement)document.documentElement.dataset.platform=process.platform;};
markPlatform();
document.addEventListener('DOMContentLoaded',markPlatform,{once:true});

listen('recovery-flush-failed', () => {
    if (activeFlush) releaseFlush(activeFlush);
    window.dispatchEvent(new Event('recovery-flush-failed'));
});
listen('flush-recovery-drafts', async ({token}) => {
    if (activeFlush) return;
    const flush = {token, body: document.body, wasInert: document.body?.inert || false};
    activeFlush = flush;
    for (const callback of closeStateHandlers) { try { callback(true); } catch (error) { console.error('Close state:', error); } }
    let success = true, confirmClose = false;
    try {
        const pending = [...flushHandlers].map(handler => Promise.resolve().then(handler));
        const completion = Promise.allSettled(pending);
        // Handlers finish existing strokes before input becomes inert.
        await Promise.resolve();
        if (activeFlush !== flush) return;
        if (flush.body) flush.body.inert = true;
        const results = await completion;
        for (const result of results) if (result.status === 'rejected') console.error('Recovery flush:', result.reason);
        success = results.every(result => result.status === 'fulfilled' && result.value !== false);
        confirmClose = results.some(result => result.status === 'fulfilled' && result.value?.confirmClose === true);
    } catch (error) { success = false; console.error('Recovery flush:', error); }
    try { if (activeFlush === flush) await call('recovery-drafts-flushed', {token, success, confirmClose}); }
    catch (error) {
        if (activeFlush === flush) { console.error('Close confirmation:', error); window.dispatchEvent(new Event('recovery-flush-failed')); }
    }
    finally { releaseFlush(flush); }
});

document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || !/^https?:/i.test(anchor.getAttribute('href'))) return;
    event.preventDefault();
    api.openExternal(anchor.href).catch(error => console.error('External link:', error));
});
