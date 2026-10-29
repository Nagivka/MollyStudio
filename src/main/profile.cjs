const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {pathKey} = require('./storage.cjs');

/** Electron requires every overridden directory to exist before app.setPath. */
function configureProfile(app, requestedProfile) {
    const privateProfile = !app.isPackaged && requestedProfile;
    let directory;
    if (privateProfile) {
        directory = fs.realpathSync.native(privateProfile);
        const temp = fs.realpathSync.native(os.tmpdir());
        if (pathKey(path.dirname(directory)) !== pathKey(temp) || !path.basename(directory).startsWith('molly-electron-check-')) throw Error('Invalid private test profile.');
    } else directory = path.join(app.getPath('appData'), 'MollyStudio');
    fs.mkdirSync(directory, {recursive: true});
    directory = fs.realpathSync.native(directory);
    const session = privateProfile ? path.join(directory, 'chromium') : directory;
    fs.mkdirSync(session, {recursive: true});
    if (privateProfile && pathKey(path.dirname(fs.realpathSync.native(session))) !== pathKey(directory)) throw Error('Private session escaped the fixture profile.');
    app.setPath('userData', directory);
    app.setPath('sessionData', session);
    return privateProfile ? directory : null;
}

module.exports = {configureProfile};
