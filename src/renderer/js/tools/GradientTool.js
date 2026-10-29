import Tool from './Tool.js';

export default class GradientTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.beforeData = null;
        this.type = 'linear';
        this.mode = 'overlay';
        this.color1 = '#D5D4D8';
        this.color2 = '#0F64D2';

        document.getElementById('btn-apply-grad-layer')?.addEventListener('click', () => {
            this.applyToActiveLayer();
        });
    }

    getEditableLayer(layer) {
        return super.getEditableLayer(layer, { name: 'Слой градиента' });
    }

    onPointerDown(x, y, color, size, layer) {
        const target = this.getEditableLayer(layer);
        if (!target) return;

        this.targetLayer = target;
        this.isDrawing = true;
        this.startX = Math.floor(x);
        this.startY = Math.floor(y);
        this.beforeData = target.getImageData();

        const c1Input = document.getElementById('grad-color-1');
        const c2Input = document.getElementById('grad-color-2');
        const typeSelect = document.getElementById('grad-type');
        const modeSelect = document.getElementById('grad-mode');

        this.color1 = c1Input ? c1Input.value : color;
        this.color2 = c2Input ? c2Input.value : '#000000';
        this.type = typeSelect ? typeSelect.value : 'linear';
        this.mode = modeSelect ? modeSelect.value : 'overlay';
        this.overlayTargetHasPixels = this.mode === 'overlay' ? this.hasLayerPixels(target) : false;
    }

    gradientEndpoint(x, y, event) {
        x = Math.floor(x); y = Math.floor(y);
        if (event?.shiftKey && this.type === 'linear') {
            const distance = Math.hypot(x - this.startX, y - this.startY);
            const angle = Math.round(Math.atan2(y - this.startY, x - this.startX) / (Math.PI / 4)) * Math.PI / 4;
            x = Math.round(this.startX + Math.cos(angle) * distance);
            y = Math.round(this.startY + Math.sin(angle) * distance);
        }
        return { x, y };
    }

    renderAt(x, y) {
        const target = this.targetLayer;
        target.ctx.putImageData(this.beforeData, 0, 0);
        this.withSelection(target.ctx, () => {
            if (target.alphaLocked || (this.mode === 'overlay' && this.overlayTargetHasPixels)) target.ctx.globalCompositeOperation = 'source-atop';
            this.renderGradient(target.ctx, this.startX, this.startY, x, y, this.color1, this.color2, this.type);
        });
        target.invalidateSource(false);
    }

    onPointerMove(x, y, color, size, layer, event) {
        if (!this.isDrawing || !this.targetLayer) return;
        if (this.layerManager.isEditable?.(this.targetLayer) === false) { this.cancelAction(); return; }
        const end = this.gradientEndpoint(x, y, event);
        if (end.x === this.startX && end.y === this.startY) { this.targetLayer.ctx.putImageData(this.beforeData, 0, 0);this.targetLayer.invalidateSource(false); }
        else this.renderAt(end.x, end.y);
        this.bus.emit('CANVAS_UPDATED');
        this.bus.emit('PREVIEW_UPDATED', ctx => this.drawVectorLine(ctx, this.startX, this.startY, end.x, end.y));
    }

    onPointerUp(x, y, color, size, layer, event) {
        if (!this.isDrawing) return;
        const target = this.targetLayer;
        const end = this.gradientEndpoint(x, y, event);
        if (!target || target.locked || target.visible === false || this.layerManager.isEditable?.(target) === false
            || (end.x === this.startX && end.y === this.startY)) {
            this.cancelAction();
            return;
        }
        this.renderAt(end.x, end.y);
        this.isDrawing = false;
        this.bus.emit('PREVIEW_CLEARED');
        this.commitRasterEdit(target, this.beforeData, 'Градиент', 'gradient');
        this.beforeData = null;
        this.targetLayer = null;
        this.overlayTargetHasPixels = false;
        this.bus.emit('CANVAS_UPDATED');
    }

    applyToActiveLayer() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || !layer.visible || this.layerManager.isEditable?.(layer) === false || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') return;

        const c1Input = document.getElementById('grad-color-1');
        const c2Input = document.getElementById('grad-color-2');
        const typeSelect = document.getElementById('grad-type');

        const c1 = c1Input ? c1Input.value : '#D5D4D8';
        const c2 = c2Input ? c2Input.value : '#0F64D2';
        const type = typeSelect ? typeSelect.value : 'linear';

        if (!this.hasLayerPixels(layer)) return;
        const beforeData = layer.getImageData();

        try {
            this.withSelection(layer.ctx, () => {
                layer.ctx.globalCompositeOperation = 'source-atop';
                this.renderGradient(layer.ctx, 0, 0, 0, layer.height, c1, c2, type);
            });
        } catch (error) {
            layer.putImageData(beforeData);
            layer.contentRevision=beforeData.mollySnapshot?.contentRevision??layer.contentRevision;
            this.bus.emit('CANVAS_UPDATED');
            globalThis.window?.mollyEditor?.showToast?.('Не удалось применить градиент. Исходные пиксели восстановлены.','error');
            return false;
        }

        if (this.commitRasterEdit(layer, beforeData, 'Градиент по объекту', 'gradient')) {
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    hasLayerPixels(layer) {
        const d = layer.ctx.getImageData(0, 0, layer.width, layer.height).data;
        for (let i = 3; i < d.length; i += 4) {
            if (d[i] > 0) return true;
        }
        return false;
    }

    renderGradient(ctx, x0, y0, x1, y1, c1, c2, type) {
        ctx.imageSmoothingEnabled = false;

        if (type === 'radial') {
            const radius = Math.hypot(x1 - x0, y1 - y0);
            const grad = ctx.createRadialGradient(x0, y0, 0, x0, y0, Math.max(1, radius));
            grad.addColorStop(0, c1);
            grad.addColorStop(1, c2);
            ctx.fillStyle = grad;
        } else {
            const grad = ctx.createLinearGradient(x0, y0, x1, y1);
            grad.addColorStop(0, c1);
            grad.addColorStop(1, c2);
            ctx.fillStyle = grad;
        }

        const w = ctx.canvas ? ctx.canvas.width : 256;
        const h = ctx.canvas ? ctx.canvas.height : 256;
        ctx.fillRect(0, 0, w, h);
    }

    drawVectorLine(ctx, x0, y0, x1, y1) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        ctx.fillStyle = '#0f64d2';
        ctx.fillRect(x0 - 2, y0 - 2, 5, 5);
        ctx.fillRect(x1 - 2, y1 - 2, 5, 5);
    }
}
