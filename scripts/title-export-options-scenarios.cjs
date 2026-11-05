const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');

(async () => {
    let win;
    const watchdog = setTimeout(() => app.exit(1), 120000);
    try {
        await ready();win = makeWindow(1280, 900);
        await win.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'title'}});
        const result = await win.page.evaluate(async () => {
            const editor = mollyEditor, title = editor.titleEditor, project = editor.getActiveProject();
            await project.prefixLoadPromise;
            const removed = title.panel.querySelector('[data-title-field="meshMode"],[data-title-scale],[data-title-field="outline"],[data-title-model-export],[data-title-field="resolution"],[data-title-field="output"],[data-title-field="padding"]');
            if (removed) throw Error('A removed inspector control remains');
            // Older documents retain their rendering parameters after the UI cleanup.
            title.change(data => {data.resolution = 1024;data.output = 'auto';data.padding = 16;data.scale = [1.2, 1, 1];data.meshMode = 'solid';data.outline = 0;});
            const before = JSON.stringify(project.titleData), panel = editor.exportPanel;
            if (!await panel.open()) throw Error('Title export did not open');
            if (panel.get('title-fields').hidden || panel.get('titlePadding').value !== '16') throw Error('Legacy export options did not load');
            panel.get('titleResolution').value = '2048';panel.get('titleOutput').value = 'square';panel.get('titlePadding').value = '32';
            await panel.preview();
            const options = panel.read(), image = panel.source(panel.entries(options)[0], options);
            const dimensions = [image.width, image.height];image.width = image.height = 1;
            if (dimensions[0] !== 2048 || dimensions[1] !== 2048 || panel.get('save').disabled) throw Error('Export controls did not produce a 2048px square');
            panel.get('titlePadding').value = '-1';await panel.preview();
            if (!panel.get('save').disabled || panel.get('error').hidden) throw Error('Invalid padding was accepted');
            panel.close();
            if (JSON.stringify(project.titleData) !== before) throw Error('Export options modified the editable title');
            await panel.open();
            if (panel.get('titleResolution').value !== '2048' || panel.get('titlePadding').value !== '32' || panel.get('titleOutput').value !== 'square') throw Error('Valid export options were not remembered');
            panel.get('titleResolution').value='1537';panel.get('titleHeight').value='863';panel.get('titleOutput').value='custom';
            await panel.preview();
            if(panel.get('dimensions').textContent!=='1537 × 863 px'||panel.get('canvas').width>640)throw Error('Custom dimensions or bounded preview failed');
            const custom=panel.source(panel.entries(panel.read())[0],panel.read());
            if(custom.width!==1537||custom.height!==863)throw Error('Custom export dimensions were rounded or stretched');custom.width=custom.height=1;
            const saved=await panel.run();
            if(saved?.manifest.images[0].width!==1537||saved.manifest.images[0].height!==863)throw Error('Native PNG save ignored custom size');
            panel.get('titleResolution').value='16384';panel.get('titleHeight').value='16384';await panel.preview();
            if(!panel.get('save').disabled)throw Error('Oversized custom output was allowed');
            panel.get('titleResolution').value='';await panel.preview();if(!panel.get('save').disabled)throw Error('Empty custom width was allowed');
            panel.get('titleResolution').value='1537';panel.get('titleHeight').value='863';await panel.preview();
            panel.close();
            await panel.open();if(panel.get('titleOutput').value!=='custom'||panel.get('titleHeight').value!=='863')throw Error('Custom output settings were lost');panel.close();
            editor.settingsManager.set('confirmClose', false);
            editor.addProject('Canvas after title export', 'none', 32, 32, false, 'canvas');
            if (!await panel.open() || !panel.get('title-fields').hidden) throw Error('Title controls leaked into the canvas exporter');
            panel.get('format').value = 'sheet';await panel.preview();
            if (panel.get('save').disabled) throw Error('Hidden title fields blocked canvas export');
            panel.close();
            editor.switchProject(project.id);await project.prefixLoadPromise;
            await panel.open();
            return {removedControls: true, legacySettingsPreserved: true, dimensions, customDimensions:[1537,863], invalidPaddingRejected: true, canvasExportUnaffected: true};
        });
        win.setContentSize(1000,700);
        for(const theme of ['dark','light','minecraft','light-minecraft']){
            await win.page.evaluate(theme=>mollyEditor.settingsManager.set('theme',theme),theme);await settle(win);
            await win.page.evaluate(()=>{
                const panel=mollyEditor.exportPanel,dialog=panel.dialog,rect=dialog.getBoundingClientRect();
                if(rect.left<0||rect.top<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1)throw Error('Custom export dialog exceeds the minimum title window');
                if(dialog.scrollWidth>dialog.clientWidth+1||document.documentElement.scrollWidth>innerWidth)throw Error('Custom export fields introduce horizontal overflow');
                const width=panel.get('titleResolution').getBoundingClientRect(),height=panel.get('titleHeight').getBoundingClientRect();
                if(!width.width||!height.width||width.right>rect.right||height.right>rect.right)throw Error('Custom resolution inputs are clipped');
            });
        }
        result.minimumWindowThemes=4;
        assert.deepEqual(win.__testErrors, []);
        await fs.writeFile(path.join(root, '.test-output', 'title-export-options.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
    } catch (error) {console.error(error);process.exitCode = 1;}
    finally {clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode || 0);}
})();
