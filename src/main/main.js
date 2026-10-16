const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { atomicWriteFile } = require('./fileStore.js');
const { createRecoveryStore, MAX_RECOVERY_FILE_BYTES } = require('./recoveryStore.js');
const { fileURLToPath } = require('node:url');
const { initializeAutoUpdater } = require('./autoUpdater.js');

let mainWindow = null;
let updateController = null;
const recoveryCloseWaiters = new Map();
ipcMain.handle('recovery-drafts-flushed', (event, success = true, confirmClose = false) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const finishClose = win ? recoveryCloseWaiters.get(win.id) : null;
    finishClose?.(success === true, confirmClose === true);
    return true;
});

function waitForRecoveryBeforeClose(win) {
    win.on('close', event => {
        if (win.__recoveryFlushComplete || win.__rendererGone || win.webContents.isDestroyed()) return;
        event.preventDefault();
        if (recoveryCloseWaiters.has(win.id)) return;

        let completed = false;
        const finish = async (success, confirmClose = false) => {
            if (completed) return;
            completed = true;
            clearTimeout(timeout);
            recoveryCloseWaiters.delete(win.id);
            if (win.isDestroyed()) return;
            if (success) {
                if (confirmClose) {
                    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Закрыть MollyStudio?',
                        message: 'Есть изменения, не сохранённые в файл.', detail: 'Автокопии сохранены. Их можно открыть на главном экране при следующем запуске.',
                        buttons: ['Вернуться', 'Закрыть'], defaultId: 0, cancelId: 0 });
                    if (result.response !== 1 || win.isDestroyed()) { updateController?.cancelRestart?.(); return; }
                }
                win.__recoveryFlushComplete = true;
                win.close();
            } else {
                updateController?.cancelRestart?.();
                win.webContents.send('recovery-flush-failed');
            }
        };
        const timeout = setTimeout(() => finish(false), 15000);
        recoveryCloseWaiters.set(win.id, finish);

        const requestFlush = () => {
            if (completed || win.isDestroyed()) return;
            if (win.webContents.isLoading()) {
                win.webContents.once('did-finish-load', requestFlush);
                return;
            }
            win.webContents.send('flush-recovery-drafts');
        };
        requestFlush();
    });
}

const recoveryStore = createRecoveryStore(path.join(app.getPath('userData'), 'recovery-drafts'));

// Every application window stays within the bundled interface.
app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(error => console.error('Open URL:', error));
        return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
        try {
            const root = path.resolve(__dirname, '../../www');
            const relative = path.relative(root, fileURLToPath(url));
            if (relative.startsWith('..') || path.isAbsolute(relative)) event.preventDefault();
        } catch (_) { event.preventDefault(); }
    });
    contents.on('render-process-gone', (_event, details) => {
        const win = BrowserWindow.fromWebContents(contents);
        if (win) win.__rendererGone = true;
        console.error('Renderer stopped:', details.reason, details.exitCode);
    });
    contents.on('did-finish-load', () => {
        const win = BrowserWindow.fromWebContents(contents);
        if (win) win.__rendererGone = false;
    });
});
process.on('unhandledRejection', error => console.error('Unhandled asynchronous error:', error));

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

