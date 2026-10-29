const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');

(async () => {
    let win;
    const results = [];
    const timer = setTimeout(() => app.exit(1), 120000);
    try {
        await ready();
        win = makeWindow(1280, 800);
        const output = path.join(root, '.test-output/brand-logo');
        await fs.mkdir(output, {recursive: true});
        for (const file of ['index.html', 'editor.html', 'settings.html', 'new-project.html']) {
            await win.loadFile(path.join(root, 'src/renderer', file), {
                query: file === 'editor.html' ? {new: 'true', type: 'canvas', width: '32', height: '32'} : {}
            });
            await settle(win);
            const checks = await win.page.evaluate(async file => {
                const {default: Settings} = await import(new URL('js/core/SettingsManager.js', location.href));
                const settings = window.mollyEditor?.settingsManager || new Settings();
                settings.set('animationsEnabled', false);
                if (file === 'settings.html') {
                    document.querySelector('[data-tab="about"]').click();
                    if (!document.querySelector('.about-brand .molly-logo')) throw Error('About section lost its logo');
                }
                const themes = ['dark','oled','midnight','forest','amethyst','light','light-nord','light-warm','light-rose','light-mint','minecraft','light-minecraft'];
                const results = [];
                for (const theme of themes) {
                    settings.set('theme', theme);
                    for (const accent of ['auto', '#EF476F', '#208BFF', '#000000', '#FFFFFF']) {
                        settings.set('accentColor', accent);
                        const primary = document.createElement('span');
                        primary.style.backgroundColor = 'var(--md-primary)';
                        document.body.append(primary);
                        const expected = getComputedStyle(primary).backgroundColor;
                        primary.remove();
                        const logos = [...document.querySelectorAll('.molly-logo')];
                        if (!logos.length) throw Error('Missing logo in ' + file);
                        for (const logo of logos) {
                            const ink = getComputedStyle(logo, '::before');
                            if (ink.backgroundColor !== expected || !ink.maskImage.includes('mark.svg')) throw Error('Logo did not follow accent: ' + theme + '/' + accent);
                            const bounds = logo.getBoundingClientRect();
                            if (logo.getClientRects().length && (bounds.width < 16 || bounds.height < 16)) throw Error('Logo lost its size');
                            if (theme.includes('minecraft') && getComputedStyle(logo).borderRadius !== '0px') throw Error('Pixel logo is rounded');
                        }
                        results.push({file, theme, accent, logos: logos.length});
                    }
                }
                settings.set('theme', 'dark');
                settings.set('accentColor', '#EF476F');
                return results;
            }, file);
            results.push(...checks);
            await settle(win);
            await fs.writeFile(path.join(output, file.replace('.html', '.png')), (await win.webContents.capturePage()).toPNG());
        }
        if (win.__testErrors.length) throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({passed: true, cases: results.length, results}, null, 2));
        console.log(JSON.stringify({passed: true, cases: results.length}));
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        clearTimeout(timer);
        win?.destroy();
        app.exit(process.exitCode || 0);
    }
})();
