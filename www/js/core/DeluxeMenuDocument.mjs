import { load, dump, CORE_SCHEMA } from '../vendor/js-yaml.mjs';

export const DELUXE_LIMITS = Object.freeze({ bytes: 1024 * 1024, items: 512, nodes: 40000, depth: 24 });
export const INVENTORIES = Object.freeze({
    CHEST: { name: 'Сундук', size: 54, columns: 9 },
    HOPPER: { name: 'Воронка', size: 5, columns: 5 },
    DISPENSER: { name: 'Раздатчик', size: 9, columns: 3 },
    DROPPER: { name: 'Выбрасыватель', size: 9, columns: 3 },
    BARREL: { name: 'Бочка', size: 27, columns: 9 },
    ENDER_CHEST: { name: 'Эндер-сундук', size: 27, columns: 9 },
    SHULKER_BOX: { name: 'Шалкеровый ящик', size: 27, columns: 9 },
    FURNACE: { name: 'Печь', size: 3, columns: 3 },
    BLAST_FURNACE: { name: 'Плавильная печь', size: 3, columns: 3 },
    SMOKER: { name: 'Коптильня', size: 3, columns: 3 },
    BREWING: { name: 'Зельеварка', size: 5, columns: 5 },
    ANVIL: { name: 'Наковальня', size: 3, columns: 3 },
    WORKBENCH: { name: 'Верстак', size: 10, columns: 5 },
    BEACON: { name: 'Маяк', size: 1, columns: 1 },
    ENCHANTING: { name: 'Стол зачарований', size: 2, columns: 2 },
    CARTOGRAPHY: { name: 'Стол картографа', size: 3, columns: 3 },
    GRINDSTONE: { name: 'Точило', size: 3, columns: 3 },
    LOOM: { name: 'Ткацкий станок', size: 4, columns: 4 },
    LECTERN: { name: 'Кафедра', size: 1, columns: 1 },
    STONECUTTER: { name: 'Камнерез', size: 2, columns: 2 },
    SMITHING: { name: 'Кузнечный стол', size: 4, columns: 4 },
    PLAYER: { name: 'Инвентарь игрока', size: 41, columns: 9 }
});
export const CLICK_TYPES = Object.freeze([
    ['click_commands', 'Любой клик'], ['left_click_commands', 'Левый клик'], ['right_click_commands', 'Правый клик'],
    ['shift_left_click_commands', 'Shift + левый'], ['shift_right_click_commands', 'Shift + правый'], ['middle_click_commands', 'Средний (до 1.18)']
]);
export const ACTION_TYPES = Object.freeze(['player','console','message','minimessage','openguimenu','close','refresh','sound','broadcast','connect','takemoney','givemoney','takeexp','giveexp']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function estimateSerializedStringBytes(value) {
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; continue; }
        }
        if (code < 0x20 || code === 0x7f) bytes += 6;
        else if (code === 0x27 || code === 0x5c) bytes += 2;
        else if (code < 0x80) bytes++;
        else if (code < 0x800) bytes += 2;
        else bytes += 3;
    }
    return bytes;
}

export function safeConfigCopy(value) {
    let nodes = 0;
    // Bound the expanded object too: YAML aliases can make a tiny input expand
    // into a much larger recovered project or export.
    let estimatedBytes = 2;
    const addBytes = amount => {
        estimatedBytes += amount;
        if (estimatedBytes > DELUXE_LIMITS.bytes) throw new Error('Конфигурация меню должна быть не больше 1 МБ.');
    };
    const ancestors = new Set();
    const visit = (item, depth) => {
        if (++nodes > DELUXE_LIMITS.nodes || depth > DELUXE_LIMITS.depth) throw new Error('Конфигурация слишком большая или глубоко вложенная.');
        if (item == null || typeof item === 'boolean') { addBytes(8); return item; }
        if (typeof item === 'number' && Number.isFinite(item)) { addBytes(24); return item; }
        if (typeof item === 'string' && item.length <= 65536) { addBytes(estimateSerializedStringBytes(item) + 4); return item; }
        if (typeof item !== 'object' || ancestors.has(item)) throw new Error('Недопустимое значение или циклическая ссылка YAML.');
        ancestors.add(item);
        let copy;
        if (Array.isArray(item)) {
            addBytes(2 + item.length);
            copy = item.map(child => visit(child, depth + 1));
        }
        else {
            if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('Недопустимый объект YAML.');
            copy = {};
            for (const [key, child] of Object.entries(item)) {
                if (forbidden.has(key)) throw new Error(`Недопустимый ключ: ${key}`);
                addBytes(estimateSerializedStringBytes(key) + 6);
                copy[key] = visit(child, depth + 1);
            }
        }
        ancestors.delete(item);
        return copy;
    };
    return visit(value, 0);
}

