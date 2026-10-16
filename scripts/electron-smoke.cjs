const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWriteFile } = require('../src/main/fileStore.js');

const root = path.resolve(__dirname, '..');
const profile = process.env.MOLLY_TEST_PROFILE || path.join(root, 'tests', `.molly-audit-electron-${process.pid}`);
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
const drafts = new Map();
let editorWindow, lastGeneratedButton;
let newProjectRequests = 0;
ipcMain.handle('window-open-new-project', () => { newProjectRequests += 1; return true; });
let outputPath = path.join(profile, 'roundtrip.mlst');
for (const channel of ['discord-set-activity', 'discord-clear-activity', 'discord-set-enabled', 'discord-set-client-id', 'recovery-drafts-flushed']) ipcMain.handle(channel, () => true);
ipcMain.handle('settings-broadcast', (event, data) => {
    for (const window of BrowserWindow.getAllWindows()) if (window.webContents !== event.sender) window.webContents.send('settings-updated', data);
    return true;
});
ipcMain.handle('button-generated', (_event, data) => {
    lastGeneratedButton = data;
    editorWindow.webContents.send('button-generated', data);
    return true;
});
ipcMain.handle('discord-get-status', () => ({ connected: false, isReady: false }));
ipcMain.handle('window-is-maximized', () => false);
ipcMain.handle('get-app-version', () => '1.3.0');
ipcMain.handle('dialog-save', () => ({ canceled: false, filePath: outputPath }));
ipcMain.handle('file-write', async (_event, file, contents) => {
    if (path.resolve(file) !== outputPath) throw new Error('Test write escaped its fixture directory');
    return atomicWriteFile(file, contents);
});
ipcMain.handle('recovery-draft-write', (_event, draft) => { drafts.set(draft.draftId, draft); return true; });
ipcMain.handle('recovery-draft-read', (_event, id) => drafts.get(id));
ipcMain.handle('recovery-draft-delete', (_event, id) => drafts.delete(id));
ipcMain.handle('recovery-draft-list', () => [...drafts.values()]);

