export function imageDataEquals(first, second) {
    if (!first || !second || first.width !== second.width || first.height !== second.height) return false;
    const a = first.data;
    const b = second.data;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
