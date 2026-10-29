import test from 'node:test';
import assert from 'node:assert/strict';
import SettingsManager from '../../src/renderer/js/core/SettingsManager.js';
import SettingsModal from '../../src/renderer/js/ui/SettingsModal.js';

class StoredSettings extends SettingsManager {
    applyAll() {}
    apply() {}
}

function useStorage(t) {
    const previous = globalThis.localStorage;
    const values = new Map();
    globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
}

test('interface sounds default to off and volume persists within safe bounds',t=>{
    useStorage(t);const settings=new StoredSettings();
    assert.equal(settings.get('uiSoundsEnabled'),false);assert.equal(settings.get('uiSoundVolume'),35);
    settings.set('uiSoundsEnabled',true);settings.set('uiSoundVolume',0);
    const reopened=new StoredSettings();assert.equal(reopened.get('uiSoundsEnabled'),true);assert.equal(reopened.get('uiSoundVolume'),0);
    for(const [value,expected] of [[-10,0],[110,100],[45.5,46],['invalid',35]]){reopened.set('uiSoundVolume',value);assert.equal(reopened.get('uiSoundVolume'),expected);}
});

test('fractional grid thresholds survive edits, restart and settings export/import', t => {
    useStorage(t);
    const settings = new StoredSettings();
    settings.set('gridMinZoom', 1.5);
    settings.set('gridOpacity', 0);
    settings.set('snapThreshold', 0);
    const reopened = new StoredSettings();
    assert.equal(reopened.get('gridMinZoom'), 1.5);
    assert.equal(reopened.get('gridOpacity'), 0);
    assert.equal(reopened.get('snapThreshold'), 0);
    const exported = reopened.exportSettingsJSON();
    reopened.resetToDefaults();
    assert.equal(reopened.importSettingsJSON(exported), true);
    assert.equal(reopened.get('gridMinZoom'), 1.5);
    for (const [value, expected] of [[0, 1], [32.5, 32], [2.75, 2.75], ['invalid', 3]]) {
        reopened.set('gridMinZoom', value);
        assert.equal(reopened.get('gridMinZoom'), expected);
    }
});

test('legacy wheel scrolling displays the corresponding supported option after loading', t => {
    useStorage(t);
    localStorage.setItem('molly_settings_m3', JSON.stringify({ wheelBehavior: 'scroll' }));
    const settings = new StoredSettings();
    assert.equal(settings.get('wheelBehavior'), 'pan-v');
});

function renderSettings(t, settings, method) {
    const previous = globalThis.document;
    const controls = new Map();
    const section = {
        innerHTML: '',
        querySelector(selector) {
            if (!controls.has(selector)) controls.set(selector, { addEventListener(name, fn) { this[name] = fn; } });
            return controls.get(selector);
        }
    };
    globalThis.document = { createElement: () => section };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const renderer = Object.create(SettingsModal.prototype);
    renderer.settings = settings;
    renderer[method]({ appendChild() {} });
    return { html: section.innerHTML, controls };
}

test('canvas controls represent zero opacity and imported zoom values without substituting defaults', t => {
    useStorage(t);
    const settings = new StoredSettings();
    settings.importSettingsJSON(JSON.stringify({ gridOpacity: 0, gridMinZoom: 8 }));
    const { html } = renderSettings(t, settings, 'renderCanvasTab');
    assert.match(html, /id="setting-grid-opacity"[^>]+min="0" max="100" value="0"/);
    assert.match(html, /<option value="8" selected>/);
    assert.match(html, /id="setting-grid-opacity-val"[^>]*>0%/);
});

test('tool controls retain imported snap limits and replace out-of-range history input with its saved value', t => {
    useStorage(t);
    const settings = new StoredSettings();
    settings.set('snapThreshold', 64);
    const { html, controls } = renderSettings(t, settings, 'renderToolsTab');
    assert.match(html, /id="setting-snap-thresh"[^>]+min="0" max="64" value="64"/);
    const field = { value: '999' };
    controls.get('#setting-undo-limit').change({ target: field });
    assert.equal(settings.get('undoLimit'), 200);
    assert.equal(field.value, '200');
    field.value = '';
    controls.get('#setting-undo-limit').change({ target: field });
    assert.equal(settings.get('undoLimit'), 50);
    assert.equal(field.value, '50');
});
