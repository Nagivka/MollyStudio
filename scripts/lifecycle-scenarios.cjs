const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, profile, ready, makeWindow, evaluateMain} = require('./lib/electron-harness.cjs');

(async () => {
    const checks = [], expect = (value, message) => { if (!value) throw Error(message); checks.push(message); };
    const watchdog = setTimeout(() => { console.error('Lifecycle scenarios timed out'); app.exit(1); }, 90000);
    let win, buttons;
    try {
        await ready(); win = makeWindow();
        await win.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'canvas', width: '32', height: '32', name: 'Lifecycle fixture'}});
        buttons = makeWindow(1120, 760, {label: 'buttons'});
        await buttons.loadFile(path.join(root, 'src/renderer/buttons.html'));
        const payload = await win.webContents.executeJavaScript(`(() => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#12AB34'; ctx.fillRect(0, 0, 4, 4);
            return {w: 4, h: 4, mode: 'normal', normalDataUrl: canvas.toDataURL(), importId: 'native-transfer-fixture'};
        })()`);
        expect(await buttons.webContents.executeJavaScript(`window.desktopAPI.notifyButtonGenerated(${JSON.stringify(payload)})`), 'A real generator receives success only after the editor commits its image');
        expect(await win.webContents.executeJavaScript(`window.mollyEditor.layerManager.getActiveLayer().sourceCanvas?.width === 4`), 'The acknowledged button retains its original four-pixel master');
        await win.webContents.executeJavaScript(`window.mollyEditor.addProject('Wrong target', 'none', 32, 32, false, 'prefix')`);
        expect(await buttons.webContents.executeJavaScript(`window.desktopAPI.notifyButtonGenerated(${JSON.stringify({...payload, importId: 'rejected-transfer'})}).then(() => false, () => true)`), 'A prefix document rejects bitmap delivery and the generator receives the failure');

        await win.webContents.executeJavaScript(`(() => {
            const editor = window.mollyEditor;
            editor.addProject('Close recovery fixture', 'none', 32, 32, false, 'canvas');
            editor.settingsManager.set('confirmClose', true);
            window.closeJob = editor.documentTasks.run(async () => {
                await new Promise(resolve => { window.releaseCloseJob = resolve; });
                const layer = editor.layerManager.addLayer('Accepted before close');
                layer.ctx.fillStyle = '#BADA55'; layer.ctx.fillRect(2, 3, 4, 5); layer.invalidateSource();
                editor.bus.emit('CANVAS_UPDATED');
            });
        })()`);
        await win.page.waitForFunction(() => typeof window.releaseCloseJob === 'function');
        // Replace only this private process's native confirmation; no desktop
        // clicks, registry changes or real user projects are involved.
        await evaluateMain(() => {
            const runtime = globalThis.__mollyTestRuntime;
            runtime.confirmations = 0; runtime.confirmResponse = 0;
            runtime.windows.electron.dialog.showMessageBox = async () => { runtime.confirmations++; return {response: runtime.confirmResponse}; };
            runtime.windows.get('main').close();
        });
        await win.page.waitForFunction(() => window.mollyEditor.documentTasks.closing && document.body.inert);
        expect(await evaluateMain(() => globalThis.__mollyTestRuntime.confirmations === 0), 'Closing waits for accepted document work before asking for confirmation');
        expect(await win.webContents.executeJavaScript(`window.mollyEditor.documentTasks.run(() => true).then(() => false, () => true)`), 'New document jobs are rejected while a close attempt is pending');
        await win.webContents.executeJavaScript('window.releaseCloseJob()');
        await win.page.waitForFunction(() => !window.mollyEditor.documentTasks.closing && !document.body.inert);
        expect(await evaluateMain(() => globalThis.__mollyTestRuntime.confirmations === 1), 'Cancelling native confirmation restores an interactive editor');
        const drafts = await win.webContents.executeJavaScript(`(async () => {
            const list = await window.desktopAPI.listRecoveryDrafts();
            return Promise.all(list.map(item => window.desktopAPI.readRecoveryDraft(item.draftId)));
        })()`);
        expect(drafts.some(draft => draft.project.layers.some(layer => layer.name === 'Accepted before close')), 'The completed import is included in durable recovery before confirmation');

        await win.webContents.executeJavaScript(`window.stopFailedFlush = window.desktopAPI.onFlushRecoveryDrafts(() => false)`);
        await evaluateMain(() => globalThis.__mollyTestRuntime.windows.get('main').close());
        await win.page.waitForFunction(() => [...document.querySelectorAll('.md-toast')].some(item => item.textContent.includes('Черновик не удалось сохранить')));
        await win.page.waitForFunction(() => !document.body.inert && !window.mollyEditor.documentTasks.closing);
        expect(await evaluateMain(() => globalThis.__mollyTestRuntime.confirmations === 1), 'A failed recovery handler keeps the window open without a misleading confirmation');
        await win.webContents.executeJavaScript('window.stopFailedFlush()');
        await evaluateMain(() => {
            const runtime = globalThis.__mollyTestRuntime;
            runtime.confirmResponse = 1;
            runtime.files.run(() => new Promise(resolve => { runtime.releaseCloseWrite = resolve; }));
            runtime.windows.get('main').close();
        });
        // Poll the actual main process; renderer inactivity alone cannot prove
        // that the native file queue was drained before destroying its window.
        for (let attempt = 0; attempt < 100; attempt++) {
            if (await evaluateMain(() => {
                const runtime = globalThis.__mollyTestRuntime, main = runtime.windows.get('main');
                return runtime.confirmations === 2 && main && runtime.windows.closing.get(main.id)?.phase === 'closing';
            })) break;
            if (attempt === 99) throw Error('Native close did not reach the file queue barrier');
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        expect(!win.page.isClosed(), 'An approved close still waits for accepted native file operations');
        const closed = win.page.waitForEvent('close');
        await evaluateMain(() => setTimeout(() => globalThis.__mollyTestRuntime.releaseCloseWrite(), 50));
        await closed;
        expect(true, 'After confirmation and queue completion the actual Electron window closes');
        const names = await fs.readdir(path.join(profile, 'recovery-drafts'));
        let recovered = false;
        for (const name of names.filter(name => name.endsWith('.json'))) {
            const data = JSON.parse(await fs.readFile(path.join(profile, 'recovery-drafts', name), 'utf8'));
            recovered ||= data?.project?.layers?.some(layer => layer.name === 'Accepted before close');
        }
        expect(recovered, 'Recovery remains readable on disk after the application exits');
        if (win.__testErrors.length || buttons.__testErrors.length) throw Error([...win.__testErrors, ...buttons.__testErrors].join('\n'));
        await fs.writeFile(path.join(root, '.test-output/lifecycle-scenarios.json'), JSON.stringify({passed: checks.length, checks}, null, 2));
        console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(watchdog); app.exit(process.exitCode || 0); }
})();
