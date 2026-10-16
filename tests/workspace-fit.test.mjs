import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFitZoom } from '../www/js/ui/Workspace.js';

test('canvas auto-fit chooses the largest pixel zoom that fits the viewport', () => {
    assert.equal(chooseFitZoom(256, 128, 1024, 768), 4);
    assert.equal(chooseFitZoom(256, 128, 80, 80), 0.25);
    assert.equal(chooseFitZoom(4096, 4096, 1, 1), 0.125);
    assert.equal(chooseFitZoom(1, 1, 500, 500), 32);
});
