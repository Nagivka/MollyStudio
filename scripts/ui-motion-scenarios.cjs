'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, root, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

(async () => {
    const windows = [], checks = [];
    const timer = setTimeout(() => app.exit(1), 60000);
    const expect = (condition, message) => { if (!condition) throw new Error(message);checks.push(message); };
    const run = (win, source) => win.webContents.executeJavaScript(source);
    const wait = async (win, source) => {
        const deadline = Date.now() + 5000;
        while (!await run(win, source)) { if (Date.now() > deadline) throw new Error('Timed out: ' + source);await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    try {
        await ready();
        const settings = makeWindow(960, 760);windows.push(settings);
        await settings.loadFile(path.join(root, 'src/renderer/settings.html'), { query: { tab: 'about' } });await settle(settings);
        settings.webContents.debugger.attach('1.3');
        await settings.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
        const reduced = value => settings.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
        await reduced('no-preference');
        await run(settings, `(async () => { const { default: SettingsManager } = await import(new URL('./js/core/SettingsManager.js', location.href).href);window.motionSettings = new SettingsManager();motionSettings.set('animationsEnabled', true); })()`);
        expect(await run(settings, `!document.querySelector('details, summary') && document.querySelector('.about-technical .ui-disclosure-icon').textContent === 'memory' && document.querySelector('.about-technical .ui-disclosure-indicator').textContent === 'expand_more'`), 'Technical information uses named Material icons instead of a native disclosure marker');
        await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').click()`);
        expect(await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').getAttribute('aria-expanded') === 'true' && document.querySelector('.about-technical .ui-disclosure-body').getAnimations().some(animation => animation.effect.getTiming().duration === 300)`), 'Opening starts a real 300 ms height animation and synchronizes accessible state');
        await wait(settings, `document.querySelector('.about-technical .ui-disclosure-body').getAnimations().length === 0`);
        expect(await run(settings, `!document.querySelector('.about-technical .ui-disclosure-body').hidden && !document.querySelector('.about-technical .ui-disclosure-body').inert && !document.querySelector('.about-technical .ui-disclosure-body').style.overflow`), 'Finished expansion exposes the content without a fixed height or clipping');
        await run(settings, `const trigger = document.querySelector('.about-technical .ui-disclosure-trigger');trigger.click();trigger.click();trigger.click();`);
        await wait(settings, `document.querySelector('.about-technical .ui-disclosure-body').hidden`);
        expect(await run(settings, `document.querySelector('.about-technical .ui-disclosure-body').inert && document.querySelector('.about-technical .ui-disclosure-trigger').getAttribute('aria-expanded') === 'false'`), 'Rapid toggles finish in the requested state and collapsed controls leave keyboard navigation');
        await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').focus()`);
        await settings.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
        await settings.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await wait(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').getAttribute('aria-expanded') === 'true'`);
        expect(true, 'Disclosure opens with the native Enter key');
        await run(settings, `motionSettings.set('animationsEnabled', false)`);
        await wait(settings, `document.querySelector('.about-technical .ui-disclosure-body').getAnimations().length === 0`);
        await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').click()`);
        expect(await run(settings, `document.querySelector('.about-technical .ui-disclosure-body').hidden && !document.querySelector('.about-technical .ui-disclosure-body').style.overflow`), 'Turning animation off settles an in-flight transition and later toggles are immediate');
        await run(settings, `motionSettings.set('animationsEnabled', true)`);await reduced('reduce');
        await wait(settings, `window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
        await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').click()`);
        const reducedState = await run(settings, `(() => { const panel = document.querySelector('.about-technical .ui-disclosure-body');return { hidden: panel.hidden, animations: panel.getAnimations().map(animation => ({ state: animation.playState, duration: animation.effect.getTiming().duration })), expanded: document.querySelector('.about-technical .ui-disclosure-trigger').getAttribute('aria-expanded') }; })()`);
        const reducedInstant = !reducedState.hidden && reducedState.animations.every(animation => animation.duration <= 1);
        expect(reducedInstant, 'Operating system reduced-motion preference disables scripted expansion' + (reducedInstant ? '' : ': ' + JSON.stringify(reducedState)));
        await reduced('no-preference');
        await wait(settings, `!window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
        await run(settings, `document.querySelector('[data-tab="canvas"]').click()`);
        const frame = await run(settings, `(() => { const section = document.querySelector('.settings-section'), style = getComputedStyle(section);return { moving: section.getAnimations().some(animation => animation.animationName === 'ui-content-enter'), opacity: Number(style.opacity) }; })()`);
        expect(frame.moving && frame.opacity < 1, 'Switching a settings section renders an actual intermediate animation frame');
        await wait(settings, `getComputedStyle(document.querySelector('.settings-section')).opacity === '1' && getComputedStyle(document.querySelector('.settings-section')).transform === 'none'`);
        expect(true, 'Panel motion ends at full opacity and its normal position');
        await run(settings, `document.querySelector('[data-tab="about"]').click()`);await settle(settings);
        await run(settings, `document.querySelector('.about-technical .ui-disclosure-trigger').click()`);
        await wait(settings, `document.querySelector('.about-technical .ui-disclosure-body').getAnimations().length === 0`);
        await fs.mkdir(path.join(root, '.test-output'), { recursive: true });
        await fs.writeFile(path.join(root, '.test-output/icon-disclosures-dark.png'), (await settings.webContents.capturePage()).toPNG());
        await run(settings, `document.documentElement.dataset.theme = 'light'`);await settle(settings);
        await fs.writeFile(path.join(root, '.test-output/icon-disclosures-light.png'), (await settings.webContents.capturePage()).toPNG());
        const launcher = makeWindow();windows.push(launcher);await launcher.loadFile(path.join(root, 'src/renderer/index.html'));await settle(launcher);
        expect(await run(launcher, `Array.from(document.querySelectorAll('#new-proj-type-selector [data-type]')).map(button => button.dataset.type).sort().join(',') === 'canvas,gui,prefix'`), 'Launcher offers GUI, canvas and prefixes');
        await run(launcher, `localStorage.setItem('molly_recent', JSON.stringify([{ name: 'Unsupported', path: 'unsupported.mlst', type: 'retired-kind' }]));window.dispatchEvent(new StorageEvent('storage', { key: 'molly_recent' }));`);
        await wait(launcher, `!!document.querySelector('.m3-empty-recent')`);
        expect(await run(launcher, `!document.querySelector('.m3-recent-card') && JSON.parse(localStorage.getItem('molly_recent')).length === 1`), 'Unsupported recent entries are hidden without deleting their files or saved records');
        const prefix = makeWindow();windows.push(prefix);
        await prefix.loadFile(path.join(root, 'src/renderer/editor.html'), { query: { new: 'true', type: 'prefix', name: 'Motion QA' } });
        await wait(prefix, `window.mollyEditor?.getActiveProject()?.type === 'prefix' && !document.querySelector('#prefix-editor').hidden`);
        expect(await run(prefix, `document.querySelectorAll('#prefix-editor [role="tab"]').length===2 && !document.querySelector('#prefix-editor details, #prefix-editor summary') && document.querySelector('#prefix-section-text h3 .material-symbols-rounded').textContent==='text_fields'`), 'Prefix uses two shared inspector tabs with Material icons');
        expect(await run(prefix, `!document.querySelector('#prefix-section-presets, #prefix-section-result, #prefix-section-composition, #prefix-block-list')`), 'Removed prefix sections are absent from the interface');
        for (const win of windows) if (win.__testErrors.length) throw new Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root, '.test-output/ui-motion-scenarios.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
        console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
    } catch (error) { console.error(error);for (const win of windows) if (win.__testErrors.length) console.error(win.__testErrors.join('\n'));process.exitCode = 1; }
    finally { clearTimeout(timer);for (const win of windows) win.destroy();app.exit(process.exitCode || 0); }
})();
