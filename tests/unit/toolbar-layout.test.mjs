import test from 'node:test';
import assert from 'node:assert/strict';
import { toolbarLayout, visibleToolIndices } from '../../src/renderer/js/ui/ToolbarLayout.mjs';

test('single-column tools fit tall windows and use overflow without shrinking targets below their minimum', () => {
    assert.deepEqual(toolbarLayout(900, 18, 36), { size: 36, gap: 4, visible: 18, overflow: false });
    for (const minimum of [28, 32]) for (const height of [290, 350, 420, 500, 600, 768, 900]) {
        const layout = toolbarLayout(height, 18, 36, minimum);
        const used = layout.visible * layout.size + Math.max(0, layout.visible - 1) * layout.gap
            + (layout.overflow ? layout.size + 8 : 0) + 160;
        assert.ok(layout.size >= minimum);
        assert.ok(used <= height, `${height}: ${used}`);
        assert.equal(layout.overflow, layout.visible < 18);
    }
});

test('choosing an overflow tool keeps it visible and never duplicates a tool', () => {
    assert.deepEqual([...visibleToolIndices(18, 7, 15)], [0, 1, 2, 3, 4, 5, 15]);
    assert.deepEqual([...visibleToolIndices(18, 7, 2)], [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(visibleToolIndices(18, 18, 15).size, 18);
});
