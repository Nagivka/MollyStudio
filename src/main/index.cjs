const electron = require('electron');
const {createApplication} = require('./application.cjs');
const {configureProfile} = require('./profile.cjs');
const {app, protocol, dialog} = electron;

app.setName('MollyStudio');
app.setAppUserModelId('ua.nagivka.mollystudio');
const profile = configureProfile(app, process.env.MOLLY_TEST_PROFILE);

protocol.registerSchemesAsPrivileged([{scheme: 'molly', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true}}]);
const earlyOpens = [];
let runtime;
app.on('open-file', (event, file) => { event.preventDefault(); if (runtime) runtime.enqueue([file]); else earlyOpens.push({args: [file], cwd: process.cwd()}); });
if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', (_event, args, cwd) => { if (runtime) runtime.enqueue(args, cwd); else earlyOpens.push({args, cwd}); });
    app.whenReady().then(async () => {
        runtime = await createApplication(electron, {testMode: Boolean(profile), profile, manual: process.env.MOLLY_MANUAL_CHECK === '1'});
        if (profile) globalThis.__mollyTestRuntime = runtime;
        runtime.enqueue(process.argv.slice(app.isPackaged ? 1 : 2));
        for (const request of earlyOpens) runtime.enqueue(request.args, request.cwd);
        runtime.windows.create('main');
        app.on('activate', () => runtime.windows.show(runtime.windows.get('main') || runtime.windows.create('main')));
    }).catch(error => {
        console.error(error);
        dialog.showErrorBox('Не удалось запустить MollyStudio', error.message || String(error));
        app.exit(1);
    });
    app.on('window-all-closed', () => app.quit());
}
