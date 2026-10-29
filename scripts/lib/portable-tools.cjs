const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawn} = require('node:child_process');

const SEVEN_ZIP = Object.freeze({
    version: '26.05',
    url: 'https://github.com/ip7z/7zip/releases/download/26.05/7z2605-extra.7z',
    sha256: 'f27a8f103c84785026edcba1f67faf1357225df9d19ddb0b7760d55947141bc7',
    x86: '357929ec748d00728c64dd2e7aa0069258f40847c1410014bb60d22eb9ec75d5',
    x64: '7ddf0a3bc451e166679296be630d6f0573eb386159c04184761c43020c484291'
});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function run(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, {stdio: 'inherit', windowsHide: true, ...options});
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? resolve() : reject(Error(`${path.basename(file)} failed (${signal || code}).`)));
    });
}

async function ensure7zip(root) {
    const cache = path.join(root, '.test-output', 'build-tools', `7zip-${SEVEN_ZIP.version}`);
    const archive = path.join(cache, 'source.7z'), binary = path.join(cache, '7za.exe'), encoder = path.join(cache, 'x64', '7za.exe');
    const valid = async (file, expected) => digest(await fs.readFile(file).catch(() => Buffer.alloc(0))) === expected;
    await fs.mkdir(cache, {recursive: true});
    if (!await valid(archive, SEVEN_ZIP.sha256)) {
        console.log(`Downloading the pinned 7-Zip ${SEVEN_ZIP.version} build tool`);
        const response = await fetch(SEVEN_ZIP.url, {signal: AbortSignal.timeout(60000)});
        if (!response.ok) throw Error(`7-Zip download failed: HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (digest(bytes) !== SEVEN_ZIP.sha256) throw Error('7-Zip archive checksum mismatch.');
        await fs.writeFile(archive, bytes);
    }
    if (!await valid(binary, SEVEN_ZIP.x86) || !await valid(encoder, SEVEN_ZIP.x64)) {
        const unpacker = await require('app-builder-lib/out/toolsets/7zip').getPath7za();
        await run(unpacker, ['x', archive, '-o' + cache, '-y', '-bsp0']);
        if (!await valid(binary, SEVEN_ZIP.x86) || !await valid(encoder, SEVEN_ZIP.x64)) throw Error('7-Zip executable checksum mismatch.');
    }
    const license = path.join(cache, 'LICENSE.distribution.txt');
    await fs.writeFile(license, Buffer.concat([
        await fs.readFile(path.join(cache, 'License.txt')),
        Buffer.from(`\n\nUnmodified 7-Zip Extra ${SEVEN_ZIP.version}, Igor Pavlov.\nSource: https://github.com/ip7z/7zip/releases/tag/${SEVEN_ZIP.version}\nhttps://www.7-zip.org/\n`)
    ]));
    return {binary, encoder, license};
}

module.exports = {SEVEN_ZIP, digest, ensure7zip, run};
