const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');

async function cycleProjects(count) {
    const app = window.mollyEditor, manager = app.projectManager;
    const anchor = app.activeProjectId;
    window.sessionWeakRefs ||= [];
    for (let cycle = 0; cycle < count; cycle++) {
        app.addProject('Session ' + cycle, 'none', 512, 512, false, 'canvas');
        const project = app.getActiveProject();
        for (let index = 0; index < 6; index++) {
            const layer = app.layerManager.addLayer('Object ' + index);
            layer.ctx.fillStyle = `hsl(${index * 50}, 70%, 50%)`;
            layer.ctx.fillRect(10 + index, 10, 90, 100);
            layer.invalidateSource();
            layer.fx.texture = {type: 'noise', amount: 15, scale: 1, seed: index};
            layer.getRenderCanvas();
            window.sessionWeakRefs.push(new WeakRef(layer));
        }
        app.tools.setTool('pencil');
        for (let stroke = 0; stroke < 8; stroke++) {
            app.tools.onPointerDown(15 + stroke, 15, {});
            app.tools.onPointerUp(15 + stroke, 15, {});
        }
        const beforeUndo = app.history.undoStack.length;
        if (!app.history.undo() || !app.history.redo() || app.history.undoStack.length !== beforeUndo) throw Error('Session undo/redo failed');
        manager.serializeProject();
        window.sessionWeakRefs.push(new WeakRef(project));
        if (!await app.closeProject(project.id)) throw Error('Session project did not close');
        if (app.activeProjectId !== anchor || app.projects.length !== 1) throw Error('Closing a project lost its anchor');
        for (const map of [manager.autosaveTimers, manager.autosaveInFlight, manager.projectRevisions, manager.savedRevisions,
            manager.savedFingerprints, manager.saveStatusFingerprints, manager.documentFingerprints, manager.autosaveFailures, manager.saveStates]) {
            if (map.has(project.id)) throw Error('Closed project retained in manager state');
        }
        // Let queued DOM updates and native recovery writes settle between tabs.
        await new Promise(resolve => setTimeout(resolve, 15));
    }
    return count;
}

(async () => {
    let win;
    const timer = setTimeout(() => app.exit(1), 150000), checks = [];
    try {
        await ready(); win = makeWindow();
        await win.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'canvas', width: '32', height: '32', name: 'Session anchor'}});
        await win.webContents.executeJavaScript(`window.mollyEditor.settingsManager.set('confirmClose',false); window.mollyEditor.settingsManager.set('animationsEnabled',false)`);
        await win.page.evaluate(()=>{
            const app=window.mollyEditor,project=app.getActiveProject();app.resizeCanvas(512,512);app.history.clear();
            app.layerManager.addLayer('Active history');app.tools.setTool('pencil');
            for(let i=0;i<20;i++){app.tools.onPointerDown(i,i,{});app.tools.onPointerUp(i,i,{});}
            if(!app.history.undoStack.length)throw Error('Active history fixture has no commands');
            app.saveProjectState();window.clearedHistoryRefs=app.history.undoStack.map(command=>new WeakRef(command));app.history.clear();
            if(project.undoStack.length||project.redoStack.length||project.documentState.layers!==app.layerManager.layers)throw Error('Project retained stale history or layers');
        });
        await settle(win);await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        if(await win.page.evaluate(()=>window.clearedHistoryRefs.some(ref=>ref.deref())))throw Error('Cleared history commands remain reachable in the active project');
        checks.push('Clearing history in an open project releases snapshots without closing or switching the tab');
        await win.webContents.executeJavaScript(`(${cycleProjects.toString()})(3)`);
        await settle(win);
        await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        const before = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
        await win.webContents.executeJavaScript(`window.sessionWeakRefs=[]; (${cycleProjects.toString()})(30)`);
        await settle(win);
        await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
        const after = await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
        const retained = await win.webContents.executeJavaScript(`window.sessionWeakRefs.filter(ref=>ref.deref()).map(ref=>({name:ref.deref().name,id:ref.deref().id}))`);
        if (retained.length) throw Error('Closed project objects remain reachable: ' + JSON.stringify(retained));
        checks.push('30 repeated project sessions preserve undo, redo, recovery writes and the remaining tab');
        checks.push('Closed projects and their 180 layers are garbage collected');
        if (after.usedSize - before.usedSize > 12 * 1024 * 1024) throw Error('Session heap grew beyond the fixed allowance');
        checks.push('Retained JavaScript heap stays within a fixed 12 MB allowance after warmup');
        if (win.__testErrors.length) throw Error(win.__testErrors.join('\n'));
        const report = {passed: checks.length, checks, cycles: 30, heapBefore: before, heapAfter: after};
        await fs.writeFile(path.join(root, '.test-output/session-scenarios.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(timer); win?.destroy(); app.exit(process.exitCode || 0); }
})();
