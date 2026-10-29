import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const reference = JSON.parse(await readFile(new URL('../fixtures/interface-1.2.5.json', import.meta.url), 'utf8'));

test('accepted design tokens and launcher retain the 1.2.5 foundation', async () => {
    const launcher = await readFile(new URL('../../src/renderer/css/launcher.css', import.meta.url));
    assert.equal(createHash('sha256').update(launcher).digest('hex'), reference.files['css/launcher.css']);
    // Responsive layout and motion may evolve while the accepted visual tokens stay stable.
    const material = await readFile(new URL('../../src/renderer/css/material-you.css', import.meta.url), 'utf8');
    for (const [token, value] of Object.entries({ '--md-shape-corner-input': '4px', '--md-shape-corner-card': '16px', '--md-shape-corner-dialog': '28px', '--md-motion-duration-short': '160ms', '--md-motion-duration-medium': '240ms' })) {
        assert.ok(material.includes(`${token}: ${value};`), token);
    }
    assert.match(material, /--md-sys-font-family: 'Google Sans', sans-serif/);
});

test('restored windows never load the superseded Material Web adapter', async () => {
    for (const file of ['index', 'editor', 'buttons', 'settings', 'new-project']) {
        const html = await readFile(new URL(`../../src/renderer/${file}.html`, import.meta.url), 'utf8');
        assert.doesNotMatch(html, /MaterialUI|MaterialControls|MaterialMotion|<md-(?:dialog|slider|switch)/);
    }
    const { dependencies = {}, devDependencies = {}, scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    assert.equal(dependencies['@material/web'], undefined);
    assert.equal(devDependencies.esbuild, undefined);
    assert.equal(scripts['vendor:material'], undefined);
});
