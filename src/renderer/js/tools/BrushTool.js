import Tool from './Tool.js';
import { clipLine, wrapLine } from './ToolGeometry.js';

/**
 * BrushTool - High precision pixel brush with blending modes,
 * alpha lock, and smooth Bresenham stroke interpolation.
 */
export default class BrushTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isDrawing = false;
        this.lastX = null;
        this.lastY = null;
        this.beforeData = null;
        this.targetLayer = null;
    }

    getBlendMode() {
        const sel = document.getElementById('brush-mode');
        const mode = sel ? sel.value : 'normal';
        return mode === 'normal' ? 'source-over' : mode;
    }

    getEditableLayer(layer) {
        return super.getEditableLayer(layer, { name: 'Слой рисования' });
    }

    onPointerDown(x, y, color, size, layer) {
        const target = this.getEditableLayer(layer);
        if (!target) return;

        this.targetLayer = target;
        this.isDrawing = true;
        this.beforeData = target.getImageData();
        this.lastX = Math.floor(x);
        this.lastY = Math.floor(y);

        const blend = this.getBlendMode();
        this.withSelection(target.ctx, () => {
            target.ctx.globalCompositeOperation = target.alphaLocked ? 'source-atop' : blend;
            this.drawSymmetricStamp(target.ctx, this.lastX, this.lastY, color, size, target.width, target.height);
        });

        this.targetLayer?.invalidateSource?.(false);
        this.bus.emit('CANVAS_UPDATED');
    }

    onPointerMove(x, y, color, size, layer) {
        if (!this.isDrawing || !this.targetLayer || this.targetLayer.locked || !this.targetLayer.visible || this.layerManager.isEditable?.(this.targetLayer) === false) return;

        const currentX = Math.floor(x);
        const currentY = Math.floor(y);

        if (currentX === this.lastX && currentY === this.lastY) return;

        const blend = this.getBlendMode();
        this.withSelection(this.targetLayer.ctx, () => {
            this.targetLayer.ctx.globalCompositeOperation = this.targetLayer.alphaLocked ? 'source-atop' : blend;
            this.drawLine(this.targetLayer.ctx, this.lastX, this.lastY, currentX, currentY, color, size, this.targetLayer.width, this.targetLayer.height);
        });

        this.lastX = currentX;
        this.lastY = currentY;
        this.targetLayer?.invalidateSource?.(false);
        this.bus.emit('CANVAS_UPDATED');
    }

    onPointerUp(x, y, color, size, layer) {
        if (!this.isDrawing) return;
        if (Number.isFinite(x) && Number.isFinite(y)) this.onPointerMove(x, y, color, size, layer);
        this.isDrawing = false;

        if (this.targetLayer && this.beforeData) {
            this.commitRasterEdit(this.targetLayer, this.beforeData);
            this.beforeData = null;
        }
        this.targetLayer = null;
        this.lastX = null;
        this.lastY = null;
        this.bus.emit('CANVAS_UPDATED');
    }

    getSymmetryPoints(px, py, size, w, h) {
        const symmX = !!this.toolManager?.symmetryX;
        const symmY = !!this.toolManager?.symmetryY;
        if (!symmX && !symmY) return [{ x: px, y: py }];

        const s = Math.max(1, Math.floor(size) || 1);
        const offset = Math.floor(s / 2);
        const rx = px - offset;
        const ry = py - offset;

        const points = [{ rx, ry }];

        if (symmX) points.push({ rx: (w - s) - rx, ry });
        if (symmY) points.push({ rx, ry: (h - s) - ry });
        if (symmX && symmY) points.push({ rx: (w - s) - rx, ry: (h - s) - ry });

        const unique = [];
        const seen = new Set();
        for (const p of points) {
            const key = `${p.rx},${p.ry}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push({ x: p.rx + offset, y: p.ry + offset, rx: p.rx, ry: p.ry });
            }
        }
        return unique;
    }

    getDitherMode() {
        return document.getElementById('brush-dither')?.value || 'none';
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

    drawSymmetricStamp(ctx, px, py, color, size, w, h) {
        const pts = this.getSymmetryPoints(px, py, size, w, h);
        for (let i = 0; i < pts.length; i++) {
            this.drawStamp(ctx, pts[i].x, pts[i].y, color, size, w, h);
        }
    }

    drawStamp(ctx, px, py, color, size, w = null, h = null) {
        ctx.fillStyle = color;
        const s = Math.max(1, Math.floor(size) || 1);
        const dither = this.getDitherMode();
        const isTiling = Boolean(window.mollyEditor?.workspace?.tilingMode && w && h);

        const putPixel = (x, y) => {
            let finalX = x;
            let finalY = y;
            if (isTiling) {
                finalX = ((x % w) + w) % w;
                finalY = ((y % h) + h) % h;
            }
            if (this.shouldDrawDither(finalX, finalY, dither)) {
                ctx.fillRect(finalX, finalY, 1, 1);
            }
        };

        if (s <= 1) {
            putPixel(px, py);
            return;
        }

        const offset = Math.floor(s / 2);
        const startX = px - offset;
        const startY = py - offset;

        if (dither === 'none' && !isTiling) {
            ctx.fillRect(startX, startY, s, s);
        } else {
            for (let dy = 0; dy < s; dy++) {
                for (let dx = 0; dx < s; dx++) {
                    putPixel(startX + dx, startY + dy);
                }
            }
        }
    }

    drawLine(ctx, x0, y0, x1, y1, color, size, w, h) {
        if (![x0, y0, x1, y1].every(Number.isFinite)) return;
        if (!globalThis.window?.mollyEditor?.workspace?.tilingMode && w && h) {
            const clipped = clipLine(x0, y0, x1, y1, w, h, Math.max(1, size));
            if (!clipped) return;
            ({ x0, y0, x1, y1 } = clipped);
        }
        if (globalThis.window?.mollyEditor?.workspace?.tilingMode && w && h) {
            ({x0,y0,x1,y1}=wrapLine(x0,y0,x1,y1,w,h));
        }
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        let curX = x0;
        let curY = y0;

        const hasSymmetry = (this.toolManager?.symmetryX || this.toolManager?.symmetryY) && w && h;

        while (true) {
            if (hasSymmetry) {
                this.drawSymmetricStamp(ctx, curX, curY, color, size, w, h);
            } else {
                this.drawStamp(ctx, curX, curY, color, size, w, h);
            }
            if (curX === x1 && curY === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; curX += sx; }
            if (e2 < dx) { err += dx; curY += sy; }
        }
    }
}
