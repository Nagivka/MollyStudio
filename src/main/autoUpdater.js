'use strict';

const UPDATE_CHECK_DELAY_MS = 15_000;

/** Start the GitHub release updater for installed production builds only. */
function initializeAutoUpdater({ app, autoUpdater, dialog, getWindow = () => null, logger = console, setTimeoutFn = setTimeout }) {
    if (!app.isPackaged || process.env.MOLLYSTUDIO_DISABLE_UPDATES === '1' || isPortableBuild()) {
        return false;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('checking-for-update', () => logger.info('[Updater] Проверяю обновления.'));
    autoUpdater.on('update-available', info => logger.info(`[Updater] Найдена версия ${info.version}; загрузка началась.`));
    autoUpdater.on('update-not-available', info => logger.info(`[Updater] Установлена последняя версия ${info.version}.`));
    autoUpdater.on('download-progress', progress => logger.info(`[Updater] Загрузка: ${Math.round(progress.percent)}%.`));
    autoUpdater.on('error', error => logger.error('[Updater] Не удалось проверить или загрузить обновление:', error));
    autoUpdater.on('update-downloaded', info => {
        logger.info(`[Updater] Версия ${info.version} загружена.`);
        const ownerWindow = getWindow();
        const options = {
            type: 'info',
            title: 'Обновление MollyStudio готово',
            message: `Версия ${info.version} загружена.`,
            detail: 'Перезапустите приложение, чтобы установить обновление. Несохранённые изменения будут обработаны обычным способом при закрытии.',
            buttons: ['Перезапустить', 'Позже'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        };
        const prompt = ownerWindow && !ownerWindow.isDestroyed()
            ? dialog.showMessageBox(ownerWindow, options)
            : dialog.showMessageBox(options);
        void prompt.then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall(false, true);
        }).catch(error => logger.error('[Updater] Не удалось показать уведомление об обновлении:', error));
    });

    const timer = setTimeoutFn(() => {
        void autoUpdater.checkForUpdates().catch(error => logger.error('[Updater] Проверка обновлений завершилась ошибкой:', error));
    }, UPDATE_CHECK_DELAY_MS);
    timer?.unref?.();
    return true;
}

function isPortableBuild() {
    return process.platform === 'win32' && Boolean(
        process.env.PORTABLE_EXECUTABLE_DIR ||
        process.env.PORTABLE_EXECUTABLE_FILE ||
        process.env.PORTABLE_EXECUTABLE_APP_FILENAME
    );
}

module.exports = { initializeAutoUpdater, isPortableBuild, UPDATE_CHECK_DELAY_MS };
