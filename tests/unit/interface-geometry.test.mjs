import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectInterfaceGeometry } from '../../scripts/lib/interface-geometry.mjs';

function element(id, [left, top, width, height], parentElement = null, options = {}) {
    return {
        id, parentElement, className: '', textContent: id, dataset: {}, clientWidth: width, clientHeight: height,
        scrollWidth: options.scrollWidth ?? width, scrollHeight: options.scrollHeight ?? height,
        style: { visibility: 'visible', overflowX: 'visible', overflowY: 'visible', maskImage: 'none', ...options.style },
        getBoundingClientRect: () => ({ left, top, right: left + width, bottom: top + height }),
        getClientRects: () => options.hidden ? [] : [{}], getAttribute: () => null,
        closest(selector) { return selector === '[hidden]' && options.hidden ? this : parentElement?.closest(selector) || null; },
        contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; },
        matches(selector) { return options.sidebar && selector.includes('.settings-win-sidebar') || options.segments && selector.includes('.m3-segmented-button') || options.titlebar && selector === '.titlebar-btn'; },
        querySelector(selector) { return selector === ':scope > .inspector-tabs' ? options.tabs || null : null; },
        querySelectorAll(selector) { return selector.startsWith('button,') ? options.controls || [] : []; }
    };
}

function inspect(controls, { overlays = [], containers = [], theme = 'dark', icons = [] } = {}) {
    const root = { dataset: { theme }, scrollWidth: 300 };
    const document = {
        documentElement: root, fonts: { status: 'loaded' }, querySelector: () => null,
        querySelectorAll(selector) {
            if (selector.startsWith('dialog[open]')) return overlays;
            if (selector.startsWith('button,')) return controls;
            if (selector === '.material-symbols-rounded') return icons;
            return containers;
        }
    };
    const values = { document, innerWidth: 300, innerHeight: 200, getComputedStyle: node => node === root
        ? { getPropertyValue: () => '1' } : node.style };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, values);
    try { return inspectInterfaceGeometry(); }
    finally { for (const key of Object.keys(values)) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key];
    } }
}

test('interface geometry detects real intersections and zero spacing, with nested controls excluded', () => {
    const group = element('group', [0, 0, 300, 150]);
    const first = element('first', [10, 10, 80, 30], group);
    const overlapping = element('overlapping', [85, 10, 80, 30], group);
    const touching = element('touching', [165, 10, 80, 30], group);
    const nested = element('nested', [20, 15, 20, 20], first);
    const result = inspect([first, overlapping, touching, nested]);
    assert.deepEqual(result.overlaps, [{ a: 'first', b: 'overlapping', width: 5, height: 30 }]);
    assert.deepEqual(result.touching, [{ a: 'overlapping', b: 'touching' }]);
});

test('interface geometry catches vertical label clipping even when width fits', () => {
    const result = inspect([element('wrapped-label', [10, 10, 120, 40], null, { scrollHeight: 58 })]);
    assert.equal(result.clipped[0].element, 'wrapped-label');
    assert.equal(result.clipped[0].scrollHeight, 58);
});

test('shared window edges and segmented borders are allowed, but intersections still fail', () => {
    for (const options of [{segments: true}, {titlebar: true}]) {
        const parent = element('group', [0, 0, 300, 100], null, options);
        const a = element('a', [0, 0, 40, 30], parent, options);
        const b = element('b', [40, 0, 40, 30], parent, options);
        assert.deepEqual(inspect([a, b]).touching, []);
        const intersecting = element('overlap', [35, 0, 40, 30], parent, options);
        assert.equal(inspect([a, intersecting]).overlaps.length, 1);
    }
});

test('controls clipped out by scrolling do not falsely overlap the visible footer', () => {
    const scroll = element('scroll', [0, 0, 250, 80], null, { style: { overflowY: 'auto' } });
    const out = element('outside', [10, 100, 100, 30], scroll);
    const footer = element('footer', [10, 100, 100, 30]);
    assert.equal(inspect([out, footer]).controls, 1);
    assert.deepEqual(inspect([out, footer]).overlaps, []);
});

test('pinned inspector tabs occlude scrolled content but real intersections below remain detectable', () => {
    const tabs = element('tabs', [0, 0, 250, 45], null, { style: { position: 'sticky' } });
    const panel = element('panel', [0, 0, 250, 180], null, { tabs, style: { overflowY: 'auto' } });
    const tab = element('tab', [10, 5, 100, 30], tabs);
    const behind = element('behind', [10, 5, 100, 30], panel);
    const first = element('first', [10, 80, 100, 30], panel);
    const second = element('second', [90, 80, 100, 30], panel);
    const result = inspect([tab, behind, first, second]);
    assert.equal(result.controls, 3);
    assert.deepEqual(result.overlaps, [{ a: 'first', b: 'second', width: 20, height: 30 }]);
});

test('a modal scopes inspection away from controls covered by its backdrop', () => {
    const action = element('dialog-action', [20, 50, 100, 30]);
    const dialog = element('dialog', [10, 10, 200, 150], null, { controls: [action] });
    const covered = element('covered-action', [20, 50, 100, 30]);
    assert.deepEqual(inspect([covered], { overlays: [dialog] }).overlaps, []);
    assert.equal(inspect([covered], { overlays: [dialog] }).controls, 1);
});

test('flat navigation rows are allowed to meet, while dialogs must stay inside the viewport', () => {
    const sidebar = element('sidebar', [0, 0, 120, 200], null, { sidebar: true });
    assert.deepEqual(inspect([element('a', [0, 0, 120, 40], sidebar), element('b', [0, 40, 120, 40], sidebar)]).touching, []);
    assert.deepEqual(inspect([], { overlays: [element('oversized-dialog', [10, 10, 320, 200])] }).dialogsOutside, ['oversized-dialog']);
});

test('overflow hidden by a panel and missing Minecraft icon masks remain detectable', () => {
    const panel = element('panel', [10, 10, 200, 50], null, { scrollWidth: 280 });
    const icon = element('icon', [20, 20, 16, 16]); icon.textContent = 'settings';
    const result = inspect([], { containers: [panel], theme: 'minecraft', icons: [icon] });
    assert.deepEqual(result.overflow, [{ element: 'panel', width: 200, scrollWidth: 280 }]);
    assert.deepEqual(result.pixelFallbacks, ['settings']);
    assert.deepEqual(inspect([], { icons: [icon] }).pixelFallbacks, []);
});
