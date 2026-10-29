import test from 'node:test';
import assert from 'node:assert/strict';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import {insertDecodedImage} from '../../src/renderer/js/core/ImageImport.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

function fixture(t) {
    const previous = {document: globalThis.document, window: globalThis.window}, canvases = [];
    globalThis.document = {getElementById: () => null, createElement() { const canvas = new RasterCanvas(); canvases.push(canvas); return canvas; }};
    const bus = new EventBus(), manager = new LayerManager(bus, {width: 8, height: 8}), history = new History(bus);
    const project = {id: 'project', type: 'canvas'};
    const app = {bus, history, config: manager.config, layerManager: manager, tools: {finishDocument: () => true}, getActiveProject: () => project, showToast() {}};
    globalThis.window = {mollyEditor: app};
    t.after(() => { globalThis.document = previous.document; globalThis.window = previous.window; });
    const image = new RasterCanvas(2, 2); image.context.fillStyle = '#12AB34'; image.context.fillRect(0, 0, 2, 2);
    return {app, manager, history, image, canvases};
}

test('image import publishes complete pixels and a separate original master with one undo action', t => {
    const {app, manager, history, image} = fixture(t);
    const layer = insertDecodedImage(app, image, {name: 'Test'});
    assert.equal(manager.layers.length, 1); assert.equal(history.undoStack.length, 1);
    assert.equal(layer.sourceCanvas.width, 2); assert.equal(layer.sourceCanvas.height, 2);
    assert.notEqual(layer.sourceCanvas, image);
    assert.deepEqual([...layer.ctx.getImageData(3, 3, 1, 1).data], [18, 171, 52, 255]);
    history.undo(); assert.equal(manager.layers.length, 0);
    history.redo(); assert.equal(manager.layers[0], layer);
    assert.deepEqual([...layer.sourceCanvas.getContext('2d').getImageData(0, 0, 1, 1).data], [18, 171, 52, 255]);
});

test('unreadable image pixels never publish a partial layer or history record', t => {
    const {app, manager, image, canvases} = fixture(t), create = document.createElement;
    document.createElement = () => {
        const canvas = create(), get = canvas.getContext.bind(canvas);
        canvas.getContext = () => {
            const context = get();
            context.getImageData = () => { const error = new Error('tainted'); error.name = 'SecurityError'; throw error; };
            return context;
        };
        return canvas;
    };
    assert.throws(() => insertDecodedImage(app, image), /Сохраните его в PNG/);
    assert.equal(manager.layers.length, 0); assert.equal(app.history.undoStack.length, 0);
    assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1));
});

test('a failed history notification restores the original layer array and active selection', t => {
    const {app, manager, image} = fixture(t), original = manager.addLayer('Original'), vector = manager.layers;
    app.history.push = () => { throw Error('history failed'); };
    assert.throws(() => insertDecodedImage(app, image), /history failed/);
    assert.equal(manager.layers, vector); assert.deepEqual(manager.layers, [original]);
    assert.equal(manager.activeLayerId, original.id);
});
