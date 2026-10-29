import test from 'node:test';
import assert from 'node:assert/strict';
import BucketTool from '../../src/renderer/js/tools/BucketTool.js';
import EraserTool from '../../src/renderer/js/tools/EraserTool.js';
import PencilTool from '../../src/renderer/js/tools/PencilTool.js';
import CanvasTextEditor from '../../src/renderer/js/ui/CanvasTextEditor.js';
import ToolManager from '../../src/renderer/js/tools/ToolManager.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import MarqueeTool from '../../src/renderer/js/tools/MarqueeTool.js';
import { imageDataEquals } from '../../src/renderer/js/core/ImageDataUtils.js';

test('tool changes expose the selected button, including transform aliases', () => {
    const previous = globalThis.document;
    const controls = ['brush', 'move', 'text'].map(tool => ({
        dataset: { tool }, attributes: {}, active: false,
        classList: { toggle(_name, value) { controls.find(control => control.dataset.tool === tool).active = value; } },
        setAttribute(name, value) { this.attributes[name] = value; }
    }));
    globalThis.document = { querySelectorAll: () => controls };
    try {
        const manager = Object.create(ToolManager.prototype), move = {};
        manager.tools = { brush: {}, move, transform: move, text: {} };
        manager.currentToolId = 'brush';
        manager.bus = { emit() {} };
        manager.updateContextualOptions = () => {};
        manager.setTool('transform');
        assert.deepEqual(controls.map(control => control.attributes['aria-pressed']), ['false', 'true', 'false']);
        assert.deepEqual(controls.map(control => control.active), [false, true, false]);
        manager.setTool('text');
        assert.deepEqual(controls.map(control => control.attributes['aria-pressed']), ['false', 'false', 'true']);
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
});

test('bucket flood fill visits each pixel once on a large uniform canvas', () => {
    const width = 640;
    const height = 480;
    const source = 0xff112233;
    const fill = 0xffaabbcc;
    const pixels = new Uint32Array(width * height).fill(source);
    const tool = Object.create(BucketTool.prototype);

    assert.equal(tool.floodFill(pixels, 0, 0, width, height, source, fill, 0), true);
    assert.ok(pixels.every(pixel => pixel === fill));
});

test('bucket color parser accepts RGB/RGBA hex and rejects malformed colors', () => {
    const tool = Object.create(BucketTool.prototype);
    assert.equal(tool.hexToUint32('#123'), 0xff332211);
    assert.equal(tool.hexToUint32('#11223380'), 0x80332211);
    assert.equal(tool.hexToUint32('#12xz90'), null);
    assert.equal(tool.hexToUint32(''), null);
});

test('image equality checks dimensions and pixel bytes', () => {
    assert.equal(imageDataEquals({ width: 1, height: 1, data: [1, 2, 3, 4] }, { width: 1, height: 1, data: [1, 2, 3, 4] }), true);
    assert.equal(imageDataEquals({ width: 1, height: 1, data: [1, 2, 3, 4] }, { width: 1, height: 1, data: [1, 2, 3, 5] }), false);
    assert.equal(imageDataEquals({ width: 1, height: 1, data: [1, 2, 3, 4] }, { width: 2, height: 1, data: [1, 2, 3, 4] }), false);
});

test('tool manager keeps pointer events with the tool that started the gesture', () => {
    const calls = [];
    const original = {
        onPointerDown: (...args) => calls.push(['down', ...args]),
        onPointerMove: (...args) => calls.push(['move', ...args]),
        onPointerUp: (...args) => calls.push(['up', ...args])
    };
    const replacement = { onPointerMove: () => calls.push(['wrong-tool']) };
    const layer = { id: 'layer-a' };
    const manager = Object.create(ToolManager.prototype);
    manager.pointerSession = null;
    manager.tools = { brush: original, eraser: replacement };
    manager.currentToolId = 'brush';
    manager.color = '#123456';
    manager.size = 3;
    manager.layerManager = { getActiveLayer: () => layer };

    manager.onPointerDown(4, 5, { pointerId: 1 });
    manager.currentToolId = 'eraser';
    manager.onPointerMove(8, 9, { pointerId: 1 });
    manager.onPointerUp(10, 11, { pointerId: 1 });

    assert.deepEqual(calls.map(call => call[0]), ['down', 'move', 'up']);
    assert.equal(calls[1][1], 8);
    assert.equal(calls[2][1], 10);
    assert.equal(manager.pointerSession, null);
});

test('pixel-perfect pencil restores the original pixel instead of erasing it', () => {
    let restored = null;
    const pencil = Object.create(PencilTool.prototype);
    pencil.targetLayer = {
        width: 2,
        height: 1,
        ctx: {
            createImageData: () => ({ data: new Uint8ClampedArray(4) }),
            putImageData: (image, x, y) => { restored = { pixel: [...image.data], x, y }; }
        }
    };
    pencil.beforeData = { data: new Uint8ClampedArray([11, 22, 33, 44, 90, 80, 70, 255]) };

    pencil.restoreOriginalPoint(1, 0);
    assert.deepEqual(restored, { pixel: [90, 80, 70, 255], x: 1, y: 0 });
});

test('eraser does not change alpha-locked layers', () => {
    const layer = { locked: false, visible: true, isBase: false, type: 'bitmap', alphaLocked: true };
    const eraser = Object.create(EraserTool.prototype);
    eraser.layerManager = {
        getLayers: () => [layer],
        getActiveLayer: () => layer
    };
    eraser.isDrawing = false;
    eraser.onPointerDown(0, 0, '#000000', 1, layer);
    assert.equal(eraser.isDrawing, false);
});

test('eraser follows the short wrapped path while tiling is enabled', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { mollyEditor: { workspace: { tilingMode: true } } };
    const calls = [];
    const tool = Object.create(EraserTool.prototype);
    tool.targetLayer = { width: 10, height: 6 };
    tool.toolManager = { symmetryX: false, symmetryY: false };
    const ctx = { clearRect: (x, y) => calls.push([x, y]) };

    try {
        tool.eraseLine(ctx, 0, 2, 9, 2, 1, 10, 6);
        assert.deepEqual(calls, [[0, 2], [9, 2]]);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('text frame resizing is undoable without changing letter size or text', () => {
    const layer = { textData: { text: 'Hello', x: 2, y: 3, maxWidth:40, fontSize:8 } };
    const commands = [];
    const tool = {
        history: { push: command => commands.push(command) },
        bus: { emit: () => {} }
    };
    const editor=Object.create(CanvasTextEditor.prototype);
    Object.assign(editor,{tool,bus:tool.bus,drag:{kind:'resize',layer,before:{textData:{...layer.textData}}},notify(){},render(){}});
    layer.textData.maxWidth=70;
    editor.pointerUp();
    assert.equal(commands.length, 1);
    commands[0].undo();
    assert.equal(layer.textData.maxWidth,40);
    assert.equal(layer.textData.fontSize,8);
    assert.equal(layer.textData.text,'Hello');
    assert.equal(editor.drag,null);
});

test('move tool commits the transform handle captured before pointer state is cleared', () => {
    let committedHandle = null;
    const tool = {
        isPointerDown: true,
        activeHandle: { id: 'rot' },
        onPointerMove() {},
        hasMoved: true,
        activeSnapLines: [],
        lastPointerEvent: { x: 10, y: 12 },
        commitAction: handle => { committedHandle = handle; }
    };

    MoveTool.prototype.onPointerUp.call(tool, 10, 12);
    assert.deepEqual(committedHandle, { id: 'rot' });
    assert.equal(tool.activeHandle, null);
});

test('marquee Alt+Backspace runs fill instead of delete', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { mollyEditor: { tools: { currentToolId: 'marquee' } } };
    const actions = [];
    const tool = {
        fillSelection: () => actions.push('fill'),
        deleteSelection: () => actions.push('delete')
    };
    const event = {
        target: { closest: () => null },
        altKey: true,
        key: 'Backspace',
        preventDefault() {}
    };

    try {
        MarqueeTool.prototype.onKeyDown.call(tool, event);
        assert.deepEqual(actions, ['fill']);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('floating marquee commit preserves its data when no recovery layer can be created', () => {
    const tool = Object.create(MarqueeTool.prototype);
    const floatingCanvas = { width: 1, height: 1 };
    const floatingData = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    tool.floatingCanvas = floatingCanvas;
    tool.floatingData = floatingData;
    tool.floatingLayer = null;
    tool.beforeData = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    tool.selection = { x: 0, y: 0, width: 1, height: 1 };
    tool.layerManager = { layers: [], addLayer: () => null };

    assert.equal(tool.commitFloating({ locked: true }), false);
    assert.equal(tool.floatingCanvas, floatingCanvas);
    assert.equal(tool.floatingData, floatingData);
});

test('floating marquee moved to another layer records undo on the destination layer', () => {
    const destination = {
        locked: false,
        value: 10,
        width: 1,
        height: 1,
        ctx: {
            save() {},
            restore() {},
            drawImage() { destination.value = 20; }
        },
        getImageData() { return { width: 1, height: 1, data: new Uint8ClampedArray([this.value]) }; },
        putImageData(data) { this.value = data.data[0]; },
        invalidateSource() {}
    };
    const commands = [];
    const original = { id: 'removed-layer' };
    const tool = Object.create(MarqueeTool.prototype);
    tool.floatingCanvas = { width: 1, height: 1 };
    tool.floatingData = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    tool.floatingLayer = original;
    tool.beforeData = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
    tool.selection = { x: 0, y: 0, width: 1, height: 1 };
    tool.layerManager = { layers: [destination] };
    tool.history = { push: command => commands.push(command) };
    tool.bus = { emit() {} };

    assert.equal(tool.commitFloating(destination), true);
    assert.equal(commands.length, 1);
    assert.equal(destination.value, 20);
    commands[0].undo();
    assert.equal(destination.value, 10);
});
