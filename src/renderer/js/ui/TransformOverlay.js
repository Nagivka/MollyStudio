/** Vector controls in screen resolution, independent of the document's pixel grid. */
export default class TransformOverlay {
    constructor(bus, workspace, documentCanvas, config, { id = 'transform-overlay-canvas', event = 'TRANSFORM_OVERLAY_UPDATED', clearOnPreview = true } = {}) {
        this.workspace = workspace;
        this.documentCanvas = documentCanvas;
        this.config = config;
        this.callback = null;
        this.canvas = document.createElement('canvas');
        this.canvas.id = id;
        this.canvas.setAttribute('aria-hidden', 'true');
        Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '30', imageRendering: 'auto' });
        workspace.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
        bus.on(event, callback => { this.callback = callback; this.render(); });
        if (clearOnPreview) bus.on('PREVIEW_CLEARED', () => { this.callback = null; this.clear(); });
    }

    clear() {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render() {
        const width = this.workspace.clientWidth, height = this.workspace.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
        this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
        this.clear();
        if (!this.callback || !width || !height) return;
        const viewport = this.workspace.getBoundingClientRect(), image = this.documentCanvas.getBoundingClientRect();
        const scaleX = image.width / this.config.width, scaleY = image.height / this.config.height;
        if (!scaleX || !scaleY) return;
        const ctx = this.ctx;
        ctx.save();
        try {
            ctx.scale(ratio, ratio);
            let top = 0, bottom = height, left = 0;
            for (const selector of ['.doc-tab-bar', '.ruler-top']) {
                const rect = this.workspace.querySelector(selector)?.getBoundingClientRect();
                if (rect?.height) top = Math.max(top, rect.bottom - viewport.top);
            }
            const status = this.workspace.querySelector('.bottom-status-bar')?.getBoundingClientRect();
            if (status?.height) bottom = Math.min(bottom, status.top - viewport.top);
            const ruler = this.workspace.querySelector('.ruler-left')?.getBoundingClientRect();
            if (ruler?.width) left = Math.max(0, ruler.right - viewport.left);
            ctx.beginPath(); ctx.rect(left, top, Math.max(0, width - left), Math.max(0, bottom - top)); ctx.clip();
            ctx.translate(image.left - viewport.left, image.top - viewport.top);
            ctx.scale(scaleX, scaleY);
            this.callback(ctx);
        } finally { ctx.restore(); }
    }
}
