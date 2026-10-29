import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root = new URL('../../', import.meta.url);
const read = file => fs.readFile(new URL(file, root));
test('compact icon font retains every symbol referenced by renderer source', async () => {
    const manifest = JSON.parse(await read('scripts/data/material-symbols.json'));
    const available = new Set(JSON.parse(await read('design/font-sources/material-symbols-ligatures.json')));
    const retained = new Set(manifest.names);
    const missing = new Set();
    async function visit(directory) {
        for (const entry of await fs.readdir(directory, {withFileTypes:true})) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(file);
            else if (/\.(js|mjs|html|css|json)$/.test(entry.name)) {
                for (const token of (await fs.readFile(file,'utf8')).matchAll(/[a-z][a-z_0-9]*/g)) {
                    if (available.has(token[0]) && !retained.has(token[0])) missing.add(token[0]);
                }
            }
        }
    }
    await visit(fileURLToPath(new URL('src/renderer/',root)));
    assert.deepEqual([...missing], [], 'Rebuild with scripts/optimize-material-symbols.py');
    for (const [file, expected] of [
        ['src/renderer/assets/fonts/MaterialSymbolsRounded.woff2',manifest.fontSha256],
        ['design/font-sources/MaterialSymbolsRounded.woff2',manifest.sourceSha256]
    ]) assert.equal(createHash('sha256').update(await read(file)).digest('hex'),expected);
    assert.deepEqual(manifest.axes,[['FILL',0,0,1],['wght',100,400,700]]);
});
