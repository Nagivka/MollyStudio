const path = require('node:path');
const {installProtocol, isAppPage} = require('./protocol.cjs');
const {Windows} = require('./windows.cjs');
const {FileAccess} = require('./storage.cjs');
const {RecoveryStore} = require('./recovery.cjs');
const {ProjectRequests} = require('./project-open.cjs');
const {DiscordRPC} = require('./discord.cjs');
const {registerIpc} = require('./ipc.cjs');
const {registerFileAssociation} = require('./file-association.cjs');
const {RendererRequests} = require('./renderer-requests.cjs');
const {UpdateService} = require('./updates.cjs');

async function createApplication(electron, options = {}) {
    const {app, protocol, net, session} = electron;
    const testMode = !app.isPackaged && options.testMode === true;
    const files = new FileAccess(), requests = new ProjectRequests();
    const recovery = new RecoveryStore(path.join(app.getPath('userData'), 'recovery-drafts'));
    const discord = new DiscordRPC();
    discord.enabled = false;
    const windows = new Windows(electron, {testMode, showOnReady: !testMode || options.manual === true,
        beforeClose: () => Promise.all([files.idle(), recovery.idle()])});
    const runtime = {windows, files, requests, recovery, discord, transfers: new RendererRequests(), testMode, manual: Boolean(options.manual)};
    runtime.updates = new UpdateService({app, windows, testMode});
    void runtime.updates.start().catch(error => console.warn('Updates:', error.message));
    installProtocol(protocol, net, path.join(__dirname, '../renderer'));
    const clipboard = permission => ['clipboard-read', 'clipboard-sanitized-write'].includes(permission);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
        callback(isAppPage(contents.getURL()) && details.isMainFrame !== false && clipboard(permission));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission) => Boolean(contents && isAppPage(contents.getURL()) && clipboard(permission)));
    session.defaultSession.on('will-download', event => event.preventDefault());
    if (testMode) Object.assign(runtime, require('./test-mode.cjs').createTestControls(runtime, options.profile));
    runtime.dispatch = registerIpc(electron, runtime);
    runtime.enqueue = (args, cwd) => {
        requests.enqueue(args, cwd);
        const main = windows.get('main');
        if (main) { windows.show(main); windows.send('main', 'project-open-requested'); }
    };
    if (!testMode) {
        runtime.migration = recovery.importFrom([path.join(app.getPath('appData'), 'ua.nagivka.mollystudio', 'recovery-drafts')])
            .catch(error => console.warn('Recovery migration:', error.message));
        registerFileAssociation(app).catch(error => console.warn('File association:', error.message));
    }
    app.once('quit', () => runtime.updates.dispose());
    app.on('will-quit', () => { discord.clearActivity(); discord.enabled = false; discord.cleanup(); });
    return runtime;
}

module.exports = {createApplication};
