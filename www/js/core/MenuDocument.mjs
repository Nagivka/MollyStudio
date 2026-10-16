import { createDeluxeConfig, validateDeluxeConfig, parseConfigYaml, stringifyConfigYaml, safeConfigCopy, menuSize, itemSlots, setItemSlots, indexDeluxeItemsBySlot, DELUXE_LIMITS } from './DeluxeMenuDocument.mjs';

export const MENU_PLUGINS = Object.freeze({ deluxemenus: 'DeluxeMenus', zmenu: 'zMenu' });
export function normalizeMenuPlugin(plugin = 'deluxemenus') {
    if (!Object.hasOwn(MENU_PLUGINS, plugin)) throw new Error('Выберите DeluxeMenus или zMenu.');
    return plugin;
}
export function createMenuConfig(plugin = 'deluxemenus') {
    return normalizeMenuPlugin(plugin) === 'zmenu' ? { name: '&8Главное меню', size: 54, items: {} } : createDeluxeConfig();
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const visualKeys = { material: 'material', display_name: 'name', lore: 'lore', amount: 'amount', model_data: 'model-id', enchantment_glint_override: 'enchantment-glint', hide_tooltip: 'hide-tooltip' };

// The view is transient. Files always contain the plugin's native configuration,
// including options unknown to the visual editor.
export function menuEditorView(config, plugin = 'deluxemenus') {
    if (normalizeMenuPlugin(plugin) === 'deluxemenus') return safeConfigCopy(config);
    const native = safeConfigCopy(config);
    const title=native.name??native.title??'';
    const view = { menu_title: Array.isArray(title)?title.join(''):title, inventory_type: native.type || 'CHEST', size: native.size ?? 54, items: {}, _native: native };
    const fill=native['fill-item']??native.fillItem;
    if(fill){view.fill_material=fill.material;view.fill_name=fill.name??'';}
    if (native['update-interval'] != null) view.update_interval = native['update-interval'];
    const matrixSlots = new Map();
    for (const [row, line] of (native.matrix || []).entries()) {
        for (const [column, id] of [...line].entries()) {
            if (id === ' ') continue;
            if (!matrixSlots.has(id)) matrixSlots.set(id, []);
            matrixSlots.get(id).push(row * 9 + column);
        }
    }
    for (const [id, button] of Object.entries(native.items || {})) {
        const visual = button.item || {};
        const item = { _native: button, material: visual.material || (visual['player-head'] || visual.playerHead || button['player-head'] ? 'PLAYER_HEAD' : 'BARRIER') };
        for (const [key, nativeKey] of Object.entries(visualKeys)) if (visual[nativeKey] != null) item[key] = visual[nativeKey];
        item.display_name ??= visual['display-name'] ?? visual.display_name;
        item.enchantment_glint_override ??= visual.glow;
        if (item.display_name === undefined) delete item.display_name;
        if (item.enchantment_glint_override === undefined) delete item.enchantment_glint_override;
        if (button.slot != null) item.slot = button.slot;
        else if (button.slots != null) item.slots = button.slots;
        else item.slots = matrixSlots.get(id) || [];
        if (button.update != null) item.update = button.update;
        view.items[id] = item;
    }
    return view;
}

export function menuConfigFromView(view, plugin = 'deluxemenus') {
    if (normalizeMenuPlugin(plugin) === 'deluxemenus') return validateDeluxeConfig(view);
    const output = safeConfigCopy(view._native || {});
    const oldTitle=output.name??output.title;
    if(view.menu_title!==(Array.isArray(oldTitle)?oldTitle.join(''):oldTitle)){output.name = view.menu_title;delete output.title;}
    output.type = view.inventory_type || 'CHEST';
    if (output.type === 'CHEST') output.size = view.size ?? 54; else delete output.size;
    if (view.update_interval == null) delete output['update-interval']; else output['update-interval'] = view.update_interval;
    const fill=output['fill-item']??output.fillItem;
    delete output.fillItem;
    if(view.fill_material)output['fill-item']={...(fill||{}),material:view.fill_material,name:view.fill_name||''};else delete output['fill-item'];
    // Once visually edited, explicit slots supersede the matrix. This keeps moves
    // and deletions from being reintroduced by the old matrix during reload.
    delete output.matrix;
    output.items = {};
    for (const [id, item] of Object.entries(view.items)) {
        const button = safeConfigCopy(item._native || { type: 'NONE' });
        const originalVisual = button.item || {};
        const visual = safeConfigCopy(originalVisual);
        for (const [key, nativeKey] of Object.entries(visualKeys)) {
            if (key === 'material' && !originalVisual.material && item._native && item.material === (originalVisual['player-head'] || originalVisual.playerHead || button['player-head'] ? 'PLAYER_HEAD' : 'BARRIER')) continue;
            if (item[key] == null) delete visual[nativeKey]; else visual[nativeKey] = item[key];
        }
        delete visual['display-name']; delete visual.display_name;
        if (Object.keys(visual).length) button.item = visual;
        if (item.update == null) delete button.update; else button.update = item.update;
        const slots = itemSlots(item, menuSize(view));
        delete button.slot; delete button.slots;
        if (slots.length) setItemSlots(button, slots);
        output.items[id] = button;
    }
    return validateMenuConfig(output, plugin);
}

export function validateMenuConfig(input, plugin = 'deluxemenus') {
    if (normalizeMenuPlugin(plugin) === 'deluxemenus') return validateDeluxeConfig(input);
    const config = safeConfigCopy(input);
    if (!object(config)) throw new Error('Нужна конфигурация одного меню zMenu.');
    const title=config.name??config.title;
    if (!(typeof title === 'string' && title.length<=4096) && !(Array.isArray(title)&&title.length<=32&&title.every(line=>typeof line==='string')&&title.join('').length<=4096)) throw new Error('zMenu: заголовок name/title должен содержать не более 4096 символов.');
    if (config.type === 'PLAYER' || config.type === 'CRAFTING') throw new Error('zMenu не поддерживает инвентари PLAYER и CRAFTING.');
    const size = menuSize({ inventory_type: config.type, size: config.size });
    if (!Number.isInteger(size) || size < 1 || size > 54 || ((!config.type || config.type === 'CHEST') && size % 9)) throw new Error('Размер меню: от 1 до 6 рядов по 9 слотов.');
    if (!object(config.items ?? {})) throw new Error('zMenu: items должен содержать кнопки меню.');
    config.items ??= {};
    const fill=config['fill-item']??config.fillItem;
    if(fill!=null&&(!object(fill)||typeof fill.material!=='string'||!fill.material.trim()||fill.material.length>512))throw new Error('Материал заполнения zMenu должен содержать material.');
    if (Object.keys(config.items).length > DELUXE_LIMITS.items) throw new Error('Допускается не более 512 кнопок.');
    if (config.matrix != null && (!Array.isArray(config.matrix) || config.matrix.length > 6 || config.matrix.some(row => typeof row !== 'string' || [...row].length !== 9) || config.matrix.length * 9 > size)) throw new Error('Матрица zMenu: не более 6 строк по 9 символов в пределах меню.');
    if (config['update-interval'] != null && (!Number.isInteger(config['update-interval']) || config['update-interval'] < 1 || config['update-interval'] > 2147483647)) throw new Error('Интервал обновления zMenu: целое число миллисекунд от 1 до 2147483647.');
    for (const [id,button] of Object.entries(config.items)) {
        if (!id.trim() || id.length > 128 || /[\r\n]/.test(id) || !object(button)) throw new Error(`Некорректный идентификатор кнопки: ${id}`);
        if (button.item != null && !object(button.item)) throw new Error(`${id}.item должен быть объектом.`);
    }
    const view = menuEditorView(config, plugin);
    for (const [id, button] of Object.entries(config.items)) {
        if (button.slot != null && button.slots != null) throw new Error(`${id}: используйте slot или slots.`);
        itemSlots(view.items[id], size);
        const visual = button.item || {};
        if(button['to-page']!=null&&(!Number.isInteger(button['to-page'])||button['to-page']<1||button['to-page']>2147483647))throw new Error(`${id}: страница перехода должна быть положительным целым числом.`);
        if (visual.material != null && (typeof visual.material !== 'string' || !visual.material.trim() || visual.material.length > 512)) throw new Error(`${id}: некорректный материал.`);
        const name = visual.name ?? visual['display-name'] ?? visual.display_name;
        if (name != null && (typeof name !== 'string' || name.length > 4096)) throw new Error(`${id}: некорректное название предмета.`);
        if (visual.lore != null && (!Array.isArray(visual.lore) || visual.lore.length > 256 || visual.lore.some(line => typeof line !== 'string' || line.length > 4096))) throw new Error(`${id}: описание должно быть списком строк.`);
        if (visual.amount != null && !(Number.isInteger(visual.amount) && visual.amount >= 1 && visual.amount <= 64) && !(typeof visual.amount === 'string' && /^%[^\s%]+%$/.test(visual.amount))) throw new Error(`${id}: количество от 1 до 64 или плейсхолдер %...%.`);
        for (const key of ['enchantment-glint', 'hide-tooltip']) if (visual[key] != null && typeof visual[key] !== 'boolean') throw new Error(`${id}.${key}: требуется true или false.`);
        if (button.actions != null && (!Array.isArray(button.actions) || button.actions.length > 256 || button.actions.some(action => !object(action) || typeof action.type !== 'string' || !action.type.trim()))) throw new Error(`${id}: действия должны быть списком объектов с полем type.`);
    }
    return config;
}

export function importMenuYaml(text, plugin) {
    const config = parseConfigYaml(text);
    const detected = plugin || (object(config) && typeof config.menu_title === 'string' ? 'deluxemenus' : 'zmenu');
    return { plugin: normalizeMenuPlugin(detected), config: validateMenuConfig(config, detected) };
}
export function exportMenuYaml(config, plugin = 'deluxemenus') { return stringifyConfigYaml(validateMenuConfig(config, plugin)); }
export function indexMenuItemsBySlot(view, plugin = 'deluxemenus', page = 1) {
    const index=indexDeluxeItemsBySlot(view);
    if(plugin!=='zmenu')return index;
    return index.map(entries=>entries.filter(([,item])=>{
        const button=item._native||{};
        if(button['is-permanent']||button.isPermanent)return true;
        const value=button.page??1;
        if(Number.isInteger(value))return value===page;
        const range=String(value).match(/^(\d+)-(\d+)$/);
        return range?page>=Number(range[1])&&page<=Number(range[2]):true;
    }));
}
export function resizeMenuView(view, plugin, type, size) {
    const next = safeConfigCopy(view);
    next.inventory_type = type;
    if (type === 'CHEST') next.size = Number(size); else delete next.size;
    const limit = menuSize(next);
    for (const [id, item] of Object.entries(view.items)) if (itemSlots(item, menuSize(view)).some(slot => slot >= limit)) throw new Error(`Кнопка «${id}» находится за новой границей. Сначала перенесите её.`);
    menuConfigFromView(next, plugin);
    return next;
}

export const ZMENU_BUTTON_TYPES = Object.freeze([['NONE','Обычная кнопка'],['INVENTORY','Открыть меню'],['BACK','Назад'],['HOME','Первое меню'],['NEXT','Следующая страница'],['PREVIOUS','Предыдущая страница'],['JUMP','Перейти на страницу'],['SWITCH','Условная кнопка']]);
export const ZMENU_ACTIONS = Object.freeze({
    'player-command': ['Команда игрока', { commands: ['spawn'] }],
    'console-command': ['Команда консоли', { commands: ['give %player% diamond 1'] }],
    message: ['Сообщение', { messages: ['&aПривет!'] }],
    inventory: ['Открыть меню', { inventory: 'main' }],
    close: ['Закрыть меню', {}], back: ['Назад', {}],
    'refresh-inventory': ['Обновить меню', {}],
    sound: ['Звук', { sound: 'UI_BUTTON_CLICK', volume: 1, pitch: 1 }]
});
