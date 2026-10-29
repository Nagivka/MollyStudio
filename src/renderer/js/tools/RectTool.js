import Tool from './Tool.js';
import { dragRectangle } from './ToolGeometry.js';
import {roundedRowInset} from './PixelRoundRect.mjs';

export default class RectTool extends Tool {
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
        const radiusId = this.isFilled ? 'rect-filled-radius' : 'rect-empty-radius';
        this.dragRadius = Math.max(0, Math.min(4096, parseInt(document.getElementById(radiusId)?.value, 10) || 0));
    }

    onPointerMove(x, y, color, size, layer, e) {
        if (!this.isDrawing) return;

        const geometry = dragRectangle(this.startX, this.startY, x, y, e);
        if (!geometry) return;
        const { x0: startX, y0: startY, x1: currentX, y1: currentY } = geometry;

        this.bus.emit('PREVIEW_UPDATED', (pCtx) => {
            this.withSelection(pCtx, () => this.drawRect(pCtx, startX, startY, currentX, currentY, color, size, this.isFilled, this.dragRadius));
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

        const isSquare = Math.abs(currentX - startX) === Math.abs(currentY - startY);
        const prefix = isSquare
            ? (this.isFilled ? 'Квадрат' : 'Контур квадрата')
            : (this.isFilled ? 'Прямоугольник' : 'Контур прямоугольника');

        const layerName = this.layerManager.getNextObjectName(prefix);
        this.createObjectLayer(layerName,layer,newLayer=>{
            const rawRad = this.dragRadius;

            newLayer.shapeData = {
                type: this.isFilled ? 'rect-filled' : 'rect-empty',
                x0: startX,
                y0: startY,
                x1: currentX,
                y1: currentY,
                color,
                stroke: size,
                radius: rawRad,
                filled: this.isFilled
            };
            newLayer.objectType = newLayer.shapeData.type;

            this.withSelection(newLayer.ctx, () => this.drawRect(newLayer.ctx, startX, startY, currentX, currentY, color, size, this.isFilled, rawRad));
        });
    }

    drawRect(ctx, x0, y0, x1, y1, color, size, filled, customRadius = null) {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.imageSmoothingEnabled = false;

        const left = Math.round(Math.min(x0, x1));
        const top = Math.round(Math.min(y0, y1));
        const width = Math.max(1,Math.round(Math.abs(x1 - x0)) + 1);
        const height = Math.max(1,Math.round(Math.abs(y1 - y0)) + 1);

        let rawRad = customRadius;
        if (rawRad === null || rawRad === undefined) {
            const radiusId = filled ? 'rect-filled-radius' : 'rect-empty-radius';
            const radInput = document.getElementById(radiusId);
            rawRad = Math.max(0, parseInt(radInput?.value, 10) || 0);
        }

        const maxR = Math.floor(Math.min(width, height) / 2);
        const r = Math.min(rawRad, maxR);

        if (r <= 0) {
            if (filled) {
                ctx.fillRect(left, top, width, height);
            } else {
                const s = Math.max(1, Math.min(Math.floor(size) || 1, Math.floor(Math.min(width, height) / 2)));
                if (s * 2 >= width || s * 2 >= height) {
                    ctx.fillRect(left, top, width, height);
                } else {
                    ctx.fillRect(left, top, width, s);
                    ctx.fillRect(left, top + height - s, width, s);
                    ctx.fillRect(left, top + s, s, height - s * 2);
                    ctx.fillRect(left + width - s, top + s, s, height - s * 2);
                }
            }
        } else {
            const s=Math.max(1,Math.min(Math.floor(size)||1,Math.floor(Math.min(width,height)/2)));
            for(let row=0;row<height;row++){
                const cut=roundedRowInset(width,height,r,row),span=width-cut*2;
                if(span<=0)continue;
                if(filled||s*2>=width||s*2>=height||row<s||row>=height-s){ctx.fillRect(left+cut,top+row,span,1);continue;}
                const innerCut=s+roundedRowInset(width-s*2,height-s*2,Math.max(0,r-s),row-s);
                const edge=Math.max(0,innerCut-cut);
                if(edge){ctx.fillRect(left+cut,top+row,edge,1);ctx.fillRect(left+width-innerCut,top+row,edge,1);}
            }
        }
    }
}
