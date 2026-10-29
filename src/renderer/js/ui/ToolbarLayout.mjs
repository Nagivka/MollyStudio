/** A single column, with readable targets and an overflow button on short windows. */
export function toolbarLayout(height, count, preferredSize = 34, minimumSize = 28) {
    const available = Math.max(0, Number(height) || 0) - 160; // colors, padding and group gap
    const total = Math.max(0, Math.floor(Number(count) || 0));
    const minimum = Math.max(24, Number(minimumSize) || 28);
    const preferred = Math.max(minimum, Math.min(38, Math.floor(Number(preferredSize) || 34)));
    for (let size = preferred; size >= minimum; size -= 2) {
        for (const gap of [4, 2]) {
            if (total * size + Math.max(0, total - 1) * gap <= available) return { size, gap, visible: total, overflow: false };
        }
    }
    const visible = Math.min(total, Math.max(0, Math.floor((available - minimum - 8 + 2) / (minimum + 2))));
    return { size: minimum, gap: 2, visible, overflow: visible < total };
}

export function visibleToolIndices(count, capacity, activeIndex = -1) {
    const indices = Array.from({ length: Math.min(count, capacity) }, (_, index) => index);
    if (indices.length && activeIndex >= indices.length && activeIndex < count) indices[indices.length - 1] = activeIndex;
    return new Set(indices);
}