export function parseConfigYaml(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > DELUXE_LIMITS.bytes) throw new Error('YAML должен быть не больше 1 МБ.');
    return safeConfigCopy(load(text, { schema: CORE_SCHEMA, json: false }));
}

export function menuSize(config) {
    const type = config.inventory_type || 'CHEST';
    if (!Object.hasOwn(INVENTORIES, type)) throw new Error(`Не поддерживается тип инвентаря: ${type}`);
    return type === 'CHEST' ? config.size ?? 54 : INVENTORIES[type].size;
}

export function itemSlots(item, size = 54) {
    const values = item.slots ?? (item.slot != null ? [item.slot] : []);
    if (!Array.isArray(values)) throw new Error('slots должен быть списком номеров или диапазонов.');
    if (values.length > 54) throw new Error('Слишком много слотов у предмета.');
    const result = new Set();
    const add = value => {
        if (!Number.isInteger(value) || value < 0 || value >= size) throw new Error(`Слот ${value} вне меню: допустимо 0–${size - 1}.`);
        result.add(value);
    };
    for (const value of values) {
        if (typeof value === 'number') add(value);
        else if (/^\d+$/.test(String(value))) add(Number(value));
        else if (typeof value === 'string' && /^\d+-\d+$/.test(value)) {
            const [from, to] = value.split('-').map(Number);
            if (from > to || to >= size) throw new Error(`Некорректный диапазон слотов: ${value}`);
            for (let index = from; index <= to; index++) add(index);
        } else throw new Error(`Некорректный слот: ${String(value)}`);
    }
    return [...result].sort((a,b) => a-b);
}

export function setItemSlots(item, slots) {
    delete item.slot; delete item.slots;
    const unique = [...new Set(slots)].sort((a,b)=>a-b);
    if (unique.length === 1) item.slot = unique[0];
    else item.slots = unique;
}

function stringList(value, label, maxLength = 4096) {
    if (!Array.isArray(value) || value.length > 256 || value.some(item => typeof item !== 'string' || item.length > maxLength)) {
        throw new Error(`${label}: нужен список не более чем из 256 строк длиной до ${maxLength} символов.`);
    }
}

export function validateDeluxeConfig(input) {
    const config = safeConfigCopy(input);
    if (!plain(config)) throw new Error('Нужна конфигурация одного меню DeluxeMenus.');
    if (typeof config.menu_title !== 'string' || config.menu_title.length > 4096) throw new Error('menu_title должен быть строкой длиной до 4096 символов.');
    const size = menuSize(config);
    if (!Number.isInteger(size) || size < 1 || size > 54 || ((config.inventory_type || 'CHEST') === 'CHEST' && size % 9 !== 0)) throw new Error('Размер сундука: 9, 18, 27, 36, 45 или 54.');
    if (!plain(config.items ?? {})) throw new Error('items должен быть объектом с именами предметов.');
    config.items ??= {};
    if (Object.keys(config.items).length > DELUXE_LIMITS.items) throw new Error('В меню допускается не более 512 определений предметов.');
    if (config.open_command != null) {
        const commands = Array.isArray(config.open_command) ? config.open_command : [config.open_command];
        if (commands.some(command => typeof command !== 'string' || !command || /[\s/]/u.test(command))) throw new Error('Команды открытия: по одному слову, без / и пробелов.');
    }
    for (const key of ['open_commands','close_commands']) if (config[key] != null) stringList(config[key], key);
    if (config.update_interval != null && (!Number.isInteger(config.update_interval) || config.update_interval < 1 || config.update_interval > 2147483647)) throw new Error('update_interval должен быть целым числом от 1 до 2147483647 секунд.');
    for (const [id, item] of Object.entries(config.items)) {
        if (!id.trim() || id.length > 128 || /[\r\n]/.test(id) || !plain(item)) throw new Error(`Некорректное определение предмета: ${id}`);
        if (typeof item.material !== 'string' || !item.material.trim() || item.material.length > 512) throw new Error(`У предмета ${id} отсутствует material или его ID длиннее 512 символов.`);
        if (item.slot != null && item.slots != null) throw new Error(`У ${id} одновременно указаны slot и slots.`);
        if (!itemSlots(item, size).length) throw new Error(`У предмета ${id} не заданы слоты.`);
        for (const [key,min,max] of [['amount',1,64],['priority',0,2147483647],['model_data',0,2147483647]]) {
            if (item[key] != null && (!Number.isInteger(item[key]) || item[key] < min || item[key] > max)) throw new Error(`${id}.${key}: целое число ${min}–${max}.`);
        }
        if (item.display_name != null && (typeof item.display_name !== 'string' || item.display_name.length > 4096)) throw new Error(`${id}.display_name должен быть строкой длиной до 4096 символов.`);
        for (const key of ['lore', ...CLICK_TYPES.map(([key])=>key)]) if (item[key] != null) stringList(item[key], `${id}.${key}`);
    }
    return config;
}

