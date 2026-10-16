const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { createRecoveryStore } = require('../src/main/recoveryStore.js');
const { app, root, profile, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

async function toolScenarios() {
    const editor = window.mollyEditor, manager = editor.projectManager, checks = [];
    const expect = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
    const snapshot = layer => [...layer.ctx.getImageData(0, 0, layer.width, layer.height).data];
    editor.settingsManager.set('animationsEnabled', false);
    const layer = editor.layerManager.addLayer('Selection fixture');
    layer.ctx.fillStyle = '#FA7311'; layer.ctx.fillRect(2, 2, 4, 4); layer.invalidateSource();
    const before = snapshot(layer);
    editor.tools.setTool('marquee');
    const marquee = editor.tools.tools.marquee;
    marquee.selection = { x: 2, y: 2, width: 4, height: 4 };
    marquee.liftSelectionToFloating(layer);
    marquee.nudge(5, 3);
    marquee.setSelectionDimensions(8, 8);
    expect(marquee.commitFloating(layer), 'selection move and resize commit');
    const after = snapshot(layer);
    expect(after.some((value, index) => value !== before[index]), 'selection transform changes pixels');
    expect(editor.history.undo() && snapshot(layer).every((value, index) => value === before[index]), 'selection transform undo restores every pixel');
    expect(editor.history.redo() && snapshot(layer).every((value, index) => value === after[index]), 'selection transform redo restores every pixel');
    marquee.clearSelection();
    editor.tools.setTool('move');
    editor.tools.tools.move.syncBoxWithActiveLayer();
    editor.tools.tools.move.setBoxDimensions(12, 10);
    expect(editor.history.undo() && snapshot(layer).every((value, index) => value === after[index]), 'object scale undo preserves previous selection transform');
    await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => editor.tools.tools.text.fontImages.minecraft ? resolve() : Date.now() > deadline ? reject(new Error('Text atlas timeout')) : setTimeout(poll, 20);
        poll();
    });
    const text = editor.layerManager.addTextLayer('Editable gradient', { text: 'Editable', fontId: 'minecraft', color: '#FFE066', x: 1, y: 1 });
    editor.tools.setTool('text'); editor.tools.tools.text.renderTextLayer(text);
    document.getElementById('textSegColorGradient').click();
    const hex = document.querySelector('#textGradientStopsList [data-gradient-role="hex"]');
    hex.value = '#FFE066'; hex.dispatchEvent(new Event('change', { bubbles: true }));
    expect(await manager.saveProjectAs(), 'gradient text saves through native file IO');
    const original = manager.serializeProject();
    const filePath = editor.projects.find(item => item.id === editor.activeProjectId).filePath;
    const saved = JSON.parse(await window.electronAPI.readFile(filePath));
    expect(JSON.stringify(saved.layers) === JSON.stringify(original.layers), 'saved file contains the expected pixels and editable text');
    const reopened = await manager.deserializeProject(saved, filePath);
    const restoredText = editor.layerManager.layers.find(item => item.type === 'text');
    expect(restoredText?.textData.text === 'Editable' && restoredText.textData.gradientColors[0] === '#FFE066', 'saved gradient text reopens editable with its colors');
    const aliases = [];
    for (const draftId of ['index', 'CaseAlias', 'casealias']) {
        const project = await manager.deserializeProject({ ...original, draftId });
        aliases.push(project.draftId.toLowerCase());
    }
    expect(new Set(aliases).size === 3 && !aliases.includes('index'), 'opened files cannot collide with recovery index or case aliases');
    // Keep two independent edited tabs durable, including an inactive document.
    editor.layerManager.addLayer('Crash marker').ctx.fillRect(1, 1, 2, 2);
    editor.layerManager.getActiveLayer().invalidateSource();
    editor.bus.emit('CANVAS_UPDATED');
    const tabA = editor.activeProjectId;
    editor.addProject('Second crash document', 'none', 32, 32, false, 'canvas');
    editor.tools.setTool('pencil');
    editor.tools.onPointerDown(3, 3, {}); editor.tools.onPointerUp(3, 3, {});
    const tabB = editor.activeProjectId;
    manager.queueAutosave(tabA); manager.queueAutosave(tabB);
    expect(await manager.flushAutosaves(), 'two edited tabs flush to the durable recovery store');
    const expected = [tabA, tabB].map(id => {
        const project = editor.projects.find(item => item.id === id), data = manager.serializeProject(id);
        return { id: project.draftId, name: project.name, layers: data.layers.map(item => ({ name: item.name, dataUrl: item.dataUrl, textData: item.textData })) };
    });
    return { checks, expected, reopenedId: reopened.id };
}