function createWindow() {

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        show: false,
        backgroundColor: '#131314',
        icon: process.platform === 'win32'
            ? path.join(__dirname, '../../www/assets/images/icon/app.ico')
            : path.join(__dirname, '../../www/assets/images/icon/icon256.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false,
            backgroundThrottling: false,
            v8CacheOptions: 'bypassHeatCheck'
        }
    });
    waitForRecoveryBeforeClose(mainWindow);

    // Content Security Policy header setup
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com;"
                ]
            }
        });
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`[RENDERER FAIL LOAD] ${errorCode}: ${errorDescription} for ${validatedURL}`);
    });

    mainWindow.webContents.on('console-message', details => {
        console.log(`[RENDERER CONSOLE ${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });

    // Show window smoothly
    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    // Load main application
    const targetPage = process.argv.find(arg => arg.startsWith('--page='))?.replace('--page=', '') || 'index.html';
    const safePage = (targetPage === 'editor.html' || targetPage === 'index.html') ? targetPage : 'index.html';
    mainWindow.loadFile(path.join(__dirname, `../../www/${safePage}`));

    // Track window maximize / restore / fullscreen state
    const notifyState = () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const isMax = mainWindow.isMaximized() || mainWindow.isFullScreen();
            mainWindow.webContents.send('window-state-changed', isMax);
        }
    };

    mainWindow.on('maximize', notifyState);
    mainWindow.on('unmaximize', notifyState);
    mainWindow.on('restore', notifyState);
    mainWindow.on('enter-full-screen', notifyState);
    mainWindow.on('leave-full-screen', notifyState);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

let settingsWindow = null;
let newProjectWindow = null;
let buttonGeneratorWindow = null;

function openSettingsWindow(tab = 'appearance') {
    tab = ['appearance', 'canvas', 'tools', 'export', 'discord', 'backup', 'hotkeys'].includes(tab) ? tab : 'appearance';
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('settings-tab-requested', tab);
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 760,
        height: 620,
        minWidth: 640,
        minHeight: 500,
        frame: false,
        backgroundColor: '#131314',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        icon: process.platform === 'win32'
            ? path.join(__dirname, '../../www/assets/images/icon/app.ico')
            : path.join(__dirname, '../../www/assets/images/icon/icon256.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    waitForRecoveryBeforeClose(settingsWindow);

    settingsWindow.loadFile(path.join(__dirname, '../../www/settings.html'), { query: { tab } });

    settingsWindow.once('ready-to-show', () => {
        settingsWindow.show();
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

function openNewProjectWindow() {
    if (newProjectWindow && !newProjectWindow.isDestroyed()) {
        newProjectWindow.show();
        newProjectWindow.focus();
        return;
    }

    newProjectWindow = new BrowserWindow({
        width: 560,
        height: 520,
        minWidth: 480,
        minHeight: 440,
        resizable: true,
        frame: false,
        backgroundColor: '#131314',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: true,
        icon: process.platform === 'win32'
            ? path.join(__dirname, '../../www/assets/images/icon/app.ico')
            : path.join(__dirname, '../../www/assets/images/icon/icon256.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    waitForRecoveryBeforeClose(newProjectWindow);

    newProjectWindow.loadFile(path.join(__dirname, '../../www/new-project.html'));

    newProjectWindow.once('ready-to-show', () => {
        newProjectWindow.show();
    });

    newProjectWindow.on('closed', () => {
        newProjectWindow = null;
    });
}

function openButtonGeneratorWindow() {
    if (buttonGeneratorWindow && !buttonGeneratorWindow.isDestroyed()) {
        buttonGeneratorWindow.show();
        buttonGeneratorWindow.focus();
        return;
    }

    buttonGeneratorWindow = new BrowserWindow({
        width: 1120,
        height: 760,
        minWidth: 880,
        minHeight: 580,
        resizable: true,
        frame: false,
        backgroundColor: '#131314',
        parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
        modal: false,
        icon: process.platform === 'win32'
            ? path.join(__dirname, '../../www/assets/images/icon/app.ico')
            : path.join(__dirname, '../../www/assets/images/icon/icon256.png'),
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true
        }
    });
    waitForRecoveryBeforeClose(buttonGeneratorWindow);

    buttonGeneratorWindow.loadFile(path.join(__dirname, '../../www/buttons.html'));

    buttonGeneratorWindow.once('ready-to-show', () => {
        buttonGeneratorWindow.show();
    });

    buttonGeneratorWindow.on('closed', () => {
        buttonGeneratorWindow = null;
    });
}

// IPC: Window management (supports any caller window)
ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
        win.minimize();
    }
});

ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!win || win.isDestroyed()) return false;
    if (win.isFullScreen()) {
        win.setFullScreen(false);
        return false;
    } else if (win.isMaximized()) {
        win.unmaximize();
        return false;
    } else {
        win.maximize();
        return true;
    }
});

ipcMain.handle('window-toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (!win || win.isDestroyed()) return false;
    const nextState = !win.isFullScreen();
    win.setFullScreen(nextState);
    return nextState;
});

ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (win && !win.isDestroyed()) {
        win.close();
    }
});

ipcMain.handle('window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    return win && !win.isDestroyed() ? (win.isMaximized() || win.isFullScreen()) : false;
});

// IPC: Standalone Modal Windows
ipcMain.handle('window-open-settings', (_event, tab) => {
    openSettingsWindow(tab);
    return true;
});

ipcMain.handle('window-open-new-project', () => {
    openNewProjectWindow();
    return true;
});

ipcMain.handle('window-open-button-generator', () => {
    openButtonGeneratorWindow();
    return true;
});

ipcMain.handle('button-generated', (_event, buttonData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('button-generated', buttonData);
        mainWindow.focus();
    }
    return true;
});

// IPC: Multi-Window Synchronization
ipcMain.handle('settings-broadcast', (_event, data) => {
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
            win.webContents.send('settings-updated', data);
        }
    });
    return true;
});

ipcMain.handle('project-created', (_event, projectData) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-created', projectData);
        mainWindow.focus();
    }
    if (newProjectWindow && !newProjectWindow.isDestroyed()) {
        newProjectWindow.close();
    }
    return true;
});

// IPC: Dialogs
ipcMain.handle('dialog-save', async (event, options = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true };
    const defaultFilters = [
        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
    ];

    try {
        const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
            title: options.title || 'Сохранить проект',
            defaultPath: options.defaultPath || 'project.mlst',
            filters: options.filters || defaultFilters
        });

        return {
            canceled: result.canceled,
            filePath: result.filePath || ''
        };
    } catch (err) {
        console.error('Save dialog error:', err);
        return { canceled: true, filePath: '' };
    }
});

ipcMain.handle('dialog-open', async (event, options = {}) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, filePaths: [] };
    const defaultFilters = [
        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
    ];

    try {
        const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender) || mainWindow, {
            title: options.title || 'Открыть проект',
            properties: options.properties || ['openFile'],
            filters: options.filters || defaultFilters
        });

        return {
            canceled: result.canceled,
            filePaths: result.filePaths || []
        };
    } catch (err) {
        console.error('Open dialog error:', err);
        return { canceled: true, filePaths: [] };
    }
});

// IPC: File System
ipcMain.handle('file-write', async (_event, filePath, data, encoding = 'utf-8') => {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path');
    }
    try {
        if (encoding === 'base64' && typeof data === 'string') {
            const cleanBase64 = data.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(cleanBase64, 'base64');
            await atomicWriteFile(filePath, buffer);
        } else {
            await atomicWriteFile(filePath, data, { encoding });
        }
        return true;
    } catch (err) {
        console.error('Failed to write file:', filePath, err);
        throw err;
    }
});

ipcMain.handle('recovery-draft-write', (_event, draft) => recoveryStore.write(draft));
ipcMain.handle('recovery-draft-read', (_event, id) => recoveryStore.read(id));
ipcMain.handle('recovery-draft-list', () => recoveryStore.list());
ipcMain.handle('recovery-draft-delete', (_event, id) => recoveryStore.delete(id));

ipcMain.handle('file-read', async (_event, filePath, encoding = 'utf-8') => {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('Invalid file path');
    }
    try {
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_RECOVERY_FILE_BYTES) {
            throw new Error('Файл проекта превышает безопасный предел размера 512 МБ.');
        }
        return await fs.readFile(filePath, encoding);
    } catch (err) {
        console.error('Failed to read file:', filePath, err);
        throw err;
    }
});

// IPC: App Info & Shell
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.handle('shell-show-in-folder', (_event, filePath) => {
    if (filePath && typeof filePath === 'string') {
        try {
            shell.showItemInFolder(filePath);
            return true;
        } catch (err) {
            console.error('Failed to show item in folder:', err);
        }
    }
    return false;
});

ipcMain.handle('shell-open-path', async (_event, targetPath) => {
    if (targetPath && typeof targetPath === 'string') {
        try {
            return await shell.openPath(targetPath);
        } catch (err) {
            console.error('Failed to open path:', err);
        }
    }
    return '';
});

ipcMain.handle('get-documents-path', () => {
    try {
        return app.getPath('documents');
    } catch (err) {
        return '';
    }
});

// IPC: Discord Rich Presence
const discordRPC = require('./discordRPC');

ipcMain.handle('discord-set-activity', (_event, activity) => {
    discordRPC.setActivity(activity);
    return true;
});

ipcMain.handle('discord-clear-activity', () => {
    discordRPC.clearActivity();
    return true;
});

ipcMain.handle('discord-set-enabled', (_event, enabled) => {
    discordRPC.setEnabled(enabled);
    return true;
});

ipcMain.handle('discord-set-client-id', (_event, clientId) => {
    discordRPC.setClientId(clientId);
    return true;
});

ipcMain.handle('discord-get-status', () => {
    return discordRPC.getStatus();
});

ipcMain.handle('discord-reconnect', () => {
    discordRPC.reconnect();
    return discordRPC.getStatus();
});

// App Lifecycle
app.whenReady().then(() => {
    if (gotTheLock) {
        createWindow();
        updateController = initializeAutoUpdater({ app, autoUpdater: require('electron-updater').autoUpdater, dialog, getWindow: () => mainWindow });
        try {
            discordRPC.connect();
            discordRPC.setActivity({
                details: 'MollyStudio',
                state: 'В главном меню',
                showTime: true,
                startTimestamp: Date.now()
            });
        } catch (e) {
            console.error('[DiscordRPC] Init error:', e);
        }
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0 && gotTheLock) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    try {
        discordRPC.clearActivity();
        discordRPC.cleanup();
    } catch (_) {}
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

