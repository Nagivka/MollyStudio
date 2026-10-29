import test from 'node:test';
import assert from 'node:assert/strict';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {DrawCommand, MergeLayersCommand} from '../../src/renderer/js/core/Commands.js';

function fixture(t, size = 8) {
    const previous = {document: globalThis.document, window: globalThis.window};
    const canvases = [], bus = new EventBus();
    globalThis.document = {getElementById: () => null, createElement() { const canvas = new RasterCanvas(); canvases.push(canvas); return canvas; }};
    const history = new History(bus);
    globalThis.window = {mollyEditor: {history, showToast() {}}};
    t.after(() => Object.assign(globalThis, previous));
    const manager = new LayerManager(bus, {width: size, height: size});
    const layer = manager.addLayer('Original');
    layer.ctx.fillStyle = '#112233'; layer.ctx.fillRect(2, 2, 3, 2);
    layer.shapeData = {type: 'rect-filled', x0: 2, y0: 2, x1: 5, y1: 4, filled: true};
    layer.setMasterSource(layer.cloneCanvas(), {x: 2, y: 2, w: 3, h: 2});
    return {manager, layer, history, canvases};
}

function unchanged(layer, before) {
    const current = layer.getImageData();
    assert.deepEqual(current.data, before.data);
    assert.deepEqual(current.mollySnapshot, before.mollySnapshot);
}

function failOnce(context, method) {
    const original = context[method].bind(context); let failed = false;
    context[method] = (...args) => { original(...args); if (!failed) { failed = true; throw Error('Partial canvas write'); } };
}

test('a failed group duplication frees detached copies without touching the shared master or selection', t => {
    const {manager, layer, canvases} = fixture(t), group = manager.addGroup('Group');
    layer.groupId = group.id;
    const originals = [...manager.layers], master = layer.sourceCanvas, before = layer.getImageData(), start = canvases.length;
    const context = Object.getPrototypeOf(layer.ctx), draw = context.drawImage; let fail = true;
    context.drawImage = function(image, ...args) {
        draw.call(this, image, ...args);
        if (image === group.canvas && fail) {fail = false; throw Error('Partial canvas write');}
    };
    t.after(() => {context.drawImage = draw;});
    assert.throws(() => manager.duplicateLayer(group.id), /Partial canvas write/);
    assert.deepEqual(manager.layers, originals); assert.equal(manager.activeLayerId, group.id);
    assert.deepEqual([...manager.selectedLayerIds], [group.id]); unchanged(layer, before);
    for (const canvas of canvases.slice(start)) assert.deepEqual([canvas.width, canvas.height], [1, 1]);
    assert.deepEqual([master.width, master.height], [8, 8]);
    assert.ok(manager.duplicateLayer(group.id)); assert.equal(manager.layers.length, 4);
});

for (const method of ['createOutline', 'createDropShadow']) {
    test(`${method} restores pixels and master after a partial write, frees temporary canvases, then permits retry`, t => {
        const {manager, layer, history, canvases} = fixture(t), before = layer.getImageData(), start = canvases.length;
        failOnce(layer.ctx, 'drawImage');
        assert.throws(() => manager[method](), /Partial canvas write/);
        unchanged(layer, before); assert.equal(history.undoStack.length, 0);
        for (const canvas of canvases.slice(start)) assert.deepEqual([canvas.width, canvas.height], [1, 1]);
        assert.equal(manager[method](), layer); const after = layer.getImageData();
        assert.notDeepEqual(after.data, before.data); assert.equal(history.undoStack.length, 1);
        history.undo(); unchanged(layer, {...before, mollySnapshot: {...before.mollySnapshot, contentRevision: layer.contentRevision}});
        history.redo(); assert.deepEqual(layer.getImageData().data, after.data);
    });
}

test('merge failure preserves both layers, selection and exact lower snapshot', t => {
    const {manager, layer, canvases} = fixture(t), before = layer.getImageData();
    const upper = manager.addLayer('Upper'); upper.ctx.fillStyle = '#aabbcc'; upper.ctx.fillRect(3, 3, 2, 2);
    const start = canvases.length; failOnce(layer.ctx, 'drawImage');
    assert.throws(() => manager.mergeDown(upper.id), /Partial canvas write/);
    unchanged(layer, before); assert.deepEqual(manager.layers, [layer, upper]);
    assert.equal(manager.activeLayerId, upper.id); assert.deepEqual([...manager.selectedLayerIds], [upper.id]);
    for (const canvas of canvases.slice(start)) assert.deepEqual([canvas.width, canvas.height], [1, 1]);
});

