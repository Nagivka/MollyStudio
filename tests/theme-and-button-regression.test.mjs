import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import SettingsManager from '../www/js/core/SettingsManager.js';

globalThis.document = { addEventListener() {} };
const { ButtonGeneratorController } = await import('../www/js/windows/button-generator-window.js');
const { default: ButtonGeneratorModal } = await import('../www/js/ui/ButtonGeneratorModal.js');
delete globalThis.document;

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

function relativeLuminance(hex) {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => {
        const channel = parseInt(value, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first, second) {
    const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

function captureRendererPixels(renderer, chin) {
    const originalDocument = globalThis.document;
    const capture = {};
    globalThis.document = {
        createElement: () => {
            const canvas = { width: 0, height: 0 };
            canvas.getContext = () => ({
                createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
                putImageData: image => { capture.data = image.data; }
            });
            return canvas;
        }
    };

    try {
        const instance = Object.create(renderer.prototype);
        instance.colorMode = 'solid';
        instance.autoShadeEnabled = false;
        instance.gradientAngle = 90;
        instance.currentChin = chin;
        instance.currentShadow = 1;
        const canvas = instance.renderButton(18, 18, {
            border: '#000000',
            highlight: '#ffffff',
            shadow: '#222222',
            surface: '#808080'
        }, 'default', 100, false, chin, 1);
        capture.width = canvas.width;
        capture.height = canvas.height;
        return capture;
    } finally {
        if (originalDocument === undefined) delete globalThis.document;
        else globalThis.document = originalDocument;
    }
}

test('theme picker and quick cycle expose the same 5 dark and 5 light themes', async () => {
    const [settingsModal, launcher, styles, themeInit] = await Promise.all([
        read('../www/js/ui/SettingsModal.js'),
        read('../www/js/launcher.js'),
        read('../www/css/style.css'),
        read('../www/js/theme-init.js')
    ]);

    const themeBlock = settingsModal.match(/this\.themes\s*=\s*\[([\s\S]*?)\n\s*\];/)?.[1];
    assert.ok(themeBlock, 'theme picker list is present');
    const themes = [...themeBlock.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'[^']+',\s*type:\s*'(dark|light)'/g)]
        .map(([, id, type]) => ({ id, type }));
    assert.equal(themes.length, 10);
    assert.equal(themes.filter(theme => theme.type === 'dark').length, 5);
    assert.equal(themes.filter(theme => theme.type === 'light').length, 5);

    const cycle = launcher.match(/const themes = \[([^\]]+)\]/)?.[1];
    assert.ok(cycle, 'launcher quick cycle list is present');
    assert.deepEqual([...cycle.matchAll(/'([^']+)'/g)].map(([, id]) => id), themes.map(theme => theme.id));
    const themeInitList = themeInit.match(/supportedThemes = \[([^\]]+)\]/)?.[1];
    assert.deepEqual([...themeInitList.matchAll(/'([^']+)'/g)].map(([, id]) => id), themes.map(theme => theme.id));
    assert.match(settingsModal, /aria-pressed="\$\{currentTheme === t\.id\}"/);
    assert.match(styles, /\.settings-theme-card\s*\{[^}]*color:\s*var\(--md-on-surface\)/s);
    assert.match(themeInit, /function normalizeTheme\(theme\)/);
    assert.match(styles, /#btn-export-png\s*\{[^}]*min-height:\s*32px !important;[^}]*padding:\s*0 12px !important;/s);
    assert.match(await read('../www/buttons.html'), /id="chinInput" min="0" max="5" value="0"/);
    assert.match(await read('../www/js/ui/ButtonGeneratorModal.js'), /id="modalChinInput" min="0" max="5" value="0"/);
});

test('all theme card foreground and selected-state color pairs meet 4.5:1 contrast', async () => {
    const [settingsModal, styles] = await Promise.all([
        read('../www/js/ui/SettingsModal.js'),
        read('../www/css/style.css')
    ]);
    const themeBlock = settingsModal.match(/this\.themes\s*=\s*\[([\s\S]*?)\n\s*\];/)?.[1] || '';
    const themeIds = [...themeBlock.matchAll(/\{\s*id:\s*'([^']+)'/g)].map(([, id]) => id);
    const darkBase = styles.match(/:root,\s*\[data-theme="dark"\]\s*\{([^}]+)\}/)?.[1] || '';
    assert.ok(darkBase, 'base dark color tokens are present');

    const token = (block, name) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
    for (const themeId of themeIds) {
        const override = styles.match(new RegExp(`\\[data-theme="${themeId}"\\]\\s*\\{([^}]+)\\}`))?.[1] || '';
        const combined = `${darkBase}\n${override}`;
        const foreground = token(combined, '--md-on-surface');
        const surface = token(combined, '--md-surface-container-high');
        const activeForeground = token(combined, '--md-on-primary-container');
        const activeSurface = token(combined, '--md-primary-container');
        const badgeForeground = token(combined, '--md-on-surface-variant');
        const badgeSurface = token(combined, '--md-surface-container-highest');
        const activeBadgeForeground = token(combined, '--md-on-primary');
        const activeBadgeSurface = token(combined, '--md-primary');
        assert.ok(foreground && surface && activeForeground && activeSurface && badgeForeground && badgeSurface && activeBadgeForeground && activeBadgeSurface, `Complete text tokens exist for ${themeId}`);
        assert.ok(contrastRatio(foreground, surface) >= 4.5, `${themeId} card text contrast`);
        assert.ok(contrastRatio(activeForeground, activeSurface) >= 4.5, `${themeId} selected card contrast`);
        assert.ok(contrastRatio(badgeForeground, badgeSurface) >= 4.5, `${themeId} badge contrast`);
        assert.ok(contrastRatio(activeBadgeForeground, activeBadgeSurface) >= 4.5, `${themeId} selected badge contrast`);
    }
});

test('custom accent foreground chooses the higher-contrast light or dark text', () => {
    const settings = Object.create(SettingsManager.prototype);
    for (const background of [
        { r: 18, g: 22, b: 35 },
        { r: 80, g: 120, b: 210 },
        { r: 250, g: 230, b: 120 },
        { r: 255, g: 255, b: 255 }
    ]) {
        const foreground = settings.bestOnColor(background);
        const foregroundRgb = foreground === '#FFFFFF'
            ? { r: 255, g: 255, b: 255 }
            : { r: 0, g: 0, b: 0 };
        const luminance = color => {
            const linear = [color.r, color.g, color.b].map(channel => {
                const value = channel / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const pair = [luminance(background), luminance(foregroundRgb)].sort((a, b) => b - a);
        assert.ok((pair[0] + 0.05) / (pair[1] + 0.05) >= 4.5);
    }
    assert.equal(settings.normalizeTheme('crimson'), 'dark');
    assert.equal(settings.normalizeTheme('light-rose'), 'light-rose');
});

test('custom accents normalize safely and expose readable Material 3 tonal pairs in every theme', async () => {
    const settings = Object.create(SettingsManager.prototype);
    assert.equal(settings.normalizeAccentColor(' auto '), 'auto');
    assert.equal(settings.normalizeAccentColor('#aBc123'), '#ABC123');
    assert.equal(settings.normalizeAccentColor('rgb(1, 2, 3)'), 'auto');
    assert.equal(settings.normalizeAccentColor(null), 'auto');

    const [settingsModal, styles, materialLayer, themeInit] = await Promise.all([
        read('../www/js/ui/SettingsModal.js'),
        read('../www/css/style.css'),
        read('../www/css/material-you.css'),
        read('../www/js/theme-init.js')
    ]);
    const accentBlock = settingsModal.match(/this\.accentPresets\s*=\s*\[([\s\S]*?)\n\s*\];/)?.[1] || '';
    const accents = [...accentBlock.matchAll(/hex:\s*'(#[0-9a-f]{6})'/gi)].map(([, hex]) => hex);
    assert.equal(accents.length, 16, 'all named accent swatches remain available');
    assert.match(settingsModal, /createElement\('button'\)/);
    assert.match(settingsModal, /role="group" aria-label="Предустановленные акцентные цвета"/);
    assert.match(themeInit, /--md-primary-fixed-dim/);
    assert.match(themeInit, /classList\.toggle\('no-animations', s\.animationsEnabled === false\)/);
    assert.match(materialLayer, /--md-shape-corner-input:\s*4px/);

    const properties = new Map();
    let theme = 'dark';
    globalThis.document = {
        documentElement: {
            style: {
                setProperty: (name, value) => properties.set(name, value),
                removeProperty: name => properties.delete(name)
            },
            getAttribute: () => theme
        }
    };
    const asHex = color => {
        if (color.startsWith('#')) return color;
        const values = color.match(/\d+/g)?.slice(0, 3).map(Number);
        return values ? `#${values.map(value => value.toString(16).padStart(2, '0')).join('')}` : null;
    };

    try {
        for (const themeId of ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint']) {
            theme = themeId;
            for (const accent of [...accents, '#000000', '#FFFFFF', '#FFFF00']) {
                properties.clear();
                settings.updateAccentCssVars(accent);
                const pairs = [
                    ['--md-on-primary', '--md-primary'],
                    ['--md-on-primary-container', '--md-primary-container'],
                    ['--md-on-primary-fixed', '--md-primary-fixed'],
                    ['--md-on-primary-fixed-variant', '--md-primary-fixed-dim'],
                    ['--md-on-secondary', '--md-secondary'],
                    ['--md-on-secondary-container', '--md-secondary-container'],
                    ['--md-on-tertiary', '--md-tertiary'],
                    ['--md-on-tertiary-container', '--md-tertiary-container']
                ];
                for (const [foregroundKey, backgroundKey] of pairs) {
                    const foreground = asHex(properties.get(foregroundKey));
                    const background = asHex(properties.get(backgroundKey));
                    assert.ok(foreground && background, `palette pair ${foregroundKey}/${backgroundKey} exists for ${themeId}`);
                    assert.ok(contrastRatio(foreground, background) >= 4.5, `${themeId} ${accent} ${foregroundKey} contrast`);
                }
                const primaryOnSurface = asHex(properties.get('--md-primary'));
                assert.ok(primaryOnSurface, `accent text token exists for ${themeId}`);
                assert.ok(
                    contrastRatio(primaryOnSurface, themeId.startsWith('light') ? '#FFFFFF' : '#37393B') >= 4.5,
                    `${themeId} ${accent} primary text remains readable on the surface`
                );
                assert.equal(properties.get('--md-sys-color-primary-rgb'), properties.get('--md-primary-rgb'));
                assert.ok(properties.has('--md-sys-color-primary-hover'));
            }
        }
    } finally {
        delete globalThis.document;
    }
});

test('Material motion has a settings kill switch and honors reduced-motion preferences', async () => {
    const [styles, materialLayer, themeInit] = await Promise.all([
        read('../www/css/style.css'),
        read('../www/css/material-you.css'),
        read('../www/js/theme-init.js')
    ]);
    assert.match(materialLayer, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /\.no-animations \*::before/);
    assert.match(themeInit, /animationsEnabled === false/);

    const toggled = [];
    globalThis.document = { documentElement: { classList: { toggle: (...args) => toggled.push(args) } } };
    try {
        SettingsManager.prototype.apply.call({ settings: {} }, 'animationsEnabled', false);
        SettingsManager.prototype.apply.call({ settings: {} }, 'animationsEnabled', true);
    } finally {
        delete globalThis.document;
    }
    assert.deepEqual(toggled, [['no-animations', true], ['no-animations', false]]);
});

test('startup theme script and live settings keep the generated accent palette in sync', async () => {
    const themeInit = await read('../www/js/theme-init.js');
    const tokens = [
        '--md-primary', '--md-on-primary', '--md-primary-container', '--md-on-primary-container',
        '--md-primary-rgb', '--md-primary-fixed', '--md-primary-fixed-dim', '--md-on-primary-fixed',
        '--md-on-primary-fixed-variant', '--md-inverse-primary', '--md-secondary', '--md-on-secondary',
        '--md-secondary-container', '--md-on-secondary-container', '--md-tertiary', '--md-on-tertiary',
        '--md-tertiary-container', '--md-on-tertiary-container', '--md-sys-color-primary-rgb',
        '--md-sys-color-primary-container-rgb', '--md-sys-color-primary-hover'
    ];
    const themes = ['dark', 'oled', 'midnight', 'forest', 'amethyst', 'light', 'light-nord', 'light-warm', 'light-rose', 'light-mint'];
    const accents = ['#2563EB', '#FFFFFF', '#FFFF00', '#10B981'];

    for (const theme of themes) {
        for (const accentColor of accents) {
            const createRoot = () => {
                const values = new Map();
                const attributes = new Map();
                const root = {
                    values,
                    style: {
                        setProperty: (name, value) => values.set(name, value),
                        removeProperty: name => values.delete(name)
                    },
                    classList: { toggle() {} },
                    setAttribute: (name, value) => attributes.set(name, value),
                    getAttribute: name => attributes.get(name) ?? theme
                };
                attributes.set('data-theme', theme);
                return root;
            };
            const earlyRoot = createRoot();
            runInNewContext(themeInit, {
                document: { documentElement: earlyRoot, readyState: 'complete' },
                localStorage: { getItem: () => JSON.stringify({ theme, accentColor }) },
                window: { addEventListener() {} }
            });

            const liveRoot = createRoot();
            globalThis.document = { documentElement: liveRoot };
            try {
                SettingsManager.prototype.updateAccentCssVars.call(Object.create(SettingsManager.prototype), accentColor);
            } finally {
                delete globalThis.document;
            }
            for (const token of tokens) {
                assert.equal(liveRoot.values.get(token), earlyRoot.values.get(token), `${theme} ${accentColor} ${token}`);
            }
        }
    }
});

test('restored SVG window controls keep their maximize state accessible', async () => {
    for (const name of ['index', 'editor', 'buttons', 'settings', 'new-project']) {
        const page = await read(`../www/${name}.html`);
        assert.match(page, /<svg/);
        assert.match(page, /id="btn-win-close"[^>]*aria-label="Закрыть"/);
    }
    for (const script of ['launcher', 'core/App', 'windows/button-generator-window']) {
        const source = await read(`../www/js/${script}.js`);
        assert.match(source, /innerHTML = isMax \? restoreSvg : maxSvg/);
        assert.match(source, /setAttribute\('aria-label', isMax/);
    }
});

test('both button generators default to no lower shadow strip but preserve the optional chin', () => {
    for (const renderer of [ButtonGeneratorController, ButtonGeneratorModal]) {
        const flat = captureRendererPixels(renderer, 0);
        const chin = captureRendererPixels(renderer, 1);
        const bottomInteriorPixel = (16 * flat.width + 5) * 4;
        assert.deepEqual([...flat.data.slice(bottomInteriorPixel, bottomInteriorPixel + 3)], [128, 128, 128]);
        assert.deepEqual([...chin.data.slice(bottomInteriorPixel, bottomInteriorPixel + 3)], [34, 34, 34]);
    }
});
