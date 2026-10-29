const LIMIT = 2048;
const fail = () => { throw new Error('Слишком сложная область выделения. Используйте меньший участок изображения.'); };
export const regionsOf = (selection) => selection ? (selection.regions || [{ x: selection.x, y: selection.y, width: selection.width, height: selection.height }]) : [];
const spatialCache = new WeakMap();
function indexRegions(rects) {
    if (!rects.length)
        return null;
    const centers = rects.map(r => r.y + r.height / 2).sort((a, b) => a - b), middle = centers[Math.floor(centers.length / 2)];
    const left = [], right = [], cross = [];
    for (const r of rects) {
        if (r.y + r.height <= middle)
            left.push(r);
        else if (r.y > middle)
            right.push(r);
        else
            cross.push(r);
    }
    return { middle, cross: cross.sort((a, b) => a.x - b.x), left: indexRegions(left), right: indexRegions(right) };
}
export function containsPixel(selection, x, y) {
    if (!selection || x < selection.x || y < selection.y || x >= selection.x + selection.width || y >= selection.y + selection.height)
        return false;
    if (!selection.regions)
        return true;
    if (!spatialCache.has(selection))
        spatialCache.set(selection, indexRegions(selection.regions));
    let node = spatialCache.get(selection);
    while (node) {
        let low = 0, high = node.cross.length - 1, candidate = -1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (node.cross[mid].x <= x) {
                candidate = mid;
                low = mid + 1;
            }
            else
                high = mid - 1;
        }
        const r = node.cross[candidate];
        if (r && x < r.x + r.width && y >= r.y && y < r.y + r.height)
            return true;
        node = y < node.middle ? node.left : node.right;
    }
    return false;
}
export function intersectRect(a, b) {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
function subtractRect(a, b) {
    const i = intersectRect(a, b);
    if (!i)
        return [a];
    return [{ x: a.x, y: a.y, width: a.width, height: i.y - a.y },
        { x: a.x, y: i.y + i.height, width: a.width, height: a.y + a.height - i.y - i.height },
        { x: a.x, y: i.y, width: i.x - a.x, height: i.height },
        { x: i.x + i.width, y: i.y, width: a.x + a.width - i.x - i.width, height: i.height }].filter(r => r.width > 0 && r.height > 0);
}
export function makeSelection(rects) {
    if (rects.some(r => r && ![r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite)))
        throw new RangeError('Некорректная область выделения.');
    rects = rects.filter(r => r && r.width > 0 && r.height > 0).map(r => ({ ...r }));
    if (!rects.length)
        return null;
    if (rects.length > LIMIT)
        fail();
    // Merge complete adjoining edges, keeping rectangular regions disjoint.
    for (const axis of ['x', 'y']) {
        const other = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'width' : 'height', otherSize = axis === 'x' ? 'height' : 'width';
        rects.sort((a, b) => a[other] - b[other] || a[otherSize] - b[otherSize] || a[axis] - b[axis]);
        const merged = [];
        for (const r of rects) {
            const last = merged.at(-1);
            if (last && last[other] === r[other] && last[otherSize] === r[otherSize] && last[axis] + last[size] === r[axis])
                last[size] += r[size];
            else
                merged.push(r);
        }
        rects = merged;
    }
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    const result = { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y };
    if (rects.length > 1)
        result.regions = rects;
    return result;
}
export function combineSelection(a, b, mode = 'replace') {
    if (mode === 'replace')
        return makeSelection(regionsOf(b));
    const left = regionsOf(a), right = regionsOf(b);
    let output = [], work = 0;
    if (mode === 'intersect') {
        for (const r of left)
            for (const s of right) {
                if (++work > 1000000)
                    fail();
                const i = intersectRect(r, s);
                if (i)
                    output.push(i);
            }
    }
    else if (mode === 'subtract' || mode === 'add') {
        let pieces = mode === 'add' ? right : left;
        const cuts = mode === 'add' ? left : right;
        for (const cut of cuts) {
            pieces = pieces.flatMap(r => {
                if (++work > 1000000)
                    fail();
                return subtractRect(r, cut);
            });
            if (pieces.length > LIMIT)
                fail();
        }
        output = mode === 'add' ? [...left, ...pieces] : pieces;
    }
    else
        throw new Error('Неизвестная операция выделения.');
    return makeSelection(output);
}
export function transformSelection(selection, next, { flipX = false, flipY = false } = {}) {
    if (!selection)
        return null;
    const sx = next.width / selection.width, sy = next.height / selection.height;
    const result = makeSelection(regionsOf(selection).map(r => {
        const x = Math.round(next.x + (flipX ? selection.width - (r.x - selection.x) - r.width : r.x - selection.x) * sx);
        const y = Math.round(next.y + (flipY ? selection.height - (r.y - selection.y) - r.height : r.y - selection.y) * sy);
        const right = Math.round(next.x + (flipX ? selection.width - (r.x - selection.x) : r.x - selection.x + r.width) * sx);
        const bottom = Math.round(next.y + (flipY ? selection.height - (r.y - selection.y) : r.y - selection.y + r.height) * sy);
        return { x, y, width: right - x, height: bottom - y };
    }));
    return selection.regions ? { ...next, regions: regionsOf(result) } : result;
}
export function maskPixels(image, x, y, selection) {
    if (!selection?.regions)
        return image;
    const output = new Uint8ClampedArray(image.data.length), box = { x, y, width: image.width, height: image.height };
    for (const r of regionsOf(selection)) {
        const i = intersectRect(r, box);
        if (!i)
            continue;
        for (let row = i.y; row < i.y + i.height; row++) {
            const start = ((row - y) * image.width + i.x - x) * 4;
            output.set(image.data.subarray(start, start + i.width * 4), start);
        }
    }
    image.data.set(output);
    return image;
}
export function rotateSelection(selection, degrees, next) {
    const angle = ((degrees % 360) + 360) % 360;
    const result = makeSelection(regionsOf(selection).map(r => {
        const x = r.x - selection.x, y = r.y - selection.y, w = r.width, h = r.height, W = selection.width, H = selection.height;
        const box = angle === 90 ? { x: H - y - h, y: x, width: h, height: w } : angle === 180 ? { x: W - x - w, y: H - y - h, width: w, height: h } : angle === 270 ? { x: y, y: W - x - w, width: h, height: w } : { x, y, width: w, height: h };
        return { ...box, x: box.x + next.x, y: box.y + next.y };
    }));
    return selection.regions ? { ...next, regions: regionsOf(result) } : result;
}
export function forSelectedPixels(image, x, y, selection, visit) {
    const bounds = { x, y, width: image.width, height: image.height };
    for (const r of regionsOf(selection)) {
        const part = intersectRect(r, bounds);
        if (!part)
            continue;
        for (let row = part.y; row < part.y + part.height; row++)
            for (let col = part.x; col < part.x + part.width; col++)
                visit(((row - y) * image.width + col - x) * 4);
    }
}
export function selectionFromAlpha(image, threshold = 1) {
    const rects = [];
    let previous = new Map();
    for (let y = 0; y < image.height; y++) {
        const current = new Map();
        let x = 0;
        while (x < image.width) {
            while (x < image.width && image.data[(y * image.width + x) * 4 + 3] < threshold)
                x++;
            const start = x;
            while (x < image.width && image.data[(y * image.width + x) * 4 + 3] >= threshold)
                x++;
            if (x === start)
                break;
            const key = `${start}:${x - start}`, r = previous.get(key);
            if (r) {
                r.height++;
                current.set(key, r);
            }
            else {
                const next = { x: start, y, width: x - start, height: 1 };
                rects.push(next);
                current.set(key, next);
                if (rects.length > LIMIT)
                    fail();
            }
        }
        previous = current;
    }
    return makeSelection(rects);
}
/** External contour segments; shared rectangle edges are never stroked. */
export function selectionEdges(selection) {
    const rects = regionsOf(selection), edges = [];
    for (const r of rects)
        for (const side of ['top', 'bottom', 'left', 'right']) {
            const horizontal = side === 'top' || side === 'bottom', axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
            const fixed = horizontal ? (side === 'top' ? r.y : r.y + r.height) : (side === 'left' ? r.x : r.x + r.width);
            let segments = [[r[axis], r[axis] + r[size]]];
            for (const n of rects) {
                if (n === r)
                    continue;
                const adjacent = horizontal ? (side === 'top' ? n.y + n.height : n.y) : (side === 'left' ? n.x + n.width : n.x);
                if (adjacent !== fixed)
                    continue;
                segments = segments.flatMap(([a, b]) => {
                    const left = Math.max(a, n[axis]), right = Math.min(b, n[axis] + n[size]);
                    return right <= left ? [[a, b]] : [[a, left], [right, b]].filter(([s, e]) => e > s);
                });
            }
            for (const [start, end] of segments)
                edges.push({ x: horizontal ? start : fixed, y: horizontal ? fixed : start, length: end - start, side });
        }
    return edges;
}
