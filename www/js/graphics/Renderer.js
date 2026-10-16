import { drawLayers } from './LayerCompositing.js';

export default class Renderer {
    constructor(bus, layerManager) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.canvas = null;
        this.ctx = null;
        this.previewCanvas = null;
        this.previewCtx = null;

        this.renderScheduled = false;
        this.bus.on('CANVAS_UPDATED', () => this.scheduleRender());
        this.bus.on('PREVIEW_UPDATED', (preview) => this.renderPreview(preview));
        this.bus.on('PREVIEW_CLEARED', () => this.clearPreview());
    }

    scheduleRender() {
        if (this.renderScheduled) return;
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.renderScheduled = false;
            this.render();
        });
    }

    init(canvasEl, previewCanvasEl) {
        this.canvas = canvasEl;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

        if (previewCanvasEl) {
            this.previewCanvas = previewCanvasEl;
            this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });
        }

        this.applyContextSettings();
        this.render();
    }

    resize(width, height) {
        if (this.canvas) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.canvas.style.width = width + 'px';
            this.canvas.style.height = height + 'px';
            if (this.canvas.parentElement) {
                this.canvas.parentElement.style.width = width + 'px';
                this.canvas.parentElement.style.height = height + 'px';
            }
        }
        if (this.previewCanvas) {
            this.previewCanvas.width = width;
            this.previewCanvas.height = height;
            this.previewCanvas.style.width = width + 'px';
            this.previewCanvas.style.height = height + 'px';
        }
        this.applyContextSettings();
        this.render();
    }

    applyContextSettings() {
        if (this.ctx) {
            this.ctx.imageSmoothingEnabled = false;
            if ('mozImageSmoothingEnabled' in this.ctx) this.ctx.mozImageSmoothingEnabled = false;
            if ('webkitImageSmoothingEnabled' in this.ctx) this.ctx.webkitImageSmoothingEnabled = false;
            if ('msImageSmoothingEnabled' in this.ctx) this.ctx.msImageSmoothingEnabled = false;
        }
        if (this.previewCtx) {
            this.previewCtx.imageSmoothingEnabled = false;
            if ('mozImageSmoothingEnabled' in this.previewCtx) this.previewCtx.mozImageSmoothingEnabled = false;
            if ('webkitImageSmoothingEnabled' in this.previewCtx) this.previewCtx.webkitImageSmoothingEnabled = false;
            if ('msImageSmoothingEnabled' in this.previewCtx) this.previewCtx.msImageSmoothingEnabled = false;
        }
    }

    render() {
        if (!this.ctx) return;
        
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        drawLayers(this.ctx, this.layerManager.getLayers());
        this.ctx.globalAlpha = 1.0;
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.imageSmoothingEnabled = false;
    }

    renderPreview(callback) {
        if (!this.previewCtx) return;
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        if (typeof callback === 'function') {
            this.previewCtx.save();
            this.previewCtx.imageSmoothingEnabled = false;
            try {
                callback(this.previewCtx);
            } catch (err) {
                console.error('Preview render error:', err);
            } finally {
                this.previewCtx.restore();
                this.previewCtx.imageSmoothingEnabled = false;
            }
        }
    }

    clearPreview() {
        if (!this.previewCtx) return;
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    }

    exportToPNG() {
        if (!this.canvas) return null;
        this.render();
        return this.canvas.toDataURL('image/png');
    }

    exportLayerToPNG(layerId) {
        const layer = this.layerManager.getLayers().find(l => l.id === layerId);
        if (!layer) return null;
        const layers = this.layerManager.getLayers();
        const included = new Set([layer.id]);
        if (layer.isGroup) {
            for (let pass = 0; pass < layers.length; pass++) {
                const count = included.size;
                for (const item of layers) if (included.has(item.groupId)) included.add(item.id);
                if (included.size === count) break;
            }
        }
        const output = document.createElement('canvas');
        output.width = layer.width; output.height = layer.height;
        drawLayers(output.getContext('2d'), layers, { exclude: new Set(layers.filter(item => !included.has(item.id)).map(item => item.id)) });
        return output.toDataURL('image/png');
    }
}