async function profileLargeProject() {
    const editor = window.mollyEditor;
    editor.projectManager.autosaveSuppressed = true;
    editor.settingsManager.set('animationsEnabled', false);
    editor.addProject('Load benchmark 1024 x 1024 x 24', 'none', 1024, 1024, false, 'canvas');
    const { default: Layer } = await import(new URL('./js/graphics/Layer.js', location.href).href);
    const layers = Array.from({ length: 24 }, (_, index) => {
        const layer = new Layer(`benchmark-${index}`, `Layer ${index}`, 1024, 1024);
        layer.ctx.fillStyle = `hsl(${index * 15} 70% 50%)`;
        layer.ctx.fillRect(index * 10, index * 10, 80, 80);
        layer.invalidateSource();
        return layer;
    });
    editor.layerManager.setLayers(layers);
    editor.bus.emit('LAYER_ORDER_CHANGED'); editor.bus.emit('CANVAS_UPDATED');
    const metrics = {}, measure = (name, operation) => {
        const start = performance.now(); const result = operation(); metrics[name] = +(performance.now() - start).toFixed(2); return result;
    };
    measure('render24LayersMs', () => editor.renderer.render());
    let encodes = 0;
    for (const layer of layers) {
        const original = layer.canvas.toDataURL.bind(layer.canvas);
        layer.canvas.toDataURL = (...args) => { encodes++; return original(...args); };
    }
    measure('serializeColdMs', () => editor.projectManager.serializeProject());
    const firstEncodes = encodes;
    measure('serializeCachedMs', () => editor.projectManager.serializeProject());
    if (encodes !== firstEncodes) throw new Error('Unchanged project re-encoded its PNG layers');
    const target = layers[0];
    measure('boundsColdMs', () => target.getBounds());
    measure('boundsCachedMs', () => target.getBounds());
    measure('switch12LayersMs', () => { for (const layer of layers.slice(0, 12)) { editor.layerManager.setActive(layer.id); editor.renderer.render(); } });
    editor.layerManager.setActive(target.id); editor.tools.setTool('pencil');
    measure('strokeWithUndoSnapshotMs', () => { editor.tools.onPointerDown(300, 300, {}); editor.tools.onPointerUp(300, 300, {}); });
    measure('undoMs', () => editor.history.undo());
    const png = measure('exportPngMs', () => editor.renderer.exportToPNG());
    if (!png.startsWith('data:image/png;') || editor.history.getUndoMemoryBytes() > editor.history.memoryBudgetBytes) throw new Error('Large project violated export or history budget');
    return { dimensions: [1024, 1024], layers: 24, pixels: 24 * 1024 * 1024, coldLayerEncodes: firstEncodes, repeatedLayerEncodes: encodes - firstEncodes, historyBudgetBytes: editor.history.memoryBudgetBytes, metrics };
}

(async () => {
    let window, releaseWrite, enteredWrite;
    const writeEntered = new Promise(resolve => { enteredWrite = resolve; });
    const writeGate = new Promise(resolve => { releaseWrite = resolve; });
    const watchdog = setTimeout(() => { console.error('User scenarios timed out'); app.exit(1); }, 120000);
    try {
        await ready({ durable: true, beforeRecoveryWrite: async draft => {
            if (draft.project.name === 'In-flight recovery') { enteredWrite(); await writeGate; }
        } });
        window = makeWindow();
        await window.loadFile(path.join(root, 'www/editor.html'), { query: { new: 'true', type: 'canvas', width: '32', height: '32', name: 'Scenario fixture' } });
        const result = await window.webContents.executeJavaScript(`(${toolScenarios.toString()})()`);
        const inFlight = { draftId: 'in-flight-test', timestamp: Date.now(), project: { name: 'In-flight recovery', type: 'canvas', config: { width: 32, height: 32 }, layers: [] } };
        await window.webContents.executeJavaScript(`void window.electronAPI.writeRecoveryDraft(${JSON.stringify(inFlight)}).catch(() => {})`);
        await writeEntered;
        const crashed = once(window.webContents, 'render-process-gone');
        window.webContents.forcefullyCrashRenderer();
        await crashed;
        releaseWrite();
        const store = createRecoveryStore(path.join(profile, 'recovery-drafts'));
        for (let attempt = 0; ; attempt++) {
            try { await store.read(inFlight.draftId); break; }
            catch (error) { if (attempt >= 50) throw error; await new Promise(resolve => setTimeout(resolve, 50)); }
        }
        result.checks.push('main process completes an in-flight recovery write after renderer death');
        window.destroy();
        window = makeWindow();
        await window.loadFile(path.join(root, 'www/editor.html'), { query: { new: 'true', type: 'canvas', width: '32', height: '32', name: 'Restart fixture' } });
        for (const expected of result.expected) {
            const actual = await window.webContents.executeJavaScript(`(async () => {
                const editor = window.mollyEditor;
                if (!await editor.projectManager.restoreCrashDraft(${JSON.stringify(expected.id)})) throw new Error('Recovery failed');
                const data = editor.projectManager.serializeProject();
                return { name: data.name, layers: data.layers.map(item => ({ name: item.name, dataUrl: item.dataUrl, textData: item.textData })) };
            })()`);
            if (JSON.stringify(actual) !== JSON.stringify({ name: expected.name, layers: expected.layers })) throw new Error(`Restored pixels or text differ: ${expected.name}`);
        }
        result.checks.push('both tabs restore identical pixels and editable text after renderer crash');
        const performance = await window.webContents.executeJavaScript(`(${profileLargeProject.toString()})()`);
        await settle(window);
        const report = { passed: result.checks.length, scenarios: result.checks, performance };
        const output = path.join(root, '.test-output');
        await fs.mkdir(output, { recursive: true });
        await fs.writeFile(path.join(output, 'user-scenarios.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
    finally { clearTimeout(watchdog); releaseWrite?.(); window?.destroy(); }
})();
