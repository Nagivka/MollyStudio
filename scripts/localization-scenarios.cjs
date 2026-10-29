const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');
const {collectUntranslated} = require('./lib/locale-audit.cjs');

(async () => {
    const windows = [], checks = [];
    const timer = setTimeout(() => app.exit(1), 90000);
    try {
        await ready();
        const editor = makeWindow(); windows.push(editor);
        await editor.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: 'canvas', width: '32', height: '32', name: 'Сохранить'}});
        checks.push(...await editor.webContents.executeJavaScript(`(async () => {
            const checks = [], expect = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
            const app = window.mollyEditor;
            const before = JSON.stringify(app.projectManager.serializeProject());
            const input = document.createElement('input'); input.value = 'Текст'; document.body.append(input); input.focus(); input.setSelectionRange(1, 2);
            app.settingsManager.set('language', 'en');
            await new Promise(resolve => setTimeout(resolve, 80));
            expect(document.documentElement.lang === 'en', 'English language is applied');
            expect(document.body.innerText.includes('Properties'), 'Static editor labels are translated');
            expect(document.activeElement === input && input.selectionStart === 1 && input.value === 'Текст', 'Language change preserves typing and focus');
            expect(before === JSON.stringify(app.projectManager.serializeProject()), 'Language change never modifies project data');
            const owned = document.createElement('div'); owned.innerHTML = '<!--i18n-->Сохранить'; document.body.append(owned);
            const user = document.createElement('div'); user.textContent = 'Сохранить'; document.body.append(user);
            await new Promise(resolve => setTimeout(resolve, 30));
            expect(owned.textContent === 'Save' && user.textContent === 'Сохранить', 'Only marked labels are translated in dynamic content');
            app.settingsManager.set('language', 'ru');
            expect(owned.textContent === 'Сохранить', 'Dynamic labels restore Russian');
            app.settingsManager.set('language', 'en');
            input.remove(); owned.remove(); user.remove();
            return checks;
        })()`));
        const settings = makeWindow(1000, 760, {label: 'settings'}); windows.push(settings);
        await settings.loadFile(path.join(root, 'src/renderer/settings.html'));
        await settle(settings);
        checks.push(...await settings.webContents.executeJavaScript(`(async () => {
            const checks = [], expect = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
            const select = document.getElementById('setting-language-select');
            expect(select?.value === 'en' && document.documentElement.lang === 'en', 'New windows restore the persisted language');
            expect(document.body.innerText.includes('Interface language') && document.body.innerText.includes('Appearance'), 'Settings labels and sidebar translate');
            select.value = 'ru'; select.dispatchEvent(new Event('change', {bubbles: true}));
            return checks;
        })()`));
        await settle(editor);
        if (!await editor.webContents.executeJavaScript(`document.documentElement.lang === 'ru'`)) throw Error('Cross-window language sync failed');
        checks.push('Language changes synchronize to already open windows');
        const untranslated = {};
        await editor.webContents.executeJavaScript(`window.mollyEditor.settingsManager.set('language','en')`);
        for (const tab of ['appearance', 'effects', 'canvas', 'tools', 'export', 'backup', 'hotkeys', 'about']) {
            await settings.webContents.executeJavaScript(`document.querySelector('[data-tab="${tab}"]').click()`);
            await settle(settings);
            untranslated['settings-' + tab] = await settings.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
        }
        for (const [name, file, query] of [
            ['canvas', 'editor.html', {new: 'true', type: 'canvas', width: '64', height: '64', name: 'QA'}],
            ['prefix', 'editor.html', {new: 'true', type: 'prefix', name: 'QA'}],
            ['launcher', 'index.html', {}], ['create', 'new-project.html', {}], ['buttons', 'buttons.html', {}]
        ]) {
            await editor.loadFile(path.join(root, 'src/renderer', file), {query});
            await settle(editor);
            untranslated[name] = await editor.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
            if(name==='canvas') {
                await editor.webContents.executeJavaScript(`(() => {
                    const app=window.mollyEditor,layer=app.layerManager.addLayer('Fixture');
                    layer.ctx.fillRect(1,1,10,10);layer.invalidateSource();
                })()`);
                for(const panel of ['exportPanel','texturePanel','historyPanel']) {
                    await editor.webContents.executeJavaScript(`window.mollyEditor.${panel}.open()`);
                    await settle(editor);
                    untranslated[panel]=await editor.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
                    await editor.webContents.executeJavaScript(`window.mollyEditor.${panel}.dialog.close()`);
                }
                await editor.webContents.executeJavaScript(`(async()=>{const {default:Utilities}=await import(new URL('./js/ui/UtilitiesPanel.js',location.href));window.languageUtilities=new Utilities();languageUtilities.open('gradient');})()`);
                await settle(editor);
                untranslated.utilities=await editor.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
                await editor.webContents.executeJavaScript(`languageUtilities.dialog.close()`);
            }
            if(name==='prefix') {
                await editor.webContents.executeJavaScript(`window.mollyEditor.designGallery.open()`);
                await settle(editor);
                untranslated.designs=await editor.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
                await editor.webContents.executeJavaScript(`window.mollyEditor.designGallery.dialog.close()`);
            }
        }
        await fs.writeFile(path.join(root, '.test-output/localization-coverage.json'), JSON.stringify(untranslated, null, 2));
        const missing=Object.entries(untranslated).filter(([,values])=>values.length);
        if(missing.length)throw Error('Untranslated interface text: '+JSON.stringify(missing));
        checks.push('English labels cover all main pages, settings sections and generated utility/export/design dialogs');
        for (const win of windows) if (win.__testErrors.length) throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root, '.test-output/localization-scenarios.json'), JSON.stringify({passed: checks.length, checks}, null, 2));
        console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { clearTimeout(timer); windows.forEach(win => win.destroy()); app.exit(process.exitCode || 0); }
})();
