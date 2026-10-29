const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {configureProfile} = require('../../src/main/profile.cjs');
const {FileAccess, atomicWrite, revision, decode} = require('../../src/main/storage.cjs');
const {RecoveryStore} = require('../../src/main/recovery.cjs');

async function fixture(run, prefix = 'molly-services-') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    try { return await run(root); }
    finally { await fs.rm(root, {recursive: true, force: true}); }
}

test('a fresh application profile and private browser session exist before Electron receives their paths', async () => {
    await fixture(async root => {
        const paths = new Map();
        const app = {isPackaged: false, getPath: () => root, setPath: (name, value) => {
            assert.equal(syncFs.statSync(value).isDirectory(), true);
            paths.set(name, value);
        }};
        assert.equal(configureProfile(app), null);
        assert.equal(paths.get('userData'), syncFs.realpathSync.native(path.join(root, 'MollyStudio')));
        assert.equal(paths.get('sessionData'), paths.get('userData'));
    });
    await fixture(async root => {
        const paths = new Map();
        const app = {isPackaged: false, setPath: (name, value) => {
            assert.equal(syncFs.statSync(value).isDirectory(), true);
            paths.set(name, value);
        }};
        assert.equal(configureProfile(app, root), syncFs.realpathSync.native(root));
        assert.equal(paths.get('sessionData'), path.join(syncFs.realpathSync.native(root), 'chromium'));
    }, 'molly-electron-check-');
});

test('atomic writes accept long destination names and keep the original after a revision conflict', async () => fixture(async root => {
    const file = path.join(root, 'x'.repeat(240) + '.mlst');
    await atomicWrite(file, 'before');
    await atomicWrite(file, 'after', revision(Buffer.from('before')));
    await assert.rejects(atomicWrite(file, 'lost', revision(Buffer.from('before'))), /FILE_CHANGED:/);
    assert.equal(await fs.readFile(file, 'utf8'), 'after');
    assert.deepEqual(await fs.readdir(root), [path.basename(file)]);
}));

test('large export payloads decode without a recursive repeated-group expression', () => {
    const expected = Buffer.alloc(5 * 1024 * 1024, 91);
    assert.deepEqual(decode(expected.toString('base64'), 'base64'), expected);
    for (const value of ['A===', 'AA=A', 'AAAA!', 'A', '=AAA']) assert.throws(() => decode(value, 'base64'));
});

test('UTF-8 BOM projects retain their disk revision and can be saved in place', async () => fixture(async root => {
    const file = path.join(root, 'project.mlst'), original = '\uFEFF' + JSON.stringify({name: 'До', layers: []});
    await fs.writeFile(file, original);
    const files = new FileAccess(), text = await files.read(file);
    assert.equal(text, original);
    const changed = JSON.stringify({name: 'После', layers: []});
    const hash = await files.write(file, changed, 'utf-8', revision(Buffer.from(text)), true);
    assert.equal(hash, revision(Buffer.from(changed)));
    assert.equal(await fs.readFile(file, 'utf8'), changed);
}));

test('a damaged summary index cannot hide a valid recovery draft', async () => fixture(async root => {
    const store = new RecoveryStore(root);
    await store.write({draftId: 'one', timestamp: 12, project: {name: 'Работа', type: 'prefix', layers: []}});
    const index = JSON.parse(await fs.readFile(path.join(root, 'index.json'), 'utf8'));
    index[0].project = null;
    await fs.writeFile(path.join(root, 'index.json'), JSON.stringify(index));
    const entries = await store.list();
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].project, {name: 'Работа', type: 'prefix'});
    assert.equal((await store.read('one')).project.name, 'Работа');
}));

test('deleting an imported draft survives the next migration attempt without changing the source', async () => fixture(async root => {
    const source = new RecoveryStore(path.join(root, 'source')), targetRoot = path.join(root, 'target');
    await source.write({draftId: 'one', timestamp: 12, project: {name: 'Старая работа', layers: []}});
    const first = new RecoveryStore(targetRoot);
    await first.importFrom([source.root]);
    assert.equal((await first.list()).length, 1);
    await first.delete('one');
    const nextLaunch = new RecoveryStore(targetRoot);
    await nextLaunch.importFrom([source.root]);
    assert.deepEqual(await nextLaunch.list(), []);
    assert.equal((await source.read('one')).project.name, 'Старая работа');
}));

test('migration preserves an unreadable destination instead of overwriting it with an older draft', async () => fixture(async root => {
    const source = new RecoveryStore(path.join(root, 'source')), targetRoot = path.join(root, 'target');
    await source.write({draftId: 'one', timestamp: 12, project: {name: 'Старая работа', layers: []}});
    await fs.mkdir(targetRoot);
    const destination = path.join(targetRoot, 'one.json');
    await fs.writeFile(destination, '{interrupted');
    await new RecoveryStore(targetRoot).importFrom([source.root]);
    assert.equal(await fs.readFile(destination, 'utf8'), '{interrupted');
}));
