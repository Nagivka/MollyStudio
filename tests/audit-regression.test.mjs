import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import EventBus from '../www/js/core/EventBus.js';
import { DrawCommand, GroupLayersCommand, RemoveLayerCommand, CompoundCommand, ResizeCanvasCommand } from '../www/js/core/Commands.js';
import Layer from '../www/js/graphics/Layer.js';
import History from '../www/js/core/History.js';
import ProjectManager from '../www/js/core/ProjectManager.mjs';
import ColorPicker from '../www/js/ui/ColorPicker.js';
import TextTool from '../www/js/tools/TextTool.js';
import RectTool from '../www/js/tools/RectTool.js';
import ToolManager from '../www/js/tools/ToolManager.js';
import MarqueeTool from '../www/js/tools/MarqueeTool.js';
import { isShortcutTarget } from '../www/js/ui/KeyboardNavigation.js';
import { validateProjectDocument } from '../www/js/core/ProjectValidation.mjs';
import { pngData } from './helpers/png.mjs';

const require = createRequire(import.meta.url);
const { atomicWriteFile } = require('../src/main/fileStore.js');

function withGlobal(t, key, value) {
    const previous = globalThis[key];
    globalThis[key] = value;
    t.after(() => { if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
}

test('event names cannot collide with object properties; dispatch has a stable listener snapshot', () => {
    const bus = new EventBus(), calls = [];
    const second = () => calls.push(2);
    bus.on('constructor', () => { calls.push(1); bus.off('constructor', second); });
    bus.on('constructor', second);
    bus.emit('constructor'); bus.emit('constructor');
    assert.deepEqual(calls, [1, 2, 1]);
});

test('atomic writes to the same file preserve request order and clean temporary files', async t => {
    const prefix = path.join(import.meta.dirname, '.molly-audit-');
    const directory = await mkdtemp(prefix);
    t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); await rm(directory, { recursive: true, force: true }); });
    const target = path.join(directory, 'project.mlst');
    const first = atomicWriteFile(target, 'a'.repeat(200000));
    const second = atomicWriteFile(target, 'latest');
    await Promise.all([first, second]);
    assert.equal(await readFile(target, 'utf8'), 'latest');
    assert.deepEqual(await readdir(directory), ['project.mlst']);
    await assert.rejects(atomicWriteFile(path.join(directory, 'missing', 'file'), 'x'));
    assert.deepEqual(await readdir(directory), ['project.mlst']);
});

test('undoing a pixel edit restores its source master and editable shape metadata', () => {
    const master = { width: 8, height: 8 };
    const layer = Object.create(Layer.prototype);
    Object.assign(layer, { width: 1, height: 1, ctx: { putImageData() {} }, sourceCanvas: null });
    const before = { width: 1, height: 1, mollySnapshot: { type: 'bitmap', shapeData: { x0: 2 }, sourceCanvas: master, sourceRect: { x: 2, y: 3, w: 8, h: 8 } } };
    new DrawCommand(layer, before, null).undo();
    assert.equal(layer.sourceCanvas, master);
    assert.equal(layer.shapeData.x0, 2);
    assert.equal(layer.sourceRect.y, 3);
});

function managerFor(layers) {
    return { layers, bus: new EventBus(), selectedLayerIds: new Set(), setActive(id) { this.activeLayerId = id; } };
}

test('group undo restores previous membership; deleting a group reparents and restores its children', () => {
    const old = { id: 'old', isGroup: true }, group = { id: 'new', isGroup: true, groupId: 'old' };
    const child = { id: 'child', groupId: 'new' };
    const manager = managerFor([old, child, group]);
    const grouping = new GroupLayersCommand(manager, group, [child], [old, child], new Map([['child', 'old']]));
    grouping.undo(); assert.equal(child.groupId, 'old');
    grouping.execute(); assert.equal(child.groupId, 'new');
    const removal = new RemoveLayerCommand(manager, group);
    removal.execute(); assert.equal(child.groupId, 'old');
    removal.undo(); assert.equal(child.groupId, 'new'); assert.ok(manager.layers.includes(group));
});

test('a compound command rolls back earlier commands when a later command fails', () => {
    let value = 0;
    const command = new CompoundCommand([{ execute() { value++; }, undo() { value--; } }, { execute() { throw new Error('failed'); }, undo() {} }]);
    assert.throws(() => command.execute(), /failed/);
    assert.equal(value, 0);
});

test('an oversized untracked edit clears both undo and redo', t => {
    withGlobal(t, 'document', undefined);
    const history = new History(new EventBus()); history.memoryBudgetBytes = 8;
    history.redoStack.push({}); history.undoStack.push({});
    assert.equal(history.push({ beforeData: { data: new Uint8Array(16) } }), false);
    assert.equal(history.undoStack.length + history.redoStack.length, 0);
});

