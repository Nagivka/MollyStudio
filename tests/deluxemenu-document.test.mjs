import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createDeluxeConfig, exportDeluxeYaml, importDeluxeYaml, parseConfigYaml,
    validateDeluxeConfig, itemSlots, setItemSlots, itemsAtSlot, indexDeluxeItemsBySlot, resizeDeluxeConfig,
    legacyTextRuns
} from '../www/js/core/DeluxeMenuDocument.mjs';
import { createProjectFromForm, normalizeProjectData, buildEditorUrl } from '../www/js/core/ProjectFactory.mjs';
import { validateProjectDocument } from '../www/js/core/ProjectValidation.mjs';

test('DeluxeMenus projects use the normal creation and editor URL contracts', () => {
    const project = createProjectFromForm({ getElementById: id => ({ value: id === 'new-deluxemenu-name' ? 'Warps' : '' }) }, 'deluxemenu');
    assert.equal(project.type, 'deluxemenu');
    assert.equal(project.name, 'Warps');
    assert.deepEqual(project.deluxeData, createDeluxeConfig());
    assert.equal(normalizeProjectData(project).deluxeData.menu_title, '&8Главное меню');
    const url = new URL(buildEditorUrl(project), 'https://local.test/');
    assert.equal(url.searchParams.get('type'), 'deluxemenu');
    assert.equal(url.searchParams.get('name'), 'Warps');
    assert.doesNotThrow(() => validateProjectDocument({ type: 'deluxemenu', deluxeData: project.deluxeData, config: { width: 256, height: 256 }, layers: [] }));
});

test('YAML round trips retain advanced requirements, arbitrary options, and click actions', () => {
    const config = createDeluxeConfig();
    config.menu_title = '&6Travel';
    config.open_command = ['warps', 'travel'];
    config.open_requirement = { requirements: [{ type: 'has permission', permission: 'server.travel' }], deny_commands: ['[message] &cNo access'] };
    config.items.teleport = {
        material: 'ENDER_PEARL', slot: 4, display_name: '&aSpawn', lore: ['&7Go home'], priority: 1,
        view_requirement: { requirements: [{ type: 'string equals', input: '%server_mode%', output: 'hub' }] },
        left_click_commands: ['[player] spawn', '[close]'], custom_model_data: { floats: [1.25] }
    };
    const serialized = exportDeluxeYaml(config);
    const imported = importDeluxeYaml(serialized);
    assert.deepEqual(imported, config);
    assert.equal(imported.items.teleport.custom_model_data.floats[0], 1.25);
});

test('slot ranges, selection, priorities, and removal preserve the slot model', () => {
    const config = createDeluxeConfig();
    config.items.border = { material: 'GRAY_STAINED_GLASS_PANE', slots: ['0-2', 9], priority: 2 };
    config.items.active = { material: 'PAPER', slot: 1, priority: 0 };
    assert.deepEqual(itemSlots(config.items.border, 54), [0, 1, 2, 9]);
    assert.deepEqual(itemsAtSlot(config, 1).map(([id]) => id), ['active', 'border']);
    assert.deepEqual(indexDeluxeItemsBySlot(config)[1].map(([id]) => id), ['active', 'border']);
    setItemSlots(config.items.border, [0, 9]);
    assert.deepEqual(config.items.border.slots, [0, 9]);
    assert.equal('slot' in config.items.border, false);
    assert.throws(() => itemSlots({ slots: ['52-55'] }, 54), /вне меню|Некорректный диапазон/);
    assert.throws(() => resizeDeluxeConfig(config, 'CHEST', 9), /Нельзя уменьшить меню/);
});

test('inventory changes validate the target inventory and retain fitting items', () => {
    const config = createDeluxeConfig();
    config.items.ingredient = { material: 'PAPER', slot: 4 };
    const hopper = resizeDeluxeConfig(config, 'HOPPER', 54);
    assert.equal(hopper.inventory_type, 'HOPPER');
    assert.equal(hopper.size, undefined);
    assert.equal(menuSlotCount(hopper), 5);
    assert.throws(() => resizeDeluxeConfig({ ...config, items: { late: { material: 'PAPER', slot: 8 } } }, 'HOPPER', 54), /Нельзя уменьшить меню/);
});

test('invalid YAML structures and oversized configurations fail safely', () => {
    assert.throws(() => parseConfigYaml('items: !!js/function >\n  x => x'), /unknown tag|tag/i);
    assert.throws(() => parseConfigYaml('items:\n  __proto__:\n    polluted: true'), /Недопустимый ключ/);
    assert.throws(() => parseConfigYaml('menu_title: "' + 'я'.repeat(600000) + '"'), /1 МБ/);
    const aliasExpansion = `menu_title: Menu\nsize: 54\nitems:\n  x:\n    material: PAPER\n    slot: 0\n    lore: [&label '${'x'.repeat(3000)}', ${Array(600).fill('*label').join(', ')}]`;
    assert.throws(() => parseConfigYaml(aliasExpansion), /1 МБ/);
    assert.throws(() => validateDeluxeConfig({ menu_title: 'Bad', size: 10, items: {} }), /Размер сундука/);
    assert.throws(() => validateDeluxeConfig({ menu_title: 'Bad', size: 54, items: { x: { material: 'PAPER', slot: 54 } } }), /вне меню/);
    assert.throws(() => validateDeluxeConfig({ menu_title: 'x'.repeat(4097), size: 54, items: {} }), /4096/);
    assert.throws(() => validateDeluxeConfig({ menu_title: 'Menu', size: 54, items: { x: { material: 'PAPER', slot: 0, lore: ['x'.repeat(4097)] } } }), /4096/);
});

test('legacy Minecraft formatting is rendered as safe text runs', () => {
    assert.deepEqual(legacyTextRuns('&aOK &lVIP &#12abef!'), [
        { text: 'OK ', color: '#55FF55' },
        { text: 'VIP ', color: '#55FF55', bold: true },
        { text: '!', color: '#12abef' }
    ]);
    assert.deepEqual(legacyTextRuns('<red>&cSafe'), [{ text: '<red>' }, { text: 'Safe', color: '#FF5555' }]);
});

function menuSlotCount(config) { return config.inventory_type === 'CHEST' ? config.size : ({ HOPPER: 5 }[config.inventory_type]); }