async function exerciseEditor() {
    const results = [];
    const expect = (value, name) => { if (!value) throw new Error(name); results.push(name); };
    const editor = window.mollyEditor;
    expect(!!editor && !!editor.workspace.canvas, 'editor boot');
    expect(document.querySelector('[data-tool="brush"]').getAttribute('aria-pressed') === 'true', 'initial tool exposes its selected state');
    await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const wait = () => {
            if (editor.tools.tools.text.fontImages.minecraft) resolve();
            else if (Date.now() > deadline) reject(new Error('Bitmap font load timeout'));
            else setTimeout(wait, 20);
        };
        wait();
    });
    editor.settingsManager.set('confirmClose', false);
    editor.tools.setTool('pencil');
    expect(document.querySelector('[data-tool="pencil"]').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-tool="brush"]').getAttribute('aria-pressed') === 'false', 'tool selection updates its accessible state');
    const pencil = editor.tools.tools.pencil;
    const initialLayerCount = editor.layerManager.getLayers().length;
    editor.tools.onPointerDown(2, 2, {});
    editor.tools.onPointerMove(3, 2, {});
    editor.tools.onPointerMove(3, 3, {});
    editor.tools.onPointerUp(3, 3, {});
    const layer = editor.layerManager.getActiveLayer();
    const alpha = (target, x, y) => target.ctx.getImageData(x, y, 1, 1).data[3];
    expect(alpha(layer, 2, 2) > 0 && alpha(layer, 3, 2) === 0 && alpha(layer, 3, 3) > 0, 'pixel-perfect stroke preserves the diagonal');
    editor.history.undo(); editor.renderer.render();
    expect(editor.layerManager.getLayers().length === initialLayerCount && editor.renderer.ctx.getImageData(2, 2, 1, 1).data[3] === 0, 'stroke undo removes its automatically created layer');
    editor.history.redo(); expect(editor.layerManager.getLayers().includes(layer) && alpha(layer, 3, 3) > 0, 'stroke redo');
    const move = editor.tools.tools.move;
    editor.tools.setTool('move'); move.rotateFixed(90);
    const rotated = layer.ctx.getImageData(0, 0, layer.width, layer.height).data.slice();
    move.nudge(1, 0); editor.history.undo();
    expect(layer.ctx.getImageData(0, 0, layer.width, layer.height).data.every((value, index) => value === rotated[index]), 'rotation then move undo keeps the rotated pixels');
    editor.resizeCanvas(64, 48, 'left', 'top');
    expect(layer.width === 64 && editor.config.height === 48, 'canvas resize');
    editor.history.undo(); expect(layer.width === 32 && editor.config.height === 32, 'canvas resize undo');
    editor.history.redo(); expect(layer.width === 64 && editor.config.width === 64, 'canvas resize redo');
    editor.history.undo();
    const rectangle = editor.tools.tools['rect-empty'];
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
    rectangle.drawRect(canvas.getContext('2d'), 1, 1, 21, 21, '#123456', 1, false, 4);
    expect(canvas.getContext('2d').getImageData(10, 10, 1, 1).data[3] === 0 && canvas.getContext('2d').getImageData(10, 1, 1, 1).data[3] > 0, 'rounded rectangle has a transparent center');
    editor.layerManager.selectedLayerIds = new Set([layer.id]);
    const grouped = editor.layerManager.groupSelectedLayers('Test group');
    expect(layer.groupId === grouped.group.id, 'group creation');
    editor.layerPanel.duplicateLayer(grouped.group);
    const duplicate = editor.layerManager.getActiveLayer();
    expect(duplicate.isGroup && editor.layerManager.getGroupLayers(duplicate.id).length === 1, 'group duplicates its content');
    editor.history.undo(); expect(!editor.layerManager.layers.includes(duplicate), 'group duplication undo');
    editor.layerManager.setActive(layer.id);
    const marquee = editor.tools.tools.marquee;
    marquee.selection = { x: 0, y: 0, width: 8, height: 8 };
    marquee.liftSelectionToFloating(layer);
    marquee.selection.x = 2;
    const firstId = editor.activeProjectId;
    editor.addProject('Second test tab', 'none', 16, 16, false, 'canvas');
    expect(!marquee.hasFloating() && marquee.selection === null && editor.layerManager.layers.length === 0, 'tab boundary commits and clears floating pixels');
    editor.switchProject(firstId);
    expect(editor.layerManager.layers.includes(layer) && editor.config.width === 32, 'tab state restoration');
    const text = editor.layerManager.addTextLayer('Test text', { text: 'Test', fontId: 'minecraft', color: '#FF0000', x: 1, y: 1 });
    editor.tools.tools.text.renderTextLayer(text);
    expect(text.ctx.getImageData(0, 0, 32, 32).data.some((value, index) => index % 4 === 3 && value > 0), 'bitmap text rendering');
    editor.tools.setTool('text');
    const oldColor = text.textData.color;
    editor.bus.emit('COLOR_CHANGED', '#00FF00');
    expect(text.textData.color === '#00FF00', 'text recolor');
    editor.history.undo(); expect(text.textData.color === oldColor, 'text recolor undo');
    await editor.projectManager.saveProjectAs();
    expect(!editor.projectManager.hasUnsavedChanges(firstId), 'manual save marks the file revision');
    const saved = editor.projectManager.serializeProject(firstId);
    const count = editor.projects.length;
    const corrupt = structuredClone(saved); corrupt.layers[0].dataUrl = 'data:image/png;base64,AA==';
    let rejected = false;
    try { await editor.projectManager.deserializeProject(corrupt); } catch (_) { rejected = true; }
    expect(rejected && editor.projects.length === count && editor.activeProjectId === firstId, 'bad import leaves the current document intact');
    const opened = await editor.projectManager.deserializeProject(saved);
    expect(opened.id !== firstId && editor.layerManager.layers.length === saved.layers.length, 'saved document reopens');
    expect(editor.layerManager.layers.some(item => item.type === 'text' && item.textData.text === 'Test'), 'editable text survives roundtrip');
    const { preparePngExport } = await import(new URL('./js/graphics/ExportImage.js', location.href).href);
    const transparent = document.createElement('canvas'); transparent.width = transparent.height = 8;
    transparent.getContext('2d').fillRect(2, 3, 2, 3);
    const png = await preparePngExport(transparent.toDataURL(), { trim: true, scale: 4 });
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = png; });
    expect(image.naturalWidth === 8 && image.naturalHeight === 12, 'PNG export trims alpha bounds before pixel scaling');
    const colorPicker = editor.colorPicker;
    const saturation = colorPicker.sat;
    colorPicker.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(colorPicker.sat === Math.max(0, saturation - 1) && colorPicker.canvas.hasAttribute('aria-valuetext'), 'color picker keyboard adjustment');
    const menu = document.querySelector('.menu-btn');
    menu.focus(); menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement.getAttribute('role') === 'menuitem', 'menu keyboard entry');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement === menu && menu.getAttribute('aria-expanded') === 'false', 'menu keyboard exit restores focus');
    const header = document.querySelector('.section-header.collapsable, .md-panel-header.collapsable, .ps-panel-header.collapsable');
    const expanded = header.getAttribute('aria-expanded');
    header.focus(); header.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(header.getAttribute('aria-expanded') !== expanded, 'sidebar panel keyboard toggle');
    expect(!document.querySelector('.material-control, .material-source') && !window.MaterialUI, 'editor keeps native 1.2.5 controls');
    editor.layerPanel.openLayerContextMenu({ clientX: 300, clientY: 150 }, editor.layerManager.getActiveLayer());
    const layerMenu = document.getElementById('layer-context-menu');
    expect(getComputedStyle(layerMenu).display === 'flex', 'restored layer context menu opens');
    for (const control of layerMenu.querySelectorAll('select, input')) {
        control.focus();
        const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        control.dispatchEvent(key);
        expect(!key.defaultPrevented && document.activeElement === control, `layer menu preserves native ${control.tagName} keyboard adjustment`);
    }
    editor.layerPanel.closeLayerContextMenu();
    expect(getComputedStyle(layerMenu).display === 'none', 'restored layer context menu closes');
    const { confirmDialog } = await import(new URL('./js/ui/ConfirmDialog.js', location.href).href);
    const confirmation = confirmDialog({ title: 'Rollback fixture', message: 'Cancel without changing a project' });
    const cancel = document.querySelector('.m3-confirm-dialog .modal-footer button');
    expect(!!cancel && document.activeElement === cancel, 'restored confirmation opens with cancel focused');
    cancel.click();
    expect(await confirmation === false && !document.querySelector('.m3-confirm-dialog'), 'restored confirmation cancels cleanly');
    editor.settingsManager.set('animationsEnabled', false);
    editor.tools.setTool('move');
    const resampling = document.getElementById('move-resample-mode');
    const selectStyle = getComputedStyle(resampling);
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = selectStyle.font;
    expect(parseFloat(selectStyle.paddingRight) >= 32 && resampling.clientWidth >= measure.measureText(resampling.selectedOptions[0].textContent).width + 42, 'toolbar select reserves room for its arrow and full label');
    editor.tools.setTool('text');
    document.getElementById('textSegColorGradient').click();
    const textSwatch = document.querySelector('#textGradientStopsList input[type="color"]');
    expect(!!textSwatch && getComputedStyle(textSwatch).opacity === '1' && textSwatch.value !== '', 'text gradient swatches expose their selected colors');
    const angles = [...document.querySelectorAll('#textGradAngleChipsRow > button')];
    expect(angles.length === 6 && document.getElementById('textGradAngleChipsRow').tagName === 'DIV', 'text gradient angle presets are six native buttons in a group');
    angles[0].click();
    expect(angles[0].getAttribute('aria-pressed') === 'true', 'text gradient angle selection synchronizes its accessible state');
    editor.buttonGeneratorModal.open();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const modal = document.querySelector('.btn-gen-modal');
    const footer = modal.querySelector('.buttons-sidebar-footer');
    expect(footer.getBoundingClientRect().bottom <= modal.getBoundingClientRect().bottom && footer.getBoundingClientRect().height > 0, 'embedded generator keeps its import action inside the dialog');
    const inner = document.getElementById('modalSegSlotInner');
    inner.click();
    expect(inner.tagName === 'BUTTON' && inner.getAttribute('aria-pressed') === 'true', 'embedded generator segments keep native button semantics');
    document.getElementById('modalSegColorGradient').click();
    const modalSwatch = modal.querySelector('[data-gradient-role="color"]');
    expect(!!modalSwatch && getComputedStyle(modalSwatch).opacity === '1', 'embedded generator gradient swatches expose their selected colors');
    editor.buttonGeneratorModal.close();
    return results;
}

