import Tool from './Tool.js';

export default class BucketTool extends Tool {
    getEditableLayer(layer) {
        return super.getEditableLayer(layer, { name: 'Слой заливки' });
    }

    onPointerDown(x, y, color, size, layer) {
        const targetLayer = this.getEditableLayer(layer);
        if (!targetLayer) return;

        const startX = Math.floor(x);
        const startY = Math.floor(y);

        if (startX < 0 || startX >= targetLayer.width || startY < 0 || startY >= targetLayer.height) return;

        const beforeData = targetLayer.getImageData();
        const imgData = targetLayer.ctx.getImageData(0, 0, targetLayer.width, targetLayer.height);
        const u32 = new Uint32Array(imgData.data.buffer);
        const width = targetLayer.width;
        const height = targetLayer.height;

        const tolInput = document.getElementById('bucket-tol');
        const tolerance = Math.max(0, Math.min(255, tolInput ? parseInt(tolInput.value, 10) || 0 : 0));

        const contiguousInput = document.getElementById('bucket-contiguous');
        const contiguous = contiguousInput ? contiguousInput.checked : true;

        const startIndex = startY * width + startX;
        const target32 = u32[startIndex];
        const fill32 = this.hexToUint32(color);
        if (fill32 === null) return;
        const alphaLocked = Boolean(targetLayer.alphaLocked);
        if (alphaLocked && ((target32 >>> 24) & 255) === 0) return;

        if (tolerance === 0 && target32 === fill32) return;

        const dither = this.getDitherMode();
        let changed = false;

        if (!contiguous) {
            changed = this.fillGlobal(u32, width, target32, fill32, tolerance, dither, alphaLocked);
        } else {
            const symmX = !!this.toolManager?.symmetryX;
            const symmY = !!this.toolManager?.symmetryY;

            const points = [{ x: startX, y: startY }];
            if (symmX) points.push({ x: (width - 1) - startX, y: startY });
            if (symmY) points.push({ x: startX, y: (height - 1) - startY });
            if (symmX && symmY) points.push({ x: (width - 1) - startX, y: (height - 1) - startY });

            const seen = new Set();
            for (const pt of points) {
                if (pt.x >= 0 && pt.x < width && pt.y >= 0 && pt.y < height) {
                    const key = `${pt.x},${pt.y}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        const idx = pt.y * width + pt.x;
                        if (this.colorMatch(u32[idx], target32, tolerance)) {
                            changed = this.floodFill(u32, pt.x, pt.y, width, height, target32, fill32, tolerance, dither, alphaLocked) || changed;
                        }
                    }
                }
            }
        }

        if (!changed) return;

        targetLayer.ctx.putImageData(imgData, 0, 0);
        this.commitRasterEdit(targetLayer, beforeData, 'Заливка', 'format_color_fill');

        this.bus.emit('CANVAS_UPDATED');
    }

    getDitherMode() {
        return document.getElementById('bucket-dither')?.value || 'none';
    }

    shouldDrawDither(x, y, mode) {
        if (!mode || mode === 'none') return true;
        const modX = ((x % 4) + 4) % 4;
        const modY = ((y % 4) + 4) % 4;
        if (mode === 'checker') {
            return (((x + y) % 2) + 2) % 2 === 0;
        }
        const bayer = [
            [ 0,  8,  2, 10],
            [12,  4, 14,  6],
            [ 3, 11,  1,  9],
            [15,  7, 13,  5]
        ];
        if (mode === 'bayer25') {
            return bayer[modY][modX] < 4;
        }
        if (mode === 'bayer75') {
            return bayer[modY][modX] < 12;
        }
        return true;
    }

    hexToUint32(hex) {
        let c = String(hex ?? '').trim().replace(/^#/, '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(c)) return null;
        const num = Number.parseInt(c, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        const a = c.length === 8 ? num & 255 : 255;
        const red = c.length === 8 ? (num >>> 24) & 255 : r;
        const green = c.length === 8 ? (num >>> 16) & 255 : g;
        const blue = c.length === 8 ? (num >>> 8) & 255 : b;
        // Little-endian RGBA: A(24-31) B(16-23) G(8-15) R(0-7)
        return (((a << 24) | (blue << 16) | (green << 8) | red) >>> 0);
    }

    colorMatch(c1, c2, tol) {
        if (c1 === c2) return true;
        if (tol === 0) return false;

        const r1 = c1 & 255;
        const g1 = (c1 >> 8) & 255;
        const b1 = (c1 >> 16) & 255;
        const a1 = (c1 >> 24) & 255;

        const r2 = c2 & 255;
        const g2 = (c2 >> 8) & 255;
        const b2 = (c2 >> 16) & 255;
        const a2 = (c2 >> 24) & 255;

        return Math.abs(r1 - r2) <= tol &&
               Math.abs(g1 - g2) <= tol &&
               Math.abs(b1 - b2) <= tol &&
               Math.abs(a1 - a2) <= tol;
    }

    fillGlobal(u32, width, target32, fill32, tolerance, dither = 'none', alphaLocked = false) {
        const len = u32.length;
        let changed = false;
        for (let i = 0; i < len; i++) {
            if (this.colorMatch(u32[i], target32, tolerance)) {
                const alpha = (u32[i] >>> 24) & 255;
                if (alphaLocked && alpha === 0) continue;
                const px = i % width;
                const py = Math.floor(i / width);
                if (this.shouldDrawDither(px, py, dither)) {
                    const next = alphaLocked ? (((fill32 & 0x00ffffff) | (u32[i] & 0xff000000)) >>> 0) : fill32;
                    if (next !== u32[i]) {
                        u32[i] = next;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    floodFill(u32, startX, startY, width, height, target32, fill32, tolerance, dither = 'none', alphaLocked = false) {
        const totalPixels = width * height;
        const visited = new Uint8Array(totalPixels);
        const stack = new Int32Array(totalPixels);
        let stackPtr = 0;
        let changed = false;
        const isTiling = Boolean(globalThis.window?.mollyEditor?.workspace?.tilingMode);
        const startIndex = startY * width + startX;
        visited[startIndex] = 1;
        stack[stackPtr++] = startIndex;

        const enqueue = index => {
            if (visited[index]) return;
            visited[index] = 1;
            stack[stackPtr++] = index;
        };

        while (stackPtr > 0) {
            const idx = stack[--stackPtr];
            const cx = idx % width;
            const cy = Math.floor(idx / width);

            if (!this.colorMatch(u32[idx], target32, tolerance)) continue;
            const alpha = (u32[idx] >>> 24) & 255;
            if (alphaLocked && alpha === 0) continue;

            if (this.shouldDrawDither(cx, cy, dither)) {
                const next = alphaLocked ? (((fill32 & 0x00ffffff) | (u32[idx] & 0xff000000)) >>> 0) : fill32;
                if (next !== u32[idx]) {
                    u32[idx] = next;
                    changed = true;
                }
            }

            if (isTiling) {
                const right = (cx + 1) % width;
                const left = (cx - 1 + width) % width;
                const down = (cy + 1) % height;
                const up = (cy - 1 + height) % height;

                enqueue(cy * width + right);
                enqueue(cy * width + left);
                enqueue(down * width + cx);
                enqueue(up * width + cx);
            } else {
                if (cx + 1 < width) enqueue(idx + 1);
                if (cx > 0) enqueue(idx - 1);
                if (cy + 1 < height) enqueue(idx + width);
                if (cy > 0) enqueue(idx - width);
            }
        }
        return changed;
    }
}
