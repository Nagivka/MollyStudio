// Verify fresh guest-written files against the exact portable hash prepared on the host.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {PNG} = require('pngjs');
const root = path.resolve(__dirname, '..');
const json = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

(async () => {
    const run = await json(path.join(root, '.test-output/windows-sandbox/latest.json'));
    const environment = await json(path.join(run.output, 'environment.json'));
    const startup = await json(path.join(run.output, 'startup.json'));
    const portable = await fs.readFile(run.executable);
    const sha256 = createHash('sha256').update(portable).digest('hex');
    assert.equal(sha256, run.sha256, 'Portable changed since preparation');
    assert.equal(environment.portableSha256, sha256);
    assert.equal(startup.portableSha256, sha256);
    assert.equal(startup.startedAt, environment.startedAt);
    assert.ok(Date.parse(environment.startedAt) >= Date.parse(run.preparedAt), 'Stale guest report');
    assert.ok(Date.parse(startup.checkedAt) >= Date.parse(environment.startedAt));
    assert.equal(environment.externalRuntimes.length, 0, 'External runtimes found in the guest');
    assert.equal(environment.networkAdaptersUp.length, 0, 'Guest networking is active');
    assert.equal(environment.launchArguments.length, 0, 'Default launch must be verified without flags');
    assert.equal(startup.appWindowDetected, true, 'Guest did not detect the application window');
    assert.ok(startup.associationCommand?.includes(path.basename(run.executable)), 'MLST association points to another executable');
    assert.ok(startup.associationCommand?.includes('"%1"'));
    const names = await fs.readdir(run.output), projects = [];
    for (const name of names.filter(name => name.endsWith('.mlst'))) {
        const document = await json(path.join(run.output, name));
        if (document.type !== 'gui') continue;
        const pngName = name.slice(0, -5) + '.png';
        if (!names.includes(pngName)) continue;
        assert.equal(document.layers.length, 1, 'GUI fixture must contain only its template');
        const image = PNG.sync.read(await fs.readFile(path.join(run.output, pngName)));
        const layer = PNG.sync.read(Buffer.from(document.layers[0].dataUrl.split(',')[1], 'base64'));
        assert.equal(image.width, document.config.width);
        assert.equal(image.height, document.config.height);
        assert.equal(layer.width, image.width);assert.equal(layer.height, image.height);
        assert.ok(image.data.equals(layer.data), 'Exported GUI pixels differ from the saved document');
        assert.ok(image.data.some((value, index) => index % 4 === 3 && value === 0), 'GUI lost transparent margins');
        projects.push({project: name, image: pngName, width: image.width, height: image.height});
    }
    assert.ok(projects.length, 'Save a GUI MLST and matching PNG into C:\\MollyResults before verification');
    assert.ok(await fs.stat(path.join(run.output, 'reopen.done')).catch(() => null), 'File association was not exercised');
    const report = {passed: true, checkedAt: new Date().toISOString(), version: run.version, buildVersion: run.buildVersion,
        executable: run.executable, bytes: portable.length, sha256, environment, startup, projects,
        cleanWindowsLaunchVerified: true, guiPNGMatchesSavedPixels: true, associationLaunchRequested: true,
        limitation: 'Smoke test in the current Windows Sandbox with vGPU disabled; it does not cover every Windows version or graphics driver.'};
    await fs.writeFile(path.join(run.directory, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