function inspectSharedControls() {
    const styles = [...document.querySelectorAll('link[rel="stylesheet"]')];
    if (styles.filter(link => link.getAttribute('href') === 'css/application-ui.css').length !== 1) throw new Error('Shared component stylesheet missing or duplicated');
    for (const select of document.querySelectorAll('select:not([multiple])')) {
        const style = getComputedStyle(select);
        if (parseFloat(style.paddingRight) < 32 || style.appearance !== 'none') throw new Error(`Select arrow gutter missing: ${select.id}`);
    }
    for (const input of document.querySelectorAll('.md-switch input, .m3-switch input')) {
        if (getComputedStyle(input).display === 'none') throw new Error(`Switch cannot receive keyboard focus: ${input.id}`);
        const track = input.nextElementSibling;
        const style = getComputedStyle(track);
        if (parseFloat(style.width) !== 48 || parseFloat(style.height) !== 28) throw new Error(`Inconsistent switch geometry: ${input.id}`);
    }
    return true;
}

app.whenReady().then(async () => {
    const errors = [];
    let window, secondary;
    let exitCode = 1;
    const timeout = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 45000);
    try {
        await fs.mkdir(profile, { recursive: true });
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, done) => done({ cancel: true }));
        window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
            preload: path.join(root, 'src/preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true
        } });
        editorWindow = window;
        window.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !/ERR_BLOCKED_BY_CLIENT/.test(message)) errors.push(message); });
        await window.loadFile(path.join(root, 'www/editor.html'), { query: { new: 'true', type: 'canvas', width: '32', height: '32', name: 'Isolated audit test' } });
        const results = await window.webContents.executeJavaScript(`(${exerciseEditor.toString()})()`);
        await window.webContents.executeJavaScript(`(${inspectSharedControls.toString()})()`);
        results.push('editor uses shared fields, switches and select arrows');
        await window.webContents.executeJavaScript("window.mollyEditor.addProject('Button fixture', 'none', 256, 256, false, 'canvas')");
        secondary = new BrowserWindow({ show: false, width: 1120, height: 760, webPreferences: {
            preload: path.join(root, 'src/preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true
        } });
        secondary.webContents.on('console-message', (_event, level, message) => { if (level === 3 && !/ERR_BLOCKED_BY_CLIENT/.test(message)) errors.push(message); });
        await secondary.loadFile(path.join(root, 'www/buttons.html'));
        const generatorReady = await secondary.webContents.executeJavaScript('!!window.buttonGenApp && window.buttonGenApp.currentChin === 0');
        if (!generatorReady) throw new Error('Standalone generator did not initialize');
        results.push('standalone generator boot');
        await secondary.webContents.executeJavaScript(`(${inspectSharedControls.toString()})()`);
        results.push('standalone generator uses shared controls');
        const standaloneSwatch = await secondary.webContents.executeJavaScript(`(() => {
            document.getElementById('segColorGradient').click();
            const input = document.querySelector('[data-gradient-role="color"]');
            const visible = !!input && getComputedStyle(input).opacity === '1';
            document.getElementById('segColorSolid').click();
            return visible;
        })()`);
        if (!standaloneSwatch) throw new Error('Standalone generator color swatch is hidden');
        results.push('standalone generator gradient swatches expose their selected colors');
        await secondary.webContents.executeJavaScript('window.buttonGenApp.importToProject()');
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const deadline = Date.now() + 5000;
            const wait = () => {
                if (window.mollyEditor.layerManager.layers.length === 1) resolve();
                else if (Date.now() > deadline) reject(new Error('Generated button was not delivered exactly once'));
                else setTimeout(wait, 20);
            }; wait();
        })`);
        const position = await window.webContents.executeJavaScript('window.mollyEditor.layerManager.getActiveLayer().sourceRect');
        if (position.x !== 7 || position.y !== 17 || position.w !== 18 || position.h !== 18) throw new Error('Generated button position does not match its preview');
        results.push('generated button placement');
        await window.webContents.executeJavaScript(`window.mollyEditor.insertGeneratedButton(${JSON.stringify(lastGeneratedButton)})`);
        if (await window.webContents.executeJavaScript('window.mollyEditor.layerManager.layers.length') !== 1) throw new Error('Duplicate generated button delivery created another layer');
        results.push('generated button delivery deduplication');
        await secondary.loadFile(path.join(root, 'www/settings.html'));
        const themes = await secondary.webContents.executeJavaScript('document.querySelectorAll(".settings-theme-card").length');
        if (themes !== 10) throw new Error(`Settings window has ${themes} theme cards`);
        results.push('settings window boot and 10 themes');
        await secondary.webContents.executeJavaScript(`(${inspectSharedControls.toString()})()`);
        results.push('settings uses shared fields and keyboard-focusable switches');
        await secondary.webContents.executeJavaScript(`document.querySelector('[data-theme="light"]').click()`);
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const deadline = Date.now() + 5000;
            const wait = () => {
                if (document.documentElement.dataset.theme === 'light') resolve();
                else if (Date.now() > deadline) reject(new Error('Theme broadcast did not update editor'));
                else setTimeout(wait, 20);
            }; wait();
        })`);
        results.push('cross-window theme synchronization');
        const nativeSettings = await secondary.webContents.executeJavaScript(`(() => {
            const accent = document.querySelector('.settings-accent-swatch:not(.auto-swatch)');
            accent.click();
            return accent.tagName === 'BUTTON' && accent.getAttribute('aria-pressed') === 'true'
                && !document.querySelector('.material-control') && !window.MaterialUI;
        })()`);
        if (!nativeSettings) throw new Error('Restored settings native accent controls failed');
        results.push('restored settings native accent selection');
        await secondary.loadFile(path.join(root, 'www/new-project.html'));
        const newProject = await secondary.webContents.executeJavaScript(`(() => {
            document.querySelector('#new-proj-tab-canvas').click();
            return document.querySelector('#new-proj-section-canvas').style.display !== 'none'
                && document.querySelector('#new-canvas-w').type === 'number';
        })()`);
        if (!newProject) throw new Error('Restored new-project canvas tab failed');
        results.push('restored new-project canvas tab');
        await secondary.webContents.executeJavaScript(`(${inspectSharedControls.toString()})()`);
        results.push('new-project uses shared select arrows');
        await secondary.loadFile(path.join(root, 'www/index.html'));
        const launcher = await secondary.webContents.executeJavaScript(`(async () => {
            document.querySelector('.create-proj-btn').click();
            await new Promise(resolve => setTimeout(resolve, 50));
            return !document.querySelector('#new-project-modal').classList.contains('show') && !window.MaterialUI;
        })()`);
        if (!launcher || newProjectRequests !== 1) throw new Error('Restored launcher did not request exactly one native new-project window');
        results.push('restored launcher requests one native new-project window');
        await secondary.webContents.executeJavaScript(`(${inspectSharedControls.toString()})()`);
        results.push('launcher uses shared select arrows');
        const saved = JSON.parse(await fs.readFile(outputPath, 'utf8'));
        if (!saved.layers.some(layer => layer.type === 'text')) throw new Error('Saved fixture is incomplete');
        if (errors.length) throw new Error(errors.join('\n'));
        console.log(JSON.stringify({ passed: results.length, scenarios: results }, null, 2));
        exitCode = 0;
    } catch (error) { console.error(error); }
    finally {
        clearTimeout(timeout);
        secondary?.destroy();
        window?.destroy();
        // All files belong to this process's isolated fixture profile.
        if (!process.env.MOLLY_TEST_PROFILE) {
            if (path.dirname(profile) !== path.join(root, 'tests') || !path.basename(profile).startsWith('.molly-audit-electron-')) throw new Error('Invalid test cleanup path');
            await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(error => console.warn('Test profile cleanup:', error.message));
        }
        app.exit(exitCode);
    }
});
