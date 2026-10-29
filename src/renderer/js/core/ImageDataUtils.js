export function imageDataEquals(first, second) {
    if (!first || !second || first.width !== second.width || first.height !== second.height) return false;
    const a = first.data;
    const b = second.data;
    if (!a || !b || a.length !== b.length) return false;
    if (a === b) return true;
    let start = 0;
    // ImageData stores RGBA bytes. Compare complete pixels without copying the
    // buffers; keep a byte path for ordinary arrays and unaligned views.
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b) && a.BYTES_PER_ELEMENT === 1 && b.BYTES_PER_ELEMENT === 1
        && a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
        const count = Math.floor(a.length / 4);
        const left = new Uint32Array(a.buffer, a.byteOffset, count), right = new Uint32Array(b.buffer, b.byteOffset, count);
        for (let i = 0; i < count; i++) if (left[i] !== right[i]) return false;
        start = count * 4;
    }
    for (let i = start; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
