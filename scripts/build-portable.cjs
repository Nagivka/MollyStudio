// Lossless BCJ2 packaging: retain the complete Electron directory and its fuses.
// The full decoder is embedded in the launcher; users install no runtime/tool.
const fs = require('node:fs/promises');
const path = require('node:path');
const {ensure7zip, run, digest} = require('./lib/portable-tools.cjs');
const root = path.resolve(__dirname, '..');
const MAX_BYTES = 100_000_000;

(async () => {
    if (process.platform !== 'win32') throw Error('Build this Windows portable on Windows.');
    const config = require('../electron-builder.cjs'), pkg = require('../package.json');
    const filename = config.portable.artifactName.replace('${buildVersion}', config.buildVersion)
        .replace('${version}', pkg.version).replace('${arch}', 'x64').replace('${ext}', 'exe');
    const output = path.join(root, 'dist', filename), packageDir = path.join(root, 'dist', 'win-unpacked');
    const previousBytes = (await fs.stat(output).catch(() => null))?.size;
    console.log('Packaging the complete Electron application');
    await run(process.execPath, [require.resolve('electron-builder/cli.js'), '--dir', '--x64'], {cwd: root});
    await run(process.execPath, [path.join(root, 'scripts/check-distribution.cjs'), packageDir], {cwd: root});
    const tools = await ensure7zip(root);
    const stagingRoot = path.join(root, '.test-output', 'portable-build');
    await fs.mkdir(stagingRoot, {recursive: true});
    const staging = await fs.mkdtemp(path.join(stagingRoot, 'candidate-'));
    const archive = path.join(staging, 'app.7z'), candidate = path.join(staging, filename);
    console.log('Compressing all files with BCJ2 + LZMA2 (256 MiB dictionary)');
    await run(tools.encoder, ['a', '-t7z', '-mx=9', '-mf=BCJ2', '-md=256m', '-mfb=273', '-mmt=2',
        '-ms=on', '-mtc=off', '-bsp0', archive, '.'], {cwd: packageDir});
    // Exercise the exact decoder embedded in the portable, including BCJ2 support.
    await run(tools.binary, ['t', archive, '-bsp0']);
    const {path: compiler, env} = await require('app-builder-lib/out/toolsets/windows').getMakeNsisPath();
    const definitions = {PORTABLE_OUTPUT: candidate, PORTABLE_ARCHIVE: archive, SEVEN_ZIP: tools.binary,
        SEVEN_ZIP_LICENSE: tools.license, APP_ICON: path.join(root, config.win.icon), APP_BUILD_VERSION: config.buildVersion};
    console.log('Building the self-contained launcher');
    await run(compiler, ['-V2', ...Object.entries(definitions).map(([key, value]) => `-D${key}=${value}`),
        path.join(root, 'scripts/packaging/portable.nsi')], {env: {...process.env, ...env}});
    const bytes = await fs.readFile(candidate);
    if (bytes.length >= MAX_BYTES) throw Error(`Portable is ${bytes.length} bytes; it must be below ${MAX_BYTES}. Previous EXE was preserved. Candidate: ${candidate}`);
    const sha256 = digest(bytes);
    const report = {checkedAt: new Date().toISOString(), file: output, version: pkg.version, buildVersion: config.buildVersion,
        previousBytes, bytes: bytes.length, maxBytes: MAX_BYTES, below100MB: true, sha256,
        compression: 'BCJ2 + LZMA2, 256 MiB dictionary, 273 fast bytes',
        packageDir, payload: archive, embeddedDecoder: tools.binary, contentRemoved: false,
        cleanWindowsVerified: false};
    await fs.rename(candidate, output);
    await fs.writeFile(output + '.sha256', `${sha256}  ${filename}\n`);
    await fs.writeFile(path.join(root, '.test-output/portable-size.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(root, '.test-output/portable-verification.json'), JSON.stringify({
        file: output, bytes: bytes.length, sha256, builtAt: new Date().toISOString(),
        distribution: true, below100MB: true, cleanWindowsVerified: false
    }, null, 2));
    console.log(JSON.stringify(report, null, 2));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
