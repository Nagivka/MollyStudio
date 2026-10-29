import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initRippleEffect } from '../../src/renderer/js/ui/Ripple.js';
import { setPressedState } from '../../src/renderer/js/ui/ControlState.js';

const read = file => readFile(new URL(`../../src/renderer/${file}`, import.meta.url), 'utf8');

test('all five windows load one common control stylesheet and native enhancement entry', async () => {
    for (const page of ['index', 'editor', 'buttons', 'settings', 'new-project']) {
        const html = await read(`${page}.html`);
        assert.equal((html.match(/href="css\/application-ui.css"/g) || []).length, 1, page);
        assert.equal((html.match(/src="js\/ui\/ApplicationUI.js"/g) || []).length, 1, page);
        assert.ok(html.indexOf('css/application-ui.css') > html.indexOf('css/material-you.css'), page);
          assert.equal((html.match(/href="css\/responsive.css"/g)||[]).length,1,page);
          assert.ok(html.indexOf('css/responsive.css')>html.indexOf('css/minecraft.css'),page);
    }
});

test('embedded and standalone generators share a scoped layout without obsolete modal overrides', async () => {
    const [editor, modal, layout, base] = await Promise.all([
        read('editor.html'), read('js/ui/ButtonGeneratorModal.js'), read('css/buttons.css'), read('css/style.css')
    ]);
    assert.match(editor, /href="css\/buttons.css"/);
    assert.match(modal, /class="modal-body buttons-win-body"/);
    assert.match(modal, /class="modal btn-gen-modal" tabindex="-1">/);
    assert.doesNotMatch(base, /\.btn-gen-modal\s*\{/);
    for (const rule of layout.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        const selectors = rule[1].trim();
        assert.ok(selectors.startsWith(':where(.buttons-win-shell, .btn-gen-modal)')
            || selectors === '.buttons-win-shell' || selectors.startsWith('.m3-toast'), selectors);
    }
});

test('selects reserve an arrow gutter even when legacy controls use inline padding', async () => {
    const css = await read('css/application-ui.css');
    const select = css.match(/:root select:not\(\[multiple\]\)\s*\{([^}]+)\}/)?.[1];
    assert.ok(select);
    assert.match(select, /padding-inline-end:\s*32px !important/);
    assert.match(select, /appearance:\s*none/);
    assert.match(select, /background-image:\s*var\(--ui-select-arrow\) !important/);
    assert.match(select, /text-overflow:\s*ellipsis/);
});

test('shared and page-level startup install just one ripple listener per document', () => {
    const globals=['document','window','MutationObserver','matchMedia'];
    const previous=Object.fromEntries(globals.map(key=>[key,globalThis[key]]));
    const events = [];
    globalThis.document = { addEventListener: (name, handler) => events.push({ name, handler }) };
    globalThis.window={addEventListener(){}};
    globalThis.MutationObserver=class{observe(){}};
    globalThis.matchMedia=()=>({addEventListener(){},matches:false});
    try {
        initRippleEffect();
        initRippleEffect();
        const pointers=events.filter(event=>event.name==='pointerdown');
        assert.equal(pointers.length, 1);
        // A disabled button must not create any visual node or cleanup timer.
        pointers[0].handler({ button: 0, target: { closest: selector => selector === 'input, select, textarea' ? null : { disabled: true } } });
    } finally {
        for(const key of globals)if(previous[key]===undefined)delete globalThis[key];else globalThis[key]=previous[key];
    }
});

test('generator segments are native keyboard buttons with synchronized pressed state', async () => {
    const modal = await read('js/ui/ButtonGeneratorModal.js');
    assert.doesNotMatch(modal, /<div class="m3-segment-item/);
    assert.equal((modal.match(/<button type="button" aria-pressed="(?:true|false)" class="m3-segment-item/g) || []).length, 7);
    const editor = await read('editor.html');
    assert.doesNotMatch(editor, /<div class="m3-(?:segment-item|chip)(?:\s|")/);
    const values = {};
    const button = { classList: { toggle: (name, value) => { values[name] = value; } }, setAttribute: (name, value) => { values[name] = value; } };
    setPressedState(button, true);
    assert.deepEqual(values, { active: true, 'aria-pressed': 'true' });
    setPressedState(button, false);
    assert.deepEqual(values, { active: false, 'aria-pressed': 'false' });
    assert.doesNotThrow(() => setPressedState(null, false));
});
