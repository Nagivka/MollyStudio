const fs = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {atomicWrite} = require('./storage.cjs');
const run = promisify(execFile);

/** Per-user association; Windows UserChoice and other applications are preserved. */
async function registerFileAssociation(app) {
    if (process.platform !== 'win32' || !app.isPackaged) return false;
    const key = 'HKCU\\Software\\Classes';
    const reg = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/reg.exe');
    const add = (subkey, value, name = null) => run(reg, ['add', `${key}\\${subkey}`, name ? '/v' : '/ve', ...(name ? [name] : []), '/t', 'REG_SZ', '/d', value, '/f'], {windowsHide: true, timeout: 10000});
    const iconDirectory = path.join(app.getPath('userData'), 'icons');
    await fs.mkdir(iconDirectory, {recursive: true});
    const icon = path.join(iconDirectory, 'mlst.ico');
    await atomicWrite(icon, await fs.readFile(path.join(app.getAppPath(), 'src/renderer/assets/images/icon/mlst.ico')));
    // An installed copy owns the association; a portable copy does not steal it.
    const commandKey = `${key}\\MollyStudio.Project\\shell\\open\\command`;
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
        try {
            const {stdout} = await run(reg, ['query', commandKey, '/ve'], {windowsHide: true, timeout: 10000});
            const existing = stdout.match(/REG_SZ\s+"([^"]+)"/i)?.[1];
            if (existing && existing.toLowerCase() !== process.env.PORTABLE_EXECUTABLE_FILE.toLowerCase() && await fs.stat(existing).catch(() => null)) return false;
        } catch { /* No existing association. */ }
    }
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
    await add('MollyStudio.Project', 'Проект MollyStudio');
    await add('MollyStudio.Project\\DefaultIcon', `"${icon}",0`);
    await add('MollyStudio.Project\\shell\\open\\command', `"${executable}" "%1"`);
    await add('.mlst', 'MollyStudio.Project');
    await add('.mlst\\OpenWithProgids', '', 'MollyStudio.Project');
    return true;
}

module.exports = {registerFileAssociation};
