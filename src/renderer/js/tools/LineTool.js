import Tool from './Tool.js';
import { clipLine } from './ToolGeometry.js';

export default class LineTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
    }

    onPointerDown(x, y, color, size, layer) {
        if (layer && (layer.locked || layer.visible === false || this.layerManager.isEditable?.(layer) === false)) return;
        this.isDrawing = true;
        this.startX = Math.floor(x);
        this.startY = Math.floor(y);
    }

    onPointerMove(x, y, color, size, layer, e) {
        if (!this.isDrawing) return;

        let currentX = Math.floor(x);
        let currentY = Math.floor(y);

        if (e && e.shiftKey) {
            const snapped = this.snapAngle(this.startX, this.startY, currentX, currentY);
            currentX = snapped.x;
            currentY = snapped.y;
        }

        this.bus.emit('PREVIEW_UPDATED', (pCtx) => {
            this.withSelection(pCtx, () => this.drawLine(pCtx, this.startX, this.startY, currentX, currentY, color, size));
        });
    }

    onPointerUp(x, y, color, size, layer, e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this.bus.emit('PREVIEW_CLEARED');
        if (layer && (layer.locked || layer.visible === false || this.layerManager.isEditable?.(layer) === false)) return;

        let currentX = Math.floor(x);
        let currentY = Math.floor(y);

        if (e && e.shiftKey) {
            const snapped = this.snapAngle(this.startX, this.startY, currentX, currentY);
            currentX = snapped.x;
            currentY = snapped.y;
        }

        const layerName = this.layerManager.getNextObjectName('Линия');
        this.createObjectLayer(layerName,layer,newLayer=>{
            newLayer.shapeData = {
                type: 'line',
                x0: this.startX,
                y0: this.startY,
                x1: currentX,
                y1: currentY,
                color,
                stroke: size
            };
            newLayer.objectType = 'line';

            this.withSelection(newLayer.ctx, () => this.drawLine(newLayer.ctx, this.startX, this.startY, currentX, currentY, color, size));
        });
    }

    snapAngle(x0, y0, x1, y1) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const dist = Math.hypot(dx, dy);
        let angle = Math.atan2(dy, dx);
        const snap = Math.PI / 4; // 45 degrees snap
        angle = Math.round(angle / snap) * snap;
        return {
            x: Math.round(x0 + Math.cos(angle) * dist),
            y: Math.round(y0 + Math.sin(angle) * dist)
        };
    }

    drawRoundStamp(ctx, px, py, color, size) {
        ctx.fillStyle = color;
        ctx.imageSmoothingEnabled = false;

        const S = Math.max(1, Math.floor(size) || 1);
        if (S <= 1) {
            ctx.fillRect(px, py, 1, 1);
            return;
        }

        const R = (S - 1) / 2;
        const rOut = R + 0.45;
        const left = px - Math.floor(S / 2);
        const top = py - Math.floor(S / 2);

        for (let dy = 0; dy < S; dy++) {
            const yDist = dy - R;
            for (let dx = 0; dx < S; dx++) {
                const xDist = dx - R;
                if (xDist * xDist + yDist * yDist <= rOut * rOut) {
                    ctx.fillRect(left + dx, top + dy, 1, 1);
                }
            }
        }
    }

    drawLine(ctx, x0, y0, x1, y1, color, size) {
        if (![x0, y0, x1, y1].every(Number.isFinite)) return;
        if (ctx.canvas) {
            const clipped = clipLine(x0, y0, x1, y1, ctx.canvas.width, ctx.canvas.height, Math.max(1, size));
            if (!clipped) return;
            ({ x0, y0, x1, y1 } = clipped);
        }
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1;
        const sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        let curX = x0;
        let curY = y0;

        while (true) {
            this.drawRoundStamp(ctx, curX, curY, color, size);
            if (curX === x1 && curY === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; curX += sx; }
            if (e2 < dx) { err += dx; curY += sy; }
        }
    }
}
