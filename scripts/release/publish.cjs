const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {releaseInfo} = require('./validate.cjs');

const SOURCE = 'Nagivka/MollyStudio';
const TARGET = 'Nagivka/MollyStudio-Releases';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function artifacts(root, info) {
    const exe = await fs.readFile(path.join(root, 'dist', info.filename));
    if (exe.length < 1_000_000 || exe.length >= 100_000_000 || exe[0] !== 0x4d || exe[1] !== 0x5a) {
        throw Error('Invalid portable executable or size exceeds 100 MB.');
    }
    const checksum = await fs.readFile(path.join(root, 'dist', info.filename + '.sha256'));
    if (checksum.toString('utf8').trim() !== `${sha256(exe)}  ${info.filename}`) throw Error('Portable checksum mismatch.');
    // Only these two files can ever leave the private repository.
    return [{name: info.filename, bytes: exe, type: 'application/vnd.microsoft.portable-executable'},
        {name: info.filename + '.sha256', bytes: checksum, type: 'text/plain'}];
}

async function publish({root, env = process.env, fetchImpl = fetch, checkAccessOnly = false}) {
    if (env.GITHUB_REPOSITORY !== SOURCE) throw Error('Publishing must run from the private source repository.');
    if (!env.RELEASES_TOKEN || !env.SOURCE_TOKEN) {
        throw Error('Add Actions secret UPDATES_REPO_TOKEN (Contents: read/write for MollyStudio-Releases only). Private build artifacts are retained.');
    }
    const info = releaseInfo(root, env.GITHUB_REF || '');
    const files = checkAccessOnly ? [] : await artifacts(root, info);
    const notes = checkAccessOnly ? '' : (await fs.readFile(info.notesPath, 'utf8')).trim();
    if (!checkAccessOnly && !notes) throw Error('Release notes are empty.');
    async function api(endpoint, {token = env.RELEASES_TOKEN, method = 'GET', body, binary = false, allow404 = false} = {}) {
        const response = await fetchImpl(endpoint.startsWith('https://') ? endpoint : `https://api.github.com${endpoint}`, {
            method, headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MollyStudio-release',
                ...(body ? {'Content-Type': binary ? binary : 'application/json'} : {})},
            body: body ? (binary ? body : JSON.stringify(body)) : undefined,
            signal: AbortSignal.timeout(binary ? 300000 : 30000), redirect: 'error'
        });
        if (allow404 && response.status === 404) return null;
        if (!response.ok) throw Error(`GitHub ${method} failed: HTTP ${response.status}.`);
        return response.json();
    }
    const source = await api(`/repos/${SOURCE}`, {token: env.SOURCE_TOKEN});
    const target = await api(`/repos/${TARGET}`);
    if (source.private !== true || source.full_name !== SOURCE) throw Error('Source repository must remain private.');
    if (target.private !== false || target.full_name !== TARGET) throw Error('Unexpected public release repository.');
    if (target.permissions?.push !== true) throw Error('Release token has no push access to the release repository.');
    if (checkAccessOnly) {
        console.log('Source is private; release destination is public; release token has push access. No release was changed.');
        return {checked: true};
    }
    const releasesPath = `/repos/${TARGET}/releases`;
    const existing = await api(`${releasesPath}/tags/${info.tag}`, {allow404: true});
    if (existing) throw Error(`Release ${info.tag} already exists; published files will not be overwritten.`);
    const release = await api(releasesPath, {method: 'POST', body: {tag_name: info.tag,
        name: `MollyStudio ${info.buildVersion} — Portable для Windows`, body: notes, draft: true, prerelease: false}});
    const uploadBase = release.upload_url?.replace(/\{.*$/, '');
    if (!Number.isSafeInteger(release.id) || uploadBase !== `https://uploads.github.com/repos/${TARGET}/releases/${release.id}/assets`) {
        throw Error('Unexpected upload destination. Release remains a draft.');
    }
    for (const file of files) {
        const asset = await api(`${uploadBase}?name=${encodeURIComponent(file.name)}`,
            {method: 'POST', body: file.bytes, binary: file.type});
        if (asset.state !== 'uploaded' || asset.size !== file.bytes.length || asset.name !== file.name ||
            asset.digest !== `sha256:${sha256(file.bytes)}`) throw Error('Uploaded asset verification failed. Release remains a draft.');
    }
    const result = await api(`${releasesPath}/${release.id}`, {method: 'PATCH', body: {draft: false, make_latest: 'true'}});
    if (result.draft !== false) throw Error('GitHub did not confirm publication.');
    console.log(`Published ${result.html_url}`);
    return result;
}

if (require.main === module) publish({root: path.resolve(__dirname, '../..'), checkAccessOnly: process.argv.includes('--check-access')})
    .catch(error => {console.error(error.message); process.exitCode = 1;});
module.exports = {artifacts, publish};
