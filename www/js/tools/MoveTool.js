import { isControlFocused } from '../ui/ControlFocus.js';
import Tool from './Tool.js';
import { DrawCommand, TextDataCommand, CompoundCommand } from '../core/Commands.js';
import { isShortcutTarget } from '../ui/KeyboardNavigation.js';

/**
 * Translation and bitmap transforms from an immutable source image.
 * Groups and multi-selection translate together; resize/rotation affect the active bitmap.
 * Text and GUI templates support translation and alignment.
 */
export default class MoveTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.isActive = false;
        this.isPointerDown = false;
        this.hasMoved = false;

        this.targetLayer = null;
        this.currentBox = null; // { x, y, w, h, angle, px, py }
        this.boxStart = null;
        this.dragStart = { x: 0, y: 0 };
        this.activeHandle = null;
        this.startAngle = 0;
        this.lastPointerEvent = null;

        // Moving / Transforming state
        this.isTransforming = false;
        this.isMoving = false;
        this.activeSourceCanvas = null; // pristine full-resolution master source for active drag
        this.beforeData = null;

        this.textStartX = 0;
        this.textStartY = 0;

        // Smart Magnetic Guides
        this.activeSnapLines = []; // [{ type: 'v', pos: number }, { type: 'h', pos: number }]
        this.isAltInspectorActive = false;
        this.hoverPos = { x: -1, y: -1 };

        this.setupListeners();
        this.setupUI();
    }

    getResampleMode() {
        return document.getElementById('move-resample-mode')?.value || 'auto';
    }

    isLockAspect() {
        const propLock = document.getElementById('prop-lock-aspect');
        if (propLock) return Boolean(propLock.checked);
        return Boolean(document.getElementById('move-lock-aspect')?.checked);
    }

    updateDimensionBadge(w, h, origW, origH) {
        const badge = document.getElementById('move-dimension-badge');
        const propBadge = document.getElementById('prop-dimension-badge');
        if (w === null || h === null) {
            if (badge) badge.style.display = 'none';
            if (propBadge) propBadge.innerText = '0 × 0 px';
            return;
        }
        const absW = Math.max(1, Math.abs(Math.round(w)));
        const absH = Math.max(1, Math.abs(Math.round(h)));
        const pct = origW ? Math.round((absW / origW) * 100) : 100;
        const text = `${absW} × ${absH} px — ${pct}%`;
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.innerText = text;
        }
        if (propBadge) {
            propBadge.innerText = text;
        }

        // Keep Properties Panel inputs in sync while transforming
        if (this.currentBox) {
            const posX = document.getElementById('prop-pos-x');
            const posY = document.getElementById('prop-pos-y');
            const sizeW = document.getElementById('prop-size-w');
            const sizeH = document.getElementById('prop-size-h');
            if (posX && !isControlFocused(posX)) posX.value = Math.round(this.currentBox.x);
            if (posY && !isControlFocused(posY)) posY.value = Math.round(this.currentBox.y);
            if (sizeW && !isControlFocused(sizeW)) sizeW.value = absW;
            if (sizeH && !isControlFocused(sizeH)) sizeH.value = absH;
        }
    }

    updateAngleBadge(deg) {
        const badge = document.getElementById('move-dimension-badge');
        const propBadge = document.getElementById('prop-dimension-badge');
        let normDeg = Math.round(deg) % 360;
        if (normDeg < 0) normDeg += 360;
        const text = `Угол: ${normDeg}°`;
        if (badge) {
            badge.style.display = 'inline-flex';
            badge.innerText = text;
        }
        if (propBadge) {
            propBadge.innerText = text;
        }
    }

    /**
     * Non-destructive, multi-algorithm image resampler
     * Ensures pixel-art remains 100% crisp without blurring,
     * and high-res images retain pristine quality without jagged aliasing.
     */
    drawResampled(ctx, sourceCanvas, destX, destY, destW, destH, angle = 0, mode = 'auto') {
        if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height || !ctx) return;

        const sw = sourceCanvas.width;
        const sh = sourceCanvas.height;
        const dw = Math.max(1, Math.round(Math.abs(destW)));
        const dh = Math.max(1, Math.round(Math.abs(destH)));

        let useSmoothing = (mode === 'smooth');

        ctx.save();
        ctx.imageSmoothingEnabled = useSmoothing;
        if ('mozImageSmoothingEnabled' in ctx) ctx.mozImageSmoothingEnabled = useSmoothing;
        if ('webkitImageSmoothingEnabled' in ctx) ctx.webkitImageSmoothingEnabled = useSmoothing;
        if ('msImageSmoothingEnabled' in ctx) ctx.msImageSmoothingEnabled = useSmoothing;
        if (useSmoothing) {
            ctx.imageSmoothingQuality = 'high';
        }

        if (angle) {
            const cx = destX + dw / 2;
            const cy = destY + dh / 2;
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            ctx.drawImage(sourceCanvas, 0, 0, sw, sh, Math.round(-dw / 2), Math.round(-dh / 2), dw, dh);
        } else {
            ctx.drawImage(sourceCanvas, 0, 0, sw, sh, destX, destY, dw, dh);
        }

        ctx.restore();
    }

    captureSourceCanvas(target) {
        if (!target || target.type === 'text') return null;
        const b = this.getLayerBoundingBox(target);
        if (!b) return null;
        const sc = document.createElement('canvas');
        sc.width = Math.max(1, b.w);
        sc.height = Math.max(1, b.h);
        const sCtx = sc.getContext('2d');
        sCtx.imageSmoothingEnabled = false;
        sCtx.drawImage(target.canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        return sc;
    }

    ensureSourceCanvas(target) {
        if (!target || target.type === 'text') return null;
        if (target.sourceCanvas && target.sourceCanvas.width > 0 && target.sourceCanvas.height > 0) {
            return target.sourceCanvas;
        }
        return this.captureSourceCanvas(target);
    }

    setupListeners() {
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        this.bus.on('LAYER_ACTIVE_CHANGED', () => {
            if (this.isActive) {
                if (this.isTransforming || this.isMoving) {
                    this.cancelAction();
                }
                this.syncBoxWithActiveLayer();
            }
        });

        this.bus.on('CANVAS_UPDATED', () => {
            if (!this.isActive || this.isPointerDown || this.isTransforming || this.isMoving) return;
            this.syncBoxWithActiveLayer();
        });

        this.bus.on('TOOL_CHANGED', (toolId) => {
            if (toolId === 'move' || toolId === 'transform') {
                this.isActive = true;
                this.syncBoxWithActiveLayer();
            } else {
                if (this.isTransforming || this.isMoving) {
                    this.commitAction();
                }
                this.isActive = false;
                this.targetLayer = null;
                this.currentBox = null;
                this.activeSnapLines = [];
                this.bus.emit('PREVIEW_CLEARED');
            }
        });
    }

    setupUI() {
        const bindBtn = (id1, id2, fn) => {
            document.getElementById(id1)?.addEventListener('click', fn);
            if (id2) document.getElementById(id2)?.addEventListener('click', fn);
        };

        bindBtn('btn-prop-fliph', 'btn-transform-fliph', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.flip(true, false);
        });

        bindBtn('btn-prop-flipv', 'btn-transform-flipv', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.flip(false, true);
        });

        bindBtn('btn-prop-rotcw', 'btn-transform-rotcw', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.rotateFixed(90);
        });

        bindBtn('btn-prop-rotccw', 'btn-transform-rotccw', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.rotateFixed(-90);
        });

        bindBtn('btn-prop-scale2x', 'btn-transform-scale2x', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.scaleUniform(2);
        });

        bindBtn('btn-prop-scalehalf', 'btn-transform-scalehalf', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.scaleUniform(0.5);
        });

        bindBtn('btn-prop-invert', 'btn-transform-invert', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.type === 'text' || target.isBase)) return;
            this.invert();
        });

        // Alignment Buttons
        bindBtn('btn-prop-align-center-h', 'btn-align-center-h', () => this.alignLayer('center-h'));
        bindBtn('btn-prop-align-center-v', 'btn-align-center-v', () => this.alignLayer('center-v'));

        // Properties Panel Input listeners (X, Y, W, H)
        const applyInputs = () => {
            const posX = document.getElementById('prop-pos-x');
            const posY = document.getElementById('prop-pos-y');
            const sizeW = document.getElementById('prop-size-w');
            const sizeH = document.getElementById('prop-size-h');
            if (!posX || !posY || !sizeW || !sizeH) return;

            const newX = parseFloat(posX.value);
            const newY = parseFloat(posY.value);
            const newW = parseFloat(sizeW.value);
            const newH = parseFloat(sizeH.value);

            if (!isNaN(newX) && !isNaN(newY)) {
                this.setBoxPosition(newX, newY);
            }
            if (!isNaN(newW) && !isNaN(newH) && newW > 0 && newH > 0) {
                this.setBoxDimensions(newW, newH);
            }
        };

        ['prop-pos-x', 'prop-pos-y'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const posX = document.getElementById('prop-pos-x');
                const posY = document.getElementById('prop-pos-y');
                if (posX && posY) {
                    const currentTool = window.mollyEditor?.tools?.currentToolId;
                    if (currentTool === 'marquee') {
                        window.mollyEditor?.tools?.tools?.['marquee']?.setSelectionPosition(parseFloat(posX.value) || 0, parseFloat(posY.value) || 0);
                    } else {
                        this.setBoxPosition(parseFloat(posX.value), parseFloat(posY.value));
                    }
                }
            });
        });

        ['prop-size-w', 'prop-size-h'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const sizeW = document.getElementById('prop-size-w');
                const sizeH = document.getElementById('prop-size-h');
                if (sizeW && sizeH) {
                    const currentTool = window.mollyEditor?.tools?.currentToolId;
                    if (currentTool === 'marquee') {
                        window.mollyEditor?.tools?.tools?.['marquee']?.setSelectionDimensions(parseFloat(sizeW.value) || 1, parseFloat(sizeH.value) || 1);
                    } else {
                        this.setBoxDimensions(parseFloat(sizeW.value), parseFloat(sizeH.value), id === 'prop-size-w' ? 'w' : 'h');
                    }
                }
            });
        });

        // Resample mode and Aspect ratio listeners
        document.getElementById('move-resample-mode')?.addEventListener('change', () => {
            if (this.isTransforming || this.isMoving) {
                this.drawOverlay();
            }
        });

        document.getElementById('move-lock-aspect')?.addEventListener('change', () => {
            if (this.isTransforming) {
                this.drawOverlay();
            }
        });
        document.getElementById('prop-lock-aspect')?.addEventListener('change', () => {
            if (this.isTransforming) {
                this.drawOverlay();
            }
        });
    }

    translateTargets(layer, dx, dy) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
        dx = Math.round(dx); dy = Math.round(dy);
        const targets = this.getMoveTargets(layer);
        const commands = [];
        for (const target of targets) {
            if (target.isGroup || target.type === 'group' || target.locked || target.visible === false
                || this.layerManager.isEditable?.(target) === false) continue;
            if (target.type === 'text' && target.textData) {
                const before = JSON.parse(JSON.stringify(target.textData));
                target.textData.x += dx;
                target.textData.y += dy;
                this.bus.emit('RENDER_TEXT_LAYER', target);
                commands.push(new TextDataCommand(target, before, target.textData, this.bus));
            } else {
                const before = target.getImageData();
                const box = target.sourceRect || this.getLayerBoundingBox(target);
                const source = this.ensureSourceCanvas(target);
                if (!box || !source) continue;
                target.clear(false);
                this.drawResampled(target.ctx, source, box.x + dx, box.y + dy, box.w, box.h, 0, this.getResampleMode());
                target.setMasterSource(source, { ...box, x: box.x + dx, y: box.y + dy });
                this.translateShape(target, dx, dy);
                commands.push(new DrawCommand(target, before, target.getImageData()));
            }
        }
        if (commands.length) {
            const command = new CompoundCommand(commands);
            command.name = 'Перемещение';
            command.icon = 'open_with';
            this.history.push(command);
        }
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    getMoveTargets(layer, includeSelection = true) {
        const selected = this.layerManager.getSelectedLayers?.() || [];
        const roots = includeSelection && selected.includes(layer) ? selected : [layer];
        const result = [], seen = new Set();
        const visit = item => {
            if (!item || seen.has(item.id)) return;
            seen.add(item.id);
            if (item.locked || item.visible === false || this.layerManager.isEditable?.(item) === false) return;
            if (item.isGroup || item.type === 'group') {
                for (const child of this.layerManager.getGroupLayers?.(item.id) || []) visit(child);
            } else result.push(item);
        };
        roots.forEach(visit);
        return result;
    }

    translateShape(layer, dx, dy) {
        if (!layer.shapeData) return;
        layer.shapeData.x0 += dx;
        layer.shapeData.x1 += dx;
        layer.shapeData.y0 += dy;
        layer.shapeData.y1 += dy;
    }

    setBoxPosition(newX, newY) {
        const layer = this.getEditableLayer();
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || !Number.isFinite(newX) || !Number.isFinite(newY)) return;
        const box = layer.isGroup || layer.type === 'group' ? this.getGroupBoundingBox(layer.id) : layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!box) return;
        this.translateTargets(layer, Math.round(newX - box.x), Math.round(newY - box.y));
    }

    setBoxDimensions(newW, newH, axis = null) {
        const layer = this.getEditableLayer();
        if (!layer || layer.locked || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || this.layerManager.isEditable?.(layer) === false) return;
        const box = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!box) return;

        if (!Number.isFinite(newW) || !Number.isFinite(newH)) return;
        let w = Math.max(1, Math.min(4096, Math.round(newW)));
        let h = Math.max(1, Math.min(4096, Math.round(newH)));
        if (axis && this.isLockAspect()) {
            if (axis === 'w') h = Math.max(1, Math.min(4096, Math.round(w * box.h / box.w)));
            else w = Math.max(1, Math.min(4096, Math.round(h * box.w / box.h)));
        }
        if (w === box.w && h === box.h) return;

        const src = this.ensureSourceCanvas(layer);
        if (!src) return;

        const beforeData = layer.getImageData();
        const mode = this.getResampleMode();
        layer.clear(false);

        this.drawResampled(layer.ctx, src, box.x, box.y, w, h, 0, mode);
        layer.setMasterSource(src, { x: box.x, y: box.y, w, h });
        layer.thumbNeedsUpdate = true;
        layer.fxDirty = true;
        layer.shapeData = null;
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));

        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    alignLayer(type) {
        const layer = this.targetLayer || this.getEditableLayer();
        if (!layer || layer.locked) return;
        if (this.isTransforming || this.isMoving) this.commitAction();
        const box = layer.isGroup ? this.getGroupBoundingBox(layer.id) : layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!box) return;
        const dx = type === 'center-h' ? Math.round((this.layerManager.config.width - box.w) / 2) - box.x : 0;
        const dy = type === 'center-v' ? Math.round((this.layerManager.config.height - box.h) / 2) - box.y : 0;
        this.translateTargets(layer, dx, dy);
    }

    getEditableLayer() {
        const active = this.layerManager.getActiveLayer();
        if (!active || active.visible === false || active.locked || this.layerManager.isEditable?.(active) === false) return null;
        return active;
    }

    syncBoxWithActiveLayer() {
        if (!this.isActive || this.isTransforming || this.isMoving) return;

        const layer = this.getEditableLayer();
        if (!layer || !layer.visible) {
            this.targetLayer = null;
            this.currentBox = null;
            this.bus.emit('PREVIEW_CLEARED');
            return;
        }

        this.targetLayer = layer;

        // Toggle bitmap-only controls: hide for text and GUI template
        const isGroup = layer.isGroup || layer.type === 'group';
        const isOnlyMoveable = layer.type === 'text' || layer.isBase || isGroup;
        const bitmapControls = document.getElementById('move-bitmap-controls');
        if (bitmapControls) {
            bitmapControls.style.display = isOnlyMoveable ? 'none' : 'inline-flex';
        }

        if (isGroup) {
            const gb = this.getGroupBoundingBox(layer.id);
            if (gb) {
                this.currentBox = { x: gb.x, y: gb.y, w: gb.w, h: gb.h, angle: 0, px: 0.5, py: 0.5 };
                this.updateDimensionBadge(gb.w, gb.h, gb.w, gb.h);
            } else {
                this.currentBox = { x: 0, y: 0, w: layer.width, h: layer.height, angle: 0, px: 0.5, py: 0.5 };
                this.updateDimensionBadge(null, null);
            }
        } else if (layer.sourceRect && layer.sourceCanvas) {
            this.currentBox = {
                x: layer.sourceRect.x,
                y: layer.sourceRect.y,
                w: Math.max(1, layer.sourceRect.w),
                h: Math.max(1, layer.sourceRect.h),
                angle: 0,
                px: 0.5,
                py: 0.5
            };
            this.updateDimensionBadge(layer.sourceRect.w, layer.sourceRect.h, layer.sourceCanvas.width, layer.sourceCanvas.height);
        } else {
            const b = this.getLayerBoundingBox(layer);
            if (b) {
                this.currentBox = { x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), angle: 0, px: 0.5, py: 0.5 };
                this.updateDimensionBadge(b.w, b.h, b.w, b.h);
            } else {
                this.currentBox = { x: 0, y: 0, w: layer.width, h: layer.height, angle: 0, px: 0.5, py: 0.5 };
                this.updateDimensionBadge(null, null);
            }
        }

        this.drawOverlay();
    }

    getGroupBoundingBox(groupId) {
        const group = this.layerManager.getLayers().find(item => item.id === groupId);
        const childLayers = this.getMoveTargets(group, false);
        if (!childLayers || childLayers.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let hasAny = false;
        for (const l of childLayers) {
            if (!l.visible) continue;
            const b = l.sourceRect || this.getLayerBoundingBox(l);
            if (b) {
                hasAny = true;
                if (b.x < minX) minX = b.x;
                if (b.y < minY) minY = b.y;
                if (b.x + b.w > maxX) maxX = b.x + b.w;
                if (b.y + b.h > maxY) maxY = b.y + b.h;
            }
        }
        if (!hasAny) return null;
        return {
            x: minX,
            y: minY,
            w: Math.max(1, maxX - minX),
            h: Math.max(1, maxY - minY)
        };
    }

    getLayerBoundingBox(layer) {
        if (!layer || !layer.ctx) return null;
        if (typeof layer.getBounds === 'function') {
            const bounds = layer.getBounds();
            return bounds || (layer.type === 'text' && layer.textData ? { x: layer.textData.x || 0, y: layer.textData.y || 0, w: 60, h: 16 } : null);
        }
        const imgData = layer.ctx.getImageData(0, 0, layer.width, layer.height);
        const data32 = new Uint32Array(imgData.data.buffer);
        const w = layer.width;
        const h = layer.height;

        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            const rowOffset = y * w;
            for (let x = 0; x < w; x++) {
                if ((data32[rowOffset + x] & 0xFF000000) !== 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (maxX === -1) {
            if (layer.type === 'text' && layer.textData) {
                return { x: layer.textData.x || 0, y: layer.textData.y || 0, w: 60, h: 16 };
            }
            return null;
        }

        return {
            x: minX,
            y: minY,
            w: maxX - minX + 1,
            h: maxY - minY + 1
        };
    }

    getHandles(b) {
        if (!b || (this.targetLayer && (this.targetLayer.type === 'text' || this.targetLayer.isBase || this.targetLayer.locked || this.targetLayer.isGroup || this.targetLayer.type === 'group'))) return [];
        const normX = Math.min(b.x, b.x + b.w);
        const normY = Math.min(b.y, b.y + b.h);
        const normW = Math.abs(b.w);
        const normH = Math.abs(b.h);
        const x1 = normX;
        const x2 = normX + normW;
        const y1 = normY;
        const y2 = normY + normH;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        return [
            { id: 'nw', x: x1, y: y1, cursor: 'nwse-resize' },
            { id: 'n', x: midX, y: y1, cursor: 'ns-resize' },
            { id: 'ne', x: x2, y: y1, cursor: 'nesw-resize' },
            { id: 'w', x: x1, y: midY, cursor: 'ew-resize' },
            { id: 'e', x: x2, y: midY, cursor: 'ew-resize' },
            { id: 'sw', x: x1, y: y2, cursor: 'nesw-resize' },
            { id: 's', x: midX, y: y2, cursor: 'ns-resize' },
            { id: 'se', x: x2, y: y2, cursor: 'nwse-resize' },
            { id: 'rot', x: midX, y: y1 - 18 / (globalThis.window?.mollyEditor?.workspace?.zoom || 1), cursor: 'crosshair' }
        ];
    }

    findHandleAt(px, py) {
        if (!this.currentBox || (this.targetLayer && (this.targetLayer.type === 'text' || this.targetLayer.isBase || this.targetLayer.locked || this.targetLayer.isGroup || this.targetLayer.type === 'group'))) return null;
        const handles = this.getHandles(this.currentBox);
        let bestHandle = null;
        const zoom = window.mollyEditor?.workspace?.zoom || 1;
        const hitRadius = 7 / zoom;
        let bestDist = hitRadius * hitRadius;

        for (const h of handles) {
            const dist = (px - h.x) * (px - h.x) + (py - h.y) * (py - h.y);
            if (dist < bestDist) {
                bestDist = dist;
                bestHandle = h;
            }
        }
        return bestHandle;
    }

    isInsideBox(px, py) {
        if (!this.currentBox) return false;
        const normX = Math.min(this.currentBox.x, this.currentBox.x + this.currentBox.w);
        const normY = Math.min(this.currentBox.y, this.currentBox.y + this.currentBox.h);
        const normW = Math.abs(this.currentBox.w);
        const normH = Math.abs(this.currentBox.h);

        const zoom = window.mollyEditor?.workspace?.zoom || 1;
        const margin = 4 / zoom;

        return px >= normX - margin && px <= normX + normW + margin &&
               py >= normY - margin && py <= normY + normH + margin;
    }

    findLayerAtPoint(px, py) {
        const layers = this.layerManager.getLayers();
        for (let i = layers.length - 1; i >= 0; i--) {
            const l = layers[i];
            if (!l.visible || l.locked || l.isGroup || this.layerManager.isEditable?.(l) === false) continue;
            if (px < 0 || py < 0 || px >= l.width || py >= l.height) continue;
            const p = l.ctx.getImageData(px, py, 1, 1).data;
            if (p[3] > 0) return l;
        }
        return null;
    }

    onPointerDown(x, y, color, size, layer, e) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const px = x;
        const py = y;

        let activeTarget = this.getEditableLayer();
        if (activeTarget && !this.currentBox) {
            this.syncBoxWithActiveLayer();
        }

        const isOnlyMoveable = activeTarget && (activeTarget.type === 'text' || activeTarget.isBase || activeTarget.isGroup || activeTarget.type === 'group');
        const handle = (activeTarget && !activeTarget.locked && !isOnlyMoveable) ? this.findHandleAt(px, py) : null;
        const insideActiveBox = (activeTarget && !activeTarget.locked) ? this.isInsideBox(px, py) : false;

        // Auto-select layer if clicking outside active layer's handles and box
        if (!handle && !insideActiveBox) {
            const autoSel = document.getElementById('move-autosel')?.checked ?? true;
            if (autoSel && !this.isTransforming && !this.isMoving) {
                const hit = this.findLayerAtPoint(px, py);
                if (hit && hit !== activeTarget) {
                    this.layerManager.setActive(hit.id);
                    this.syncBoxWithActiveLayer();
                    activeTarget = hit;
                }
            }
        }

        const target = this.getEditableLayer();
        if (!target || target.locked || !target.visible) return;

        this.targetLayer = target;
        this.isPointerDown = true;
        this.hasMoved = false;
        this.dragStart = { x: px, y: py };
        this.activeSnapLines = [];
        this.liveStretchedAspect = null;

        if (!this.currentBox) {
            this.syncBoxWithActiveLayer();
        }
        if (!this.currentBox) return;

        const isGroup = target.isGroup || target.type === 'group';
        const isTargetOnlyMoveable = target.type === 'text' || target.isBase || isGroup;
        this.activeHandle = isTargetOnlyMoveable ? null : this.findHandleAt(px, py);

        // Prepare beforeData snapshot for Undo
        this.beforeData = (!isGroup && target.type !== 'text') ? target.getImageData() : null;
        this.boxStart = { ...this.currentBox };

        // Pristine Master Source: use ensureSourceCanvas to keep high-res master intact
        if (!isGroup && target.type !== 'text') {
            this.activeSourceCanvas = this.ensureSourceCanvas(target);
        } else {
            this.activeSourceCanvas = null;
        }

        // A handle transforms only the active bitmap. Companions participate in translation only.
        this.selectedLayersStart = [];
        this.textBeforeData = target.textData ? structuredClone(target.textData) : null;
        this.textStartRevision = target.contentRevision || 0;
        if (!this.activeHandle) {
            for (const item of this.getMoveTargets(target)) {
                if (item === target) continue;
                const b = item.sourceRect || this.getLayerBoundingBox(item);
                if (!b) continue;
                this.selectedLayersStart.push({
                    layer: item, startX: b.x, startY: b.y, w: b.w, h: b.h,
                    beforeData: item.type !== 'text' ? item.getImageData() : null,
                    sourceCanvas: item.type !== 'text' ? this.ensureSourceCanvas(item) : null,
                    textData: item.textData ? structuredClone(item.textData) : null,
                    revision: item.contentRevision || 0
                });
            }
        }

        if (this.activeHandle) {
            this.isTransforming = true;
            this.updateDimensionBadge(this.currentBox.w, this.currentBox.h, this.activeSourceCanvas?.width, this.activeSourceCanvas?.height);

            if (this.activeHandle.id === 'rot') {
                const cx = this.currentBox.x + this.currentBox.w * 0.5;
                const cy = this.currentBox.y + this.currentBox.h * 0.5;
                this.startAngle = Math.atan2(py - cy, px - cx);
                this.currentBox.angle = 0;
            }
            return;
        }

        if (this.isInsideBox(px, py)) {
            this.activeHandle = { id: 'move' };
            this.isMoving = true;

            if (target.type === 'text' && target.textData) {
                this.textStartX = target.textData.x || 0;
                this.textStartY = target.textData.y || 0;
            }
            return;
        }
    }

    computeSnapping(rawX, rawY, w, h) {
        const snapToggle = document.getElementById('move-snap');
        const snapEnabled = snapToggle ? snapToggle.checked : (window.mollyEditor?.settingsManager?.get('snapEnabled') ?? true);
        if (!snapEnabled) {
            this.activeSnapLines = [];
            return { x: rawX, y: rawY };
        }

        const threshold = window.mollyEditor?.settingsManager?.get('snapThreshold') ?? 5;
        const cw = this.layerManager.config.width;
        const ch = this.layerManager.config.height;

        let finalX = rawX;
        let finalY = rawY;
        const snapLines = [];

        // Vertical snap targets (X-coordinates)
        const xTargets = [
            { pos: 0, type: 'edge' },
            { pos: cw, type: 'edge' },
            { pos: Math.round(cw / 2), type: 'center' }
        ];

        // Horizontal snap targets (Y-coordinates)
        const yTargets = [
            { pos: 0, type: 'edge' },
            { pos: ch, type: 'edge' },
            { pos: Math.round(ch / 2), type: 'center' }
        ];

        // Collect other layers bounds for snapping
        const layers = this.layerManager.getLayers();
        const movingIds = new Set([this.targetLayer?.id, ...(this.selectedLayersStart || []).map(item => item.layer.id)]);
        for (const l of layers) {
            if (movingIds.has(l.id) || !l.visible || l.isGroup || l.type === 'group' || this.layerManager.isEditable?.(l) === false) continue;
            const b = this.getLayerBoundingBox(l);
            if (b) {
                xTargets.push({ pos: b.x, type: 'layer' }, { pos: b.x + b.w, type: 'layer' }, { pos: Math.round(b.x + b.w / 2), type: 'center' });
                yTargets.push({ pos: b.y, type: 'layer' }, { pos: b.y + b.h, type: 'layer' }, { pos: Math.round(b.y + b.h / 2), type: 'center' });
            }
        }

        // Collect custom user guides for magnetic snapping
        const wsGuides = window.mollyEditor?.workspace?.guides;
        if (wsGuides && window.mollyEditor?.workspace?.guidesVisible) {
            if (wsGuides.vertical) {
                for (const gx of wsGuides.vertical) {
                    xTargets.push({ pos: gx, type: 'guide' });
                }
            }
            if (wsGuides.horizontal) {
                for (const gy of wsGuides.horizontal) {
                    yTargets.push({ pos: gy, type: 'guide' });
                }
            }
        }

        // Check horizontal snap (X)
        const myPointsX = [
            { offset: 0, name: 'left' },
            { offset: Math.round(w / 2), name: 'center' },
            { offset: w, name: 'right' }
        ];

        let minDiffX = threshold + 1;
        let bestSnapX = null;

        for (const pt of myPointsX) {
            const currentPtX = rawX + pt.offset;
            for (const tgt of xTargets) {
                const diff = Math.abs(currentPtX - tgt.pos);
                if (diff <= threshold && diff < minDiffX) {
                    minDiffX = diff;
                    bestSnapX = { targetPos: tgt.pos, myOffset: pt.offset };
                }
            }
        }

        if (bestSnapX) {
            finalX = bestSnapX.targetPos - bestSnapX.myOffset;
            snapLines.push({ type: 'v', pos: bestSnapX.targetPos });
        }

        // Check vertical snap (Y)
        const myPointsY = [
            { offset: 0, name: 'top' },
            { offset: Math.round(h / 2), name: 'center' },
            { offset: h, name: 'bottom' }
        ];

        let minDiffY = threshold + 1;
        let bestSnapY = null;

        for (const pt of myPointsY) {
            const currentPtY = rawY + pt.offset;
            for (const tgt of yTargets) {
                const diff = Math.abs(currentPtY - tgt.pos);
                if (diff <= threshold && diff < minDiffY) {
                    minDiffY = diff;
                    bestSnapY = { targetPos: tgt.pos, myOffset: pt.offset };
                }
            }
        }

        if (bestSnapY) {
            finalY = bestSnapY.targetPos - bestSnapY.myOffset;
            snapLines.push({ type: 'h', pos: bestSnapY.targetPos });
        }

        this.activeSnapLines = snapLines;
        return { x: finalX, y: finalY };
    }

    onPointerMove(x, y, color, size, layer, e) {
        if (!this.isPointerDown || !this.activeHandle || !this.currentBox || !this.boxStart) return;

        const px = x;
        const py = y;
        const dx = Math.round(px - this.dragStart.x);
        const dy = Math.round(py - this.dragStart.y);

        this.lastPointerEvent = { x: px, y: py, e };

        if (dx !== 0 || dy !== 0) this.hasMoved = true;

        if (!this.hasMoved) return;

        const shiftKey = e?.shiftKey ?? false;
        const altKey = e?.altKey ?? false;

        if (this.activeHandle.id === 'move') {
            const rawX = this.boxStart.x + dx;
            const rawY = this.boxStart.y + dy;
            const snapped = this.computeSnapping(rawX, rawY, this.boxStart.w, this.boxStart.h);

            if (this.targetLayer && this.targetLayer.type === 'text' && this.targetLayer.textData) {
                const textDx = snapped.x - this.boxStart.x;
                const textDy = snapped.y - this.boxStart.y;
                this.targetLayer.textData.x = this.textStartX + textDx;
                this.targetLayer.textData.y = this.textStartY + textDy;
                this.bus.emit('RENDER_TEXT_LAYER', this.targetLayer);
                this.currentBox.x = snapped.x;
                this.currentBox.y = snapped.y;
            } else {
                this.currentBox.x = snapped.x;
                this.currentBox.y = snapped.y;
            }
        } else if (this.activeHandle.id === 'rot') {
            this.activeSnapLines = [];
            const cx = this.boxStart.x + this.boxStart.w * 0.5;
            const cy = this.boxStart.y + this.boxStart.h * 0.5;
            let a = Math.atan2(py - cy, px - cx) - this.startAngle;
            if (shiftKey) {
                const snap = Math.PI / 12; // Snap to 15 degrees
                a = Math.round(a / snap) * snap;
            }
            this.currentBox.angle = a;
            const deg = Math.round((a * 180 / Math.PI)) % 360;
            this.updateAngleBadge(deg);
        } else {
            this.activeSnapLines = [];
            this.scaleBoxFromHandle(this.activeHandle.id, dx, dy, shiftKey, altKey, e);
        }

        this.renderLivePixels();
        this.drawOverlay();
    }

    renderLivePixels() {
        const target = this.targetLayer, box = this.currentBox, start = this.boxStart;
        if (!target || !box || !start || !this.hasMoved) return;
        if (target.locked || target.visible === false || this.layerManager.isEditable?.(target) === false) { this.cancelAction(); return; }
        if (this.isMoving) {
            const dx = box.x - start.x, dy = box.y - start.y;
            for (const item of this.selectedLayersStart || []) {
                if (item.layer.locked || item.layer.visible === false || this.layerManager.isEditable?.(item.layer) === false) continue;
                if (item.layer.type === 'text' && item.textData) {
                    item.layer.textData.x = item.textData.x + dx;
                    item.layer.textData.y = item.textData.y + dy;
                    this.bus.emit('RENDER_TEXT_LAYER', item.layer);
                } else if (item.sourceCanvas) {
                    item.layer.clear(false);
                    this.drawResampled(item.layer.ctx, item.sourceCanvas, item.startX + dx, item.startY + dy, item.w, item.h, 0, this.getResampleMode());
                }
            }
        }
        if (this.activeSourceCanvas && target.type !== 'text') {
            target.clear(false);
            if (this.isMoving) this.drawResampled(target.ctx, this.activeSourceCanvas, box.x, box.y, start.w, start.h, 0, this.getResampleMode());
            else if (this.activeHandle?.id === 'rot') {
                const rotated = this.createRotatedSource(this.activeSourceCanvas, start, box.angle || 0);
                this.drawResampled(target.ctx, rotated.canvas, rotated.rect.x, rotated.rect.y, rotated.rect.w, rotated.rect.h, 0, this.getResampleMode());
            } else {
                target.ctx.save();
                target.ctx.translate(box.x, box.y);
                target.ctx.scale(box.w < 0 ? -1 : 1, box.h < 0 ? -1 : 1);
                this.drawResampled(target.ctx, this.activeSourceCanvas, 0, 0, Math.abs(box.w), Math.abs(box.h), 0, this.getResampleMode());
                target.ctx.restore();
            }
        }
        this.bus.emit('CANVAS_UPDATED');
    }

    scaleBoxFromHandle(handleId, dx, dy, shift, alt, e = null) {
        const bs = this.boxStart;
        if (!bs || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (alt) { dx *= 2; dy *= 2; }
        let x = bs.x;
        let y = bs.y;
        let w = bs.w;
        let h = bs.h;

        const isCorner = ['nw', 'ne', 'se', 'sw'].includes(handleId);
        const lockAspect = this.isLockAspect();
        // Holding Shift enables free stretch; without Shift corner handles scale proportionally
        const freeStretch = shift || (!isCorner && !lockAspect);
        const baseAspect = Math.max(0.0001, Math.abs(bs.w) / Math.max(1, Math.abs(bs.h)));

        if (freeStretch) {
            // Free Stretch (Растяжение): corners and sides stretch freely with cursor
            switch (handleId) {
                case 'se':
                    w = bs.w + dx;
                    h = bs.h + dy;
                    break;
                case 'nw':
                    x = bs.x + dx;
                    y = bs.y + dy;
                    w = bs.w - dx;
                    h = bs.h - dy;
                    break;
                case 'ne':
                    y = bs.y + dy;
                    w = bs.w + dx;
                    h = bs.h - dy;
                    break;
                case 'sw':
                    x = bs.x + dx;
                    w = bs.w - dx;
                    h = bs.h + dy;
                    break;
                case 'e':
                    w = bs.w + dx;
                    break;
                case 'w':
                    x = bs.x + dx;
                    w = bs.w - dx;
                    break;
                case 's':
                    h = bs.h + dy;
                    break;
                case 'n':
                    y = bs.y + dy;
                    h = bs.h - dy;
                    break;
            }
            if (Math.abs(w) > 0 && Math.abs(h) > 0) {
                this.liveStretchedAspect = Math.abs(w) / Math.abs(h);
            }
        } else {
            // Proportional Scale: strictly preserve the current aspect ratio of the object
            const aspect = baseAspect;
            switch (handleId) {
                case 'se': {
                    let newW = bs.w + dx;
                    let newH = bs.h + dy;
                    if (Math.abs(dx / (bs.w || 1)) >= Math.abs(dy / (bs.h || 1))) {
                        newH = newW / aspect;
                    } else {
                        newW = newH * aspect;
                    }
                    w = newW;
                    h = newH;
                    break;
                }
                case 'nw': {
                    let newW = bs.w - dx;
                    let newH = bs.h - dy;
                    if (Math.abs(dx / (bs.w || 1)) >= Math.abs(dy / (bs.h || 1))) {
                        newH = newW / aspect;
                    } else {
                        newW = newH * aspect;
                    }
                    w = newW;
                    h = newH;
                    x = (bs.x + bs.w) - newW;
                    y = (bs.y + bs.h) - newH;
                    break;
                }
                case 'ne': {
                    let newW = bs.w + dx;
                    let newH = bs.h - dy;
                    if (Math.abs(dx / (bs.w || 1)) >= Math.abs(dy / (bs.h || 1))) {
                        newH = newW / aspect;
                    } else {
                        newW = newH * aspect;
                    }
                    w = newW;
                    h = newH;
                    x = bs.x;
                    y = (bs.y + bs.h) - newH;
                    break;
                }
                case 'sw': {
                    let newW = bs.w - dx;
                    let newH = bs.h + dy;
                    if (Math.abs(dx / (bs.w || 1)) >= Math.abs(dy / (bs.h || 1))) {
                        newH = newW / aspect;
                    } else {
                        newW = newH * aspect;
                    }
                    w = newW;
                    h = newH;
                    x = (bs.x + bs.w) - newW;
                    y = bs.y;
                    break;
                }
                case 'e': {
                    w = bs.w + dx;
                    h = w / aspect;
                    y = bs.y + (bs.h - h) / 2;
                    break;
                }
                case 'w': {
                    w = bs.w - dx;
                    h = w / aspect;
                    x = bs.x + dx;
                    y = bs.y + (bs.h - h) / 2;
                    break;
                }
                case 's': {
                    h = bs.h + dy;
                    w = h * aspect;
                    x = bs.x + (bs.w - w) / 2;
                    break;
                }
                case 'n': {
                    h = bs.h - dy;
                    w = h * aspect;
                    y = bs.y + dy;
                    x = bs.x + (bs.w - w) / 2;
                    break;
                }
            }
        }

        if (alt) {
            // Alt: scale symmetrically from center
            x = bs.x - (w - bs.w) / 2;
            y = bs.y - (h - bs.h) / 2;
        }

        // Holding Ctrl snaps to clean integer pixel multiples (1x, 2x, 3x, 4x, etc.)
        const ctrlKey = Boolean(e?.ctrlKey);
        if (ctrlKey && this.activeSourceCanvas) {
            const origW = this.activeSourceCanvas.width;
            const origH = this.activeSourceCanvas.height;
            let factor = Math.abs(w) / origW;
            if (factor >= 1) {
                factor = Math.max(1, Math.round(factor));
            } else {
                factor = factor > 0.5 ? 0.5 : (factor > 0.25 ? 0.25 : 0.125);
            }
            w = Math.sign(w || 1) * Math.round(origW * factor);
            h = Math.sign(h || 1) * Math.round(origH * factor);
        }

        // Snap to whole pixels to eliminate subpixel interpolation blur
        w = Math.round(w);
        h = Math.round(h);
        if (Math.abs(w) < 1) w = Math.sign(w || 1);
        if (Math.abs(h) < 1) h = Math.sign(h || 1);
        w = Math.sign(w) * Math.min(4096, Math.abs(w));
        h = Math.sign(h) * Math.min(4096, Math.abs(h));
        // Rebuild the fixed anchor after pixel quantization, Ctrl snapping and size limits.
        x = alt ? bs.x + (bs.w - w) / 2 : handleId.includes('w') ? bs.x + bs.w - w : handleId === 'n' || handleId === 's' ? bs.x + (bs.w - w) / 2 : bs.x;
        y = alt ? bs.y + (bs.h - h) / 2 : handleId.includes('n') ? bs.y + bs.h - h : handleId === 'e' || handleId === 'w' ? bs.y + (bs.h - h) / 2 : bs.y;

        this.currentBox.x = Math.round(x);
        this.currentBox.y = Math.round(y);
        this.currentBox.w = w;
        this.currentBox.h = h;

        this.updateDimensionBadge(w, h, this.activeSourceCanvas?.width, this.activeSourceCanvas?.height);
    }

    onPointerUp(x, y, color, size, layer, e) {
        if (!this.isPointerDown) return;
        if (Number.isFinite(x) && Number.isFinite(y)) this.onPointerMove(x, y, color, size, layer, e);
        if (!this.isPointerDown) return;
        const completedHandle = this.activeHandle;
        this.isPointerDown = false;
        this.activeHandle = null;
        this.activeSnapLines = [];
        this.lastPointerEvent = null;

        if (this.hasMoved) {
            this.commitAction(completedHandle);
        } else {
            this.cancelAction();
        }
    }

    resetActionState() {
        this.isPointerDown = false;
        this.isMoving = false;
        this.isTransforming = false;
        this.hasMoved = false;
        this.activeHandle = null;
        this.activeSourceCanvas = null;
        this.beforeData = null;
        this.textBeforeData = null;
        this.selectedLayersStart = null;
        this.boxStart = null;
        this.lastPointerEvent = null;
        this.activeSnapLines = [];
        this.updateDimensionBadge(null, null);
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    createRotatedSource(source, box, angle) {
        const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
        const w = Math.max(1, Math.ceil(box.w * cos + box.h * sin - 1e-8));
        const h = Math.max(1, Math.ceil(box.w * sin + box.h * cos - 1e-8));
        const resolution = Math.min(Math.max(source.width / box.w, source.height / box.h, 1), 4096 / w, 4096 / h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * resolution));
        canvas.height = Math.max(1, Math.round(h * resolution));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = this.getResampleMode() === 'smooth';
        ctx.scale(canvas.width / w, canvas.height / h);
        ctx.translate(w / 2, h / 2);
        ctx.rotate(angle);
        ctx.drawImage(source, -box.w / 2, -box.h / 2, box.w, box.h);
        return { canvas, rect: { x: Math.floor(box.x + box.w / 2) - Math.floor(w / 2), y: Math.floor(box.y + box.h / 2) - Math.floor(h / 2), w, h } };
    }

    commitAction(completedHandle = this.activeHandle) {
        const target = this.targetLayer, box = this.currentBox, start = this.boxStart;
        if (!target || !box || !start || !this.hasMoved || this.layerManager.isEditable?.(target) === false || target.locked || target.visible === false) {
            this.cancelAction();
            return;
        }
        const commands = [], transforming = this.isTransforming;
        const dx = box.x - start.x, dy = box.y - start.y;
        if (this.isMoving) {
            if (!dx && !dy) { this.cancelAction(); return; }
            const items = [...(this.selectedLayersStart || [])];
            if (!target.isGroup && target.type !== 'group') items.push({
                layer: target, startX: start.x, startY: start.y, w: start.w, h: start.h,
                beforeData: this.beforeData, sourceCanvas: this.activeSourceCanvas, textData: this.textBeforeData
            });
            for (const item of items) {
                const layer = item.layer;
                if (layer.locked || layer.visible === false || this.layerManager.isEditable?.(layer) === false) {
                    if (item.beforeData) layer.putImageData(item.beforeData);
                    if (item.textData) { layer.textData = structuredClone(item.textData); this.bus.emit('RENDER_TEXT_LAYER', layer); }
                    continue;
                }
                if (layer.type === 'text' && item.textData) {
                    layer.textData.x = item.textData.x + dx;
                    layer.textData.y = item.textData.y + dy;
                    this.bus.emit('RENDER_TEXT_LAYER', layer);
                    commands.push(new TextDataCommand(layer, item.textData, layer.textData, this.bus));
                } else if (item.sourceCanvas) {
                    layer.clear(false);
                    const rect = { x: item.startX + dx, y: item.startY + dy, w: item.w, h: item.h };
                    this.drawResampled(layer.ctx, item.sourceCanvas, rect.x, rect.y, rect.w, rect.h, 0, this.getResampleMode());
                    layer.setMasterSource(item.sourceCanvas, rect);
                    this.translateShape(layer, dx, dy);
                    commands.push(new DrawCommand(layer, item.beforeData, layer.getImageData()));
                }
            }
        } else if (this.isTransforming && this.activeSourceCanvas && this.beforeData) {
            let source = this.activeSourceCanvas, rect;
            if (completedHandle?.id === 'rot') {
                if (Math.abs(box.angle || 0) < 1e-8) { this.cancelAction(); return; }
                const rotated = this.createRotatedSource(source, start, box.angle);
                source = rotated.canvas; rect = rotated.rect;
            } else {
                rect = { x: Math.round(box.w < 0 ? box.x + box.w : box.x), y: Math.round(box.h < 0 ? box.y + box.h : box.y),
                    w: Math.abs(box.w), h: Math.abs(box.h) };
                if (box.w === start.w && box.h === start.h && rect.x === start.x && rect.y === start.y) { this.cancelAction(); return; }
                if (box.w < 0 || box.h < 0) {
                    const flipped = document.createElement('canvas');
                    flipped.width = source.width; flipped.height = source.height;
                    const ctx = flipped.getContext('2d');
                    ctx.translate(box.w < 0 ? flipped.width : 0, box.h < 0 ? flipped.height : 0);
                    ctx.scale(box.w < 0 ? -1 : 1, box.h < 0 ? -1 : 1);
                    ctx.drawImage(source, 0, 0);
                    source = flipped;
                }
            }
            target.clear(false);
            this.drawResampled(target.ctx, source, rect.x, rect.y, rect.w, rect.h, 0, this.getResampleMode());
            target.setMasterSource(source, rect);
            target.shapeData = null;
            commands.push(new DrawCommand(target, this.beforeData, target.getImageData()));
        }
        if (commands.length) {
            const command = new CompoundCommand(commands);
            command.name = transforming ? 'Трансформация' : 'Перемещение';
            command.icon = 'open_with';
            this.history.push(command);
        }
        this.resetActionState();
    }

    cancelAction() {
        if (this.hasMoved && this.targetLayer && this.beforeData) {
            this.targetLayer.putImageData(this.beforeData);
            this.targetLayer.contentRevision = this.beforeData.mollySnapshot?.contentRevision ?? this.targetLayer.contentRevision;
        }
        if (this.hasMoved && this.targetLayer && this.textBeforeData) {
            this.targetLayer.textData = structuredClone(this.textBeforeData);
            this.bus.emit('RENDER_TEXT_LAYER', this.targetLayer);
            this.targetLayer.contentRevision = this.textStartRevision;
        }
        for (const item of this.hasMoved ? this.selectedLayersStart || [] : []) {
            if (item.beforeData) item.layer.putImageData(item.beforeData);
            if (item.textData) { item.layer.textData = structuredClone(item.textData); this.bus.emit('RENDER_TEXT_LAYER', item.layer); }
            item.layer.contentRevision = item.revision;
        }
        this.resetActionState();
    }

    get transformMode() {
        return Boolean(this.isTransforming || this.isMoving);
    }

    commitTransform() {
        this.commitAction();
    }

    cancelTransform() {
        this.cancelAction();
    }

    onHoverMove(x, y, e) {
        if (!this.isActive || this.isPointerDown || !this.currentBox) return;
        const px = x;
        const py = y;
        this.hoverPos = { x: px, y: py };

        this.drawOverlay();

        const h = this.findHandleAt(px, py);

        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;

        if (this.targetLayer?.locked) {
            canvas.style.cursor = 'not-allowed';
            return;
        }

        if (h) {
            canvas.style.cursor = h.cursor || 'pointer';
        } else if (this.isInsideBox(px, py)) {
            canvas.style.cursor = 'move';
        } else {
            canvas.style.cursor = 'default';
        }
    }

    drawOverlay() {
        if (!this.isActive || !this.currentBox || !this.targetLayer) {
            this.bus.emit('PREVIEW_CLEARED');
            return;
        }

        this.bus.emit('TRANSFORM_OVERLAY_UPDATED', (pCtx) => {
            const b = this.currentBox;
            const { x, y, w, h, angle } = b;
            const mode = this.getResampleMode();

            pCtx.save();
            pCtx.imageSmoothingEnabled = false;

            // Draw Smart Magnetic Snap Guides across the canvas (Figma Magenta style)
            if (this.activeSnapLines && this.activeSnapLines.length > 0) {
                const cw = this.layerManager.config.width;
                const ch = this.layerManager.config.height;

                pCtx.save();
                pCtx.strokeStyle = '#E11D48';
                pCtx.lineWidth = 1;
                pCtx.setLineDash([3, 2]);

                for (const line of this.activeSnapLines) {
                    pCtx.beginPath();
                    if (line.type === 'v') {
                        pCtx.moveTo(line.pos + 0.5, 0);
                        pCtx.lineTo(line.pos + 0.5, ch);
                    } else if (line.type === 'h') {
                        pCtx.moveTo(0, line.pos + 0.5);
                        pCtx.lineTo(cw, line.pos + 0.5);
                    }
                    pCtx.stroke();
                }
                pCtx.restore();
            }

            // Figma-style Alt-spacing Distance Inspector
            if (this.isAltInspectorActive && this.currentBox) {
                this.drawAltInspector(pCtx);
            }

            // Draw Bounding Box & Handles
            const accent = getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim() || '#3B82F6';
            const unit = 1 / (window.mollyEditor?.workspace?.zoom || 1);
            pCtx.strokeStyle = this.targetLayer.locked ? '#EF4444' : accent;
            pCtx.lineWidth = unit;

            if (this.isTransforming && this.activeHandle?.id === 'rot') {
                // Rotated bounding box
                const cx = this.boxStart.x + this.boxStart.w * 0.5;
                const cy = this.boxStart.y + this.boxStart.h * 0.5;
                pCtx.translate(cx, cy);
                pCtx.rotate(angle || 0);

                const hw = this.boxStart.w / 2;
                const hh = this.boxStart.h / 2;
                pCtx.setLineDash([4, 4]);
                pCtx.strokeRect(-hw, -hh, this.boxStart.w, this.boxStart.h);
                pCtx.setLineDash([]);

                // Rotation handle stem
                pCtx.beginPath();
                pCtx.moveTo(0, -hh);
                pCtx.lineTo(0, -hh - 18 * unit);
                pCtx.stroke();

                pCtx.fillStyle = '#FFFFFF';
                pCtx.beginPath();
                pCtx.arc(0, -hh - 18 * unit, 3 * unit, 0, Math.PI * 2);
                pCtx.fill();
                pCtx.stroke();
            } else {
                // Standard bounding box
                const normX = Math.round(w < 0 ? x + w : x);
                const normY = Math.round(h < 0 ? y + h : y);
                const absW = Math.max(1, Math.abs(Math.round(w)));
                const absH = Math.max(1, Math.abs(Math.round(h)));

                pCtx.setLineDash([4, 4]);
                pCtx.strokeRect(normX, normY, absW, absH);
                pCtx.setLineDash([]);

                // Draw handles ONLY for regular bitmap layers (not text, not base template, not locked)
                if (this.targetLayer.type !== 'text' && !this.targetLayer.isBase && !this.targetLayer.locked && !this.targetLayer.isGroup && this.targetLayer.type !== 'group') {
                    const handles = [
                        { x: normX, y: normY },
                        { x: normX + absW / 2, y: normY },
                        { x: normX + absW, y: normY },
                        { x: normX, y: normY + absH / 2 },
                        { x: normX + absW, y: normY + absH / 2 },
                        { x: normX, y: normY + absH },
                        { x: normX + absW / 2, y: normY + absH },
                        { x: normX + absW, y: normY + absH }
                    ];

                    pCtx.fillStyle = '#FFFFFF';
                    pCtx.strokeStyle = accent;
                    pCtx.lineWidth = unit;

                    for (const pt of handles) {
                        pCtx.fillRect(pt.x - 3 * unit, pt.y - 3 * unit, 6 * unit, 6 * unit);
                        pCtx.strokeRect(pt.x - 3 * unit, pt.y - 3 * unit, 6 * unit, 6 * unit);
                    }

                    // Rotation handle stem
                    const topMidX = normX + absW / 2;
                    const topMidY = normY;
                    pCtx.beginPath();
                    pCtx.moveTo(topMidX, topMidY);
                    pCtx.lineTo(topMidX, topMidY - 18 * unit);
                    pCtx.stroke();

                    pCtx.beginPath();
                    pCtx.arc(topMidX, topMidY - 18 * unit, 3 * unit, 0, Math.PI * 2);
                    pCtx.fill();
                    pCtx.stroke();
                }
            }

            pCtx.restore();
        });
    }

    drawAltInspector(pCtx) {
        const b = this.currentBox;
        if (!b) return;

        const cw = this.layerManager.config.width;
        const ch = this.layerManager.config.height;
        const bx1 = Math.min(b.x, b.x + b.w);
        const by1 = Math.min(b.y, b.y + b.h);
        const bx2 = bx1 + Math.abs(b.w);
        const by2 = by1 + Math.abs(b.h);

        pCtx.save();
        pCtx.font = 'bold 9px Google Sans, sans-serif';
        pCtx.textAlign = 'center';
        pCtx.textBaseline = 'middle';
        pCtx.lineWidth = 1;
        pCtx.strokeStyle = '#E11D48';
        pCtx.fillStyle = '#E11D48';

        let targetB = null;
        if (this.hoverPos && (this.hoverPos.x >= 0 && this.hoverPos.y >= 0)) {
            const layers = this.layerManager.getLayers();
            for (let i = layers.length - 1; i >= 0; i--) {
                const l = layers[i];
                if (l.id === this.targetLayer?.id || !l.visible) continue;
                const lb = this.getLayerBoundingBox(l);
                if (lb && this.hoverPos.x >= lb.x && this.hoverPos.x <= lb.x + lb.w &&
                    this.hoverPos.y >= lb.y && this.hoverPos.y <= lb.y + lb.h) {
                    targetB = lb;
                    break;
                }
            }
        }

        const drawBadge = (badgeX, badgeY, text) => {
            const tw = Math.max(22, pCtx.measureText(text).width + 8);
            const th = 14;
            pCtx.fillStyle = '#E11D48';
            pCtx.beginPath();
            pCtx.rect(badgeX - tw / 2, badgeY - th / 2, tw, th);
            pCtx.fill();
            pCtx.fillStyle = '#FFFFFF';
            pCtx.fillText(text, badgeX, badgeY);
        };

        const drawDistV = (lineX, topY, botY, val) => {
            if (val <= 0) return;
            pCtx.strokeStyle = '#E11D48';
            pCtx.beginPath();
            pCtx.moveTo(lineX + 0.5, topY);
            pCtx.lineTo(lineX + 0.5, botY);
            pCtx.moveTo(lineX - 3.5, topY);
            pCtx.lineTo(lineX + 4.5, topY);
            pCtx.moveTo(lineX - 3.5, botY);
            pCtx.lineTo(lineX + 4.5, botY);
            pCtx.stroke();
            drawBadge(lineX, (topY + botY) / 2, `${val}`);
        };

        const drawDistH = (lineY, leftX, rightX, val) => {
            if (val <= 0) return;
            pCtx.strokeStyle = '#E11D48';
            pCtx.beginPath();
            pCtx.moveTo(leftX, lineY + 0.5);
            pCtx.lineTo(rightX, lineY + 0.5);
            pCtx.moveTo(leftX, lineY - 3.5);
            pCtx.lineTo(leftX, lineY + 4.5);
            pCtx.moveTo(rightX, lineY - 3.5);
            pCtx.lineTo(rightX, lineY + 4.5);
            pCtx.stroke();
            drawBadge((leftX + rightX) / 2, lineY, `${val}`);
        };

        if (targetB) {
            pCtx.setLineDash([2, 2]);
            pCtx.strokeRect(targetB.x, targetB.y, targetB.w, targetB.h);
            pCtx.setLineDash([]);

            const tx1 = targetB.x;
            const ty1 = targetB.y;
            const tx2 = targetB.x + targetB.w;
            const ty2 = targetB.y + targetB.h;

            if (tx1 >= bx2) {
                drawDistH(Math.round((Math.max(by1, ty1) + Math.min(by2, ty2)) / 2), bx2, tx1, tx1 - bx2);
            } else if (bx1 >= tx2) {
                drawDistH(Math.round((Math.max(by1, ty1) + Math.min(by2, ty2)) / 2), tx2, bx1, bx1 - tx2);
            }

            if (ty1 >= by2) {
                drawDistV(Math.round((Math.max(bx1, tx1) + Math.min(bx2, tx2)) / 2), by2, ty1, ty1 - by2);
            } else if (by1 >= ty2) {
                drawDistV(Math.round((Math.max(bx1, tx1) + Math.min(bx2, tx2)) / 2), ty2, by1, by1 - ty2);
            }
        } else {
            const midX = Math.round(bx1 + (bx2 - bx1) / 2);
            const midY = Math.round(by1 + (by2 - by1) / 2);

            drawDistV(midX, 0, by1, by1);
            drawDistV(midX, by2, ch, ch - by2);
            drawDistH(midY, 0, bx1, bx1);
            drawDistH(midY, bx2, cw, cw - bx2);
        }

        pCtx.restore();
    }

    onKeyDown(e) {
        if (e?.defaultPrevented || isShortcutTarget(e?.target, e)) return;
        if (!this.isActive) return;

        if (e.key === 'Escape') {
            if (this.isTransforming || this.isMoving) {
                this.cancelAction();
                e.preventDefault();
                return;
            }
        }

        if (['Shift', 'Alt', 'Control'].includes(e.key)) {
            if (this.isTransforming && this.activeHandle && this.lastPointerEvent) {
                const px = this.lastPointerEvent.x;
                const py = this.lastPointerEvent.y;
                this.onPointerMove(px, py, null, null, null, e);
            }
        }

        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
            if (!this.isAltInspectorActive && this.isActive && !this.isMoving && !this.isTransforming) {
                this.isAltInspectorActive = true;
                this.drawOverlay();
            }
        }

        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            if (this.isPointerDown || e.ctrlKey || e.metaKey || e.altKey) return;
            // If Marquee has active selection, let Marquee handle its selection nudge
            const marquee = window.mollyEditor?.tools?.tools?.['marquee'];
            if (window.mollyEditor?.tools?.currentToolId === 'marquee' && marquee?.selection) {
                return;
            }

            e.preventDefault();
            const step = e.shiftKey ? 10 : 1;
            const dx = e.key === 'ArrowLeft' ? -step : (e.key === 'ArrowRight' ? step : 0);
            const dy = e.key === 'ArrowUp' ? -step : (e.key === 'ArrowDown' ? step : 0);
            this.nudge(dx, dy);
        }
    }

    onKeyUp(e) {
        if (e?.defaultPrevented || isShortcutTarget(e?.target, e)) return;
        if (!this.isActive) { this.isAltInspectorActive = false; return; }

        if (['Shift', 'Alt', 'Control'].includes(e.key)) {
            if (this.isTransforming && this.activeHandle && this.lastPointerEvent) {
                const px = this.lastPointerEvent.x;
                const py = this.lastPointerEvent.y;
                this.onPointerMove(px, py, null, null, null, e);
            }
        }

        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
            if (this.isAltInspectorActive) {
                this.isAltInspectorActive = false;
                this.drawOverlay();
            }
        }
    }

    nudge(dx, dy) {
        const layer = this.targetLayer || this.getEditableLayer();
        if (!layer || layer.locked) return;
        if (this.isTransforming || this.isMoving) this.commitAction();
        this.translateTargets(layer, dx, dy);
    }

    flip(h, v) {
        const layer = this.targetLayer || this.layerManager.getActiveLayer();
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || layer.isGroup || layer.type === 'text' || layer.isBase) return;
        const b = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!b) return;

        const beforeData = layer.getImageData();
        const src = this.ensureSourceCanvas(layer);
        if (!src) return;

        // Lossless flip of master source
        const fCanvas = document.createElement('canvas');
        fCanvas.width = src.width;
        fCanvas.height = src.height;
        const fCtx = fCanvas.getContext('2d');
        fCtx.imageSmoothingEnabled = false;
        fCtx.save();
        fCtx.translate(h ? fCanvas.width : 0, v ? fCanvas.height : 0);
        fCtx.scale(h ? -1 : 1, v ? -1 : 1);
        fCtx.drawImage(src, 0, 0);
        fCtx.restore();

        layer.clear(false);
        const mode = this.getResampleMode();
        this.drawResampled(layer.ctx, fCanvas, b.x, b.y, b.w, b.h, 0, mode);
        layer.setMasterSource(fCanvas, { x: b.x, y: b.y, w: b.w, h: b.h });

        layer.shapeData = null;
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    rotateFixed(deg) {
        if (!Number.isFinite(deg) || deg % 90 !== 0 || deg % 360 === 0) return;
        const layer = this.targetLayer || this.layerManager.getActiveLayer();
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || layer.isGroup || layer.type === 'text' || layer.isBase) return;
        const b = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!b) return;

        const beforeData = layer.getImageData();
        const src = this.ensureSourceCanvas(layer);
        if (!src) return;

        // Normalize deg to positive 90, 180, 270
        let normDeg = Math.round(deg) % 360;
        if (normDeg < 0) normDeg += 360;

        const sw = src.width;
        const sh = src.height;
        const isSwap = (normDeg === 90 || normDeg === 270);
        const nw = isSwap ? sh : sw;
        const nh = isSwap ? sw : sh;

        // Lossless 90° step rotation of pristine master
        const rCanvas = document.createElement('canvas');
        rCanvas.width = nw;
        rCanvas.height = nh;
        const rCtx = rCanvas.getContext('2d');
        rCtx.imageSmoothingEnabled = false;

        rCtx.save();
        if (normDeg === 90) {
            rCtx.translate(sh, 0);
            rCtx.rotate(Math.PI / 2);
        } else if (normDeg === 180) {
            rCtx.translate(sw, sh);
            rCtx.rotate(Math.PI);
        } else if (normDeg === 270) {
            rCtx.translate(0, sw);
            rCtx.rotate(3 * Math.PI / 2);
        }
        rCtx.drawImage(src, 0, 0);
        rCtx.restore();

        const curW = isSwap ? b.h : b.w;
        const curH = isSwap ? b.w : b.h;
        const cx = b.x + Math.floor(b.w / 2);
        const cy = b.y + Math.floor(b.h / 2);
        const nx = cx - Math.floor(curW / 2);
        const ny = cy - Math.floor(curH / 2);

        layer.clear(false);
        const mode = this.getResampleMode();
        this.drawResampled(layer.ctx, rCanvas, nx, ny, curW, curH, 0, mode);
        layer.setMasterSource(rCanvas, { x: nx, y: ny, w: curW, h: curH });

        layer.shapeData = null;
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    scaleUniform(factor) {
        if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
        const layer = this.targetLayer || this.layerManager.getActiveLayer();
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || layer.isGroup || layer.type === 'text' || layer.isBase) return;
        const b = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!b) return;

        const beforeData = layer.getImageData();
        const nw = Math.max(1, Math.min(4096, Math.round(b.w * factor)));
        const nh = Math.max(1, Math.min(4096, Math.round(b.h * factor)));
        if (nw === b.w && nh === b.h) return;
        const nx = Math.round(b.x - (nw - b.w) / 2);
        const ny = Math.round(b.y - (nh - b.h) / 2);

        // Get pristine master source - NEVER crop downscaled pixels!
        const srcCanvas = this.ensureSourceCanvas(layer);
        if (!srcCanvas) return;

        layer.clear(false);
        const mode = this.getResampleMode();
        this.drawResampled(layer.ctx, srcCanvas, nx, ny, nw, nh, 0, mode);
        layer.setMasterSource(srcCanvas, { x: nx, y: ny, w: nw, h: nh });

        layer.shapeData = null;
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    invert() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || layer.isGroup || layer.type === 'text' || layer.isBase) return;

        const source = this.ensureSourceCanvas(layer);
        const rect = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!source || !rect) return;
        const beforeData = layer.getImageData();
        const inverted = document.createElement('canvas');
        inverted.width = source.width;
        inverted.height = source.height;
        const context = inverted.getContext('2d');
        context.drawImage(source, 0, 0);
        const imgData = context.getImageData(0, 0, inverted.width, inverted.height);
        const d = imgData.data;

        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] > 0) {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
            }
        }

        context.putImageData(imgData, 0, 0);
        layer.ctx.clearRect(0, 0, layer.width, layer.height);
        this.drawResampled(layer.ctx, inverted, rect.x, rect.y, rect.w, rect.h, 0, this.getResampleMode());
        layer.setMasterSource(inverted, rect);
        layer.shapeData = null;
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.bus.emit('CANVAS_UPDATED');
    }
}
