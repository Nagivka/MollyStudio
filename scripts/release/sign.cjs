const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, sign} = require('node:crypto');
const {PUBLIC_KEY, releaseNames, readManifest, signingKey} = require('../../src/main/update-security.cjs');
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);

async function prepareRelease(root, info, privateKey, publicKey = PUBLIC_KEY) {
    signingKey(privateKey, publicKey);
    const files = [];
    for (const name of releaseNames(info.version)) {
        const bytes = await fs.readFile(path.join(root, 'dist', name));
        files.push({name, bytes, type: name.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' : 'application/octet-stream'});
    }
    if (files[0].bytes[0] !== 0x4d || files[0].bytes[1] !== 0x5a) throw Error('Invalid installer executable.');
    const checksum = await fs.readFile(path.join(root, 'dist', info.filename + '.sha256'));
    if (checksum.toString('utf8').trim() !== `${hash(files[0].bytes, 'sha256', 'hex')}  ${info.filename}`) throw Error('Installer checksum mismatch.');
    const notes = (await fs.readFile(info.notesPath, 'utf8')).trim();
    const payload = {version: info.version, platform: 'win32', arch: 'x64', format: 'nsis', notes,
        files: files.map(file => ({name: file.name, size: file.bytes.length,
            sha256: hash(file.bytes, 'sha256', 'hex'), sha512: hash(file.bytes, 'sha512', 'base64')}))};
    const content = Buffer.from(JSON.stringify(payload));
    const envelope = JSON.stringify({schema: 2, payload: content.toString('base64'), signature: sign(null, content, privateKey).toString('base64')}, null, 2) + '\n';
    readManifest(envelope, info.version, publicKey);
    files.push({name: info.filename + '.sha256', bytes: checksum, type: 'text/plain'});
    files.push({name: 'release-manifest.json', bytes: Buffer.from(envelope), type: 'application/json'});
    return files;
}
module.exports = {prepareRelease};
