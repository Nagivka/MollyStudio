import test from 'node:test';
import assert from 'node:assert/strict';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';

for (const toolId of ['marquee', 'lasso', 'wand', 'move']) {
    test(`numeric position and size controls target the active ${toolId} object`, t => {
        const previous = {document: globalThis.document, window: globalThis.window}, calls = [];
        const inputs = new Map(['prop-pos-x', 'prop-pos-y', 'prop-size-w', 'prop-size-h'].map((id, index) => [id, {
            value: String([12, 23, 34, 45][index]),
            addEventListener(event, callback) {this[event] = callback;}
        }]));
        globalThis.document = {getElementById: id => inputs.get(id)};
        const marquee = {selection: {x: 1, y: 1, width: 2, height: 2},
            setSelectionPosition: (...args) => calls.push(['area-position', ...args]),
            setSelectionDimensions: (...args) => calls.push(['area-size', ...args])};
        globalThis.window = {mollyEditor: {tools: {currentToolId: toolId, tools: {marquee}}}};
        t.after(() => Object.assign(globalThis, previous));
        const move = Object.assign(Object.create(MoveTool.prototype), {
            setBoxPosition: (...args) => calls.push(['layer-position', ...args]),
            setBoxDimensions: (...args) => calls.push(['layer-size', ...args])
        });
        move.setupUI();
        inputs.get('prop-pos-x').change(); inputs.get('prop-size-h').change();
        const target = toolId === 'move' ? 'layer' : 'area';
        assert.deepEqual(calls, [[target + '-position', 12, 23], [target + '-size', 34, 45, 'h']]);
        calls.length = 0;
        inputs.get('prop-pos-x').value = ''; inputs.get('prop-size-w').value = '';
        inputs.get('prop-pos-x').change(); inputs.get('prop-size-h').change();
        assert.deepEqual(calls, [], 'clearing a field must not jump to zero or resize to one pixel');
    });
}
