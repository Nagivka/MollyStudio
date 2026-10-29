import Tool from './Tool.js';
import { clipLine, wrapLine } from './ToolGeometry.js';

export default class EraserTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isDrawing = false;
        this.lastX = null;
        this.lastY = null;
        this.beforeData = null;
        this.targetLayer = null;
    }

    getEditableLayer(layer) {
        return super.getEditableLayer(layer, { create: false });
    }

    onPointerDown(x, y, color, size, layer) {
        const target = this.getEditableLayer(layer);
        if (!target || target.alphaLocked) return;

        this.targetLayer = target;
        this.isDrawing = true;
        this.beforeData = target.getImageData();
        this.lastX = Math.floor(x);
        this.lastY = Math.floor(y);

        this.withSelection(target.ctx, () => this.eraseSymmetricStamp(target.ctx, this.lastX, this.lastY, size, target.width, target.height));
        this.targetLayer?.invalidateSource?.(false);
        this.bus.emit('CANVAS_UPDATED');
    }

    onPointerMove(x, y, color, size, layer) {
        if (!this.isDrawing || !this.targetLayer || this.targetLayer.locked || !this.targetLayer.visible || this.targetLayer.alphaLocked || this.layerManager.isEditable?.(this.targetLayer) === false) return;

        const currentX = Math.floor(x);
        const currentY = Math.floor(y);

        if (currentX === this.lastX && currentY === this.lastY) return;

        this.withSelection(this.targetLayer.ctx, () => this.eraseLine(this.targetLayer.ctx, this.lastX, this.lastY, currentX, currentY, size, this.targetLayer.width, this.targetLayer.height));

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
            this.commitRasterEdit(this.targetLayer, this.beforeData, 'Ластик', 'ink_eraser');
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

    eraseSymmetricStamp(ctx, px, py, size, w, h) {
        const pts = this.getSymmetryPoints(px, py, size, w, h);
        for (let i = 0; i < pts.length; i++) {
            this.eraseStamp(ctx, pts[i].x, pts[i].y, size);
        }
    }

    eraseStamp(ctx, px, py, size) {
        const s = Math.max(1, Math.floor(size) || 1);
        const w = this.targetLayer?.width;
        const h = this.targetLayer?.height;
        const isTiling = Boolean(globalThis.window?.mollyEditor?.workspace?.tilingMode && w && h);
        const offset = Math.floor(s / 2);
        if (!isTiling) {
            ctx.clearRect(px - offset, py - offset, s, s);
            return;
        }
        const seen = new Set();
        for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) {
                const x = ((px - offset + dx) % w + w) % w;
                const y = ((py - offset + dy) % h + h) % h;
                const key = y * w + x;
                if (seen.has(key)) continue;
                seen.add(key);
                ctx.clearRect(x, y, 1, 1);
            }
        }
    }

    eraseLine(ctx, x0, y0, x1, y1, size, w, h) {
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
                this.eraseSymmetricStamp(ctx, curX, curY, size, w, h);
            } else {
                this.eraseStamp(ctx, curX, curY, size);
            }
            if (curX === x1 && curY === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; curX += sx; }
            if (e2 < dx) { err += dx; curY += sy; }
        }
    }

}
