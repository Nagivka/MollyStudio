'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { releaseNames, readSignedManifest, verifyReleaseFile } = require('../src/main/updateSignature.js');
const root = path.resolve(__dirname, '..');
const SOURCE = 'Nagivka/MollyStudio';
const CHANNEL = 'Nagivka/MollyStudio-Updates';

function git(args, options = {}) {
    const result = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, ...args], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, ...options
    });
    if (result.status !== 0) throw new Error('Git не выполнил проверку. Для публикации нужен существующий вход в GitHub через Git Credential Manager.');
    return result.stdout.trim();
}

function credentials() {
    if (process.env.UPDATES_REPO_TOKEN) return process.env.UPDATES_REPO_TOKEN;
    // Use the maintainer's existing authenticated Git session only in memory.
    // Never persist this account credential as an Actions secret or include it in logs.
    const output = git(['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n' });
    const token = output.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
    if (!token) throw new Error('Нет доступного входа в GitHub. Значения токенов в исходники добавлять не нужно.');
    return token;
}

function validateArtifacts(dist, version, publicKey) {
    const names = releaseNames(version);
    const payload = readSignedManifest(fs.readFileSync(path.join(dist, 'release-manifest.json')), publicKey, version);
    for (const name of names) verifyReleaseFile(path.join(dist, name), payload);
    const metadata = yaml.load(fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (Object.keys(metadata).some(key => !['version', 'files', 'path', 'sha512', 'releaseDate'].includes(key))) throw new Error('В latest.yml есть посторонние поля; они не будут опубликованы.');
    const installer = payload.files.find(file => file.name === names[0]);
    const checksum = Buffer.from(installer.sha512, 'hex').toString('base64');
    if (metadata.version !== version || metadata.path !== names[0] || metadata.sha512 !== checksum || metadata.packages || metadata.files?.length !== 1 || metadata.files[0].url !== names[0] || metadata.files[0].sha512 !== checksum || metadata.files[0].size !== installer.size) throw new Error('latest.yml не соответствует подписанному установщику.');
    return [...names, 'release-manifest.json'];
}

async function publishRelease() {
    require('./verify-build.cjs').verifyBuild();
    const { version } = require('../package.json');
    const dist = path.join(root, 'dist');
    const { publicKey } = require('../src/main/update-trust.json');
    const names = validateArtifacts(dist, version, publicKey);
    if (git(['status', '--porcelain'])) throw new Error('Сначала сохраните изменения исходников в коммит и отправьте его в приватный репозиторий.');
    if (![ `https://github.com/${SOURCE}.git`, `https://github.com/${SOURCE}` ].includes(git(['remote', 'get-url', 'origin']))) throw new Error('Локальный origin должен указывать только на приватный репозиторий исходников.');
    if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Тег выпуска не совпадает с версией package.json.');
    const commit = git(['rev-parse', 'HEAD']);
    const token = credentials();
    async function api(endpoint, { method = 'GET', body, upload, allow404 = false, authToken = token } = {}) {
        const url = upload || `https://api.github.com${endpoint}`;
        const host = new URL(url).hostname;
        if (!['api.github.com', 'uploads.github.com'].includes(host)) throw new Error('Недопустимый адрес публикации.');
        const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(upload ? 300_000 : 30_000),
            headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'MollyStudio-release', 'Content-Type': upload ? 'application/octet-stream' : 'application/json' },
            body: body === undefined ? undefined : upload ? body : JSON.stringify(body) });
        if (response.status === 404 && allow404) return null;
        if (!response.ok) throw new Error(`GitHub ${method} ${endpoint || '/release-asset'}: HTTP ${response.status}. Секреты не выводятся.`);
        return response.status === 204 ? null : response.json();
    }
    const sourceToken = process.env.GITHUB_TOKEN || token;
    const source = await api(`/repos/${SOURCE}`, { authToken: sourceToken });
    const channel = await api(`/repos/${CHANNEL}`);
    if (source.private !== true || channel.private !== false) throw new Error('Публикация отменена: исходники должны быть приватными, канал обновлений — отдельным публичным репозиторием.');
    await api(`/repos/${SOURCE}/commits/${commit}`, { authToken: sourceToken });
    const tag = `v${version}`;
    if (await api(`/repos/${CHANNEL}/releases/tags/${tag}`, { allow404: true })) throw new Error(`Выпуск ${tag} уже существует. Опубликованные обновления не перезаписываются.`);

    if (channel.size === 0) {
        const readme = await api(`/repos/${CHANNEL}/contents/README.md`, { allow404: true });
        if (!readme) await api(`/repos/${CHANNEL}/contents/README.md`, { method: 'PUT', body: { message: 'Initialize binary update channel', content: Buffer.from('# MollyStudio updates\n\nThis repository distributes Windows installers and signed update metadata only. Application source is maintained in a separate private repository.\n\nDownload the latest NSIS installer from Releases. Portable users should install the NSIS version once to receive future automatic updates.\n').toString('base64') } });
    }
    const tree = await api(`/repos/${CHANNEL}/git/trees/${channel.default_branch || 'main'}?recursive=1`);
    if (tree.truncated || tree.tree.some(entry => entry.type === 'blob' && !['README.md', 'LICENSE', '.gitignore'].includes(entry.path))) throw new Error('В публичном канале найдены файлы вне разрешённого списка. Публикация остановлена.');
    const release = await api(`/repos/${CHANNEL}/releases`, { method: 'POST', body: { tag_name: tag, name: `MollyStudio ${version}`, draft: true, prerelease: false,
        body: `Установите MollyStudio-Setup-${version}.exe. После первой установки NSIS приложение получает следующие версии автоматически.\n\nУстановщик пока без сертификата Windows: система может показывать неизвестного издателя. Подлинность автообновлений проверяется подписью Ed25519 внутри приложения.\n\nPortable-пользователям нужно один раз перейти на установщик. Исходники в этом репозитории не публикуются.` } });
    for (const name of names) {
        const file = path.join(dist, name);
        const asset = await api('', { method: 'POST', upload: release.upload_url.replace(/\{.*$/, '') + `?name=${encodeURIComponent(name)}`, body: fs.readFileSync(file) });
        if (asset.size !== fs.statSync(file).size) throw new Error('Размер загруженного файла не совпал; выпуск остался черновиком.');
        console.log(`Загружен разрешённый файл: ${name}`);
    }
    const assets = await api(`/repos/${CHANNEL}/releases/${release.id}/assets`);
    if (assets.length !== names.length || assets.some(asset => !names.includes(asset.name))) throw new Error('Список файлов выпуска не прошёл проверку; выпуск остался черновиком.');
    const published = await api(`/repos/${CHANNEL}/releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } });
    console.log(`Выпуск опубликован: ${published.html_url}`);
}

if (require.main === module) publishRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateArtifacts };
