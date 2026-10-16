import Tool from './Tool.js';
import { dragRectangle } from './ToolGeometry.js';
import { CreateObjectCommand } from '../core/Commands.js';

export default class CircleTool extends Tool {
    constructor(bus, layerManager, history, isFilled = false) {
        super(bus, layerManager, history);
        this.isFilled = isFilled;
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

        const geometry = dragRectangle(this.startX, this.startY, x, y, e);
        if (!geometry) return;
        const { x0: startX, y0: startY, x1: currentX, y1: currentY } = geometry;

        this.bus.emit('PREVIEW_UPDATED', (pCtx) => {
            this.drawEllipse(pCtx, startX, startY, currentX, currentY, color, size, this.isFilled);
        });
    }

    onPointerUp(x, y, color, size, layer, e) {
        if (!this.isDrawing) return;
        this.isDrawing = false;
        this.bus.emit('PREVIEW_CLEARED');
        if (layer && (layer.locked || layer.visible === false || this.layerManager.isEditable?.(layer) === false)) return;

        const geometry = dragRectangle(this.startX, this.startY, x, y, e);
        if (!geometry) return;
        const { x0: startX, y0: startY, x1: currentX, y1: currentY } = geometry;

        const isCircle = Math.abs(currentX - startX) === Math.abs(currentY - startY);
        const prefix = isCircle
            ? (this.isFilled ? 'Круг' : 'Контур круга')
            : (this.isFilled ? 'Эллипс' : 'Контур эллипса');

        const layerName = this.layerManager.getNextObjectName(prefix);
        const newLayer = this.layerManager.addLayer(layerName);
        if (!newLayer) return;

        if (layer && (layer.isGroup || layer.type === 'group')) {
            newLayer.groupId = layer.id;
        } else if (layer && layer.groupId) {
            newLayer.groupId = layer.groupId;
        }

        newLayer.shapeData = {
            type: this.isFilled ? 'circle-filled' : 'circle-empty',
            x0: startX,
            y0: startY,
            x1: currentX,
            y1: currentY,
            color,
            stroke: size,
            filled: this.isFilled
        };
        newLayer.objectType = newLayer.shapeData.type;

        this.drawEllipse(newLayer.ctx, startX, startY, currentX, currentY, color, size, this.isFilled);
        newLayer.invalidateSource();

        this.history.push(new CreateObjectCommand(this.layerManager, newLayer));
        this.bus.emit('CANVAS_UPDATED');
    }

    drawEllipse(ctx, x0, y0, x1, y1, color, strokeSize, filled) {
        ctx.fillStyle = color;
        ctx.imageSmoothingEnabled = false;

        const left = Math.min(x0, x1);
        const top = Math.min(y0, y1);
        const right = Math.max(x0, x1);
        const bottom = Math.max(y0, y1);
        const W = right - left + 1;
        const H = bottom - top + 1;

        const size = Math.max(1, Math.floor(strokeSize) || 1);

        if (W <= 2 || H <= 2) {
            ctx.fillRect(left, top, W, H);
            return;
        }

        if (filled) {
            const minX = new Map();
            const maxX = new Map();

            const plotPoint = (x, y) => {
                const curMin = minX.get(y);
                const curMax = maxX.get(y);
                minX.set(y, curMin === undefined ? x : Math.min(curMin, x));
                maxX.set(y, curMax === undefined ? x : Math.max(curMax, x));
            };

            this._rasterizeEllipseBoundary(left, top, right, bottom, plotPoint);

            minX.forEach((xStart, y) => {
                const xEnd = maxX.get(y);
                ctx.fillRect(xStart, y, xEnd - xStart + 1, 1);
            });
        } else {
            if (size === 1) {
                const plotted = new Set();
                const plotPoint = (x, y) => {
                    const key = `${x},${y}`;
                    if (plotted.has(key)) return;
                    plotted.add(key);
                    ctx.fillRect(x, y, 1, 1);
                };
                this._rasterizeEllipseBoundary(left, top, right, bottom, plotPoint);
                return;
            }

            if (size * 2 >= W || size * 2 >= H) {
                // Stroke fills the entire ellipse
                const minX = new Map();
                const maxX = new Map();
                const plotPoint = (x, y) => {
                    const curMin = minX.get(y);
                    const curMax = maxX.get(y);
                    minX.set(y, curMin === undefined ? x : Math.min(curMin, x));
                    maxX.set(y, curMax === undefined ? x : Math.max(curMax, x));
                };
                this._rasterizeEllipseBoundary(left, top, right, bottom, plotPoint);
                minX.forEach((xStart, y) => {
                    const xEnd = maxX.get(y);
                    ctx.fillRect(xStart, y, xEnd - xStart + 1, 1);
                });
                return;
            }

            // Concentric outer and inner rasterization for uniform thick stroke
            const outerMinX = new Map();
            const outerMaxX = new Map();
            const plotOuter = (x, y) => {
                const curMin = outerMinX.get(y);
                const curMax = outerMaxX.get(y);
                outerMinX.set(y, curMin === undefined ? x : Math.min(curMin, x));
                outerMaxX.set(y, curMax === undefined ? x : Math.max(curMax, x));
            };
            this._rasterizeEllipseBoundary(left, top, right, bottom, plotOuter);

            const inLeft = left + size;
            const inTop = top + size;
            const inRight = right - size;
            const inBottom = bottom - size;

            const innerMinX = new Map();
            const innerMaxX = new Map();
            const plotInner = (x, y) => {
                const curMin = innerMinX.get(y);
                const curMax = innerMaxX.get(y);
                innerMinX.set(y, curMin === undefined ? x : Math.min(curMin, x));
                innerMaxX.set(y, curMax === undefined ? x : Math.max(curMax, x));
            };
            this._rasterizeEllipseBoundary(inLeft, inTop, inRight, inBottom, plotInner);

            outerMinX.forEach((outStart, y) => {
                const outEnd = outerMaxX.get(y);
                if (innerMinX.has(y)) {
                    const inStart = innerMinX.get(y);
                    const inEnd = innerMaxX.get(y);
                    if (inStart > outStart) {
                        ctx.fillRect(outStart, y, inStart - outStart, 1);
                    }
                    if (outEnd > inEnd) {
                        ctx.fillRect(inEnd + 1, y, outEnd - inEnd, 1);
                    }
                } else {
                    ctx.fillRect(outStart, y, outEnd - outStart + 1, 1);
                }
            });
        }
    }

    _rasterizeEllipseBoundary(x0, y0, x1, y1, plot) {
        let a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
        let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
        let err = dx + dy + b1 * a * a, e2;

        let curX0 = x0, curX1 = x1, curY0 = y0, curY1 = y1;
        if (curX0 > curX1) { curX0 = curX1; curX1 += a; }
        if (curY0 > curY1) { curY0 = curY1; }
        curY0 += (b + 1) >> 1;
        curY1 = curY0 - b1;
        a *= 8 * a;
        b1 = 8 * b * b;

        do {
            plot(curX1, curY0);
            plot(curX0, curY0);
            plot(curX0, curY1);
            plot(curX1, curY1);
            e2 = 2 * err;
            if (e2 <= dy) { curY0++; curY1--; err += dy += a; }
            if (e2 >= dx || 2 * err > dy) { curX0++; curX1--; err += dx += b1; }
        } while (curX0 <= curX1);

        while (curY0 - curY1 < b) {
            plot(curX0 - 1, curY0);
            plot(curX1 + 1, curY0++);
            plot(curX0 - 1, curY1);
            plot(curX1 + 1, curY1--);
        }
    }
}
