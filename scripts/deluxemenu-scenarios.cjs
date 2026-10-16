const fs = require('node:fs/promises');
const path = require('node:path');
const { app, root, profile, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

async function exercise() {
    const editor = window.mollyEditor;
    const dm = editor.deluxeMenusEditor;
    const checks = [];
    const expect = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    let project = editor.getActiveProject();
    expect(Boolean(document.getElementById('new-proj-tab-deluxemenu')) && Boolean(document.getElementById('new-deluxemenu-name')), 'The standard new-project dialog exposes the DeluxeMenus project type');
    expect(project.type === 'deluxemenu' && project.deluxeData.size === 54, 'DeluxeMenus opens as an independent project type with a default chest menu');
    expect(!dm.root.hidden && document.body.classList.contains('deluxe-project') && dm.get('grid').children.length === 54, 'DeluxeMenus view replaces the raster workspace and renders all inventory slots');
    expect(getComputedStyle(document.querySelector('.options-bar')).display === 'none', 'Canvas tool options are fully hidden in a DeluxeMenus project');
    expect(dm.get('materials').querySelectorAll('[data-dm-material]').length > 0, 'Minecraft inventory material library is populated');
    const canvasTool = editor.tools.currentToolId;
    editor.tools.setTool('brush');
    expect(editor.tools.currentToolId === canvasTool && canvasTool === 'hand', 'Raster tools cannot alter a DeluxeMenus project');
    dm.root.querySelector('[data-dm-slot="0"]').focus();
    dm.root.querySelector('[data-dm-slot="0"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(dm.activeSlot === 1 && document.activeElement.dataset.dmSlot === '1' && dm.get('grid').querySelectorAll('.dm-slot[tabindex="0"]').length === 1, 'Slot grid supports arrow navigation with a single tab stop');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(dm.activeSlot === 0, 'Home returns keyboard focus to the first menu slot');
    const search = dm.get('search'); search.value = 'stone'; search.dispatchEvent(new Event('input', { bubbles: true }));
    const stone = dm.get('materials').querySelector('[data-dm-material="STONE"]');
    expect(Boolean(stone), 'Material search finds the requested Minecraft material');
    stone.click();
    const itemId = dm.itemId;
    expect(itemId && project.deluxeData.items[itemId].material === 'STONE' && project.deluxeData.items[itemId].slot === 0, 'Selecting a material creates an undoable item in the selected slot');
    const displayName = dm.control('item', 'display_name');
    displayName.value = '&aSpawn'; displayName.dispatchEvent(new Event('input', { bubbles: true })); displayName.dispatchEvent(new Event('change', { bubbles: true }));
    expect(project.deluxeData.items[itemId].display_name === '&aSpawn', 'Item property edits are committed to the menu definition');
    const slots = dm.control('item', 'slots');
    slots.value = '0, 1, 2-3'; slots.dispatchEvent(new Event('input', { bubbles: true })); slots.dispatchEvent(new Event('change', { bubbles: true }));
    expect(JSON.stringify(project.deluxeData.items[itemId].slots) === JSON.stringify([0,1,2,3]) && dm.get('grid').children[3].querySelector('img'), 'Slot lists and ranges update the live inventory preview');
    expect(editor.history.undo() && !project.deluxeData.items[itemId].slots, 'Undo restores the earlier single-slot definition');
    expect(editor.history.redo() && project.deluxeData.items[itemId].slots.length === 4, 'Redo restores the edited slot range');
    const yaml = dm.project().deluxeData && (await import('../www/js/core/DeluxeMenuDocument.mjs')).exportDeluxeYaml(dm.project().deluxeData);
    const parsed = (await import('../www/js/core/DeluxeMenuDocument.mjs')).importDeluxeYaml(yaml);
    expect(parsed.items[itemId].display_name === '&aSpawn' && parsed.items[itemId].slots[3] === 3, 'YAML export and import preserve edited menu data');
    expect(await editor.exportPNG(), 'The editor export command routes DeluxeMenus projects to YAML export');

    const serialized = editor.projectManager.serializeProject(project.id);
    expect(serialized.type === 'deluxemenu' && serialized.deluxeData.items[itemId].slots.length === 4, 'MLST serialization includes the complete DeluxeMenus configuration');
    expect(await editor.projectManager.saveProjectAs(), 'DeluxeMenus saves through the native .mlst project flow');
    const savedFile = JSON.parse(await window.electronAPI.readFile(project.filePath));
    expect(savedFile.type === 'deluxemenu' && savedFile.deluxeData.items[itemId].display_name === '&aSpawn', 'Saved MLST file retains the menu type and item properties');
    await editor.projectManager.deserializeProject(savedFile, project.filePath);
    project = editor.getActiveProject();
    expect(project.type === 'deluxemenu' && project.deluxeData.items[itemId].slots.length === 4, 'Opening an MLST file recreates the editable DeluxeMenus project');
    const reopened = project;
    editor.addProject('Canvas test tab', 'none', 16, 16, false, 'canvas');
    const activeCanvas = editor.getActiveProject();
    editor.switchProject(reopened.id);
    project = reopened;
    expect(editor.getActiveProject() === project && !dm.root.hidden && project.deluxeData.items[itemId].slots.length === 4, 'Switching tabs restores the menu editor and its configuration');
    editor.switchProject(activeCanvas.id);
    expect(dm.root.hidden && !document.body.classList.contains('deluxe-project'), 'Switching away restores the standard canvas interface');
    await editor.projectManager.flushAutosaves();
    expect(editor.projectManager.serializeProject(project.id).deluxeData.items[itemId].display_name === '&aSpawn', 'Autosave retains the latest DeluxeMenus properties');
    return { checks, projectId: project.id };
}

(async () => {
    let win;
    const watchdog = setTimeout(() => app.exit(1), 90000);
    try {
        await ready();
        win = makeWindow();
        await win.loadFile(path.join(root, 'www/editor.html'), { query: { new: 'true', type: 'deluxemenu', name: 'Deluxe QA' } });
        const result = await win.webContents.executeJavaScript(`(${exercise.toString()})()`);
        const checks = result.checks;
        const exportedYaml = await fs.readFile(path.join(profile, 'Deluxe QA.yml'), 'utf8');
        if (!exportedYaml.includes("menu_title: '&8Главное меню'") || !exportedYaml.includes("display_name: '&aSpawn'")) throw new Error('Native YAML export did not preserve the DeluxeMenus configuration.');
        checks.push('The native .yml export file contains the menu title and item properties');
        await fs.writeFile(path.join(root, '.test-output/deluxemenu-export.yml'), exportedYaml);
        await win.webContents.executeJavaScript(`window.mollyEditor.switchProject(${JSON.stringify(result.projectId)})`);
        await settle(win);
        if (win.__testErrors.length) throw new Error(win.__testErrors.join('\n'));
        await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
        await fs.writeFile(path.join(root, '.test-output/deluxemenu.png'), (await win.webContents.capturePage()).toPNG());
        win.setSize(820, 720);
        await settle(win);
        const responsive = await win.webContents.executeJavaScript(`(() => {
            const layout = document.querySelector('.dm-layout');
            const grid = document.getElementById('dm-grid').getBoundingClientRect();
            const center = document.querySelector('.dm-center').getBoundingClientRect();
            return layout.scrollWidth <= layout.clientWidth + 1 && grid.width >= 9 * 20
                && grid.left >= center.left && grid.right <= center.right;
        })()`);
        if (!responsive) throw new Error('DeluxeMenus panels did not reflow for a narrow window.');
        checks.push('A narrow menu window keeps all nine inventory columns readable without horizontal overflow');
        await fs.writeFile(path.join(root, '.test-output/deluxemenu-narrow.png'), (await win.webContents.capturePage()).toPNG());
        await fs.writeFile(path.join(root, '.test-output/deluxemenu.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
        console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(watchdog); win?.destroy(); app.exit(process.exitCode || 0); }
})();
