import Tool from './Tool.js';
import { DrawCommand, AddLayerCommand } from '../core/Commands.js';
import { imageDataEquals } from '../core/ImageDataUtils.js';
import { isShortcutTarget } from '../ui/KeyboardNavigation.js';

/**
 * MarqueeTool - Advanced Material Design 3 selection tool.
 * Features:
 * - 8 Transform handles (NW, N, NE, E, SE, S, SW, W) for live resizing
 * - Shift constraint: 1:1 square marquee creation & proportional handle scaling
 * - Alt modifier: center-origin selection expansion & symmetrical scaling
 * - Live floating drag: smoothly moves lifted pixels with pointer capture
 * - Arrow key nudging: 1px (or 10px with Shift)
 * - Clipboard operations: Copy (Ctrl+C), Cut (Ctrl+X), Paste (Ctrl+V)
 * - Deselect (Ctrl+D / Esc), Select All (Ctrl+A), Commit (Enter)
 * - Clear / Delete selection (Delete / Backspace) with full Undo/Redo
 * - Fill (Alt+Backspace) and Stroke selection border with current color
 * - Invert selection colors (Ctrl+Shift+I) & Recolor selection
 * - Flip Horizontal/Vertical & Rotate 90° for floating selection
 * - Synchronized with Properties Panel coordinates & dimensions
 */
