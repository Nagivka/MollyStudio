import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const reference = JSON.parse(await readFile(new URL('./fixtures/interface-1.2.5.json', import.meta.url), 'utf8'));

test('accepted design tokens and launcher retain the 1.2.5 foundation', async () => {
    for (const [file, expected] of Object.entries(reference.files)) {
        if (!['css/material-you.css', 'css/launcher.css'].includes(file)) continue;
        const data = await readFile(new URL(`../www/${file}`, import.meta.url));
        assert.equal(createHash('sha256').update(data).digest('hex'), expected, file);
    }
});

test('restored windows never load the superseded Material Web adapter', async () => {
    for (const file of ['index', 'editor', 'buttons', 'settings', 'new-project']) {
        const html = await readFile(new URL(`../www/${file}.html`, import.meta.url), 'utf8');
        assert.doesNotMatch(html, /MaterialUI|MaterialControls|MaterialMotion|<md-(?:dialog|slider|switch)/);
    }
    const { dependencies = {}, devDependencies = {}, scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(dependencies['@material/web'], undefined);
    assert.equal(devDependencies.esbuild, undefined);
    assert.equal(scripts['vendor:material'], undefined);
});
