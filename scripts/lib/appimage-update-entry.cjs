// Included only in the private update fixture, never in release packages.
const fs = require('node:fs/promises');
const path = require('node:path');
const electron = require('electron');
const {app, protocol} = electron;
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux') throw Error('Private Linux CI fixture only');
const config = JSON.parse(require('node:fs').readFileSync(process.env.MOLLY_CI_APPIMAGE, 'utf8'));
const {createApplication} = require('./src/main/application.cjs');
const {configureProfile} = require('./src/main/profile.cjs');
const {installLifecycle} = require('./src/main/lifecycle.cjs');
const {UpdateService} = require('./src/main/updates.cjs');
app.setName('MollyStudio');
configureProfile(app);
protocol.registerSchemesAsPrivileged([{scheme: 'molly', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true}}]);
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
    const runtime = await createApplication(electron);
    runtime.updates.dispose();
    const {AppImageUpdater} = require('electron-updater');
    runtime.updates = new UpdateService({app, windows: runtime.windows, portable: false,
        publicKey: config.publicKey,
        request: async (url, limit, signal) => {
            const name = url.endsWith('/releases/latest') ? 'release.json' : path.basename(new URL(url).pathname);
            const response = await fetch(config.base + name, {signal});
            if (!response.ok) throw Error('Fixture HTTP failed');
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > limit) throw Error('Fixture response limit');
            return bytes;
        },
        engineFactory: () => {
            const engine = new AppImageUpdater();
            const setFeed = engine.setFeedURL.bind(engine);
            engine.setFeedURL = options => setFeed({...options, url: config.base});
            return engine;
        }});
    installLifecycle(app, runtime.windows);
    runtime.enqueue([config.project]);
    const win = runtime.windows.get('main');
    let opened = false;
    for (let attempt = 0; attempt < 300 && !opened; attempt++) {
        opened = await win.webContents.executeJavaScript(`window.mollyEditor?.getActiveProject()?.filePath === ${JSON.stringify(config.project)}`).catch(() => false);
        if (!opened) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!opened) throw Error('The update fixture project did not open');
    if (app.getVersion() === config.nextVersion) {
        const layerNames = await win.webContents.executeJavaScript('mollyEditor.layerManager.layers.map(layer => layer.name)');
        const summaries = await runtime.recovery.list();
        const drafts = await Promise.all(summaries.map(item => runtime.recovery.read(item.draftId)));
        await fs.writeFile(config.result, JSON.stringify({version: app.getVersion(), executable: process.env.APPIMAGE, layerNames, drafts}));
        app.exit(0);
        return;
    }
    await win.webContents.executeJavaScript(`(async () => {
        const editor = mollyEditor;
        editor.settingsManager.set('confirmClose', false);
        const layer = editor.layerManager.addLayer('Saved before update');
        layer.ctx.fillStyle = '#4588FF';layer.ctx.fillRect(4, 4, 10, 10);layer.invalidateSource();
        if (!await editor.projectManager.saveProject()) throw Error('Fixture project save failed');
        const pending = editor.layerManager.addLayer('Pending before update');
        pending.ctx.fillStyle = '#FF8844';pending.ctx.fillRect(20, 20, 8, 8);pending.invalidateSource();
        editor.bus.emit('CANVAS_UPDATED');
    })()`);
    await runtime.updates.check();
    if (runtime.updates.status().status !== 'available') throw Error(JSON.stringify(runtime.updates.status()));
    await runtime.updates.download();
    if (runtime.updates.status().status !== 'downloaded') throw Error(JSON.stringify(runtime.updates.status()));
    if (!await runtime.updates.install()) throw Error('Fixture update installation rejected');
}).catch(async error => {
    await fs.writeFile(config.result, JSON.stringify({error: error.stack}));
    app.exit(1);
});