test('multi-layer replacement rolls back every changed layer if a later write fails', t => {
    const {manager, layer, history} = fixture(t), second = manager.addLayer('Second');
    second.ctx.fillStyle = '#112233'; second.ctx.fillRect(1, 1, 2, 2); second.invalidateSource();
    const snapshots = [layer, second].map(item => item.getImageData()); failOnce(second.ctx, 'putImageData');
    assert.throws(() => manager.replaceColor('#112233', '#ff0000', 0, true), /Partial canvas write/);
    [layer, second].forEach((item, index) => unchanged(item, snapshots[index]));
    assert.equal(history.undoStack.length, 0);
    assert.equal(manager.replaceColor('#112233', '#ff0000', 0, true), 10);
    assert.equal(history.undoStack.length, 1); history.undo();
    [layer, second].forEach((item, index) => assert.deepEqual(item.getImageData().data, snapshots[index].data));
});

test('replacing a color with itself is a no-op and keeps editable geometry and master', t => {
    const {manager, layer, history} = fixture(t), before = layer.getImageData();
    assert.equal(manager.replaceColor('#112233', '#112233'), 0);
    unchanged(layer, before); assert.equal(history.undoStack.length, 0);
});

test('replacement counts only pixels whose RGB actually changes within tolerance', t => {
    const {manager, layer} = fixture(t);
    layer.ctx.fillStyle = '#112234'; layer.ctx.fillRect(2, 2, 1, 1);
    assert.equal(manager.replaceColor('#112233', '#112234', 1), 5);
});

for (const direction of ['undo', 'redo']) test(`a failed pixel ${direction} keeps the image, metadata and history position unchanged`, t => {
    const {layer, history} = fixture(t), before = layer.getImageData();
    layer.ctx.fillStyle = '#ff0000'; layer.ctx.fillRect(2, 2, 1, 1); layer.invalidateSource();
    const after = layer.getImageData(); history.push(new DrawCommand(layer, before, after));
    if (direction === 'redo') history.undo();
    const current = layer.getImageData(), position = [history.undoStack.length, history.redoStack.length];
    const error = console.error; console.error = () => {}; t.after(() => { console.error = error; });
    failOnce(layer.ctx, 'putImageData');
    assert.equal(history[direction](), false); unchanged(layer, current);
    assert.deepEqual([history.undoStack.length, history.redoStack.length], position);
    assert.equal(history[direction](), true);
    assert.deepEqual(layer.getImageData().data, direction === 'undo' ? before.data : after.data);
});

test('sparse merge history stores pixel patches and remains reversible', t => {
    const {manager, layer, history} = fixture(t, 64), before = layer.getImageData();
    const upper = manager.addLayer('Upper'); upper.ctx.fillStyle = '#aabbcc'; upper.ctx.fillRect(3, 3, 1, 1);
    const merged = manager.mergeDown(upper.id);
    const command = new MergeLayersCommand(manager, merged.lowerLayer, merged.before, upper, merged.index, merged.after);
    assert.equal(command.beforeData.pixelPatch, true);
    assert.ok(command.beforeData.data.byteLength < before.data.byteLength);
    history.push(command); const after = layer.getImageData();
    history.undo(); assert.deepEqual(manager.layers, [layer, upper]); assert.deepEqual(layer.getImageData().data, before.data);
    history.redo(); assert.deepEqual(manager.layers, [layer]); assert.deepEqual(layer.getImageData().data, after.data);
});

for (const scale of [false, true]) test(`failed document resize (scale=${scale}) restores all layers before publishing a size change`, t => {
    const {manager, layer} = fixture(t), second = manager.addLayer('Second');
    const before = [layer, second].map(item => item.getImageData());
    const method = scale ? 'scale' : 'resize', resize = second[method].bind(second);
    second[method] = (...args) => { resize(...args); throw Error('Resize failed'); };
    let updates = 0; manager.bus.on('CANVAS_UPDATED', () => updates++);
    assert.throws(() => manager.resizeCanvas(12, 10, 'center', 'center', scale), /Resize failed/);
    assert.deepEqual(manager.config, {width: 8, height: 8});
    [layer, second].forEach((item, index) => unchanged(item, before[index]));
    assert.equal(updates, 0);
});

test('layer effects and replacement leave the document alone when a pending edit cannot commit', t => {
    const {manager, layer, history} = fixture(t), before = layer.getImageData();
    window.mollyEditor.tools = {finishDocument: () => false};
    assert.equal(manager.createOutline(), null); assert.equal(manager.createDropShadow(), null);
    assert.equal(manager.replaceColor('#112233', '#ff0000'), 0);
    unchanged(layer, before); assert.equal(history.undoStack.length, 0);
});
