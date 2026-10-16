const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
const { app, root, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');
const update = process.argv.includes('--update');
const themes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint'];
const pages = ['index', 'editor', 'settings', 'new-project', 'buttons'];
const baselineRoot = path.join(root, 'tests/visual/baselines', `${process.platform}-electron${process.versions.electron.split('.')[0]}`);
const outputRoot = path.join(root, '.test-output/visual');

async function prepare(page) {
    const { default: SettingsManager } = await import(new URL('./js/core/SettingsManager.js', location.href).href);
    window.visualSettings = window.mollyEditor?.settingsManager || new SettingsManager();
    visualSettings.set('animationsEnabled', false);
    if (page === 'index') await new Promise((resolve, reject) => {
        const deadline = Date.now() + 4000;
        const poll = () => document.querySelector('.m3-empty-recent, .m3-recent-card') ? resolve()
            : Date.now() > deadline ? reject(new Error('Recent projects did not render')) : setTimeout(poll, 20);
        poll();
    });
    if (page === 'editor') {
        const editor = window.mollyEditor;
        await new Promise((resolve, reject) => {
            const deadline = Date.now() + 10000;
            const poll = () => editor.tools.tools.text.fontImages.minecraft ? resolve()
                : Date.now() > deadline ? reject(new Error('Font atlas timeout')) : setTimeout(poll, 20);
            poll();
        });
        const layer = editor.layerManager.addTextLayer('Длинное название текстового слоя для проверки интерфейса', {
            text: 'Пример', fontId: 'minecraft', color: '#FFE066', x: 1, y: 1
        });
        editor.tools.setTool('text');
        editor.tools.tools.text.renderTextLayer(layer);
        document.getElementById('textSegColorGradient').click();
    } else if (page === 'new-project') document.getElementById('new-proj-tab-canvas').click();
    else if (page === 'buttons') window.buttonGenApp.setColorMode('gradient');
}

function inspect(page, theme) {
    if (document.documentElement.dataset.theme !== theme) throw new Error('Theme did not apply');
    if (!document.title || document.body.innerText.length < 50) throw new Error('Blank page');
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Root horizontal overflow');
    for (const select of document.querySelectorAll('select:not([multiple])')) {
        if (parseFloat(getComputedStyle(select).paddingRight) < 32) throw new Error(`Select arrow overlaps its label: ${select.id}`);
    }
    const luminance = color => {
        const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => (x /= 255) <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    if (page === 'settings') {
        for (const card of document.querySelectorAll('.settings-theme-card')) {
            const style = getComputedStyle(card), foreground = luminance(style.color), background = luminance(style.backgroundColor);
            if ((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) < 4.5) throw new Error(`Unreadable theme card: ${card.dataset.theme}`);
        }
    }
    const action = document.querySelector(page === 'editor' ? '#btn-export-png' : page === 'new-project' ? '#btn-create' : page === 'buttons' ? '#btnImportProject' : '#btn-win-close');
    if (!action || action.getBoundingClientRect().width < 10) throw new Error('Primary action missing');
    const box = action.getBoundingClientRect();
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) throw new Error('Primary action outside the viewport');
    return { title: document.title, width: innerWidth, height: innerHeight };
}

function compare(expected, actual) {
    const expectedSize = expected.getSize(), actualSize = actual.getSize();
    if (expectedSize.width !== actualSize.width || expectedSize.height !== actualSize.height) return { ratio: 1, changed: -1 };
    const a = expected.toBitmap(), b = actual.toBitmap(), diff = Buffer.from(b);
    let changed = 0;
    for (let index = 0; index < a.length; index += 4) {
        const mismatch = Math.max(Math.abs(a[index] - b[index]), Math.abs(a[index + 1] - b[index + 1]), Math.abs(a[index + 2] - b[index + 2])) > 16;
        if (mismatch) { changed++; diff[index] = 0; diff[index + 1] = 0; diff[index + 2] = 255; diff[index + 3] = 255; }
    }
    return { changed, ratio: changed / (a.length / 4), diff: nativeImage.createFromBitmap(diff, actualSize) };
}

(async () => {
    let window;
    const results = [], failures = [];
    const watchdog = setTimeout(() => { console.error('Visual matrix timed out'); app.exit(1); }, 240000);
    try {
        await ready();
        await fs.mkdir(baselineRoot, { recursive: true });
        await fs.mkdir(outputRoot, { recursive: true });
        window = makeWindow();
        for (const page of pages) {
            await window.loadFile(path.join(root, `www/${page}.html`), page === 'editor'
                ? { query: { new: 'true', type: 'canvas', width: '32', height: '32', name: 'Очень длинное название проекта для проверки подписей и вкладок' } } : {});
            await window.webContents.executeJavaScript(`(${prepare.toString()})(${JSON.stringify(page)})`);
            await window.webContents.insertCSS('* { caret-color: transparent !important; }');
            for (const theme of themes) {
                await window.webContents.executeJavaScript(page === 'settings'
                    ? `document.querySelector('[data-theme="${theme}"]').click()` : `visualSettings.set('theme', '${theme}')`);
                for (const [width, height] of [[1280, 800], [760, 780]]) {
                    for (const zoom of [1, 1.25, 1.5]) {
                        window.setContentSize(width, height);
                        window.webContents.setZoomFactor(zoom);
                        await settle(window);
                        const identity = `${page}-${theme}-${width}x${height}-${zoom}`;
                        try {
                            const info = await window.webContents.executeJavaScript(`(${inspect.toString()})('${page}', '${theme}')`);
                            if (Math.abs(info.width - width / zoom) > 2 || Math.abs(info.height - height / zoom) > 2) throw new Error('Viewport zoom did not settle');
                            if (width === 1280 && zoom === 1) {
                                const file = `${page}-${theme}.png`, destination = path.join(baselineRoot, file);
                                const actual = await window.webContents.capturePage(undefined, { stayHidden: true });
                                if (update) await fs.writeFile(destination, actual.toPNG());
                                else {
                                    const previous = await fs.readFile(destination).catch(() => null);
                                    if (!previous) throw new Error(`Missing baseline ${file}; create it explicitly with npm run test:visual:update`);
                                    const comparison = compare(nativeImage.createFromBuffer(previous), actual);
                                    if (comparison.ratio > .0001) {
                                        await fs.writeFile(path.join(outputRoot, `${file}.actual.png`), actual.toPNG());
                                        if (comparison.diff) await fs.writeFile(path.join(outputRoot, `${file}.diff.png`), comparison.diff.toPNG());
                                        throw new Error(`Screenshot differs: ${comparison.changed} pixels (${(comparison.ratio * 100).toFixed(4)}%)`);
                                    }
                                }
                            }
                            results.push({ case: identity, ...info });
                        } catch (error) {
                            failures.push({ case: identity, message: error.message });
                            console.error(identity, error.message);
                        }
                    }
                }
            }
            console.log(`Visual ${page}: ${results.length} cases passed, ${failures.length} failures`);
        }
        if (window.__testErrors.length) failures.push(...window.__testErrors.map(message => ({ message })));
        const report = { electron: process.versions.electron, platform: process.platform, offlineFonts: true, baselineScreenshots: 50, passed: results.length, failures };
        await fs.writeFile(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));
        if (update) await fs.writeFile(path.join(baselineRoot, 'manifest.json'), JSON.stringify({ electron: process.versions.electron, platform: process.platform, themes, pages, viewport: [1280, 800], zoom: 1, offlineFonts: true }, null, 2));
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = failures.length ? 1 : 0;
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
        clearTimeout(watchdog);
        window?.destroy();
        app.exit(process.exitCode || 0);
    }
})();
