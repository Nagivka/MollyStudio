const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {run} = require('./lib/portable-tools.cjs');
const {releaseNames} = require('../src/main/update-security.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
    if (process.platform !== 'win32') throw Error('Build the Windows installer on Windows.');
    const pkg = require('../package.json');
    const [name, blockmap] = releaseNames(pkg.version);
    await run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never'], {cwd: root});
    await run(process.execPath, [path.join(root, 'scripts/check-distribution.cjs')], {cwd: root});
    const bytes = await fs.readFile(path.join(root, 'dist', name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    if (bytes[0] !== 0x4d || bytes[1] !== 0x5a || !(await fs.stat(path.join(root, 'dist', blockmap))).size) throw Error('Invalid installer artifacts.');
    const metadata = `version: ${pkg.version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`;
    await fs.writeFile(path.join(root, 'dist', 'latest.yml'), metadata);
    await fs.writeFile(path.join(root, 'dist', name + '.sha256'), `${sha256}  ${name}\n`);
    console.log(JSON.stringify({file: name, bytes: bytes.length, sha256, format: 'nsis', autoUpdates: true}, null, 2));
})().catch(error => {console.error(error.message); process.exitCode = 1;});