export default class MarqueeTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isSelecting = false;
        this.startX = 0;
        this.startY = 0;
        this.downX = 0;
        this.downY = 0;
        this.selection = null; // { x, y, width, height }

        // Floating selection state
        this.floatingData = null; // ImageData of lifted pixels
        this.floatingCanvas = null; // offscreen canvas for crisp rendering & transforms
        this.isMovingFloating = false;
        this.moveStartX = 0;
        this.moveStartY = 0;
        this.floatingStartPos = { x: 0, y: 0 };
        this.floatingX = 0;
        this.floatingY = 0;
        this.beforeData = null; // layer snapshot before lifting pixels
        this.floatingLayer = null; // original layer that owns the lifted pixels

        // 8-Handle Transform state
        this.isTransformingHandle = false;
        this.activeHandle = null;
        this.boxStart = null;
        this.transformSourceCanvas = null; // master clone before current handle drag to prevent blur

        // Marching ants animation
        this.antsOffset = 0;
        this.antsTimer = null;

        // Clipboard buffer for Copy / Cut / Paste
        this.clipboard = null; // { canvas: HTMLCanvasElement, width: number, height: number }

        this.setupEventListeners();
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));

        this.bus.on('SELECT_ALL', () => this.selectAll());
        this.bus.on('DESELECT', () => this.clearSelection());
        this.bus.on('INVERT_SELECTION', () => this.invertSelection());

        // Marquee Options Bar Buttons
        document.getElementById('btn-marquee-copy')?.addEventListener('click', () => this.copy());
        document.getElementById('btn-marquee-cut')?.addEventListener('click', () => this.cut());
        document.getElementById('btn-marquee-paste')?.addEventListener('click', () => this.paste());
        document.getElementById('btn-marquee-delete')?.addEventListener('click', () => this.deleteSelection());
        document.getElementById('btn-marquee-fill')?.addEventListener('click', () => this.fillSelection());
        document.getElementById('btn-marquee-stroke')?.addEventListener('click', () => this.strokeSelection());
        document.getElementById('btn-marquee-fliph')?.addEventListener('click', () => this.flipFloating(true, false));
        document.getElementById('btn-marquee-flipv')?.addEventListener('click', () => this.flipFloating(false, true));
        document.getElementById('btn-marquee-rotcw')?.addEventListener('click', () => this.rotateFloating(90));
        document.getElementById('btn-marquee-rotccw')?.addEventListener('click', () => this.rotateFloating(-90));
        document.getElementById('btn-marquee-deselect')?.addEventListener('click', () => this.clearSelection());
    }

    startAntsAnimation() {
        if (this.antsTimer) return;
        this.antsTimer = setInterval(() => {
            if (this.selection) {
                this.antsOffset = (this.antsOffset + 1) % 8;
                this.updatePreview();
            }
        }, 120);
    }

    stopAntsAnimation() {
        if (this.antsTimer) {
            clearInterval(this.antsTimer);
            this.antsTimer = null;
        }
    }

    getHandles(b) {
        if (!b) return [];
        const x = b.x;
        const y = b.y;
        const w = b.width;
        const h = b.height;
        const midX = Math.round(x + w / 2);
        const midY = Math.round(y + h / 2);
        const maxX = x + w;
        const maxY = y + h;

        return [
            { id: 'nw', x: x, y: y, cursor: 'nwse-resize' },
            { id: 'n',  x: midX, y: y, cursor: 'ns-resize' },
            { id: 'ne', x: maxX, y: y, cursor: 'nesw-resize' },
            { id: 'e',  x: maxX, y: midY, cursor: 'ew-resize' },
            { id: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
            { id: 's',  x: midX, y: maxY, cursor: 'ns-resize' },
            { id: 'sw', x: x, y: maxY, cursor: 'nesw-resize' },
            { id: 'w',  x: x, y: midY, cursor: 'ew-resize' },
        ];
    }

    findHandleAt(px, py) {
        if (!this.selection) return null;
        const zoom = window.mollyEditor?.workspace?.zoom || 1;
        const radius = Math.max(3, Math.round(6 / zoom));
        const handles = this.getHandles(this.selection);

        for (const h of handles) {
            const dx = Math.abs(px - h.x);
            const dy = Math.abs(py - h.y);
            if (dx <= radius && dy <= radius) {
                return h;
            }
        }
        return null;
    }

    cloneCanvas(srcCanvas) {
        if (!srcCanvas) return null;
        const c = document.createElement('canvas');
        c.width = srcCanvas.width;
        c.height = srcCanvas.height;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcCanvas, 0, 0);
        return c;
    }

    scaleCanvas(srcCanvas, targetW, targetH) {
        if (!srcCanvas || srcCanvas.width <= 0 || srcCanvas.height <= 0) return srcCanvas;
        const nw = Math.max(1, Math.round(Math.abs(targetW)));
        const nh = Math.max(1, Math.round(Math.abs(targetH)));
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(srcCanvas, 0, 0, nw, nh);
        return c;
    }

    onPointerDown(x, y, color, size, layer, e) {
        const px = Math.floor(x);
        const py = Math.floor(y);
        this.downX = px;
        this.downY = py;

        // 1. Check if clicking on an active transform handle
        if (this.selection) {
            const handle = this.findHandleAt(px, py);
            if (handle) {
                // If not yet lifted into floating pixels, lift now if layer is editable
                if (!this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
                    this.liftSelectionToFloating(layer);
                }

                this.isTransformingHandle = true;
                this.activeHandle = handle;
                this.boxStart = { ...this.selection };
                if (this.hasFloating()) {
                    this.transformSourceCanvas = this.cloneCanvas(this.getFloatingCanvas());
                }
                return;
            }
        }

        // 2. Check if clicking inside existing selection -> Start moving floating pixels
        if (this.selection && this.pointInSelection(px, py)) {
            if (!this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
                this.liftSelectionToFloating(layer);
            }
            this.isMovingFloating = true;
            this.moveStartX = px;
            this.moveStartY = py;
            this.floatingStartPos = { x: this.selection.x, y: this.selection.y };
            return;
        }

        // 3. Click outside selection -> Commit any active floating pixels and start new selection
        if (this.hasFloating()) {
            if (!this.commitFloating(layer)) return;
        }

        this.isSelecting = true;
        this.startX = px;
        this.startY = py;
        this.selection = null;
        this.updatePreview();
    }

    liftSelectionToFloating(layer) {
        if (layer?.alphaLocked) return;
        if (!layer || !this.selection || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') return;

        const sx = Math.max(0, this.selection.x);
        const sy = Math.max(0, this.selection.y);
        const sw = Math.min(layer.width, this.selection.x + this.selection.width) - sx;
        const sh = Math.min(layer.height, this.selection.y + this.selection.height) - sy;

        if (sw <= 0 || sh <= 0) return;

        this.beforeData = layer.getImageData();
        this.floatingLayer = layer;
        this.floatingData = layer.ctx.getImageData(sx, sy, sw, sh);

        this.floatingCanvas = document.createElement('canvas');
        this.floatingCanvas.width = sw;
        this.floatingCanvas.height = sh;
        const fCtx = this.floatingCanvas.getContext('2d');
        fCtx.imageSmoothingEnabled = false;
        fCtx.putImageData(this.floatingData, 0, 0);

        // Clear lifted area on the source layer
        layer.ctx.clearRect(sx, sy, sw, sh);
        layer.shapeData = null;
        layer.invalidateSource?.();

        this.floatingX = sx;
        this.floatingY = sy;
        this.selection.x = sx;
        this.selection.y = sy;
        this.selection.width = sw;
        this.selection.height = sh;

        this.bus.emit('CANVAS_UPDATED');
    }

    scaleSelectionFromHandle(handleId, dx, dy, shift, alt) {
        if (!this.boxStart) return;
        const bs = this.boxStart;
        let x = bs.x;
        let y = bs.y;
        let w = bs.width;
        let h = bs.height;

        const baseAspect = Math.max(0.0001, bs.width / Math.max(1, bs.height));

        switch (handleId) {
            case 'se':
                w = bs.width + dx;
                h = bs.height + dy;
                break;
            case 'nw':
                x = bs.x + dx;
                y = bs.y + dy;
                w = bs.width - dx;
                h = bs.height - dy;
                break;
            case 'ne':
                y = bs.y + dy;
                w = bs.width + dx;
                h = bs.height - dy;
                break;
            case 'sw':
                x = bs.x + dx;
                w = bs.width - dx;
                h = bs.height + dy;
                break;
            case 'e':
                w = bs.width + dx;
                break;
            case 'w':
                x = bs.x + dx;
                w = bs.width - dx;
                break;
            case 's':
                h = bs.height + dy;
                break;
            case 'n':
                y = bs.y + dy;
                h = bs.height - dy;
                break;
        }

        if (shift && ['nw', 'ne', 'se', 'sw'].includes(handleId)) {
            // Proportional constraint on corners
            if (Math.abs(w / (bs.width || 1)) >= Math.abs(h / (bs.height || 1))) {
                h = Math.round(w / baseAspect);
            } else {
                w = Math.round(h * baseAspect);
            }
            if (handleId === 'nw') {
                x = bs.x + (bs.width - w);
                y = bs.y + (bs.height - h);
            } else if (handleId === 'ne') {
                y = bs.y + (bs.height - h);
            } else if (handleId === 'sw') {
                x = bs.x + (bs.width - w);
            }
        }

        if (alt) {
            // Alt: scale symmetrically from center
            x = bs.x - (w - bs.width) / 2;
            y = bs.y - (h - bs.height) / 2;
        }

        const normX = Math.round(w >= 0 ? x : x + w);
        const normY = Math.round(h >= 0 ? y : y + h);
        const normW = Math.max(1, Math.abs(Math.round(w)));
        const normH = Math.max(1, Math.abs(Math.round(h)));

        this.selection = { x: normX, y: normY, width: normW, height: normH };

        if (this.transformSourceCanvas) {
            this.floatingCanvas = this.scaleCanvas(this.transformSourceCanvas, normW, normH);
        }

        this.updatePreview();
    }

    onPointerMove(x, y, color, size, layer, e) {
        const px = Math.floor(x);
        const py = Math.floor(y);

        // 1. Transforming via handle
        if (this.isTransformingHandle && this.activeHandle) {
            const dx = px - this.downX;
            const dy = py - this.downY;
            this.scaleSelectionFromHandle(this.activeHandle.id, dx, dy, Boolean(e?.shiftKey), Boolean(e?.altKey));
            return;
        }

        // 2. Moving floating pixels
        if (this.isMovingFloating && this.selection) {
            const dx = px - this.moveStartX;
            const dy = py - this.moveStartY;
            this.selection.x = this.floatingStartPos.x + dx;
            this.selection.y = this.floatingStartPos.y + dy;
            this.floatingX = this.selection.x;
            this.floatingY = this.selection.y;

            this.updatePreview();
            return;
        }

        // 3. Creating new selection rectangle
        if (!this.isSelecting) return;

        let dx = px - this.startX;
        let dy = py - this.startY;

        // Shift key: constrain to square (1:1 ratio)
        if (e?.shiftKey) {
            const maxDist = Math.max(Math.abs(dx), Math.abs(dy));
            dx = Math.sign(dx || 1) * maxDist;
            dy = Math.sign(dy || 1) * maxDist;
        }

        let x0 = dx >= 0 ? this.startX : this.startX + dx;
        let y0 = dy >= 0 ? this.startY : this.startY + dy;
        let w = Math.abs(dx) + 1;
        let h = Math.abs(dy) + 1;

        // Alt key: expand from center
        if (e?.altKey) {
            x0 = this.startX - Math.abs(dx);
            y0 = this.startY - Math.abs(dy);
            w = Math.abs(dx) * 2 + 1;
            h = Math.abs(dy) * 2 + 1;
        }

        this.selection = { x: x0, y: y0, width: w, height: h };
        this.startAntsAnimation();
        this.updatePreview();
    }

    onPointerUp(x, y, color, size, layer, e) {
        if (Number.isFinite(x) && Number.isFinite(y) && (this.isSelecting || this.isMovingFloating || this.isTransformingHandle)) this.onPointerMove(x, y, color, size, layer, e);
        if (this.isTransformingHandle) {
            this.isTransformingHandle = false;
            this.activeHandle = null;
            this.transformSourceCanvas = null;
            if (this.selection) {
                this.floatingX = this.selection.x;
                this.floatingY = this.selection.y;
            }
            this.updatePreview();
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        if (this.isMovingFloating) {
            this.isMovingFloating = false;
            if (this.selection) {
                this.floatingX = this.selection.x;
                this.floatingY = this.selection.y;
            }
            this.updatePreview();
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        if (!this.isSelecting) return;
        this.isSelecting = false;

        if (this.selection && (this.selection.width <= 1 && this.selection.height <= 1)) {
            this.clearSelection();
        } else {
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    onHoverMove(x, y) {
        const px = Math.floor(x);
        const py = Math.floor(y);
        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;

        if (this.selection) {
            const handle = this.findHandleAt(px, py);
            if (handle) {
                canvas.style.cursor = handle.cursor;
                return;
            }

            if (this.pointInSelection(px, py)) {
                canvas.style.cursor = 'move';
                return;
            }
        }

        canvas.style.cursor = 'crosshair';
    }

    updatePreview() {
        if (!this.selection) {
            this.bus.emit('PREVIEW_CLEARED');
            return;
        }

        this.bus.emit('PREVIEW_UPDATED', (pCtx) => {
            pCtx.imageSmoothingEnabled = false;
            const floatingCanvas = this.getFloatingCanvas();
            if (floatingCanvas && this.selection) {
                pCtx.drawImage(floatingCanvas, this.selection.x, this.selection.y);
            }
            this.drawMarchingAnts(pCtx, this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        });
    }

    pointInSelection(px, py) {
        if (!this.selection) return false;
        return px >= this.selection.x && px < this.selection.x + this.selection.width &&
               py >= this.selection.y && py < this.selection.y + this.selection.height;
    }

    drawMarchingAnts(ctx, x, y, w, h) {
        ctx.save();
        // 1. Solid dark border outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

        // 2. Animated marching ants dash
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.lineDashOffset = this.antsOffset;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);

        // 3. 8 Transform handles
        const handles = this.getHandles({ x, y, width: w, height: h });
        const zoom = window.mollyEditor?.workspace?.zoom || 1;
        const handleSize = Math.max(3, Math.min(8, Math.round(5 / zoom)));
        const half = handleSize / 2;

        ctx.setLineDash([]);
        for (const hn of handles) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(hn.x - half, hn.y - half, handleSize, handleSize);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.strokeRect(hn.x - half, hn.y - half, handleSize, handleSize);
        }
        ctx.restore();
    }

    hasFloating() {
        return Boolean(this.floatingCanvas || this.floatingData);
    }

    getFloatingCanvas() {
        if (this.floatingCanvas) return this.floatingCanvas;
        if (!this.floatingData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.floatingData.width;
        canvas.height = this.floatingData.height;
        canvas.getContext('2d').putImageData(this.floatingData, 0, 0);
        this.floatingCanvas = canvas;
        return canvas;
    }

    commitFloating(layer) {
        if (!this.hasFloating() || !this.selection) return false;

        const originalLayer = this.floatingLayer;
        const originalStillExists = originalLayer && this.layerManager.layers?.includes(originalLayer);
        let target = originalStillExists ? originalLayer : layer;
        let isNew = false;
        if (!target || (!originalStillExists && (target.locked || target.isBase || target.type === 'text' || target.isGroup || target.type === 'group'))) {
            target = this.layerManager.addLayer('Плавающая область');
            if (!target) return false;
            const parentLayer = originalLayer || layer;
            if (parentLayer && (parentLayer.isGroup || parentLayer.type === 'group')) {
                target.groupId = parentLayer.id;
            } else if (parentLayer && parentLayer.groupId) {
                target.groupId = parentLayer.groupId;
            }
            isNew = true;
        }

        const targetBeforeData = !isNew ? target.getImageData() : null;
        const floatingCanvas = this.getFloatingCanvas();
        if (floatingCanvas) {
            target.ctx.save();
            target.ctx.imageSmoothingEnabled = false;
            if (target.alphaLocked) target.ctx.globalCompositeOperation = 'source-atop';
            target.ctx.drawImage(floatingCanvas, this.selection.x, this.selection.y);
            target.ctx.restore();
        } else if (this.floatingData) {
            target.ctx.putImageData(this.floatingData, this.selection.x, this.selection.y);
        }
        if (isNew) {
            target.invalidateSource?.();
            this.history.push(new AddLayerCommand(this.layerManager, target));
        } else {
            const beforeData = target === originalLayer ? this.beforeData : targetBeforeData;
            if (beforeData) this.commitRasterEdit(target, beforeData, 'Выделение', 'crop_square');
        }

        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingLayer = null;
        this.beforeData = null;
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }

    cancelFloating() {
        const layer = this.floatingLayer || this.layerManager.getActiveLayer();
        if (this.beforeData && layer) {
            layer.putImageData(this.beforeData);
        }
        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingLayer = null;
        this.beforeData = null;
        this.selection = null;
        this.stopAntsAnimation();
        this.bus.emit('PREVIEW_CLEARED');
        this.bus.emit('CANVAS_UPDATED');
    }

    cancelAction() {
        this.isSelecting = false;
        this.isMovingFloating = false;
        this.isTransformingHandle = false;
        this.activeHandle = null;
        this.transformSourceCanvas = null;
        if (this.hasFloating()) this.cancelFloating();
        else { this.selection = null; this.stopAntsAnimation(); this.bus.emit('PREVIEW_CLEARED'); }
    }

    clearSelection() {
        const layer = this.layerManager.getActiveLayer();
        if (this.hasFloating()) {
            if (!this.commitFloating(this.floatingLayer || layer)) return;
        }
        this.selection = null;
        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingLayer = null;
        this.stopAntsAnimation();
        this.bus.emit('PREVIEW_CLEARED');
        this.bus.emit('CANVAS_UPDATED');
    }

    selectAll() {
        if (this.hasFloating() && !this.commitFloating(this.floatingLayer || this.layerManager.getActiveLayer())) return;
        const cw = this.layerManager.config.width;
        const ch = this.layerManager.config.height;
        this.selection = { x: 0, y: 0, width: cw, height: ch };
        this.startAntsAnimation();
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    copy() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.selection) return;

        if (this.hasFloating()) {
            const copyCanvas = this.cloneCanvas(this.getFloatingCanvas());
            this.clipboard = { canvas: copyCanvas, width: copyCanvas.width, height: copyCanvas.height };
            return;
        }

        const sx = Math.max(0, this.selection.x);
        const sy = Math.max(0, this.selection.y);
        const sw = Math.min(layer.width, this.selection.x + this.selection.width) - sx;
        const sh = Math.min(layer.height, this.selection.y + this.selection.height) - sy;

        if (sw <= 0 || sh <= 0) return;

        const copyCanvas = document.createElement('canvas');
        copyCanvas.width = sw;
        copyCanvas.height = sh;
        const cCtx = copyCanvas.getContext('2d');
        cCtx.imageSmoothingEnabled = false;
        cCtx.drawImage(layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

        this.clipboard = { canvas: copyCanvas, width: sw, height: sh };
    }

    cut() {
        if (this.layerManager.getActiveLayer()?.alphaLocked) return;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        this.copy();

        if (this.hasFloating()) {
            const target = this.floatingLayer || layer;
            this.floatingCanvas = null;
            this.floatingData = null;
            if (this.beforeData && target) {
                const afterData = target.getImageData();
                if (!imageDataEquals(this.beforeData, afterData)) {
                    this.history.push(new DrawCommand(target, this.beforeData, afterData));
                }
            }
            this.beforeData = null;
            this.floatingLayer = null;
            this.clearSelection();
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        const beforeData = layer.getImageData();
        layer.ctx.clearRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        this.commitRasterEdit(layer, beforeData, 'Выделение', 'crop_square');
        this.bus.emit('CANVAS_UPDATED');
        this.clearSelection();
    }

    paste() {
        if (!this.clipboard) return;

        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') {
            const newLayer = this.layerManager.addLayer('Вставка');
            if (!newLayer) return;
            if (layer && (layer.isGroup || layer.type === 'group')) {
                newLayer.groupId = layer.id;
            } else if (layer && layer.groupId) {
                newLayer.groupId = layer.groupId;
            }
            const dx = Math.round((newLayer.width - this.clipboard.width) / 2);
            const dy = Math.round((newLayer.height - this.clipboard.height) / 2);
            newLayer.ctx.imageSmoothingEnabled = false;
            newLayer.ctx.drawImage(this.clipboard.canvas, dx, dy);
            newLayer.invalidateSource?.();
            this.history.push(new AddLayerCommand(this.layerManager, newLayer));
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        if (this.hasFloating()) {
            if (!this.commitFloating(this.floatingLayer || layer)) return;
        }

        this.beforeData = layer.getImageData();
        this.floatingLayer = layer;

        this.floatingCanvas = this.cloneCanvas(this.clipboard.canvas);
        const fCtx = this.floatingCanvas.getContext('2d');
        this.floatingData = fCtx.getImageData(0, 0, this.floatingCanvas.width, this.floatingCanvas.height);

        const px = this.selection ? this.selection.x : Math.round((layer.width - this.clipboard.width) / 2);
        const py = this.selection ? this.selection.y : Math.round((layer.height - this.clipboard.height) / 2);

        this.selection = {
            x: px,
            y: py,
            width: this.clipboard.width,
            height: this.clipboard.height
        };
        this.floatingX = px;
        this.floatingY = py;

        this.startAntsAnimation();
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    deleteSelection() {
        if (this.layerManager.getActiveLayer()?.alphaLocked) return;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (this.hasFloating()) {
            const target = this.floatingLayer || layer;
            this.floatingCanvas = null;
            this.floatingData = null;
            if (this.beforeData && target) {
                const afterData = target.getImageData();
                if (!imageDataEquals(this.beforeData, afterData)) {
                    this.history.push(new DrawCommand(target, this.beforeData, afterData));
                }
            }
            this.beforeData = null;
            this.floatingLayer = null;
            this.clearSelection();
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        const beforeData = layer.getImageData();
        layer.ctx.clearRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        this.commitRasterEdit(layer, beforeData, 'Выделение', 'crop_square');
        this.bus.emit('CANVAS_UPDATED');
    }

    fillSelection(fillColor = null) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        const color = fillColor || window.mollyEditor?.tools?.color || '#3B82F6';

        if (this.hasFloating()) {
            const floatingCanvas = this.getFloatingCanvas();
            const fCtx = floatingCanvas.getContext('2d');
            fCtx.fillStyle = color;
            fCtx.fillRect(0, 0, floatingCanvas.width, floatingCanvas.height);
            this.updatePreview();
            return;
        }

        const beforeData = layer.getImageData();
        layer.ctx.save();
        if (layer.alphaLocked) layer.ctx.globalCompositeOperation = 'source-atop';
        layer.ctx.fillStyle = color;
        layer.ctx.fillRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        layer.ctx.restore();
        this.commitRasterEdit(layer, beforeData, 'Выделение', 'crop_square');
    }

    strokeSelection(strokeColor = null) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        const color = strokeColor || window.mollyEditor?.tools?.color || '#3B82F6';
        if (this.hasFloating()) {
            const floatingCanvas = this.getFloatingCanvas();
            if (!floatingCanvas) return;
            const fCtx = floatingCanvas.getContext('2d');
            fCtx.save();
            fCtx.strokeStyle = color;
            fCtx.lineWidth = 1;
            fCtx.strokeRect(0.5, 0.5, Math.max(0, floatingCanvas.width - 1), Math.max(0, floatingCanvas.height - 1));
            fCtx.restore();
            this.updatePreview();
            return;
        }

        const beforeData = layer.getImageData();
        layer.ctx.save();
        if (layer.alphaLocked) layer.ctx.globalCompositeOperation = 'source-atop';
        layer.ctx.strokeStyle = color;
        layer.ctx.lineWidth = 1;
        layer.ctx.strokeRect(this.selection.x + 0.5, this.selection.y + 0.5, this.selection.width - 1, this.selection.height - 1);
        layer.ctx.restore();
        this.commitRasterEdit(layer, beforeData, 'Выделение', 'crop_square');
    }

    flipFloating(horizontal = true, vertical = false) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (!this.hasFloating()) {
            this.liftSelectionToFloating(layer);
        }

        const sourceCanvas = this.getFloatingCanvas();
        if (!sourceCanvas) return;

        const temp = document.createElement('canvas');
        temp.width = sourceCanvas.width;
        temp.height = sourceCanvas.height;
        const tCtx = temp.getContext('2d');
        tCtx.imageSmoothingEnabled = false;

        tCtx.save();
        tCtx.translate(horizontal ? temp.width : 0, vertical ? temp.height : 0);
        tCtx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
        tCtx.drawImage(sourceCanvas, 0, 0);
        tCtx.restore();

        this.floatingCanvas = temp;
        this.updatePreview();
    }

    rotateFloating(deg = 90) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (!this.hasFloating()) {
            this.liftSelectionToFloating(layer);
        }

        const sourceCanvas = this.getFloatingCanvas();
        if (!sourceCanvas) return;

        let normDeg = Math.round(deg) % 360;
        if (normDeg < 0) normDeg += 360;

        const sw = sourceCanvas.width;
        const sh = sourceCanvas.height;
        const isSwap = (normDeg === 90 || normDeg === 270);
        const nw = isSwap ? sh : sw;
        const nh = isSwap ? sw : sh;

        const temp = document.createElement('canvas');
        temp.width = nw;
        temp.height = nh;
        const tCtx = temp.getContext('2d');
        tCtx.imageSmoothingEnabled = false;

        tCtx.save();
        if (normDeg === 90) {
            tCtx.translate(sh, 0);
            tCtx.rotate(Math.PI / 2);
        } else if (normDeg === 180) {
            tCtx.translate(sw, sh);
            tCtx.rotate(Math.PI);
        } else if (normDeg === 270) {
            tCtx.translate(0, sw);
            tCtx.rotate(3 * Math.PI / 2);
        }
        tCtx.drawImage(sourceCanvas, 0, 0);
        tCtx.restore();

        const cx = this.selection.x + this.selection.width / 2;
        const cy = this.selection.y + this.selection.height / 2;
        const nx = Math.round(cx - nw / 2);
        const ny = Math.round(cy - nh / 2);

        this.floatingCanvas = temp;
        this.selection.x = nx;
        this.selection.y = ny;
        this.selection.width = nw;
        this.selection.height = nh;
        this.floatingX = nx;
        this.floatingY = ny;
        this.updatePreview();
    }

    nudge(dx, dy) {
        if (!this.selection) return;
        const layer = this.layerManager.getActiveLayer();
        if (!this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
            this.liftSelectionToFloating(layer);
        }

        this.selection.x += dx;
        this.selection.y += dy;
        this.floatingX = this.selection.x;
        this.floatingY = this.selection.y;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    invertSelection() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (this.hasFloating()) {
            const floatingCanvas = this.getFloatingCanvas();
            const fCtx = floatingCanvas.getContext('2d');
            const imgData = fCtx.getImageData(0, 0, floatingCanvas.width, floatingCanvas.height);
            const d = imgData.data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i + 3] > 0) {
                    d[i] = 255 - d[i];
                    d[i + 1] = 255 - d[i + 1];
                    d[i + 2] = 255 - d[i + 2];
                }
            }
            fCtx.putImageData(imgData, 0, 0);
            this.updatePreview();
            return;
        }

        const beforeData = layer.getImageData();
        const imgData = layer.ctx.getImageData(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 0) {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
            }
        }

        layer.ctx.putImageData(imgData, this.selection.x, this.selection.y);
        this.commitRasterEdit(layer, beforeData, 'Цвет выделения', 'palette');
    }

    recolorSelection(hexColor) {
        const layer = this.layerManager.getActiveLayer();
        if (!this.selection) return;

        const color = hexColor || '#3B82F6';

        if (this.hasFloating()) {
            const floatingCanvas = this.getFloatingCanvas();
            const fCtx = floatingCanvas.getContext('2d');
            fCtx.save();
            fCtx.globalCompositeOperation = 'source-in';
            fCtx.fillStyle = color;
            fCtx.fillRect(0, 0, floatingCanvas.width, floatingCanvas.height);
            fCtx.restore();
            this.updatePreview();
            return;
        }

        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') return;

        const beforeData = layer.getImageData();
        const temp = document.createElement('canvas');
        temp.width = this.selection.width;
        temp.height = this.selection.height;
        const tCtx = temp.getContext('2d');
        tCtx.drawImage(layer.canvas, this.selection.x, this.selection.y, this.selection.width, this.selection.height, 0, 0, this.selection.width, this.selection.height);
        tCtx.save();
        tCtx.globalCompositeOperation = 'source-in';
        tCtx.fillStyle = color;
        tCtx.fillRect(0, 0, temp.width, temp.height);
        tCtx.restore();

        layer.ctx.clearRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        layer.ctx.drawImage(temp, this.selection.x, this.selection.y);
        this.commitRasterEdit(layer, beforeData, 'Цвет выделения', 'palette');
    }

    setSelectionPosition(newX, newY) {
        if (!this.selection || !Number.isFinite(newX) || !Number.isFinite(newY)) return;
        this.selection.x = Math.round(newX);
        this.selection.y = Math.round(newY);
        this.floatingX = this.selection.x;
        this.floatingY = this.selection.y;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    setSelectionDimensions(newW, newH) {
        if (!this.selection) return;
        if (!Number.isFinite(Number(newW)) || !Number.isFinite(Number(newH))) return;
        const w = Math.max(1, Math.min(4096, Math.round(newW)));
        const h = Math.max(1, Math.min(4096, Math.round(newH)));
        if (this.hasFloating()) {
            this.floatingCanvas = this.scaleCanvas(this.getFloatingCanvas(), w, h);
        }
        this.selection.width = w;
        this.selection.height = h;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    deactivate() {
        const layer = this.layerManager.getActiveLayer();
        if (this.hasFloating()) {
            this.commitFloating(this.floatingLayer || layer);
        }
        this.stopAntsAnimation();
        this.bus.emit('PREVIEW_CLEARED');
    }

    onKeyDown(e) {
        if (e?.defaultPrevented || isShortcutTarget(e?.target, e)) return;
        if (window.mollyEditor?.tools?.currentToolId !== 'marquee') return;

        // Clipboard
        if (e.ctrlKey && !e.shiftKey && !e.altKey) {
            if (e.code === 'KeyC') {
                e.preventDefault();
                this.copy();
            } else if (e.code === 'KeyX') {
                e.preventDefault();
                this.cut();
            } else if (e.code === 'KeyV') {
                e.preventDefault();
                this.paste();
            } else if (e.code === 'KeyA') {
                e.preventDefault();
                this.selectAll();
            } else if (e.code === 'KeyD') {
                e.preventDefault();
                this.clearSelection();
            }
        } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyI') {
            e.preventDefault();
            this.invertSelection();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            if (this.hasFloating()) this.cancelFloating();
            else this.clearSelection();
        } else if (e.altKey && (e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault();
            this.fillSelection();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            this.deleteSelection();
        } else if (e.key === 'Enter') {
            const layer = this.layerManager.getActiveLayer();
            if (this.hasFloating() && layer) {
                e.preventDefault();
                this.commitFloating(layer);
            }
        } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            if (this.selection) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
                const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
                this.nudge(dx, dy);
            }
        }
    }
}
