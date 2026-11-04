const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, sign} = require('node:crypto');
const {PUBLIC_KEY, releaseNames, readManifest, signingKey} = require('../../src/main/update-security.cjs');
const {updateTarget}=require('../../src/main/update-targets.cjs');
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding);

async function prepareRelease(root, info, privateKey, publicKey = PUBLIC_KEY,target=updateTarget('win32','x64')) {
    signingKey(privateKey, publicKey);
    const files = [];
    const names=releaseNames(info.version,target),filename=names[0];
    for (const name of names) {
        const bytes = await fs.readFile(path.join(root, 'dist', name));
        files.push({name, bytes, type: name.endsWith('.exe') ? 'application/vnd.microsoft.portable-executable' : 'application/octet-stream'});
    }
    const first=files[0].bytes;
    if(target.platform==='win32'&&(first[0]!==0x4d||first[1]!==0x5a)||target.platform==='darwin'&&(first[0]!==0x50||first[1]!==0x4b||first[2]!==3||first[3]!==4)||target.platform==='linux'&&(first[0]!==0x7f||first.toString('ascii',1,4)!=='ELF'))throw Error('Invalid release artifact.');
    const checksum = await fs.readFile(path.join(root, 'dist', filename + '.sha256'));
    if (checksum.toString('utf8').trim() !== `${hash(files[0].bytes, 'sha256', 'hex')}  ${filename}`) throw Error('Installer checksum mismatch.');
    const notes = (await fs.readFile(info.notesPath, 'utf8')).trim();
    const payload = {version: info.version, platform: target.platform, arch: target.arch, format: target.format, notes,
        files: files.map(file => ({name: file.name, size: file.bytes.length,
            sha256: hash(file.bytes, 'sha256', 'hex'), sha512: hash(file.bytes, 'sha512', 'base64')}))};
    const content = Buffer.from(JSON.stringify(payload));
    const envelope = JSON.stringify({schema: 2, payload: content.toString('base64'), signature: sign(null, content, privateKey).toString('base64')}, null, 2) + '\n';
    readManifest(envelope, info.version, publicKey,target);
    files.push({name: filename + '.sha256', bytes: checksum, type: 'text/plain'});
    files.push({name: target.manifest, bytes: Buffer.from(envelope), type: 'application/json'});
    return files;
}
module.exports = {prepareRelease};