export function importDeluxeYaml(text) { return validateDeluxeConfig(parseConfigYaml(text)); }
export function stringifyConfigYaml(value) {
    const output = dump(safeConfigCopy(value), { schema: CORE_SCHEMA, noRefs: true, lineWidth: -1, quotingType: "'", forceQuotes: true, noCompatMode: false });
    if (new TextEncoder().encode(output).length > DELUXE_LIMITS.bytes) throw new Error('Экспортированный YAML должен быть не больше 1 МБ.');
    return output;
}
export function exportDeluxeYaml(config) {
    return stringifyConfigYaml(validateDeluxeConfig(config));
}
export function createDeluxeConfig() { return { menu_title: '&8Главное меню', size: 54, open_command: ['menu'], items: {} }; }
export function uniqueItemId(config, base = 'item') {
    base = String(base).replace(/[^\w-]/g, '_').slice(0,100) || 'item';
    let id = base, index = 2;
    while (Object.hasOwn(config.items,id) || forbidden.has(id)) id = `${base}_${index++}`;
    return id;
}
export function itemsAtSlot(config, slot) {
    return Object.entries(config.items).filter(([,item])=>itemSlots(item,menuSize(config)).includes(slot))
        .sort((a,b)=>(a[1].priority ?? 2147483647)-(b[1].priority ?? 2147483647));
}
export function indexDeluxeItemsBySlot(config) {
    const index = Array.from({ length: menuSize(config) }, () => []);
    for (const entry of Object.entries(config.items)) {
        for (const slot of itemSlots(entry[1], index.length)) index[slot].push(entry);
    }
    for (const entries of index) entries.sort((a,b)=>(a[1].priority ?? 2147483647)-(b[1].priority ?? 2147483647));
    return index;
}
export function resizeDeluxeConfig(config, type, size) {
    const copy = safeConfigCopy(config); copy.inventory_type = type;
    if (type === 'CHEST') copy.size = Number(size); else delete copy.size;
    const nextSize = menuSize(copy);
    for (const [id,item] of Object.entries(config.items)) {
        if (itemSlots(item,menuSize(config)).some(slot=>slot>=nextSize)) throw new Error(`Нельзя уменьшить меню: предмет «${id}» находится за новой границей. Сначала перенесите или удалите его.`);
    }
    return validateDeluxeConfig(copy);
}

// A literal preview of Minecraft legacy formatting; no placeholder evaluation or HTML parsing.
const PALETTE = ['#000000','#0000AA','#00AA00','#00AAAA','#AA0000','#AA00AA','#FFAA00','#AAAAAA','#555555','#5555FF','#55FF55','#55FFFF','#FF5555','#FF55FF','#FFFF55','#FFFFFF'];
export function legacyTextRuns(text) {
    const runs = [];
    let style = {}, buffer = '';
    const flush = () => { if(buffer) runs.push({text:buffer,...style}); buffer=''; };
    const input = String(text ?? '');
    for(let index=0;index<input.length;) {
        const rest=input.slice(index);
        const hex=rest.match(/^(?:[&§]#([0-9a-f]{6})|[&§]x((?:[&§][0-9a-f]){6}))/i);
        if(hex) { flush(); style={color:'#'+(hex[1]||hex[2].replace(/[&§]/g,''))}; index+=hex[0].length; continue; }
        const code=rest.match(/^[&§]([0-9a-fl-or])/i);
        if(code) {
            flush();const key=code[1].toLowerCase();
            if(/[0-9a-f]/.test(key))style={color:PALETTE[parseInt(key,16)]};
            else if(key==='r')style={};else style[{l:'bold',o:'italic',n:'underlined',m:'strikethrough'}[key]]=true;
            index+=2;continue;
        }
        buffer+=input[index++];
    }
    flush();return runs;
}
