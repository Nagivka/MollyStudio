/** Geometry uses document pixels; interaction thresholds use screen pixels. */
export function boundsOf(boxes) {
    if (!boxes.length)
        return null;
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
}
export function resizeAtAnchor(box, w, h, anchor = { x: 0, y: 0 }) {
    if (!box || ![box.x, box.y, box.w, box.h, w, h, anchor.x, anchor.y].every(Number.isFinite) || w <= 0 || h <= 0)
        return null;
    const shift = (value) => Math.sign(value) * Math.round(Math.abs(value));
    return { x: Math.round(box.x) + shift((box.w - w) * anchor.x), y: Math.round(box.y) + shift((box.h - h) * anchor.y), w, h };
}
export function alignmentOffsets(boxes, type, reference) {
    const axis = ['left', 'center-h', 'right'].includes(type) ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h', fraction = type.startsWith('center') ? .5 : ['right', 'bottom'].includes(type) ? 1 : 0;
    return boxes.map(box => ({ dx: axis === 'x' ? Math.round(reference.x + reference[size] * fraction - box.x - box[size] * fraction) : 0, dy: axis === 'y' ? Math.round(reference.y + reference[size] * fraction - box.y - box[size] * fraction) : 0 }));
}
export function distributionOffsets(boxes, axis = 'x') {
    if (boxes.length < 3)
        return boxes.map(() => ({ dx: 0, dy: 0 }));
    const size = axis === 'x' ? 'w' : 'h', order = boxes.map((box, index) => ({ box, index })).sort((a, b) => a.box[axis] - b.box[axis] || a.index - b.index), first = order[0].box, last = order[order.length - 1].box;
    const gap = (last[axis] + last[size] - first[axis] - boxes.reduce((sum, b) => sum + b[size], 0)) / (boxes.length - 1), result = boxes.map(() => ({ dx: 0, dy: 0 }));
    let position = first[axis];
    for (const { box, index } of order) {
        result[index][axis === 'x' ? 'dx' : 'dy'] = Math.round(position) - box[axis];
        position += box[size] + gap;
    }
    return result;
}
