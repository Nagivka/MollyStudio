/** Preserve the selected stop's identity when an earlier color is removed. */
export function removeColorStop(colors, index, activeIndex, minimum = 2) {
    if (!Number.isInteger(index) || index < 0 || index >= colors.length || colors.length <= minimum) return null;
    colors.splice(index, 1);
    const active = Number.isInteger(activeIndex) ? activeIndex : 0;
    return Math.max(0, Math.min(colors.length - 1, active > index ? active - 1 : active));
}
