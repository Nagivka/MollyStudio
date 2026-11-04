const fs = require('node:fs/promises');
const path = require('node:path');
const {verifyFile} = require('./update-security.cjs');

async function installAppImage({current, download, expected, relaunch}) {
    if (!path.isAbsolute(current || '')) throw Error('UPDATE_INSTALL_FAILED');
    const destination = await fs.realpath(current);
    const original = await fs.stat(destination);
    if (!original.isFile()) throw Error('UPDATE_INSTALL_FAILED');
    const image = await fs.open(destination, 'r');
    try {
        const header = Buffer.alloc(11);
        const {bytesRead} = await image.read(header, 0, header.length, 0);
        if (bytesRead !== header.length || header.toString('hex', 0, 4) !== '7f454c46' || header.toString('hex', 8) !== '414902') throw Error('UPDATE_INSTALL_FAILED');
    } finally { await image.close(); }
    const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.molly-update-'));
    const candidate = path.join(staging, 'new.AppImage');
    const backup = path.join(staging, 'old.AppImage');
    const previous = destination + '.previous';
    try {
        await fs.copyFile(download, candidate);
        await verifyFile(candidate, expected);
        const handle = await fs.open(candidate, 'r+');
        try {
            await handle.chmod(original.mode & 0o777);
            await handle.sync();
        } finally { await handle.close(); }
        try { await fs.link(destination, backup); }
        catch (error) {
            if (!['EPERM', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK'].includes(error.code)) throw error;
            await fs.copyFile(destination, backup);
        }
        const latest = await fs.stat(destination);
        if (latest.ino !== original.ino || latest.dev !== original.dev || latest.mtimeMs !== original.mtimeMs || latest.size !== original.size) throw Error('UPDATE_INSTALL_FAILED');
        await fs.rename(backup, previous);
        // Publish with one rename on the destination filesystem. A failed copy
        // or verification never removes the executable users started from.
        await fs.rename(candidate, destination);
        try { await relaunch(destination); }
        catch (error) {
            await fs.rename(previous, destination);
            throw error;
        }
    } finally {
        await fs.rm(staging, {recursive: true, force: true}).catch(() => {});
    }
}

module.exports = {installAppImage};
