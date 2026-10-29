/** Local text coordinates remain independent of glyph size and frame reflow. */
export function textMatrix(data) {
    const angle = (Number(data.rotation) || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const sx = Math.max(Number.MIN_VALUE, Math.min(1000000, Number(data.scaleX) || 1)) * (data.flipX ? -1 : 1), sy = Math.max(Number.MIN_VALUE, Math.min(1000000, Number(data.scaleY) || 1)) * (data.flipY ? -1 : 1), k = Number(data.shearX) || 0;
    return { a: c * sx, b: s * sx, c: (c * k - s) * sy, d: (s * k + c) * sy };
}
export function textWorldPoint(data, point) {
    const m = textMatrix(data);
    return { x: (Number(data.x) || 0) + m.a * point.x + m.c * point.y, y: (Number(data.y) || 0) + m.b * point.x + m.d * point.y };
}
export function textLocalPoint(data, point) {
    const m = textMatrix(data), det = m.a * m.d - m.b * m.c, x = point.x - (Number(data.x) || 0), y = point.y - (Number(data.y) || 0);
    if (!Number.isFinite(det) || det === 0)
        throw new RangeError('Некорректное преобразование текста.');
    return { x: (m.d * x - m.c * y) / det, y: (m.a * y - m.b * x) / det };
}
/** Decompose a world resize/flip without losing shear on a rotated text frame. */
export function transformTextAxes(data, point) {
    const origin = point(data.x, data.y), axisX = textWorldPoint(data, { x: 1, y: 0 }), axisY = textWorldPoint(data, { x: 0, y: 1 });
    const u = point(axisX.x, axisX.y), v = point(axisY.x, axisY.y);
    const a = u.x - origin.x, b = u.y - origin.y, c = v.x - origin.x, d = v.y - origin.y, sx = Math.hypot(a, b), sy = (a * d - b * c) / sx;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx === 0 || sy === 0)
        throw new RangeError('Нельзя уменьшить текст до нулевого размера.');
    return { x: origin.x, y: origin.y, rotation: Math.atan2(b, a) * 180 / Math.PI, scaleX: sx, scaleY: Math.abs(sy),
        flipX: false, flipY: sy < 0, shearX: (a * c + b * d) / (sx * sy) };
}
