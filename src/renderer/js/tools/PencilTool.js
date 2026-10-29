import BrushTool from './BrushTool.js';
import {clipLine,wrapLine} from './ToolGeometry.js';
import {pencilTipContains} from './PencilTip.mjs';

/**
 * PencilTool - 1px & circular pixel pencil with Pixel-Perfect stroke smoothing.
 * Eliminates duplicate corner pixels in 1px strokes.
 */
export default class PencilTool extends BrushTool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.pixelPerfectPoints = [];
    }

    onPointerDown(x, y, color, size, layer) {
        this.pixelPerfectPoints = [{ x: Math.floor(x), y: Math.floor(y) }];
        super.onPointerDown(x, y, color, size, layer);
    }

    getBlendMode() {
        return 'source-over';
    }

    onPointerMove(x, y, color, size, layer) {
        if (![x,y].every(Number.isFinite)) return;
        const pixelPerfect = globalThis.window?.mollyEditor?.settingsManager?.get('pixelPerfect') ?? true;
        if (!pixelPerfect || size > 1) return super.onPointerMove(x, y, color, size, layer);
        const target = this.targetLayer;
        if (!this.isDrawing || !target || target.locked || !target.visible || this.layerManager.isEditable?.(target) === false) return;
        const currentX = Math.floor(x);
        const currentY = Math.floor(y);
        let endX = currentX;
        let endY = currentY;
        let px = this.lastX;
        let py = this.lastY;
        if (globalThis.window?.mollyEditor?.workspace?.tilingMode) {
            const wrapped=wrapLine(px,py,endX,endY,target.width,target.height);
            if(wrapped.x0!==px||wrapped.y0!==py)this.pixelPerfectPoints=[];
            px=wrapped.x0;py=wrapped.y0;endX=wrapped.x1;endY=wrapped.y1;
        }
        if (!globalThis.window?.mollyEditor?.workspace?.tilingMode) {
            const clipped=clipLine(px,py,endX,endY,target.width,target.height,1);
            if(!clipped){this.lastX=currentX;this.lastY=currentY;this.pixelPerfectPoints=[];return;}
            if(clipped.x0!==px||clipped.y0!==py)this.pixelPerfectPoints=[];
            px=clipped.x0;py=clipped.y0;endX=clipped.x1;endY=clipped.y1;
        }
        const dx = Math.abs(endX - px);
        const dy = Math.abs(endY - py);
        const sx = px < endX ? 1 : -1;
        const sy = py < endY ? 1 : -1;
        let error = dx - dy;
        this.withSelection(target.ctx, () => {
            target.ctx.globalCompositeOperation = target.alphaLocked ? 'source-atop' : 'source-over';
            while (px !== endX || py !== endY) {
                const twiceError = error * 2;
                if (twiceError > -dy) { error -= dy; px += sx; }
                if (twiceError < dx) { error += dx; py += sy; }
                this.drawSymmetricStamp(target.ctx, px, py, color, 1, target.width, target.height);
                this.pixelPerfectPoints.push({ x: px, y: py });
                const points = this.pixelPerfectPoints;
                if (points.length >= 3) {
                    const [first, middle, last] = points.slice(-3);
                    if (Math.abs(last.x - first.x) === 1 && Math.abs(last.y - first.y) === 1
                        && Math.abs(middle.x - first.x) + Math.abs(middle.y - first.y) === 1
                        && Math.abs(last.x - middle.x) + Math.abs(last.y - middle.y) === 1) {
                        for (const point of this.getSymmetryPoints(middle.x, middle.y, 1, target.width, target.height)) {
                            this.restoreOriginalPoint(point.x, point.y);
                        }
                        points.splice(points.length - 2, 1);
                    }
                }
                if (points.length > 3) points.shift();
            }
        });
        this.lastX = currentX;
        this.lastY = currentY;
        target.invalidateSource(false);
        this.bus.emit('CANVAS_UPDATED');
    }

    restoreOriginalPoint(px, py) {
        const layer = this.targetLayer;
        const source = this.beforeData;
        if (!layer || !source) return;
        if (globalThis.window?.mollyEditor?.workspace?.tilingMode) {
            px = (px % layer.width + layer.width) % layer.width;
            py = (py % layer.height + layer.height) % layer.height;
        }
        if (px < 0 || py < 0 || px >= layer.width || py >= layer.height) return;
        const offset = (py * layer.width + px) * 4;
        const pixel = layer.ctx.createImageData(1, 1);
        pixel.data.set(source.data.subarray(offset, offset + 4));
        layer.ctx.putImageData(pixel, px, py);
    }

    drawStamp(ctx, px, py, color, size = 1, w = null, h = null) {
        ctx.fillStyle = color;
        const s = Math.max(1, Math.floor(size) || 1);
        const tiling = globalThis.window?.mollyEditor?.workspace?.tilingMode && w && h;
        const putPixel = (x, y) => ctx.fillRect(tiling ? (x % w + w) % w : x, tiling ? (y % h + h) % h : y, 1, 1);

        if (s <= 1) {
            putPixel(px, py);
            return;
        }

        const offset = Math.floor(s / 2);


        const startX = px - offset;
        const startY = py - offset;

        for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) {
                if (pencilTipContains(s,dx,dy)) {
                    putPixel(startX + dx, startY + dy);
                }
            }
        }
    }
}
