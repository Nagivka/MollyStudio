import { safeFileStem } from './FileNames.mjs';
export { safeFileStem };
export function uniqueExportNames(values, { prefix = '', numbered = false } = {}) {
    const used = new Set();
    return values.map((value, index) => {
        const original = safeFileStem(`${prefix}${numbered ? String(index + 1).padStart(3, '0') + '_' : ''}${value}`);
        let name = original, suffix = 1;
        while (used.has(name.toLowerCase()))
            name = Array.from(original).slice(0, 88).join('') + '_' + (++suffix);
        used.add(name.toLowerCase());
        return name + '.png';
    });
}
export function parsePrefixList(value) {
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length)
        throw Error('Введите названия префиксов — по одному в строке.');
    if (lines.length > 200)
        throw Error('За один раз можно экспортировать не более 200 префиксов.');
    if (lines.some(line => line.length > 64))
        throw Error('Название префикса не должно превышать 64 символа.');
    return lines;
}
export function planSpriteSheet(items, { columns = 4, gap = 1 } = {}) {
    if (!items.length)
        throw Error('Нет изображений для спрайт-листа.');
    if (items.some(item => !Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height) || item.width < 1 || item.height < 1))
        throw Error('Некорректные размеры изображений для спрайт-листа.');
    columns = Math.min(items.length, Math.max(1, Math.min(32, Math.round(Number(columns) || 1))));
    gap = Math.max(0, Math.min(64, Math.round(Number(gap) || 0)));
    const cellWidth = Math.max(...items.map(i => i.width)), cellHeight = Math.max(...items.map(i => i.height)), rows = Math.ceil(items.length / columns);
    const width = columns * cellWidth + (columns - 1) * gap, height = rows * cellHeight + (rows - 1) * gap;
    if (width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024)
        throw Error('Спрайт-лист слишком велик. Уменьшите масштаб или число элементов.');
    return { width, height, cellWidth, cellHeight, columns, rows, gap, frames: items.map((item, index) => ({ x: index % columns * (cellWidth + gap), y: Math.floor(index / columns) * (cellHeight + gap), width: item.width, height: item.height })) };
}
