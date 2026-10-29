import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import MenuBar from '../../src/renderer/js/ui/MenuBar.js';
import {ACTION_ICONS} from '../../src/renderer/js/ui/ActionIcons.mjs';
import {minecraftIcon} from '../../src/renderer/js/ui/MinecraftIcons.mjs';
import {SHORTCUT_COMMANDS} from '../../src/renderer/js/core/Shortcuts.mjs';

for (const [action, expected] of [['image-load-ref', 'load'], ['image-clear-ref', 'clear'], ['layer-dropshadow', 'shadow']]) {
    test(`the visible ${action} menu item invokes its actual editor operation`, t => {
        const previous = globalThis.document, calls = [];
        globalThis.document = {getElementById(id) { return id === 'input-ref-file' ? {click: () => calls.push('load')} : null; }};
        t.after(() => { globalThis.document = previous; });
        const menu = Object.assign(Object.create(MenuBar.prototype), {app: {
            workspace: {clearReferenceImage: () => calls.push('clear')},
            layerManager: {createDropShadow: () => calls.push('shadow')}
        }});
        menu.handleAction(action); assert.deepEqual(calls, [expected]);
    });
}

test('every static editor menu action has a dispatch branch', async () => {
    const html = await readFile(new URL('../../src/renderer/editor.html', import.meta.url), 'utf8');
    const source = await readFile(new URL('../../src/renderer/js/ui/MenuBar.js', import.meta.url), 'utf8');
    const actions = [...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]);
    const branches = new Set([...source.matchAll(/case\s+'([^']+)'|action\s*===\s*'([^']+)'/g)].map(match => match[1] || match[2]));
    assert.deepEqual(actions.filter(action => !action.startsWith('utility-') && !branches.has(action)), []);
    assert.deepEqual(actions.filter(action => !ACTION_ICONS[action]), []);
    assert.deepEqual([...new Set(Object.values(ACTION_ICONS))].filter(icon => !minecraftIcon(icon)), []);
});

test('reference loading has a registered shortcut instead of falling through to browser reload', () => {
    assert.deepEqual(SHORTCUT_COMMANDS.find(command => command.id === 'image-load-ref')?.keys, ['Ctrl+Shift+KeyR']);
});
