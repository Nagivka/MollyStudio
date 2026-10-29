const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'tests/unit');
// Pass actual files: an explicit directory is not a test-file glob and can be
// treated as a CommonJS entry point by supported versions of Node.
const files = fs.readdirSync(directory).filter(name => /\.test\.(?:cjs|mjs|js)$/.test(name)).sort().map(name => path.join(directory, name));
if (!files.length) throw Error('Модульные проверки не найдены.');
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {cwd: root, stdio: 'inherit', windowsHide: true});
if (result.error) { console.error(result.error.message); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
