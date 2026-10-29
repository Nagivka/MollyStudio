import test from 'node:test';
import assert from 'node:assert/strict';
import {safeFileStem} from '../../src/renderer/js/core/FileNames.mjs';

test('project and export names handle reserved Windows devices, controls and trailing dots', () => {
    assert.equal(safeFileStem('CON'), '_CON');
    assert.equal(safeFileStem('aux.backup'), '_aux.backup');
    assert.equal(safeFileStem('LPT1'), '_LPT1');
    assert.equal(safeFileStem('COM¹'), '_COM¹');
    assert.equal(safeFileStem('LPT².txt'), '_LPT².txt');
    assert.equal(safeFileStem('report\u0000\n/name. '), 'report___name');
    assert.equal(safeFileStem('... ', 'project'), 'project');
    assert.equal(safeFileStem('Меню сервера'), 'Меню сервера');
});

test('fallback names are sanitized and bounded just like normal names', () => {
    assert.doesNotMatch(safeFileStem('', '../unsafe:name'), /[\\/:]/);
    assert.equal(Array.from(safeFileStem('', 'a'.repeat(200))).length, 96);
    assert.equal(safeFileStem('', '...'), 'image');
});

test('long Unicode filenames are normalized without splitting a surrogate pair', () => {
    const name = safeFileStem('я'.repeat(95) + '🎨🎨');
    assert.equal(Array.from(name).length, 96);
    assert.equal(name.at(-2) + name.at(-1), '🎨');
    assert.equal(safeFileStem('и\u0306'), 'й');
});