test('canvas resize undo applies layer snapshots and document dimensions together', () => {
    const sizes = [], layerSizes = [];
    const app = { config: {}, getActiveProject: () => ({ config: {} }), renderer: { resize: (w, h) => sizes.push([w, h]) }, updateProjectTypeUI() {}, workspace: { fitToScreen() {} }, bus: new EventBus() };
    const command = new ResizeCanvasCommand(app, { width: 16, height: 16 }, { width: 32, height: 24 }, [{ execute: () => layerSizes.push(32), undo: () => layerSizes.push(16) }]);
    command.undo(); command.execute();
    assert.deepEqual(sizes, [[16, 16], [32, 24]]); assert.deepEqual(layerSizes, [16, 32]);
});

test('manual saves stay serialized and retain the tab captured when Save was requested', async t => {
    const writes = [], releases = [];
    withGlobal(t, 'window', { electronAPI: { writeFile: (file, json) => new Promise(resolve => { writes.push([file, JSON.parse(json).name]); releases.push(resolve); }) } });
    const projects = ['A', 'B'].map(name => ({ id: name, name, filePath: `${name}.mlst`, layers: [], config: { width: 32, height: 32 } }));
    const app = { projects, activeProjectId: 'A', config: projects[0].config, layerManager: { getLayers: () => [] } };
    const manager = new ProjectManager(app);
    manager.recordRecentSafely = () => {}; manager.refreshSavedProjectPreview = async () => {}; manager.finishSave = async () => {};
    const first = manager.saveProject(); app.activeProjectId = 'B'; const second = manager.saveProject();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, [['A.mlst', 'A']]);
    releases.shift()(); await first; await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(writes, [['A.mlst', 'A'], ['B.mlst', 'B']]);
    releases.shift()(); await second; await manager.waitForPendingSaves();
    assert.equal(manager.pendingSaves.size, 0);
});

test('a document boundary refuses to discard a floating selection that could not commit', () => {
    const manager = Object.create(ToolManager.prototype);
    manager.tools = { marquee: { clearSelection() {}, hasFloating: () => true } };
    manager.bus = new EventBus();
    assert.equal(manager.finishDocument(), false);
});

test('copy clips selections starting outside the canvas to their actual intersection', t => {
    let copied;
    withGlobal(t, 'document', { createElement: () => ({ getContext: () => ({ drawImage: (...args) => { copied = args; } }) }) });
    const marquee = Object.create(MarqueeTool.prototype);
    marquee.selection = { x: -3, y: -2, width: 5, height: 6 };
    marquee.layerManager = { getActiveLayer: () => ({ width: 8, height: 8, canvas: {} }) };
    marquee.copy();
    assert.deepEqual(copied.slice(1, 5), [0, 0, 2, 4]);
    assert.equal(marquee.clipboard.width, 2);
});

test('the shading ramp creates accessible buttons without preventing editor startup', t => {
    const slots = [];
    withGlobal(t, 'document', { createElement: () => ({ style: {}, classList: { add() {} }, setAttribute(key, value) { this[key] = value; }, appendChild() {}, addEventListener() {} }) });
    const picker = Object.create(ColorPicker.prototype);
    Object.assign(picker, { shadingRampList: { appendChild: slot => slots.push(slot) }, activeTarget: 'fg', fgColor: '#123456', rampSteps: 3, rampStrength: 20 });
    picker.renderShadingRamp();
    assert.ok(slots.length >= 3);
    assert.ok(slots.every(slot => /^Выбрать цвет #[0-9a-f]{6}$/i.test(slot['aria-label'])));
});

test('text form edits keep the first snapshot and commit to the original layer', t => {
    const inputs = new Map();
    const input = id => {
        if (!inputs.has(id)) inputs.set(id, { value: '', style: {}, classList: { contains: () => false, toggle() {} }, handlers: {}, addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); } });
        return inputs.get(id);
    };
    withGlobal(t, 'document', { getElementById: input, querySelectorAll: () => [] });
    const layer = { type: 'text', textData: { text: 'Original', color: '#123456', gradientAngle: 90 } }, commands = [];
    let active = layer;
    const tool = Object.create(TextTool.prototype);
    Object.assign(tool, { layerManager: { getActiveLayer: () => active }, history: { push: cmd => commands.push(cmd) }, bus: new EventBus(), renderTextLayer() {} });
    tool.setupUIBindings();
    tool.capturePendingEdit(); layer.textData.gradientAngle = 0;
    tool.capturePendingEdit(); layer.textData.gradientAngle = 180;
    active = { type: 'text', textData: { text: 'Other' } };
    tool.commitPendingEdit();
    assert.equal(commands.length, 1); assert.equal(commands[0].layer, layer);
    assert.equal(commands[0].oldTextData.gradientAngle, 90); assert.equal(commands[0].newTextData.gradientAngle, 180);
});

test('a missing bitmap font preserves the existing text raster', () => {
    const tool = Object.create(TextTool.prototype); tool.fontImages = {};
    let clears = 0;
    tool.renderTextLayer({ type: 'text', textData: { text: 'Hello', fontId: 'minecraft' }, clear() { clears++; } });
    assert.equal(clears, 0);
});

