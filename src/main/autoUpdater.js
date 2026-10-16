'use strict';

const { readSignedManifest, verifyReleaseFile, releaseNames, MAX_MANIFEST_BYTES } = require('./updateSignature.js');
const trust = require('./update-trust.json');
const UPDATE_CHECK_DELAY_MS = 15_000;

async function loadReleaseManifest(version) {
    releaseNames(version);
    const { net } = require('electron');
    const response = await net.fetch(`https://github.com/Nagivka/MollyStudio-Updates/releases/download/v${version}/release-manifest.json`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Не удалось получить подпись обновления: HTTP ${response.status}.`);
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_MANIFEST_BYTES) throw new Error('Слишком большой манифест обновления.');
            chunks.push(Buffer.from(value));
        }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
}

/** Installer launches only after all windows have finished their normal recovery/close flow. */
function initializeAutoUpdater({ app, autoUpdater, dialog, getWindow = () => null, logger = console, setTimeoutFn = setTimeout,
    loadManifest = loadReleaseManifest, verifyFile = verifyReleaseFile, publicKey = trust.publicKey, platform = process.platform, env = process.env }) {
    if (!app.isPackaged || platform !== 'win32' || env.MOLLYSTUDIO_DISABLE_UPDATES === '1' || isPortableBuild(env, platform)) return false;

    autoUpdater.autoDownload = true;
    // Never let electron-updater install a cached file before our signature verification.
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
    let pending = null, restartRequested = false, quitting = false, installing = false;
    const checkingVersions = new Set();

    autoUpdater.on('checking-for-update', () => logger.info('[Updater] Проверяю обновления.'));
    autoUpdater.on('update-available', info => logger.info(`[Updater] Найдена версия ${info.version}; загрузка началась.`));
    autoUpdater.on('error', error => logger.error('[Updater] Обновление не выполнено:', error.message));
    autoUpdater.on('update-downloaded', info => {
        void acceptUpdate(info).catch(error => logger.error('[Updater] Установка заблокирована:', error.message));
    });

    async function acceptUpdate(info) {
        if (pending?.version === info.version || checkingVersions.has(info.version)) return;
        checkingVersions.add(info.version);
        try {
            const manifest = await loadManifest(info.version);
            const payload = readSignedManifest(manifest, publicKey, info.version);
            if (typeof info.downloadedFile !== 'string') throw new Error('Нет пути к загруженному установщику.');
            const installerName = releaseNames(info.version)[0];
            verifyFile(info.downloadedFile, payload, installerName);
            pending = { version: info.version, file: info.downloadedFile, manifest, installerName };
            logger.info(`[Updater] Подпись и содержимое версии ${info.version} проверены.`);
            if (quitting) return;
            const options = { type: 'info', title: 'Обновление MollyStudio готово', message: `Версия ${info.version} загружена и проверена.`,
                detail: 'Установить обновление при следующем закрытии или перезапустить сейчас? Изменения проектов будут сохранены в автокопии перед закрытием.',
                buttons: ['Перезапустить', 'При закрытии'], defaultId: 0, cancelId: 1, noLink: true };
            const owner = getWindow();
            const result = owner && !owner.isDestroyed() ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
            if (result.response === 0) { restartRequested = true; app.quit(); }
        } finally { checkingVersions.delete(info.version); }
    }

    app.on('before-quit', () => { quitting = true; });
    app.on('will-quit', () => {
        if (!pending || installing) return;
        try {
            // A cached installer may have changed since the download event. Fail closed.
            const payload = readSignedManifest(pending.manifest, publicKey, pending.version);
            verifyFile(pending.file, payload, pending.installerName);
            installing = true;
            autoUpdater.quitAndInstall(true, restartRequested);
        } catch (error) { logger.error('[Updater] Установка при закрытии заблокирована:', error.message); }
    });

    const timer = setTimeoutFn(() => {
        void autoUpdater.checkForUpdates().catch(error => logger.error('[Updater] Ошибка проверки:', error.message));
    }, UPDATE_CHECK_DELAY_MS);
    timer?.unref?.();
    return { cancelRestart() { restartRequested = false; quitting = false; } };
}

function isPortableBuild(env = process.env, platform = process.platform) {
    return platform === 'win32' && Boolean(env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_APP_FILENAME);
}

module.exports = { initializeAutoUpdater, isPortableBuild, UPDATE_CHECK_DELAY_MS };
