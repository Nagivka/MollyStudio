import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectorBounds } from '../../src/renderer/js/core/LayoutMetrics.mjs';
test('inspector resizing preserves room for the canvas from scaled minimum to 4K', () => {
    for (const pixel of [false, true]) {
        for (const width of [533, 600, 760, 900, 1280, 1920, 3840]) {
            const { minimum, maximum } = inspectorBounds(width, 56, pixel);
            assert.ok(maximum >= minimum && maximum <= 520);
            assert.ok(width - maximum - 56 - 6 >= Math.min(200, width * .25));
        }
    }
    assert.equal(inspectorBounds(1280, 56).minimum, 260);
    assert.equal(inspectorBounds(1280, 56, true).minimum, 320);
});
