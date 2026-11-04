const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {installAppImage} = require('../src/main/appimage-install.cjs');

const hash = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const root = path.resolve(__dirname, '..');

async function main() {
    assert.ok(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux', 'Use a disposable Linux GitHub runner');
    const source = path.resolve(process.argv[2]);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-appimage-compatibility-'));
    const current = path.join(directory, 'MollyStudio.AppImage');
    const previous = current + '.previous';
    try {
        const bytes = await fs.readFile(source);
        const expected = {name: path.basename(source), size: bytes.length, sha256: hash('sha256', bytes), sha512: hash('sha512', bytes, 'base64')};
        await fs.copyFile(source, current);
        await fs.chmod(current, 0o755);
        // The original AppImage and its embedded SquashFS remain runnable.
        // Distinct bytes let us detect replacement without a published release.
        await fs.appendFile(current, '\nMollyStudio CI previous artifact\n');
        const originalHash = hash('sha256', await fs.readFile(current));
        const smoke = () => execFileSync(process.execPath, [path.join(__dirname, 'packaged-platform-smoke.cjs'), current, 'appimage'], {cwd: root, stdio: 'inherit', timeout: 120000});
        smoke();

        const replace = options => installAppImage({current, download: source, expected, relaunch() {}, ...options});
        await assert.rejects(replace({expected: {...expected, sha256: '0'.repeat(64)}}), /UPDATE_INVALID_DOWNLOAD/);
        assert.equal(hash('sha256', await fs.readFile(current)), originalHash, 'Failed verification must leave the original file intact');
        await assert.rejects(replace({relaunch() {throw Error('simulated restart scheduling failure');}}), /simulated restart scheduling failure/);
        assert.equal(hash('sha256', await fs.readFile(current)), originalHash, 'Failed restart scheduling must restore the original file');
        smoke();

        let scheduled;
        await replace({relaunch(file) {scheduled = file;}});
        assert.equal(scheduled, current);
        assert.equal(hash('sha256', await fs.readFile(current)), expected.sha256);
        assert.equal(hash('sha256', await fs.readFile(previous)), originalHash);
        smoke();
        const result = {arch: process.arch, originalLaunched: true, rejectedUpdatePreservedOriginal: true, rollbackLaunched: true, replacementLaunched: true, backupPreserved: true};
        await fs.writeFile(path.join(root, '.test-output', 'appimage-compatibility.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
    } finally { await fs.rm(directory, {recursive: true, force: true}); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
