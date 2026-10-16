/** Integer geometry shared by previews and committed objects. */
export function dragRectangle(x0, y0, x1, y1, event = {}) {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    let dx = Math.floor(x1) - x0, dy = Math.floor(y1) - y0;
    const limit = event?.altKey ? 2047 : 4095;
    dx = Math.sign(dx) * Math.min(limit, Math.abs(dx));
    dy = Math.sign(dy) * Math.min(limit, Math.abs(dy));
    if (event?.shiftKey) {
        const side = Math.max(Math.abs(dx), Math.abs(dy));
        dx = Math.sign(dx || 1) * side; dy = Math.sign(dy || 1) * side;
    }
    return event?.altKey
        ? { x0: x0 - dx, y0: y0 - dy, x1: x0 + dx, y1: y0 + dy }
        : { x0, y0, x1: x0 + dx, y1: y0 + dy };
}

/** Liang–Barsky clipping keeps a captured pointer far outside the canvas cheap. */
export function clipLine(x0, y0, x1, y1, width, height, margin = 0) {
    if (![x0, y0, x1, y1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    const dx = x1 - x0, dy = y1 - y0;
    let start = 0, end = 1;
    const p = [-dx, dx, -dy, dy], q = [x0 + margin, width - 1 + margin - x0, y0 + margin, height - 1 + margin - y0];
    for (let index = 0; index < 4; index++) {
        if (p[index] === 0) { if (q[index] < 0) return null; continue; }
        const ratio = q[index] / p[index];
        if (p[index] < 0) start = Math.max(start, ratio);
        else end = Math.min(end, ratio);
        if (start > end) return null;
    }
    return { x0: Math.round(x0 + start * dx), y0: Math.round(y0 + start * dy), x1: Math.round(x0 + end * dx), y1: Math.round(y0 + end * dy) };
}
