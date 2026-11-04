const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {createHash, generateKeyPairSync} = require('node:crypto');
const {once} = require('node:events');
const {build, Platform, Arch} = require('electron-builder');
const {prepareRelease} = require('./release/sign.cjs');
const {updateTarget, targetReleaseNames} = require('../src/main/update-targets.cjs');
const root = path.resolve(__dirname, '..');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function main() {
    assert.ok(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux', 'Private disposable Linux runner required');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-version-upgrade-'));
    const previousVersion = '0.0.1', nextVersion = '0.0.2';
    const target = updateTarget('linux', process.arch);
    const requests = [];
    let server, child, log = '';
    try {
        // These packages have a different entry point and stay outside dist.
        // Neither the fixture entry nor its ephemeral key enters a release.
        for (const version of [previousVersion, nextVersion]) {
            await build({targets: Platform.LINUX.createTarget(['AppImage'], Arch[process.arch]), publish: 'never', config: {
                directories: {output: path.join(directory, version, 'dist')},
                extraMetadata: {version, main: 'scripts/lib/appimage-update-entry.cjs'}, buildVersion: version + '.0',
                files: [...require('../electron-builder.cjs').files,
                    'scripts/lib/appimage-update-entry.cjs'],
                linux: {artifactName: targetReleaseNames(version, target)[0]}
            }});
        }
        const nextRoot = path.join(directory, nextVersion), name = targetReleaseNames(nextVersion, target)[0];
        const next = path.join(nextRoot, 'dist', name), bytes = await fs.readFile(next);
        await fs.writeFile(next + '.sha256', `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
        const yaml = `version: ${nextVersion}\nfiles:\n  - url: ${name}\n    sha512: ${createHash('sha512').update(bytes).digest('base64')}\n    size: ${bytes.length}\n`;
        await fs.writeFile(path.join(nextRoot, 'dist', target.metadata), yaml);
        const notesPath = path.join(directory, 'notes.md');await fs.writeFile(notesPath, 'Private two-version upgrade');
        const keys = generateKeyPairSync('ed25519');
        const publicKey = keys.publicKey.export({type: 'spki', format: 'pem'});
        const files = await prepareRelease(nextRoot, {version: nextVersion, notesPath}, keys.privateKey.export({type: 'pkcs8', format: 'pem'}), publicKey, target);
        const base = `https://github.com/Nagivka/MollyStudio-Releases/releases/download/v${nextVersion}/`;
        const release = {tag_name: 'v' + nextVersion, draft: false, prerelease: false,
            assets: files.map(file => ({name: file.name, size: file.bytes.length, browser_download_url: base + file.name}))};
        server = http.createServer((request, response) => {
            const name = new URL(request.url, 'http://localhost').pathname.slice(1);requests.push(name);
            const content = name === 'release.json' ? Buffer.from(JSON.stringify(release)) : files.find(file => file.name === name)?.bytes;
            response.writeHead(content ? 200 : 404, {'Content-Length': content?.length || 0});response.end(content);
        });
        server.listen(0, '127.0.0.1');await once(server, 'listening');
        const profile = path.join(directory, 'profile'), project = path.join(directory, 'Upgrade.mlst');
        const result = path.join(directory, 'result.json'), current = path.join(directory, 'MollyStudio.AppImage');
        await fs.mkdir(profile);
        await fs.writeFile(path.join(profile, 'update-preferences.json'), JSON.stringify({autoCheck: false, autoDownload: false}));
        await fs.writeFile(project, JSON.stringify({mollyVersion: 2, type: 'canvas', name: 'Upgrade', config: {width: 64, height: 64}, layers: []}));
        await fs.copyFile(path.join(directory, previousVersion, 'dist', targetReleaseNames(previousVersion, target)[0]), current);
        await fs.chmod(current, 0o755);
        const config = path.join(directory, 'config.json');
        await fs.writeFile(config, JSON.stringify({nextVersion, publicKey, project, result, base: `http://127.0.0.1:${server.address().port}/`}));
        child = spawn(current, [`--user-data-dir=${profile}`], {env: {...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', MOLLY_CI_APPIMAGE: config}, stdio: ['ignore', 'pipe', 'pipe']});
        child.on('error', error => {log += error.stack;});
        for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {log = (log + bytes).slice(-20000);});
        let completed;
        for (let attempt = 0; attempt < 1800; attempt++) {
            completed = await fs.readFile(result, 'utf8').then(JSON.parse).catch(error => {if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;throw error;});
            if (completed) break;
            await delay(100);
        }
        assert.ok(completed, 'The updated application did not restart\n' + log);
        assert.ok(!completed.error, completed.error);
        assert.equal(completed.version, nextVersion);
        assert.equal(completed.executable, current);
        assert.ok(completed.layerNames.includes('Saved before update'));
        assert.ok(completed.drafts.some(draft => draft.project.layers.some(layer => layer.name === 'Pending before update')), 'Pending edits must have a recovery draft');
        const installed = await fs.readFile(current);
        assert.ok(installed.equals(bytes), 'Installed bytes differ from the signed download');
        assert.ok(requests.includes(name) && requests.includes(target.metadata) && requests.includes(target.manifest));
        const report = {passed: true, arch: process.arch, previousVersion, nextVersion, requests, projectPreserved: true, recoveryPreserved: true, restartedVersionConfirmed: true};
        await fs.writeFile(path.join(root, '.test-output', 'appimage-version-upgrade.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
    } finally {
        await fs.mkdir(path.join(root, '.test-output'), {recursive: true});
        await fs.writeFile(path.join(root, '.test-output', 'appimage-version-upgrade.log'), log);
        if (child && child.exitCode === null) {child.kill();await Promise.race([once(child, 'exit'), delay(5000)]);}
        await new Promise(resolve => server ? server.close(resolve) : resolve());
        await fs.rm(directory, {recursive: true, force: true});
    }
}
main().catch(error => {console.error(error);process.exit(1);});
