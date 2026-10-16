'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { releaseNames, hashFileSync, readSignedManifest, verifyReleaseFile } = require('../src/main/updateSignature.js');
const root = path.resolve(__dirname, '..');

function signRelease() {
    const { version } = require('../package.json');
    const dist = path.join(root, 'dist');
    const privateKey = process.env.UPDATES_SIGNING_KEY || fs.readFileSync(path.join(root, '.secrets/updates.private.pem'), 'utf8');
    const { publicKey } = require('../src/main/update-trust.json');
    const actualKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    if (actualKey !== publicKey) throw new Error('Ключ выпуска не соответствует открытому ключу в приложении.');
    const payload = { version, files: releaseNames(version).map(name => {
        const file = path.join(dist, name);
        return { name, size: fs.statSync(file).size, sha512: hashFileSync(file) };
    }) };
    const bytes = Buffer.from(JSON.stringify(payload));
    const envelope = { schema: 1, payload: bytes.toString('base64'), signature: crypto.sign(null, bytes, privateKey).toString('base64') };
    const output = JSON.stringify(envelope, null, 2) + '\n';
    const verified = readSignedManifest(output, publicKey, version);
    for (const entry of verified.files) verifyReleaseFile(path.join(dist, entry.name), verified);
    fs.writeFileSync(path.join(dist, 'release-manifest.json'), output);
    console.log(`Подписаны три файла выпуска ${version}; закрытый ключ не включён в результат.`);
    return verified;
}

if (require.main === module) signRelease();
module.exports = { signRelease };
