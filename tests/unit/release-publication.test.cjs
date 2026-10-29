const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {releaseInfo} = require('../../scripts/release/validate.cjs');
const {publish} = require('../../scripts/release/publish.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-release-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    await fs.mkdir(path.join(root, 'dist'));
    await fs.mkdir(path.join(root, 'releases'));
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({version: '1.4.1'}));
    await fs.writeFile(path.join(root, 'electron-builder.cjs'), "module.exports={buildVersion:'1.4.1.0'}");
    await fs.writeFile(path.join(root, 'releases/1.4.1.md'), 'Release notes');
    const bytes = Buffer.alloc(1_000_000); bytes.write('MZ');
    const name = 'MollyStudio-1.4.1.0-x64-portable.exe';
    await fs.writeFile(path.join(root, 'dist', name), bytes);
    await fs.writeFile(path.join(root, 'dist', name + '.sha256'), `${hash(bytes)}  ${name}\n`);
    await fs.writeFile(path.join(root, 'dist', 'private-source.zip'), 'must not upload');
    const env = {GITHUB_REPOSITORY: 'Nagivka/MollyStudio', GITHUB_REF: 'refs/tags/v1.4.1',
        RELEASES_TOKEN: 'test-target-token', SOURCE_TOKEN: 'test-source-token'};
    return {root, bytes, name, env};
}

function mockApi({sourcePrivate = true, targetPrivate = false, existing = false, badDigest = false, uploadUrl} = {}) {
    const calls = [];
    const response = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
    return {calls, fetchImpl: async (url, options) => {
        calls.push({url, ...options});
        if (url === 'https://api.github.com/repos/Nagivka/MollyStudio') return response({full_name: 'Nagivka/MollyStudio', private: sourcePrivate});
        if (url === 'https://api.github.com/repos/Nagivka/MollyStudio-Releases') return response({full_name: 'Nagivka/MollyStudio-Releases', private: targetPrivate, permissions: {push: true}});
        if (url.endsWith('/tags/v1.4.1')) return existing ? response({id: 42}) : response(null, 404);
        if (url.startsWith('https://uploads.github.com/')) return response({state: 'uploaded', size: options.body.length,
            name: new URL(url).searchParams.get('name'), digest: badDigest ? 'sha256:wrong' : `sha256:${hash(options.body)}`});
        if (options.method === 'POST') return response({id: 42,
            upload_url: uploadUrl || 'https://uploads.github.com/repos/Nagivka/MollyStudio-Releases/releases/42/assets{?name,label}'});
        if (options.method === 'PATCH') return response({draft: false, html_url: 'https://github.com/Nagivka/MollyStudio-Releases/releases/tag/v1.4.1'});
        throw Error(`Unexpected API request ${url}`);
    }};
}

test('release version rejects a mismatched tag', async t => {
    const f = await fixture(t);
    assert.throws(() => releaseInfo(f.root, 'refs/tags/v1.3.1'), /Tag must be/);
});

test('publication uploads only EXE and SHA256, verifies digests, then publishes', async t => {
    const f = await fixture(t), api = mockApi();
    await publish({...f, fetchImpl: api.fetchImpl});
    const uploads = api.calls.filter(c => c.url.startsWith('https://uploads.github.com/'));
    assert.deepEqual(uploads.map(c => new URL(c.url).searchParams.get('name')), [f.name, f.name + '.sha256']);
    assert.equal(api.calls[0].headers.Authorization, 'Bearer test-source-token');
    assert.ok(api.calls.slice(1).every(c => c.headers.Authorization === 'Bearer test-target-token'));
    assert.ok(api.calls.every(c => c.redirect === 'error'));
    assert.equal(JSON.parse(api.calls.find(c => c.method === 'POST' && !c.url.includes('uploads.')).body).draft, true);
    assert.equal(api.calls.at(-1).method, 'PATCH');
});

for (const [name, options, pattern] of [
    ['public source', {sourcePrivate: false}, /must remain private/],
    ['private destination', {targetPrivate: true}, /Unexpected public/],
    ['existing release', {existing: true}, /will not be overwritten/],
    ['wrong digest', {badDigest: true}, /verification failed/],
    ['unexpected upload host', {uploadUrl: 'https://example.com/assets'}, /Unexpected upload destination/]
]) test(`publication blocks ${name} without publishing`, async t => {
    const f = await fixture(t), api = mockApi(options);
    await assert.rejects(publish({...f, fetchImpl: api.fetchImpl}), pattern);
    assert.ok(!api.calls.some(c => c.method === 'PATCH'));
});

test('checksum mismatch stops all network requests', async t => {
    const f = await fixture(t), api = mockApi();
    await fs.writeFile(path.join(f.root, 'dist', f.name + '.sha256'), 'bad');
    await assert.rejects(publish({...f, fetchImpl: api.fetchImpl}), /checksum mismatch/);
    assert.equal(api.calls.length, 0);
});

test('missing token stops before network access', async t => {
    const f = await fixture(t), api = mockApi(); delete f.env.RELEASES_TOKEN;
    await assert.rejects(publish({...f, fetchImpl: api.fetchImpl}), /UPDATES_REPO_TOKEN/);
    assert.equal(api.calls.length, 0);
});

test('access check performs only repository metadata reads without artifacts or publication', async t => {
    const f = await fixture(t), api = mockApi();
    await fs.rm(path.join(f.root, 'dist'), {recursive: true});
    assert.deepEqual(await publish({...f, fetchImpl: api.fetchImpl, checkAccessOnly: true}), {checked: true});
    assert.equal(api.calls.length, 2);
    assert.ok(api.calls.every(call => call.method === 'GET'));
});