test('rounded rectangle outline builds both contours within a single evenodd path', () => {
    const tool = Object.create(RectTool.prototype), calls = [];
    const context = new Proxy({}, { set: () => true, get: (_target, name) => (...args) => calls.push([name, ...args]) });
    tool.drawRect(context, 0, 0, 20, 20, '#123456', 1, false, 4);
    assert.equal(calls.filter(call => call[0] === 'beginPath').length, 1);
    assert.ok(calls.some(call => call[0] === 'fill' && call[1] === 'evenodd'));
});

test('global shortcuts remain available after focusing toolbar buttons; activation keys stay native', () => {
    const button = { closest: selector => selector.includes('button') ? {} : null };
    assert.equal(isShortcutTarget(button, { key: 's', ctrlKey: true }), false);
    assert.equal(isShortcutTarget(button, { key: 'b' }), false);
    assert.equal(isShortcutTarget(button, { key: ' ' }), true);
    assert.equal(isShortcutTarget({ closest: () => ({}) }, { key: 's', ctrlKey: true }), true);
});

test('project validation rejects malformed PNG headers, mismatched dimensions, group cycles, and nonfinite text', () => {
    const project = layers => ({ config: { width: 32, height: 32 }, layers });
    assert.throws(() => validateProjectDocument(project([{ dataUrl: 'data:image/png;base64,AA==' }])), /повреждённое/);
    assert.throws(() => validateProjectDocument(project([{ dataUrl: pngData(16, 16) }])), /Размер изображения/);
    assert.throws(() => validateProjectDocument(project([{ id: 'g', type: 'group', groupId: 'g' }])), /структура групп/);
    assert.throws(() => validateProjectDocument(project([{ type: 'text', textData: { text: 'Hello', fontId: 'minecraft', x: Infinity } }])), /координаты/);
});

test('serialization reuses encoded layers and invalidates its cache after a pixel revision', () => {
    let encodes = 0;
    const layer = { contentRevision: 1, canvas: { toDataURL: () => `encoded-${++encodes}` } };
    const app = { projects: [{ id: 'a', layers: [layer] }], activeProjectId: 'a', layerManager: { getLayers: () => [layer] } };
    const manager = new ProjectManager(app);
    manager.serializeProject(); manager.serializeProject();
    assert.equal(encodes, 1);
    layer.contentRevision++;
    assert.equal(manager.serializeProject().layers[0].dataUrl, 'encoded-2');
});

test('selection-only canvas updates do not mark a saved document dirty', t => {
    withGlobal(t, 'window', { addEventListener() {} });
    const bus = new EventBus(), layer = { id: 'pixels', contentRevision: 1 };
    const app = { bus, projects: [{ id: 'a' }], activeProjectId: 'a', config: { width: 32, height: 32 }, layerManager: { getLayers: () => [layer] } };
    const manager = new ProjectManager(app); manager.initAutosave(); manager.markClean('a'); manager.markSaved('a');
    t.after(() => manager.markClean('a'));
    bus.emit('CANVAS_UPDATED'); bus.emit('LAYER_ACTIVE_CHANGED', layer);
    assert.equal(manager.hasUnsavedChanges('a'), false);
    layer.contentRevision++; bus.emit('CANVAS_UPDATED');
    assert.equal(manager.hasUnsavedChanges('a'), true);
});

test('autosave does not commit or serialize a floating selection in the middle of editing', async t => {
    const app = { projects: [{ id: 'a' }], activeProjectId: 'a', tools: { tools: { marquee: { hasFloating: () => true } } }, layerManager: { getLayers: () => [] } };
    const manager = new ProjectManager(app); manager.serializeProject = () => { throw new Error('Active selection must not serialize'); };
    manager.queueAutosave('a'); t.after(() => manager.markClean('a'));
    assert.equal(await manager.performAutosave('a'), false);
    assert.equal(manager.autosaveDirtyIds.has('a'), true);
});

test('an IndexedDB request that succeeds before transaction abort is not reported as durable storage', async t => {
    withGlobal(t, 'window', {});
    withGlobal(t, 'indexedDB', { open() {
        const request = {};
        queueMicrotask(() => {
            request.result = { transaction() {
                const transaction = { objectStore() { return { put() {
                    const write = {};
                    queueMicrotask(() => { write.onsuccess?.(); queueMicrotask(() => transaction.onabort?.()); });
                    return write;
                } }; } };
                return transaction;
            } };
            request.onsuccess();
        });
        return request;
    } });
    const store = await import('../www/js/core/RecoveryDraftStore.mjs?abort-test');
    const failingStorage = { setItem() { throw new Error('Quota exceeded'); } };
    await assert.rejects(store.writeRecoveryDraft(failingStorage, 'draft', { layers: [] }), /ни в одном хранилище/);
    const saved = new Map();
    await store.writeRecoveryDraft({ setItem: (key, value) => saved.set(key, value) }, 'fallback', { layers: [] });
    assert.ok([...saved.values()].some(value => JSON.parse(value).draftId === 'fallback'));
});
