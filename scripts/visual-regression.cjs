const fs = require('node:fs/promises');
const path = require('node:path');
const nativeImage = require('./lib/png-image.cjs');
const {visualEnvironment, sameVisualEnvironment} = require('./lib/visual-environment.cjs');
const { app, root, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');
const update = process.argv.includes('--update');
const captureOnly = process.argv.includes('--capture');
const language = process.argv.find(argument => argument.startsWith('--language='))?.slice(11) || 'ru';
if (!['ru', 'en'].includes(language)) throw Error('Unsupported visual language');
if (update && captureOnly) throw new Error('Choose capture or baseline update, not both.');
const themes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint', 'minecraft', 'light-minecraft'];
const allPages = ['index', 'editor', 'settings', 'new-project', 'buttons'];
const selectedPage = process.argv.find(argument => argument.startsWith('--page='))?.slice(7);
if(selectedPage&&!allPages.includes(selectedPage))throw new Error('Unknown visual page');
const pages = selectedPage ? [selectedPage] : allPages;
const baselineRoot = path.join(root, 'tests/visual/baselines', `${process.platform}-electron45${language === 'ru' ? '' : '-' + language}`);
const outputRoot = path.join(root, `.test-output/visual${language === 'ru' ? '' : '-' + language}`);

async function prepare(page, language) {
    const { default: SettingsManager } = await import(new URL('./js/core/SettingsManager.js', location.href).href);
    window.visualSettings = window.mollyEditor?.settingsManager || new SettingsManager();
    visualSettings.set('language', language);
    visualSettings.set('animationsEnabled', false);
    if (page === 'index') await new Promise((resolve, reject) => {
        const deadline = Date.now() + 4000;
        const poll = () => document.querySelector('.m3-empty-recent, .m3-recent-card') ? resolve()
            : Date.now() > deadline ? reject(new Error('Recent projects did not render')) : setTimeout(poll, 20);
        poll();
    });
    if (page === 'editor') {
        const editor = window.mollyEditor;
        document.getElementById('properties-panel-section').classList.add('expanded');
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

function inspect(page, theme, inspectGeometry) {
    if (document.documentElement.dataset.theme !== theme) throw new Error('Theme did not apply');
    if (!document.title || document.body.innerText.length < 50) throw new Error('Blank page');
    if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Root horizontal overflow');
    // Check nested controls too: overflow:hidden can conceal broken layout
    // while leaving the root width unchanged.
    const minimumWidth = { index: 900, editor: 900, settings: 760, 'new-project': 480, buttons: 880 }[page];
    if (innerWidth >= minimumWidth) {
        const geometry = inspectGeometry();
        if (geometry.rootScroll.some(value => Math.abs(value) > 1)) throw new Error('The window scrolled instead of its content panel');
        for (const key of ['overlaps', 'touching', 'clipped', 'overflow', 'pixelFallbacks', 'dialogsOutside']) {
            if (geometry[key].length) throw new Error(`Interface ${key}: ${JSON.stringify(geometry[key])}`);
        }
        if (page === 'editor' && innerHeight >= 500) {
            for (const id of ['main-toolbar']) {
                const panel = document.getElementById(id);
                if (panel.scrollHeight > panel.clientHeight + 1) throw new Error(`Outer panel must fit without scrolling: ${id}`);
            }
            const toolbar = document.getElementById('main-toolbar').getBoundingClientRect();
            const columns = getComputedStyle(document.querySelector('#main-toolbar .tools-group')).gridTemplateColumns.trim();
            if (columns.split(/\s+/).length !== 1) throw new Error('Tool strip must remain a single column');
            if (document.querySelectorAll('#main-toolbar .tool-btn,.tool-overflow-list .tool-btn').length !== 18) throw new Error('A tool was lost while fitting the strip');
            for (const button of document.querySelectorAll('#main-toolbar button')) {
                const box = button.getBoundingClientRect();
                if (box.top < toolbar.top - 1 || box.bottom > toolbar.bottom + 1) throw new Error('A tool is outside the adaptive toolbar');
            }
            const options = document.querySelector('.options-bar');
            if (options.clientHeight && options.clientHeight > 56) throw new Error('Tool options wrapped onto another row');
        }
        const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]');
        for (const field of document.querySelectorAll('.prop-resettable')) {
            const input = field.querySelector('input'), button = field.querySelector('.prop-reset-button');
            if (!input || !button || !visible(input)) continue;
            const a = input.getBoundingClientRect(), b = button.getBoundingClientRect();
            if (b.left < a.right + 3 || Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) > 2) throw new Error(`Reset action is not aligned beside its field: ${input.id}`);
        }
        for (const element of document.querySelectorAll('.top-menu,.options-bar .opt-group,.bottom-status-bar,.status-left,.zoom-controls,#color-panel-section,.md-hex-row,.shading-ramp-header,.shading-ramp-subrow,.palette-header,.md-panel-props,#prefix-editor,.new-win-card,.settings-win-content-scroll')) {
            if (visible(element) && element.scrollWidth > element.clientWidth + 3) throw new Error(`Panel clips its controls: ${element.id || element.className}`);
        }
        for (const button of document.querySelectorAll('button,[role="tab"]')) {
            if (visible(button) && button.clientWidth && button.scrollWidth > button.clientWidth + 3) throw new Error(`Button label clipped: ${button.id || button.textContent.trim()}`);
        }
        const status = document.querySelector('.bottom-status-bar');
        if (status) {
            const outer = status.getBoundingClientRect();
            for (const group of status.children) {
                const box = group.getBoundingClientRect();
                if (visible(group) && (box.top < outer.top - 1 || box.bottom > outer.bottom + 1)) throw new Error('Status controls outside the status bar');
            }
        }
    }
    if(page==='new-project')for(const element of document.querySelectorAll('.new-win-body, .new-win-card, .project-type-selector')){
        if(element.scrollWidth>element.clientWidth+1)throw new Error('Project creation panel has horizontal overflow: '+element.className);
    }
    if (page === 'editor' || page === 'buttons') {
        const canvas = document.getElementById(page === 'editor' ? 'main-canvas' : 'previewCanvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) throw new Error('Canvas fixture lost its rendered content');
    }
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
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) throw new Error('Primary action outside the viewport '+JSON.stringify({id:action.id,box:box.toJSON(),viewport:[innerWidth,innerHeight]}));
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

function canvasSamples(page) {
    const canvas = document.getElementById(page === 'editor' ? 'main-canvas' : 'previewCanvas');
    const rect = canvas.getBoundingClientRect(), samples = [];
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 0; y < canvas.height && samples.length < 12; y++) for (let x = 0; x < canvas.width && samples.length < 12; x++) {
        const index = (y * canvas.width + x) * 4;
        if (data[index + 3] !== 255) continue;
        const screenX = Math.floor(rect.left + (x + .5) * rect.width / canvas.width);
        const screenY = Math.floor(rect.top + (y + .5) * rect.height / canvas.height);
        if (screenX < 60 || screenX >= innerWidth - 2 || screenY < 120 || screenY >= innerHeight - 32) continue;
        samples.push({ x: screenX, y: screenY, rgb: [...data.slice(index, index + 3)] });
    }
    return samples;
}

function verifyCapturedCanvas(actual, samples) {
    if (!samples.length) throw new Error('No visible opaque canvas samples');
    const bitmap = actual.toBitmap(), { width } = actual.getSize();
    const mismatches = samples.flatMap(sample => {
        const offset = (sample.y * width + sample.x) * 4;
        const captured = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
        return captured.some((channel, index) => Math.abs(channel - sample.rgb[index]) >= 36)
            ? [{...sample, captured}] : [];
    });
    if (mismatches.length > samples.length * .25) {
        throw new Error('Captured screenshot differs from the canvas pixels: ' + JSON.stringify(mismatches.slice(0, 3)));
    }
}

(async () => {
    const { inspectInterfaceGeometry } = await import('./lib/interface-geometry.mjs');
    let window;
    const results = [], failures = [], staged = new Map();
    let environment;
    const previousManifest = JSON.parse(await fs.readFile(path.join(baselineRoot, 'manifest.json'), 'utf8').catch(() => 'null'));
    const watchdog = setTimeout(() => { console.error('Visual matrix timed out'); app.exit(1); }, 360000);
    try {
        await ready();
        await fs.mkdir(baselineRoot, { recursive: true });
        await fs.mkdir(outputRoot, { recursive: true });
        if (captureOnly) await fs.mkdir(path.join(outputRoot, 'captures'), {recursive: true});
        for (const page of pages) {
            window?.destroy();
            window = makeWindow(1280, 800, { offscreen: false });
            // Chromium can defer compositor viewport updates for hidden windows after
            // zoom changes. Validate the same visible-window path users actually see.
            window.showInactive();
            await window.loadFile(path.join(root, `src/renderer/${page}.html`), page === 'editor'
                ? { query: { new: 'true', type: 'canvas', width: '32', height: '32', name: 'Очень длинное название проекта для проверки подписей и вкладок' } } : {});
            await window.webContents.executeJavaScript(`(${prepare.toString()})(${JSON.stringify(page)},${JSON.stringify(language)})`);
            if (!environment) {
                const fonts = {};
                for (const name of ['GoogleSans.woff2', 'MaterialSymbolsRounded.woff2', 'Minecraft1.ttf', 'minecraft-ten1.ttf'])
                    fonts[name] = await fs.readFile(path.join(root, 'src/renderer/assets/fonts', name));
                environment = visualEnvironment(process.platform, await window.webContents.executeJavaScript('navigator.userAgent'), fonts);
                if (!update && !captureOnly && !sameVisualEnvironment(environment, previousManifest?.environment))
                    throw Error('Версия Chromium или шрифты не совпадают с эталонами. Сначала просмотрите новый результат и явно обновите эталоны.');
            }
            if (!update && !captureOnly && !previousManifest.pages?.includes(page)) throw Error(`Нет актуальных эталонов страницы ${page}`);
            await window.webContents.insertCSS('* { caret-color: transparent !important; }');
            for (const theme of themes) {
                await window.webContents.executeJavaScript(page === 'settings'
                    ? `document.querySelector('[data-theme="${theme}"]').click()` : `visualSettings.set('theme', '${theme}')`);
                const sizes = page === 'new-project' ? [[1280,800],[760,780],[560,520],[480,440]]
                    : page === 'buttons' ? [[1280,800],[880,580],[760,780]]
                    : page === 'settings' ? [[1280,800],[760,560],[760,780]]
                    : [[1280,800],[900,600],[760,780]];
                for (const [width, height] of sizes) {
                    for (const zoom of [1, 1.25, 1.5]) {
                        window.setContentSize(width, height);
                        window.webContents.setZoomFactor(zoom);
                        await settle(window);
                        const identity = `${page}-${theme}-${width}x${height}-${zoom}`;
                        try {
                            const info = await window.webContents.executeJavaScript(`(${inspect.toString()})('${page}', '${theme}', (${inspectInterfaceGeometry.toString()}))`);
                            if (Math.abs(info.width - width / zoom) > 2 || Math.abs(info.height - height / zoom) > 2) throw new Error('Viewport zoom did not settle');
                            if (width === 1280 && zoom === 1) {
                                const file = `${page}-${theme}.png`, destination = path.join(baselineRoot, file);
                                const actual = await window.webContents.capturePage(undefined, { stayHidden: true });
                                if (captureOnly) await fs.writeFile(path.join(outputRoot, 'captures', file), actual.toPNG());
                                if (page === 'editor' || page === 'buttons') verifyCapturedCanvas(actual, await window.webContents.executeJavaScript(`(${canvasSamples.toString()})('${page}')`));
                                if (update) staged.set(destination, actual.toPNG());
                                else if (!captureOnly) {
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
            if (window.__testErrors.length) failures.push(...window.__testErrors.map(message => ({ page, message })));
        }
        const report = { runtime: 'electron-chromium', mode: captureOnly ? 'capture' : update ? 'baseline-update' : 'regression',
            platform: process.platform, language, offlineFonts: true, baselineScreenshots: pages.length*themes.length,
            comparedScreenshots: !update && !captureOnly ? pages.length*themes.length : 0, passed: results.length, failures };
        await fs.writeFile(path.join(outputRoot, selectedPage?`report-${selectedPage}.json`:'report.json'), JSON.stringify(report, null, 2));
        if (update && !failures.length) {
            // Failed geometry checks must never overwrite approved screenshots.
            for (const [destination, bytes] of staged) await fs.writeFile(destination, bytes);
            const retained = sameVisualEnvironment(environment, previousManifest?.environment) ? previousManifest.pages || [] : [];
            const recordedPages = allPages.filter(page => pages.includes(page) || retained.includes(page));
            await fs.writeFile(path.join(baselineRoot, 'manifest.json'), JSON.stringify({ runtime: 'electron-chromium', platform: process.platform, language, environment, themes, pages:recordedPages, viewport: [1280, 800], zoom: 1, offlineFonts: true }, null, 2));
        }
        console.log(JSON.stringify(report, null, 2));
        process.exitCode = failures.length ? 1 : 0;
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally {
        clearTimeout(watchdog);
        window?.destroy();
        app.exit(process.exitCode || 0);
    }
})();
