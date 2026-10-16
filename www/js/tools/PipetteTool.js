import Tool from './Tool.js';

export default class PipetteTool extends Tool {
    onPointerDown(x, y) {
        this.isSampling = true;
        this.sample(x, y);
    }

    onPointerMove(x, y) { if (this.isSampling) this.sample(x, y); }
    onPointerUp(x, y) { if (this.isSampling && Number.isFinite(x) && Number.isFinite(y)) this.sample(x, y); this.isSampling = false; }
    cancelAction() { this.isSampling = false; }

    sample(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const px = Math.floor(x);
        const py = Math.floor(y);

        const fromLayer = document.getElementById('pipette-source')?.value === 'layer';
        const mainCanvas = fromLayer ? this.layerManager.getActiveLayer()?.canvas : document.getElementById('main-canvas');
        if (!mainCanvas) return;

        const cw = mainCanvas.width;
        const ch = mainCanvas.height;

        if (px < 0 || px >= cw || py < 0 || py >= ch) return;

        const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
        const sampleSelect = document.getElementById('pipette-sample');
        const mode = sampleSelect ? sampleSelect.value : 'point';

        let r = 0, g = 0, b = 0, count = 0;

        if (mode === '3x3' || mode === '5x5') {
            const radius = mode === '5x5' ? 2 : 1;
            const minX = Math.max(0, px - radius);
            const minY = Math.max(0, py - radius);
            const maxX = Math.min(cw - 1, px + radius);
            const maxY = Math.min(ch - 1, py + radius);
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;

            const blockData = ctx.getImageData(minX, minY, w, h).data;
            for (let i = 0; i < blockData.length; i += 4) {
                if (blockData[i + 3] > 0) {
                    const weight = blockData[i + 3] / 255;
                    r += blockData[i] * weight;
                    g += blockData[i + 1] * weight;
                    b += blockData[i + 2] * weight;
                    count += weight;
                }
            }
        }

        if (count === 0) {
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3] === 0) return;
            r = pixel[0];
            g = pixel[1];
            b = pixel[2];
            count = 1;
        }

        const avgR = Math.min(255, Math.max(0, Math.round(r / count)));
        const avgG = Math.min(255, Math.max(0, Math.round(g / count)));
        const avgB = Math.min(255, Math.max(0, Math.round(b / count)));

        const hex = '#' + [avgR, avgG, avgB].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        this.bus.emit('COLOR_SELECTED', hex);
    }
}
