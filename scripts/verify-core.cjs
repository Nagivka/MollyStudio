const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const temporaryRoot = path.join(root, '.test-output');
fs.mkdirSync(temporaryRoot, {recursive: true});
const output = fs.mkdtempSync(path.join(temporaryRoot, 'core-verify-'));

try {
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--outDir', output], {
        cwd: root, encoding: 'utf8', windowsHide: true
    });
    if (result.error || result.status !== 0) throw Error(result.error?.message || result.stdout + result.stderr);
    const runtime = path.join(root, 'src/renderer/js/core/typed');
    const expectedFiles = fs.readdirSync(output).filter(name => name.endsWith('.mjs')).sort();
    const actualFiles = fs.readdirSync(runtime).filter(name => name.endsWith('.mjs')).sort();
    if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) throw Error('Generated core modules differ from TypeScript sources.');
    for (const file of expectedFiles) {
        if (!fs.readFileSync(path.join(output, file)).equals(fs.readFileSync(path.join(runtime, file)))) throw Error('Stale generated core: ' + file);
    }
    console.log('Verified ' + expectedFiles.length + ' generated TypeScript modules.');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    if (path.dirname(output) !== temporaryRoot || !path.basename(output).startsWith('core-verify-')) throw Error('Unexpected verification directory.');
    fs.rmSync(output, {recursive: true, force: true});
}
