const { contextBridge, ipcRenderer, webUtils } = require('electron');

const recoveryFlushHandlers = new Set();
ipcRenderer.on('flush-recovery-drafts', async () => {
    let success = true;
    let confirmClose = false;
    try {
        const results = await Promise.all([...recoveryFlushHandlers].map(handler => handler()));
        success = results.every(result => result !== false);
        confirmClose = results.some(result => result?.confirmClose === true);
    } catch (error) {
        success = false;
        console.error('Recovery draft flush failed before window close:', error);
    } finally {
        ipcRenderer.invoke('recovery-drafts-flushed', success, confirmClose).catch(() => {});
    }
});

ipcRenderer.on('recovery-flush-failed', () => {
    globalThis.dispatchEvent(new Event('recovery-flush-failed'));
});

contextBridge.exposeInMainWorld('electronAPI', {
    // Window controls
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    toggleFullScreen: () => ipcRenderer.invoke('window-toggle-fullscreen'),
    close: () => ipcRenderer.invoke('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onWindowStateChange: (callback) => {
        const handler = (_event, isMax) => callback(isMax);
        ipcRenderer.on('window-state-changed', handler);
        return () => ipcRenderer.removeListener('window-state-changed', handler);
    },

    // Multi-Window & Dialogs
    openSettingsWindow: (tab) => ipcRenderer.invoke('window-open-settings', tab),
    onSettingsTabRequested: (callback) => {
        const handler = (_event, tab) => callback(tab);
        ipcRenderer.on('settings-tab-requested', handler);
        return () => ipcRenderer.removeListener('settings-tab-requested', handler);
    },
    openNewProjectWindow: () => ipcRenderer.invoke('window-open-new-project'),
    openButtonGeneratorWindow: () => ipcRenderer.invoke('window-open-button-generator'),
    notifyButtonGenerated: (data) => ipcRenderer.invoke('button-generated', data),
    onButtonGenerated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('button-generated', handler);
        return () => ipcRenderer.removeListener('button-generated', handler);
    },
    broadcastSettings: (data) => ipcRenderer.invoke('settings-broadcast', data),
    onSettingsUpdated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('settings-updated', handler);
        return () => ipcRenderer.removeListener('settings-updated', handler);
    },
    notifyProjectCreated: (data) => ipcRenderer.invoke('project-created', data),
    onProjectCreated: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('project-created', handler);
        return () => ipcRenderer.removeListener('project-created', handler);
    },

    // File Dialogs
    showSaveDialog: (options) => ipcRenderer.invoke('dialog-save', options),
    showOpenDialog: (options) => ipcRenderer.invoke('dialog-open', options),

    // File System operations
    writeFile: (filePath, data, encoding = 'utf-8') => ipcRenderer.invoke('file-write', filePath, data, encoding),
    readFile: (filePath, encoding = 'utf-8') => ipcRenderer.invoke('file-read', filePath, encoding),

    // Crash recovery data stays in the app's private user-data directory.
    writeRecoveryDraft: (draft) => ipcRenderer.invoke('recovery-draft-write', draft),
    readRecoveryDraft: (draftId) => ipcRenderer.invoke('recovery-draft-read', draftId),
    listRecoveryDrafts: () => ipcRenderer.invoke('recovery-draft-list'),
    deleteRecoveryDraft: (draftId) => ipcRenderer.invoke('recovery-draft-delete', draftId),
    onFlushRecoveryDrafts: (callback) => {
        if (typeof callback !== 'function') return () => {};
        recoveryFlushHandlers.add(callback);
        return () => recoveryFlushHandlers.delete(callback);
    },

    // App info & Shell
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell-show-in-folder', filePath),
    openPath: (targetPath) => ipcRenderer.invoke('shell-open-path', targetPath),
    getDocumentsPath: () => ipcRenderer.invoke('get-documents-path'),

    // File Utilities for Drag-and-Drop
    getPathForFile: (file) => {
        try {
            return (webUtils && typeof webUtils.getPathForFile === 'function')
                ? webUtils.getPathForFile(file)
                : (file?.path || '');
        } catch (e) {
            return file?.path || '';
        }
    },

    // Discord Rich Presence
    updateDiscordPresence: (data) => ipcRenderer.invoke('discord-set-activity', data),
    clearDiscordPresence: () => ipcRenderer.invoke('discord-clear-activity'),
    setDiscordEnabled: (enabled) => ipcRenderer.invoke('discord-set-enabled', enabled),
    setDiscordClientId: (clientId) => ipcRenderer.invoke('discord-set-client-id', clientId),
    getDiscordStatus: () => ipcRenderer.invoke('discord-get-status'),
    reconnectDiscord: () => ipcRenderer.invoke('discord-reconnect')
});
