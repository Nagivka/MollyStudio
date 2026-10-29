import test from 'node:test';
import assert from 'node:assert/strict';
import ToolOptionsBar from '../../src/renderer/js/ui/ToolOptionsBar.js';

test('selection actions follow selection, clipboard, layer type and editability', () => {
    const previous = globalThis.document, controls = new Map();
    const drag = {}, edit = {};
    globalThis.document = { getElementById(id) { if (id === 'selection-drag-options') return drag; if(id==='btn-selection-edit')return edit; if (!controls.has(id)) controls.set(id, {}); return controls.get(id); } };
    try {
        const marquee = { selection: null, clipboard: null };
        let layer = { type: 'bitmap' };
        const app = { tools: { tools: { marquee } }, layerManager: { getActiveLayer: () => layer, isEditable: value => !value.locked } };
        const options = Object.assign(Object.create(ToolOptionsBar.prototype), { app });
        const enabled = name => !controls.get(`btn-marquee-${name}`).disabled;
        options.syncSelectionActions();
        assert.ok([...controls.values()].every(control => control.disabled));
        assert.ok([...controls.values()].every(control => control.hidden));
        assert.equal(drag.hidden, true);
        marquee.clipboard = {};
        options.syncSelectionActions();
        assert.equal(enabled('paste'), true);
        assert.equal(controls.get('btn-marquee-paste').hidden, false);
        assert.equal(controls.get('btn-marquee-copy').hidden, true);
        assert.equal(enabled('copy'), false);
        marquee.selection = { x: 1, y: 1, width: 4, height: 4 };
        options.syncSelectionActions();
        assert.ok([...controls.values()].every(control => !control.disabled));
        assert.ok([...controls.values()].every(control => !control.hidden));
        assert.equal(drag.hidden, false);
        for(const tool of ['lasso','wand']){
            app.tools.currentToolId=tool;options.syncSelectionActions();
            assert.equal(drag.hidden,true);assert.equal(edit.hidden,false);
        }
        app.tools.currentToolId='marquee';options.syncSelectionActions();
        assert.equal(drag.hidden,false);assert.equal(edit.hidden,true);
        layer.alphaLocked = true;
        options.syncSelectionActions();
        for (const name of ['cut', 'delete', 'fliph', 'flipv', 'rotcw', 'rotccw']) assert.equal(enabled(name), false);
        assert.equal(enabled('fill'), true);
        layer = { type: 'text' };
        options.syncSelectionActions();
        assert.equal(enabled('copy'), true);
        assert.equal(enabled('deselect'), true);
        assert.equal(enabled('fill'), false);
        layer = { type: 'bitmap', locked: true };
        options.syncSelectionActions();
        assert.equal(enabled('copy'), true);
        assert.equal(enabled('cut'), false);
    } finally { if (previous) globalThis.document = previous; else delete globalThis.document; }
});
