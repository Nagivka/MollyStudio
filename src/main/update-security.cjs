const {createHash, createPublicKey, verify} = require('node:crypto');
const fs = require('node:fs');

const REPOSITORY = 'Nagivka/MollyStudio-Releases';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases/latest`;
const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAYwa8DCRVY9QcKzX9k8D0tm+JNDwy8OyeS3swnPTnaDY=\n-----END PUBLIC KEY-----\n';
const stableVersion = value => typeof value === 'string' && /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(value);
function compareVersions(a, b) {
    if (!stableVersion(a) || !stableVersion(b)) throw Error('UPDATE_INVALID_VERSION');
    const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i] ? 1 : -1;
    return 0;
}
function releaseNames(version) {
    if (!stableVersion(version)) throw Error('UPDATE_INVALID_VERSION');
    const installer = `MollyStudio-${version}.0-x64-setup.exe`;
    return [installer, installer + '.blockmap', 'latest.yml'];
}
const downloadBase = version => `https://github.com/${REPOSITORY}/releases/download/v${version}/`;
function readManifest(source, expectedVersion, publicKey = PUBLIC_KEY) {
    if (Buffer.byteLength(source) > 64 * 1024) throw Error('UPDATE_INVALID_MANIFEST');
    let envelope, payload;
    try {
        envelope = JSON.parse(source);
        if (envelope.schema !== 2 || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw Error();
        const bytes = Buffer.from(envelope.payload, 'base64'), signature = Buffer.from(envelope.signature, 'base64');
        if (bytes.toString('base64') !== envelope.payload || signature.length !== 64 ||
            signature.toString('base64') !== envelope.signature || !verify(null, bytes, publicKey, signature)) throw Error();
        payload = JSON.parse(bytes.toString('utf8'));
    } catch { throw Error('UPDATE_INVALID_SIGNATURE'); }
    const names = releaseNames(expectedVersion);
    if (payload.version !== expectedVersion || payload.platform !== 'win32' || payload.arch !== 'x64' ||
        payload.format !== 'nsis' || !Array.isArray(payload.files) || payload.files.length !== 3 ||
        typeof payload.notes !== 'string' || payload.notes.length > 8000) throw Error('UPDATE_INVALID_MANIFEST');
    for (let i = 0; i < names.length; i++) {
        const file = payload.files[i];
        const max = i === 0 ? 300_000_000 : i === 1 ? 10_000_000 : 64 * 1024;
        if (file?.name !== names[i] || !Number.isSafeInteger(file.size) || file.size < (i === 0 ? 1_000_000 : 1) || file.size > max ||
            typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) ||
            typeof file.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512)) throw Error('UPDATE_INVALID_MANIFEST');
    }
    return payload;
}
function validateUpdateInfo(info, manifest) {
    const file = manifest.files[0];
    if (info?.version !== manifest.version || info.packages != null || !Array.isArray(info.files) || info.files.length !== 1 ||
        info.files[0].url !== file.name || info.files[0].sha512 !== file.sha512 || info.files[0].size !== file.size ||
        (info.path != null && info.path !== file.name) || (info.sha512 != null && info.sha512 !== file.sha512)) throw Error('UPDATE_UNTRUSTED_METADATA');
}
async function verifyFile(filename, expected) {
    const handle = await fs.promises.open(filename, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== expected.size) throw Error('UPDATE_INVALID_DOWNLOAD');
        const h256 = createHash('sha256'), h512 = createHash('sha512');
        let bytes = 0;
        for await (const chunk of handle.createReadStream({autoClose: false})) {
            if (!bytes && expected.name.endsWith('.exe') && (chunk[0] !== 0x4d || chunk[1] !== 0x5a)) throw Error('UPDATE_INVALID_DOWNLOAD');
            bytes += chunk.length;
            if (bytes > expected.size) throw Error('UPDATE_INVALID_DOWNLOAD');
            h256.update(chunk); h512.update(chunk);
        }
        if (bytes !== expected.size || h256.digest('hex') !== expected.sha256 || h512.digest('base64') !== expected.sha512) throw Error('UPDATE_INVALID_DOWNLOAD');
    } finally { await handle.close(); }
}
function signingKey(privateKey, publicKey = PUBLIC_KEY) {
    if (!privateKey || createPublicKey(privateKey).export({type: 'spki', format: 'pem'}) !== publicKey) throw Error('Release signing key does not match the application trust key.');
    return privateKey;
}
module.exports = {REPOSITORY, RELEASES_URL, PUBLIC_KEY, stableVersion, compareVersions, releaseNames, downloadBase, readManifest, validateUpdateInfo, verifyFile, signingKey};
