import {translate} from '../core/Locale.mjs';
import {primaryModifier} from '../core/Platform.mjs';
import { getRussianItemName } from '../utils/MinecraftItems.js';
import { isShortcutTarget } from './KeyboardNavigation.js';
import TransformOverlay from './TransformOverlay.js';
import { parseProjectJSON } from '../core/ProjectValidation.mjs';
import {pencilTipContains} from '../tools/PencilTip.mjs';

export const ZOOM_STEPS = [0.125, 0.25, 1 / 3, 0.5, 0.75, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];

export function alignViewportPan(pan, origin = 0, deviceRatio = 1) {
    const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
    return (Math.round((origin + pan) * ratio) / ratio - origin) || 0;
}

export function chooseFitZoom(canvasWidth, canvasHeight, availableWidth, availableHeight) {
    const width = Math.max(1, Number(canvasWidth) || 1);
    const height = Math.max(1, Number(canvasHeight) || 1);
    const fitScale = Math.min(Math.max(1, availableWidth) / width, Math.max(1, availableHeight) / height);
    const steps = ZOOM_STEPS.filter(step => step <= fitScale && step <= 32);
    return steps.at(-1) || 0.125;
}

/** Velocity in screen pixels/second; no scroll outside an active object drag. */
export function edgePanVelocity(x,y,rect) {
    const axis=(p,min,max)=>{
        const margin=Math.min(48,(max-min)/4);
        if(margin<=0||!Number.isFinite(p))return 0;
        const proximity=p<min+margin?-(min+margin-p)/margin:p>max-margin?(p-max+margin)/margin:0;
        return Math.sign(proximity)*Math.min(1,Math.abs(proximity))**2*360;
    };
    let vx=axis(x,rect.left,rect.right),vy=axis(y,rect.top,rect.bottom);
    const length=Math.hypot(vx,vy);if(length>360){vx*=360/length;vy*=360/length;}
    return {x:vx,y:vy};
}

/**
 * Workspace - Central viewport controller managing infinite canvas pan, zoom,
 * pixel grid, and drag & drop.
 */
export default class Workspace {
    constructor(bus, tools, config = { width: 256, height: 256 }) {
        this.bus = bus;
        this.tools = tools;
        this.config = config;

        this.workspace = null;
        this.wrapper = null;
        this.canvas = null;
        this.gridCanvas = null;
        this.gridCtx = null;

        this.zoom = 2;
        this.panX = 0;
        this.panY = 0;
        this.autoFitOnResize = true;

        this.isPointerDown = false;
        this.activePointerId = null;
        this.isSpacePressed = false;
        this.isPanning = false;
        this.panStartX = 0;
        this.panStartY = 0;
        this.panOriginX = 0;
        this.panOriginY = 0;

        this.currentMousePos = { x: -1, y: -1, isInside: false };
        this.isAltQuickPipette = false;
        this.previousToolId = null;

        // Rulers & Guides
        this.rulersVisible = true;
        this.guidesVisible = true;
        this.guides = { horizontal: [], vertical: [] };
        this.activeGuideDrag = null;

        // Seamless Tiling & Reference
        this.tilingMode = false;
        this.referenceOpacity = 0.4;

        this.bus.on('TOOL_CHANGED', () => {this.stopEdgePan();this.updateCursorStyle();});
        this.bus.on('TOOL_SIZE_CHANGED', () => this.updateBrushCursor());
        this.bus.on('CANVAS_UPDATED', () => {
            if (this.tilingMode) this.renderGrid();
        });
        this.bus.on('SETTINGS_CHANGED', () => {
            this.renderGrid();
        });
    }

    init(wrapperEl, canvasEl) {
        this.wrapper = wrapperEl;
        this.canvas = canvasEl;
        this.workspace = document.getElementById('workspace');
        if (this.workspace) this.transformOverlay = new TransformOverlay(this.bus, this.workspace, canvasEl, this.config);
        if (this.workspace) {
            this.hoverOverlay=new TransformOverlay(this.bus,this.workspace,canvasEl,this.config,{id:'object-hover-overlay-canvas',event:'OBJECT_HOVER_UPDATED'});
            this.selectionOverlay = new TransformOverlay(this.bus, this.workspace, canvasEl, this.config, { id: 'selection-overlay-canvas', event: 'SELECTION_OVERLAY_UPDATED', clearOnPreview: false });
            this.brushOverlay = new TransformOverlay(this.bus, this.workspace, canvasEl, this.config, { id: 'brush-overlay-canvas', event: 'BRUSH_OVERLAY_UPDATED', clearOnPreview: false });
            this.workspace.addEventListener('pointerleave', () => {this.tools.tools?.move?.clearHover(); if (!this.isPointerDown){this.updateBrushCursor({ isInside: false });this.tools.tools?.pipette?.hideLoupe();} });
        }
        this.gridCanvas = document.getElementById('grid-screen-canvas');
        if (this.gridCanvas) {
            this.gridCtx = this.gridCanvas.getContext('2d');
        }

        this.setupNavigation();
        this.setupGrid();
        this.setupDragAndDrop();

        this.rulerTop = document.getElementById('ruler-top');
        this.rulerLeft = document.getElementById('ruler-left');
        this.rulerCorner = document.getElementById('ruler-corner');
        this.rulerTopCtx = this.rulerTop?.getContext('2d');
        this.rulerLeftCtx = this.rulerLeft?.getContext('2d');
        this.referenceImg = document.getElementById('reference-img');

        this.setupRulersAndGuides();
        this.setupTiling();
        this.setupReferenceImage();

        this.bus.on('SYMMETRY_CHANGED', () => this.renderGrid());
        this.bus.on('SETTINGS_CHANGED', () => {
            this.renderGrid();
            if (this.rulersVisible) this.renderRulers();
        });

        let lastW = 0;
        let lastH = 0;

        if (window.ResizeObserver && this.workspace) {
            this.workspaceObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const cr = entry.contentRect;
                    const newW = cr.width;
                    const newH = cr.height;
                    if (newW <= 0 || newH <= 0) continue;

                    if (lastW > 0 && lastH > 0 && (newW !== lastW || newH !== lastH)) {
                        if (this.autoFitOnResize) {
                            this.fitToScreen();
                        } else {
                            this.panX += (newW - lastW) / 2;
                            this.panY += (newH - lastH) / 2;
                            this.updateTransform();
                        }
                    }
                    lastW = newW;
                    lastH = newH;
                    this.renderGrid();
                }
            });
            this.workspaceObserver.observe(this.workspace);
        } else {
            window.addEventListener('resize', () => {
                if (this.autoFitOnResize) this.fitToScreen();
                else this.renderGrid();
            });
        }

        requestAnimationFrame(() => this.fitToScreen());
    }

    updateCursorStyle() {
        if (!this.workspace || !this.canvas) return;
        const isHand = this.tools.currentToolId === 'hand';
        const isPipette = this.tools.currentToolId === 'pipette' || this.isAltQuickPipette;

        if (this.isPanning) {
            this.workspace.style.cursor = 'grabbing';
            this.canvas.style.cursor = 'grabbing';
            if (this.wrapper) this.wrapper.style.cursor = 'grabbing';
        } else if (this.isSpacePressed || isHand) {
            this.workspace.style.cursor = 'grab';
            this.canvas.style.cursor = 'grab';
            if (this.wrapper) this.wrapper.style.cursor = 'grab';
        } else if (isPipette) {
            const pipetteSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Cpath d='M7 17l-4 4v-4l4-4 4 4-4 4zm8.7-12.7c-.4-.4-1-.4-1.4 0l-2.3 2.3 3.8 3.8 2.3-2.3c.4-.4.4-1 0-1.4l-2.4-2.4zm-4.4 4.4L3.6 16.4 7.4 20.2 15.1 12.5l-3.8-3.8z' fill='%23ffffff' stroke='%23111111' stroke-width='1.2' stroke-linejoin='round'/%3E%3C/svg%3E") 3 21, crosshair`;
            this.workspace.style.cursor = 'default';
            this.canvas.style.cursor = pipetteSvg;
            if (this.wrapper) this.wrapper.style.cursor = pipetteSvg;
        } else if (this.tools.currentToolId === 'text') {
            this.workspace.style.cursor = 'default';this.canvas.style.cursor = 'text';
            if(this.wrapper)this.wrapper.style.cursor = 'text';
        } else {
            this.workspace.style.cursor = 'default';
            this.canvas.style.cursor = 'crosshair';
            if (this.wrapper) this.wrapper.style.cursor = 'crosshair';
        }
        this.updateBrushCursor();
    }

    updateBrushCursor(coords = this.currentMousePos) {
        if (!this.brushOverlay) return;
        const tool = this.tools.currentToolId;
        const visible = ['brush', 'pencil', 'eraser'].includes(tool) && coords?.isInside && !this.isSpacePressed && !this.isPanning && !this.isBrushResizing;
        this.brushOverlay.callback = visible ? ctx => {
            const size = this.tools.size || 1, zoom = this.zoom;
            const x = Math.floor(coords.x) - Math.floor(size / 2), y = Math.floor(coords.y) - Math.floor(size / 2);
            ctx.beginPath();
            if (tool === 'pencil' && size > 1) {
                const filled = (dx, dy) => pencilTipContains(size,dx,dy);
                for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (filled(dx, dy)) {
                    if (!filled(dx, dy - 1)) { ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx + 1, y + dy); }
                    if (!filled(dx, dy + 1)) { ctx.moveTo(x + dx, y + dy + 1); ctx.lineTo(x + dx + 1, y + dy + 1); }
                    if (!filled(dx - 1, dy)) { ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx, y + dy + 1); }
                    if (!filled(dx + 1, dy)) { ctx.moveTo(x + dx + 1, y + dy); ctx.lineTo(x + dx + 1, y + dy + 1); }
                }
            } else ctx.rect(x, y, size, size);
            ctx.lineWidth = 3 / zoom; ctx.strokeStyle = '#000'; ctx.stroke();
            ctx.lineWidth = 1 / zoom; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.font = `${11 / zoom}px "Google Sans", sans-serif`;
            ctx.lineWidth = 3 / zoom; ctx.lineJoin = 'round'; ctx.textBaseline = 'bottom';
            const selection=this.tools.tools.marquee?.selection;
            const label = `${size} px${selection?' · в выделении':''}`, tx = x + size + 5 / zoom, ty = y - 3 / zoom;
            ctx.strokeStyle = '#000'; ctx.strokeText(label, tx, ty); ctx.fillStyle = '#fff'; ctx.fillText(label, tx, ty);
        } : null;
        this.brushOverlay.render();
    }

    setupNavigation() {
        this.updateZoomHUD();

        document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
            const nextZoom = ZOOM_STEPS.find(s => s > this.zoom + 0.01) || 64;
            const rect = this.workspace ? this.workspace.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };
            this.zoomTo(nextZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
        });

        document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
            const rev = [...ZOOM_STEPS].reverse();
            const nextZoom = rev.find(s => s < this.zoom - 0.01) || 0.125;
            const rect = this.workspace ? this.workspace.getBoundingClientRect() : { left: 0, top: 0, width: 800, height: 600 };
            this.zoomTo(nextZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
        });

        document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
            this.fitToScreen();
        });

        document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
            this.resetZoom();
        });

        this.workspace?.addEventListener('wheel', (e) => {
            if (e.target.closest?.('.doc-tab-bar, .bottom-status-bar')) return;
            e.preventDefault();
            const sm = window.mollyEditor?.settingsManager;
            const behavior = sm?.get('wheelBehavior') || 'zoom';
            const invert = sm?.get('invertZoom') || false;

            if (['scroll', 'pan-v', 'pan-h'].includes(behavior) && !e.ctrlKey && !e.metaKey) {
                this.autoFitOnResize = false;
                this.panX = Math.round(this.panX - (behavior === 'pan-h' ? e.deltaY + e.deltaX : e.deltaX));
                this.panY = Math.round(this.panY - (behavior === 'pan-h' ? 0 : e.deltaY));
                this.updateTransform();
                return;
            }

            let delta = e.deltaY;
            if (invert) delta = -delta;
            if (!delta) return;
            
            // Aseprite discrete integer pixel zoom steps
            let nextZoom = this.zoom;
            if (delta < 0) {
                nextZoom = ZOOM_STEPS.find(s => s > this.zoom + 0.01) || 64;
            } else {
                const rev = [...ZOOM_STEPS].reverse();
                nextZoom = rev.find(s => s < this.zoom - 0.01) || 0.125;
            }
            this.zoomTo(nextZoom, e.clientX, e.clientY);
        }, { passive: false });

        // Prevent autoscroll when middle-clicking on Windows Chromium
        this.workspace?.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });
        window.addEventListener('auxclick', (e) => {
            if (e.button === 1) e.preventDefault();
        });

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;

            // Alt quick eyedropper
            if ((e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat && !this.isPointerDown) {
                if (!this.isAltQuickPipette && ['brush', 'pencil', 'eraser', 'bucket'].includes(this.tools.currentToolId)) {
                    e.preventDefault();
                    this.isAltQuickPipette = true;
                    this.previousToolId = this.tools.currentToolId;
                    this.tools.setTool('pipette');
                    this.updateCursorStyle();
                }
            }

            if (e.code === 'Space' && !this.isSpacePressed) {
                this.isSpacePressed = true;
                e.preventDefault();
                this.updateCursorStyle();
            } else if (e.code === 'BracketLeft' || e.key === '[' || e.key === 'х' || e.key === 'Х') {
                e.preventDefault();
                this.tools.changeSize(-1);
            } else if (e.code === 'BracketRight' || e.key === ']' || e.key === 'ъ' || e.key === 'Ъ') {
                e.preventDefault();
                this.tools.changeSize(1);
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
                if (this.isAltQuickPipette) {
                    e.preventDefault();
                    const prev = this.previousToolId || 'brush';
                    this.isAltQuickPipette = false;
                    this.previousToolId = null;
                    this.tools.setTool(prev);
                    this.updateCursorStyle();
                }
            }
            if (e.code === 'Space') {
                this.isSpacePressed = false;
                this.updateCursorStyle();
            }
        });

        this.workspace?.addEventListener('contextmenu', (e) => {
            if (this.isBrushResizing || e.altKey) {
                e.preventDefault();
            }
        });
        window.addEventListener('contextmenu', (e) => {
            if (this.isBrushResizing) {
                e.preventDefault();
            }
        });

        this.workspace?.addEventListener('pointerdown', (e) => {
            if (e.isPrimary === false || this.isPointerDown || this.isPanning || this.isBrushResizing) return;
            // Defensively ignore clicks on interface overlays and controls (tabs, status bar, rulers, dialogs, buttons)
            if (e.target.closest('.doc-tab-bar, .bottom-status-bar, .ruler-top, .ruler-left, .ruler-corner, .modal, .modal-overlay, .dropdown-menu, .crash-recovery-banner, button, input, select, textarea, label')) {
                return;
            }

            // Interactive Brush Size Gesture: Alt + RMB or Ctrl + Alt + LMB
            const resizeTool = this.isAltQuickPipette ? this.previousToolId : this.tools.currentToolId;
            const isBrushResize = ['brush', 'pencil', 'eraser'].includes(resizeTool)
                && ((e.button === 2 && e.altKey) || (e.button === 0 && e.altKey && primaryModifier(e)));
            if (isBrushResize) {
                e.preventDefault();
                e.stopPropagation();

                if (this.isAltQuickPipette) {
                    const prev = this.previousToolId || 'brush';
                    this.isAltQuickPipette = false;
                    this.previousToolId = null;
                    this.tools.setTool(prev);
                    this.updateCursorStyle();
                }

                this.isBrushResizing = true;
                this.activePointerId = e.pointerId;
                this.brushResizeStartX = e.clientX;
                this.brushResizeStartY = e.clientY;
                this.brushResizeStartSize = this.tools.size || 1;

                try { this.workspace.setPointerCapture(e.pointerId); } catch (_) {}
                this.showBrushResizeHUD(e.clientX, e.clientY, this.brushResizeStartSize);
                return;
            }

            const isHand = this.tools.currentToolId === 'hand';
            const isMMB = e.button === 1;
            if (e.button !== 0 && !isMMB) return;
            const coordinates = this.getExactCoordinates(e, true);
            const move = ['move', 'transform'].includes(this.tools.currentToolId) ? this.tools.getActiveTool() : null;
            const hitsTransform = move && (move.findHandleAt(coordinates.x, coordinates.y) || move.isInsideBox(coordinates.x, coordinates.y));
            const textHandle=this.tools.currentToolId==='text'&&this.tools.tools?.text?.canvasEditor?.findHandle(coordinates);
            const shouldPan = isMMB || this.isSpacePressed || isHand || (e.target === this.workspace && !hitsTransform && !textHandle);

            if (shouldPan) {
                e.preventDefault();
                this.autoFitOnResize = false;
                this.isPanning = true;
                this.activePointerId = e.pointerId;
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;
                this.panOriginX = this.panX;
                this.panOriginY = this.panY;
                try { this.workspace.setPointerCapture(e.pointerId); } catch (_) {}
                document.body.classList.add('is-panning');
                this.updateCursorStyle();
                return;
            }

            if (e.button === 0 && e.isPrimary !== false) {
                this.isPointerDown = true;
                this.activePointerId = e.pointerId;
                try { this.workspace?.setPointerCapture(e.pointerId); } catch (_) {}
                const coords = this.getExactCoordinates(e, true);
                this.tools.onPointerDown(coords.x, coords.y, e);
                this.updateCursorPos(coords);
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (this.activePointerId != null && e.pointerId !== this.activePointerId) return;

            if (this.isBrushResizing) {
                const dx = e.clientX - this.brushResizeStartX;
                const delta = Math.round(dx / 8);
                const newSize = Math.max(1, Math.min(64, this.brushResizeStartSize + delta));
                if (newSize !== this.tools.size) {
                    if (typeof this.tools.setSize === 'function') {
                        this.tools.setSize(newSize);
                    } else if (typeof this.tools.syncSize === 'function') {
                        this.tools.syncSize(newSize);
                    }
                }
                this.updateBrushResizeHUD(e.clientX, e.clientY, this.tools.size);
                return;
            }

            if (this.isPanning) {
                const dx = e.clientX - this.panStartX;
                const dy = e.clientY - this.panStartY;
                this.panX = this.panOriginX + dx;
                this.panY = this.panOriginY + dy;
                this.updateTransform();
                return;
            }

            if (!this.isPointerDown && (!this.workspace?.contains(e.target) || e.target.closest?.('.doc-tab-bar, .bottom-status-bar, .ruler-top, .ruler-left, .ruler-corner, .modal, .modal-overlay, .dropdown-menu, .crash-recovery-banner, button, input, select, textarea'))) {
                this.currentMousePos = { x: -1, y: -1, isInside: false };
                this.updateCursorPos(this.currentMousePos);
                this.bus.emit('PREVIEW_CLEARED');
                return;
            }

            const coords = this.getExactCoordinates(e, true);
            this.currentMousePos = coords;
            this.updateCursorPos(coords);

            if (this.isPointerDown) {
                this.tools.onPointerMove(coords.x, coords.y, e);
                this.trackEdgePan(e);
            } else {
                this.tools.onHoverMove(coords.x, coords.y, e);
            }
        });

        const endPointer = (e) => {
            if (this.activePointerId != null && e?.pointerId != null && e.pointerId !== this.activePointerId) return;
            this.stopEdgePan();

            if (this.isBrushResizing) {
                this.isBrushResizing = false;
                this.activePointerId = null;
                this.hideBrushResizeHUD();
                if (e && e.pointerId != null) {
                    try { this.workspace.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                return;
            }

            if (this.isPanning) {
                this.isPanning = false;
                this.activePointerId = null;
                document.body.classList.remove('is-panning');
                if (e && e.pointerId != null) {
                    try { this.workspace.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                this.updateCursorStyle();
                return;
            }

            if (this.isPointerDown) {
                this.isPointerDown = false;
                if (this.activePointerId != null) {
                    try { this.workspace?.releasePointerCapture(this.activePointerId); } catch (_) {}
                    this.activePointerId = null;
                } else if (e && e.pointerId != null) {
                    try { this.workspace?.releasePointerCapture(e.pointerId); } catch (_) {}
                }
                const coords = this.getExactCoordinates(e, true);
                if (e.type === 'pointercancel') this.tools.cancelPointer?.();
                else this.tools.onPointerUp(coords.x, coords.y, e);
            }
        };

        window.addEventListener('pointerup', endPointer);
        window.addEventListener('pointercancel', endPointer);
        this.bus.on('TOOL_GESTURE_CANCELLED', () => {
            this.stopEdgePan();
            this.isPointerDown = false;
            if (this.activePointerId != null) {
                try { this.workspace?.releasePointerCapture(this.activePointerId); } catch (_) {}
                this.activePointerId = null;
            }
        });
        window.addEventListener('blur', () => {
            this.tools.tools?.move?.clearHover();
            this.stopEdgePan();
            this.updateBrushCursor({ isInside: false });
            this.isSpacePressed = false;
            if (this.isBrushResizing) {
                this.isBrushResizing = false;
                this.hideBrushResizeHUD();
            }
            if (this.isPanning) {
                this.isPanning = false;
                document.body.classList.remove('is-panning');
                this.updateCursorStyle();
            }
            if (this.isPointerDown) {
                try {
                    this.tools.finishPointer?.();
                } catch (error) {
                    console.error('Unable to finish the active tool before focus loss:', error);
                }
                this.isPointerDown = false;
                if (this.activePointerId != null) {
                    try { this.workspace?.releasePointerCapture(this.activePointerId); } catch (_) {}
                    this.activePointerId = null;
                }
            }
            if (this.isAltQuickPipette) {
                const prev = this.previousToolId || 'brush';
                this.isAltQuickPipette = false;
                this.previousToolId = null;
                this.tools.setTool(prev);
                this.updateCursorStyle();
            }
            if (this.activePointerId != null) {
                try { this.workspace?.releasePointerCapture(this.activePointerId); } catch (_) {}
                this.activePointerId = null;
            }
        });
        document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stopEdgePan();});
    }

    getDragViewport() {
        const bounds=this.workspace.getBoundingClientRect();
        const rect={left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom};
        for(const selector of ['.doc-tab-bar','.ruler-top','.bottom-status-bar','.ruler-left']){
            const node=this.workspace.querySelector(selector);if(!node||!node.getClientRects().length)continue;
            const r=node.getBoundingClientRect();
            if(selector==='.bottom-status-bar')rect.bottom=Math.min(rect.bottom,r.top);
            else if(selector==='.ruler-left')rect.left=Math.max(rect.left,r.right);
            else rect.top=Math.max(rect.top,r.bottom);
        }
        return rect;
    }

    stopEdgePan() {
        cancelAnimationFrame(this.edgePanFrame);this.edgePanFrame=0;this.edgePanPointer=null;
        this.edgePanTime=0;this.edgePanRemainder={x:0,y:0};
    }

    trackEdgePan(event) {
        const tool=this.tools.getActiveTool();
        if(!this.isPointerDown||!['move','transform'].includes(this.tools.currentToolId)||!tool?.isPointerDown||tool.activeHandle?.id!=='move')return this.stopEdgePan();
        this.edgePanPointer=event;
        if(this.edgePanFrame)return;
        this.edgePanTime=performance.now();this.edgePanRemainder={x:0,y:0};
        this.edgePanFrame=requestAnimationFrame(time=>this.stepEdgePan(time));
    }

    stepEdgePan(time) {
        this.edgePanFrame=0;
        const event=this.edgePanPointer,tool=this.tools.getActiveTool();
        if(!event||!this.isPointerDown||document.hidden||this.isPanning||!['move','transform'].includes(this.tools.currentToolId)||!tool?.isPointerDown||tool.activeHandle?.id!=='move')return this.stopEdgePan();
        if(event.clientX<0||event.clientY<0||event.clientX>innerWidth||event.clientY>innerHeight)return this.stopEdgePan();
        const speed=edgePanVelocity(event.clientX,event.clientY,this.getDragViewport());
        if(!speed.x&&!speed.y)return this.stopEdgePan();
        const dt=Math.max(0,Math.min(40,time-this.edgePanTime))/1000;this.edgePanTime=time;
        const x=this.panX-speed.x*dt+this.edgePanRemainder.x,y=this.panY-speed.y*dt+this.edgePanRemainder.y;
        this.panX=x;this.panY=y;this.autoFitOnResize=false;this.updateTransform();
        this.edgePanRemainder={x:x-this.panX,y:y-this.panY};
        // Reproject the stationary pointer after moving the camera, so the object
        // stays under the cursor and the whole gesture remains one undo action.
        const coords=this.getExactCoordinates(event,true);this.currentMousePos=coords;this.updateCursorPos(coords);
        this.tools.onPointerMove(coords.x,coords.y,event);
        if(this.isPointerDown)this.edgePanFrame=requestAnimationFrame(next=>this.stepEdgePan(next));
    }

    showBrushResizeHUD(cx, cy, size) {
        if (!this.brushHUD) {
            this.brushHUD = document.getElementById('brush-resize-hud');
            this.brushHUDText = document.getElementById('brush-resize-hud-text');
            this.brushHUDRing = document.getElementById('brush-resize-ring');
        }
        if (!this.brushHUD) return;
        this.brushHUD.style.display = 'flex';
        this.updateBrushResizeHUD(cx, cy, size);
    }

    updateBrushResizeHUD(cx, cy, size) {
        if (!this.brushHUD) return;
        this.brushHUD.style.left = `${cx}px`;
        this.brushHUD.style.top = `${cy}px`;
        if (this.brushHUDText) {
            this.brushHUDText.innerText = `Размер: ${size} px`;
        }
        if (this.brushHUDRing) {
            const pxSize = Math.max(8, Math.round(size * (this.zoom || 1)));
            this.brushHUDRing.style.width = `${pxSize}px`;
            this.brushHUDRing.style.height = `${pxSize}px`;
        }
    }

    hideBrushResizeHUD() {
        if (this.brushHUD) {
            this.brushHUD.style.display = 'none';
        }
    }

    setupGrid() {
        const btnGrid = document.getElementById('btn-toggle-grid');

        const updateGridUI = () => {
            const sm = window.mollyEditor?.settingsManager;
            const enabled = sm ? sm.get('showPixelGrid') : true;
            if (btnGrid) {
                btnGrid.classList.toggle('active', enabled);
            }
            this.renderGrid();
        };

        btnGrid?.addEventListener('click', () => {
            const sm = window.mollyEditor?.settingsManager;
            if (sm) {
                sm.set('showPixelGrid', !sm.get('showPixelGrid'));
                updateGridUI();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;
            if (primaryModifier(e) && (e.key === "'" || e.key === 'э' || e.key === 'Э')) {
                e.preventDefault();
                const sm = window.mollyEditor?.settingsManager;
                if (sm) {
                    sm.set('showPixelGrid', !sm.get('showPixelGrid'));
                    updateGridUI();
                }
            }
        });

        updateGridUI();
        this.bus?.on('SETTINGS_CHANGED', () => updateGridUI());
    }

    renderGrid() {
        if (!this.gridCtx || !this.workspace) return;

        const sm = window.mollyEditor?.settingsManager;
        const gridEnabled = sm ? sm.get('showPixelGrid') : true;
        const gridOpacity = sm ? (sm.get('gridOpacity') / 100) : 0.20;
        const gridMinZoom = sm ? (sm.get('gridMinZoom') ?? 3) : 3;
        const gridColorType = sm ? (sm.get('gridColor') || 'white') : 'white';

        const dpr = window.devicePixelRatio || 1;
        const w = this.workspace.clientWidth;
        const h = this.workspace.clientHeight;

        if (this.gridCanvas.width !== Math.floor(w * dpr) || this.gridCanvas.height !== Math.floor(h * dpr)) {
            this.gridCanvas.width = Math.floor(w * dpr);
            this.gridCanvas.height = Math.floor(h * dpr);
            this.gridCanvas.style.width = `${w}px`;
            this.gridCanvas.style.height = `${h}px`;
        }

        this.gridCtx.save();
        this.gridCtx.scale(dpr, dpr);
        this.gridCtx.clearRect(0, 0, w, h);

        const tabBar = this.workspace?.querySelector('.doc-tab-bar') || document.querySelector('.doc-tab-bar');
        const statusBar = this.workspace?.querySelector('.bottom-status-bar') || document.querySelector('.bottom-status-bar');
        const topBarH = (this.rulerTop && this.rulersVisible) ? 58 : (tabBar?.offsetHeight || 38);
        const bottomH = statusBar?.offsetHeight || 28;
        const leftBarW = (this.rulerLeft && this.rulersVisible) ? 20 : 0;

        // Strictly clip all grid, symmetry, and guide drawing to visible workspace canvas viewport
        this.gridCtx.save();
        this.gridCtx.beginPath();
        this.gridCtx.rect(leftBarW, topBarH, Math.max(0, w - leftBarW), Math.max(0, h - topBarH - bottomH));
        this.gridCtx.clip();

        const originX = this.panX;
        const originY = this.panY;

        const startX = originX;
        const startY = originY;
        const endX = Math.round(originX + this.config.width * this.zoom);
        const endY = Math.round(originY + this.config.height * this.zoom);

        // Seamless Tiling 3x3 Preview Mode
        if (this.tilingMode && this.canvas) {
            const tileW = this.config.width * this.zoom;
            const tileH = this.config.height * this.zoom;
            this.gridCtx.save();
            this.gridCtx.imageSmoothingEnabled = false;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const tx = originX + dx * tileW;
                    const ty = originY + dy * tileH;
                    if (tx + tileW < 0 || tx > w || ty + tileH < 0 || ty > h) continue;
                    this.gridCtx.globalAlpha = 0.65;
                    this.gridCtx.drawImage(this.canvas, tx, ty, tileW, tileH);
                    this.gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                    this.gridCtx.lineWidth = 1;
                    this.gridCtx.strokeRect(tx + 0.5, ty + 0.5, tileW, tileH);
                }
            }
            this.gridCtx.restore();
        }

        // Pixel Grid (when zoomed in >= gridMinZoom)
        if (gridEnabled && this.zoom >= gridMinZoom) {
            let strokeColor = `rgba(255, 255, 255, ${gridOpacity})`;
            if (gridColorType === 'black') {
                strokeColor = `rgba(0, 0, 0, ${gridOpacity})`;
            } else if (gridColorType === 'accent') {
                const accent = sm?.get('accentColor') || '#2563EB';
                const rgb = sm?.hexToRgb?.(accent) || { r: 37, g: 99, b: 235 };
                strokeColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${gridOpacity})`;
            }
            this.gridCtx.strokeStyle = strokeColor;
            this.gridCtx.lineWidth = 1;
            this.gridCtx.beginPath();

            const minGridX = Math.max(0, Math.floor((-originX) / this.zoom));
            const maxGridX = Math.min(this.config.width, Math.ceil((w - originX) / this.zoom));
            const minGridY = Math.max(0, Math.floor((-originY) / this.zoom));
            const maxGridY = Math.min(this.config.height, Math.ceil((h - originY) / this.zoom));

            const yTop = Math.max(0, startY);
            const yBottom = Math.min(h, endY);
            const xLeft = Math.max(0, startX);
            const xRight = Math.min(w, endX);

            for (let x = minGridX; x <= maxGridX; x++) {
                const sx = Math.round(originX + x * this.zoom) + 0.5;
                if (sx < 0 || sx > w) continue;
                this.gridCtx.moveTo(sx, yTop);
                this.gridCtx.lineTo(sx, yBottom);
            }

            for (let y = minGridY; y <= maxGridY; y++) {
                const sy = Math.round(originY + y * this.zoom) + 0.5;
                if (sy < 0 || sy > h) continue;
                this.gridCtx.moveTo(xLeft, sy);
                this.gridCtx.lineTo(xRight, sy);
            }

            this.gridCtx.stroke();
        }

        // Dynamic Symmetry Guide Lines
        const symmX = !!this.tools?.symmetryX;
        const symmY = !!this.tools?.symmetryY;

        if (symmX || symmY) {
            const yTop = Math.max(0, startY);
            const yBottom = Math.min(h, endY);
            const xLeft = Math.max(0, startX);
            const xRight = Math.min(w, endX);

            this.gridCtx.save();
            this.gridCtx.lineWidth = 1.5;
            this.gridCtx.setLineDash([6, 4]);

            // Vertical center line for Symmetry X (separates Left and Right)
            if (symmX) {
                const cx = Math.round(originX + (this.config.width / 2) * this.zoom) + 0.5;
                if (cx >= 0 && cx <= w) {
                    this.gridCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(cx + 1, yTop);
                    this.gridCtx.lineTo(cx + 1, yBottom);
                    this.gridCtx.stroke();

                    this.gridCtx.strokeStyle = '#3B82F6';
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(cx, yTop);
                    this.gridCtx.lineTo(cx, yBottom);
                    this.gridCtx.stroke();
                }
            }

            // Horizontal center line for Symmetry Y (separates Top and Bottom)
            if (symmY) {
                const cy = Math.round(originY + (this.config.height / 2) * this.zoom) + 0.5;
                if (cy >= 0 && cy <= h) {
                    this.gridCtx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(xLeft, cy + 1);
                    this.gridCtx.lineTo(xRight, cy + 1);
                    this.gridCtx.stroke();

                    this.gridCtx.strokeStyle = '#3B82F6';
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(xLeft, cy);
                    this.gridCtx.lineTo(xRight, cy);
                    this.gridCtx.stroke();
                }
            }

            this.gridCtx.restore();
        }

        // Custom Magnetic Guides
        if (this.guidesVisible && (this.guides.vertical.length > 0 || this.guides.horizontal.length > 0 || this.activeGuideDrag)) {
            this.gridCtx.save();
            this.gridCtx.lineWidth = 1;
            this.gridCtx.font = '10px Google Sans, sans-serif';

            for (const gx of this.guides.vertical) {
                const sx = Math.round(originX + gx * this.zoom) + 0.5;
                if (sx < 0 || sx > w) continue;
                this.gridCtx.strokeStyle = '#06B6D4';
                this.gridCtx.setLineDash([4, 3]);
                this.gridCtx.beginPath();
                this.gridCtx.moveTo(sx, 0);
                this.gridCtx.lineTo(sx, h);
                this.gridCtx.stroke();

                this.gridCtx.fillStyle = '#06B6D4';
                this.gridCtx.fillRect(sx + 2, 24, 38, 14);
                this.gridCtx.fillStyle = '#062D33';
                this.gridCtx.fillText(`X:${gx}`, sx + 4, 35);
            }

            for (const gy of this.guides.horizontal) {
                const sy = Math.round(originY + gy * this.zoom) + 0.5;
                if (sy < 0 || sy > h) continue;
                this.gridCtx.strokeStyle = '#06B6D4';
                this.gridCtx.setLineDash([4, 3]);
                this.gridCtx.beginPath();
                this.gridCtx.moveTo(0, sy);
                this.gridCtx.lineTo(w, sy);
                this.gridCtx.stroke();

                this.gridCtx.fillStyle = '#06B6D4';
                this.gridCtx.fillRect(24, sy + 2, 38, 14);
                this.gridCtx.fillStyle = '#062D33';
                this.gridCtx.fillText(`Y:${gy}`, 26, sy + 13);
            }

            if (this.activeGuideDrag) {
                this.gridCtx.strokeStyle = '#EC4899';
                this.gridCtx.setLineDash([]);
                this.gridCtx.beginPath();
                if (this.activeGuideDrag.type === 'horizontal') {
                    const sy = Math.round(originY + this.activeGuideDrag.pos * this.zoom) + 0.5;
                    this.gridCtx.moveTo(0, sy);
                    this.gridCtx.lineTo(w, sy);
                    this.gridCtx.stroke();
                    this.gridCtx.fillStyle = '#EC4899';
                    this.gridCtx.fillRect(24, sy + 2, 44, 14);
                    this.gridCtx.fillStyle = '#FFFFFF';
                    this.gridCtx.fillText(`Y:${this.activeGuideDrag.pos}`, 26, sy + 13);
                } else if (this.activeGuideDrag.type === 'vertical') {
                    const sx = Math.round(originX + this.activeGuideDrag.pos * this.zoom) + 0.5;
                    this.gridCtx.moveTo(sx, 0);
                    this.gridCtx.lineTo(sx, h);
                    this.gridCtx.stroke();
                    this.gridCtx.fillStyle = '#EC4899';
                    this.gridCtx.fillRect(sx + 2, 24, 44, 14);
                    this.gridCtx.fillStyle = '#FFFFFF';
                    this.gridCtx.fillText(`X:${this.activeGuideDrag.pos}`, sx + 4, 35);
                }
            }

            this.gridCtx.restore();
        }

        // Visual Symmetry Axis Guides (when Mirror X or Mirror Y is active)
        const isMirrorX = this.tools?.symmetryX;
        const isMirrorY = this.tools?.symmetryY;
        if (isMirrorX || isMirrorY) {
            this.gridCtx.save();
            this.gridCtx.lineWidth = 1.5;
            this.gridCtx.setLineDash([5, 4]);

            if (isMirrorX) {
                const midX = Math.round(originX + (this.config.width / 2) * this.zoom) + 0.5;
                if (midX >= 0 && midX <= w) {
                    this.gridCtx.strokeStyle = '#38bdf8'; // Sky cyan
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(midX, Math.max(0, originY));
                    this.gridCtx.lineTo(midX, Math.min(h, originY + this.config.height * this.zoom));
                    this.gridCtx.stroke();

                    // Symmetry badge tag
                    this.gridCtx.fillStyle = '#38bdf8';
                    this.gridCtx.fillRect(midX - 24, Math.max(22, originY - 18), 48, 14);
                    this.gridCtx.fillStyle = '#030712';
                    this.gridCtx.font = 'bold 9px Google Sans, sans-serif';
                    this.gridCtx.fillText('Зеркало X', midX - 21, Math.max(32, originY - 8));
                }
            }

            if (isMirrorY) {
                const midY = Math.round(originY + (this.config.height / 2) * this.zoom) + 0.5;
                if (midY >= 0 && midY <= h) {
                    this.gridCtx.strokeStyle = '#c084fc'; // Purple
                    this.gridCtx.beginPath();
                    this.gridCtx.moveTo(Math.max(0, originX), midY);
                    this.gridCtx.lineTo(Math.min(w, originX + this.config.width * this.zoom), midY);
                    this.gridCtx.stroke();

                    // Symmetry badge tag
                    this.gridCtx.fillStyle = '#c084fc';
                    this.gridCtx.fillRect(Math.max(22, originX - 52), midY - 7, 48, 14);
                    this.gridCtx.fillStyle = '#030712';
                    this.gridCtx.font = 'bold 9px Google Sans, sans-serif';
                    this.gridCtx.fillText('Зеркало Y', Math.max(24, originX - 50), midY + 4);
                }
            }

            this.gridCtx.restore();
        }

        // Restore clipped viewport region
        this.gridCtx.restore();

        this.gridCtx.restore();

        // Render Rulers Tick Marks and Indicators
        this.renderRulers();
    }

    updateZoomHUD() {
        const zoomText = document.getElementById('zoom-level');
        const docTab = document.querySelector('.doc-tab.active .doc-tab-zoom') || document.getElementById('doc-tab-zoom');
        const percent = `${Math.round(this.zoom * 100)}%`;
        if (zoomText) zoomText.innerText = percent;
        if (docTab) docTab.innerText = document.body?.classList?.contains('title-project')?'3D':`@ ${percent}`;
    }

    zoomTo(targetZoom, clientX, clientY) {
        if (!this.workspace) return;
        this.autoFitOnResize = false;
        const wsRect = this.workspace.getBoundingClientRect();
        const mouseX = (clientX !== undefined ? clientX : (wsRect.left + wsRect.width / 2)) - wsRect.left;
        const mouseY = (clientY !== undefined ? clientY : (wsRect.top + wsRect.height / 2)) - wsRect.top;

        const newZoom = Math.max(0.125, Math.min(64, targetZoom));
        const ratio = newZoom / this.zoom;

        this.panX = Math.round(mouseX - (mouseX - this.panX) * ratio);
        this.panY = Math.round(mouseY - (mouseY - this.panY) * ratio);
        this.zoom = newZoom;

        this.updateTransform();
    }

    fitToScreen() {
        if (!this.workspace) return;
        const rect = this.workspace.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            requestAnimationFrame(() => this.fitToScreen());
            return;
        }

        const tabBar = this.workspace.querySelector('.doc-tab-bar');
        const statusBar = this.workspace.querySelector('.bottom-status-bar');
        const topOffset = tabBar ? tabBar.offsetHeight : 30;
        const bottomOffset = statusBar ? statusBar.offsetHeight : 26;

        const padding = 32;
        const availableW = Math.max(80, rect.width - padding * 2);
        const availableH = Math.max(80, rect.height - topOffset - bottomOffset - padding * 2);

        this.autoFitOnResize = true;
        this.zoom = chooseFitZoom(this.config.width, this.config.height, availableW, availableH);

        this.panX = Math.round((rect.width - this.config.width * this.zoom) / 2);
        this.panY = Math.round(topOffset + (rect.height - topOffset - bottomOffset - this.config.height * this.zoom) / 2);

        this.updateTransform();
    }

    resetZoom() {
        if (!this.workspace) return;
        this.autoFitOnResize = false;
        const rect = this.workspace.getBoundingClientRect();
        this.zoom = 2;
        const w = rect.width > 0 ? rect.width : 800;
        const h = rect.height > 0 ? rect.height : 600;

        const tabBar = this.workspace.querySelector('.doc-tab-bar');
        const statusBar = this.workspace.querySelector('.bottom-status-bar');
        const topOffset = tabBar ? tabBar.offsetHeight : 30;
        const bottomOffset = statusBar ? statusBar.offsetHeight : 26;

        this.panX = Math.round((w - this.config.width * this.zoom) / 2);
        this.panY = Math.round(topOffset + (h - topOffset - bottomOffset - this.config.height * this.zoom) / 2);
        this.updateTransform();
    }

    updateTransform() {
        this.tools?.tools?.move?.clearHover();
        if (this.wrapper) {
            const origin = this.workspace.getBoundingClientRect();
            this.panX = alignViewportPan(this.panX, origin.left, window.devicePixelRatio);
            this.panY = alignViewportPan(this.panY, origin.top, window.devicePixelRatio);
            this.wrapper.style.setProperty('--canvas-focus-width', `${2 / this.zoom}px`);
            this.wrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
            this.wrapper.style.transformOrigin = '0 0';
        }
        this.updateZoomHUD();
        this.renderGrid();
        this.transformOverlay?.render();
        this.selectionOverlay?.render();
        this.bus?.emit('TEXT_VIEWPORT_CHANGED');
        this.updateBrushCursor();
    }

    getExactCoordinates(e, continuous = false) {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height || !e) return { x: NaN, y: NaN, isInside: false };
        const scaleX = this.config.width / rect.width;
        const scaleY = this.config.height / rect.height;

        const rawX = (e.clientX - rect.left) * scaleX;
        const rawY = (e.clientY - rect.top) * scaleY;
        const x = continuous ? rawX : Math.floor(rawX);
        const y = continuous ? rawY : Math.floor(rawY);

        const isInside = x >= 0 && x < this.config.width && y >= 0 && y < this.config.height;

        return {
            x,
            y,
            clampedX: Math.max(0, Math.min(this.config.width - 1, x)),
            clampedY: Math.max(0, Math.min(this.config.height - 1, y)),
            isInside
        };
    }

    setupDragAndDrop() {
        if (!this.workspace) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            this.workspace.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.workspace.classList.add('drag-active');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.workspace.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.workspace.classList.remove('drag-active');
            });
        });

        this.workspace.addEventListener('drop', async (e) => {
            if (['prefix','title'].includes(window.mollyEditor?.getActiveProject?.()?.type)) {
                e.preventDefault();
                window.mollyEditor.showToast('Изображения можно добавлять в проекты GUI и холста.', 'info');
                return;
            }
            const itemDataStr = e.dataTransfer?.getData('application/minecraft-item');
            if (itemDataStr) {
                try {
                    const item = JSON.parse(itemDataStr);
                    const coords = this.getExactCoordinates(e);
                    if (window.mollyEditor && window.mollyEditor.itemsPanel) {
                        window.mollyEditor.itemsPanel.addItemToCanvas(item, coords.x, coords.y);
                    }
                    return;
                } catch (err) {
                    console.error('Ошибка добавления предмета на холст:', err);
                }
            }

            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;

            for (const file of files) {
                if (file.size > 512 * 1024 * 1024) { window.mollyEditor?.showToast('Файл превышает предел 512 МБ.', 'error'); continue; }
                const filePath = (window.desktopAPI?.getPathForFile ? window.desktopAPI.getPathForFile(file) : file.path) || '';
                const fileName = file.name || (filePath ? filePath.split(/[\\/]/).pop() : '');

                if (/\.mlst$/i.test(fileName)) {
                    if (window.mollyEditor && window.mollyEditor.projectManager) {
                        if (filePath && window.desktopAPI?.readFile) {
                            try {
                                // Use the same path as File → Open: it captures
                                // SHA-256 and focuses an already opened document.
                                await window.mollyEditor.projectManager.openRecentProject(filePath);
                                continue;
                            } catch (err) {
                                console.error('Ошибка открытия проекта через drop:', err);
                                window.mollyEditor.showToast('Не удалось открыть проект: ' + err.message, 'error');
                                continue;
                            }
                        }

                        try {
                            const parsed = parseProjectJSON(await file.text());
                            await window.mollyEditor.projectManager.deserializeProject(parsed);
                        } catch (err) {
                            console.error('Ошибка загрузки проекта:', err);
                        }
                        continue;
                    }
                } else if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(fileName)) {
                    // Queue the complete drop batch before yielding; decoding
                    // is serialized by DocumentTasks to keep memory bounded.
                    void window.mollyEditor?.importImage(file, {name: getRussianItemName(fileName)});
                }
            }
        });
    }

    samplePixelColor(x, y) {
        if (!this.canvas) return null;
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || px >= this.canvas.width || py < 0 || py >= this.canvas.height) return null;
        try {
            const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3] === 0) return 'Прозрачный';
            return '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        } catch (_) {
            return null;
        }
    }

    updateCursorPos(coords) {
        this.updateBrushCursor(coords);
        const posEl = document.getElementById('cursor-pos');
        if (posEl) {
            if (coords.isInside) {
                let text = `X: ${Math.floor(coords.x)}, Y: ${Math.floor(coords.y)}`;
                if (this.tools?.currentToolId === 'pipette' || this.isAltQuickPipette) {
                    const color = this.samplePixelColor(coords.x, coords.y);
                    if (color) text += ` | ${color}`;
                }
                posEl.innerText = text;
            } else {
                posEl.innerText = 'X: --, Y: --';
            }
        }
        if (this.rulersVisible) {
            this.renderRulers();
        }
    }

    renderRulers() {
        if (!this.rulersVisible || !this.rulerTop || !this.rulerLeft || !this.workspace) return;

        const dpr = window.devicePixelRatio || 1;
        const wsW = this.workspace.clientWidth;
        const wsH = this.workspace.clientHeight;
        const topW = Math.max(20, wsW - 20);
        const topH = 20;
        const leftW = 20;
        const leftH = Math.max(20, wsH - 58 - 32);

        this.rulerTop.style.width = `${topW}px`;
        this.rulerTop.style.height = `${topH}px`;
        this.rulerLeft.style.width = `${leftW}px`;
        this.rulerLeft.style.height = `${leftH}px`;

        const targetTopW = Math.floor(topW * dpr);
        const targetTopH = Math.floor(topH * dpr);
        const targetLeftW = Math.floor(leftW * dpr);
        const targetLeftH = Math.floor(leftH * dpr);

        if (this.rulerTop.width !== targetTopW || this.rulerTop.height !== targetTopH) {
            this.rulerTop.width = targetTopW;
            this.rulerTop.height = targetTopH;
        }
        if (this.rulerLeft.width !== targetLeftW || this.rulerLeft.height !== targetLeftH) {
            this.rulerLeft.width = targetLeftW;
            this.rulerLeft.height = targetLeftH;
        }

        const originX = this.panX;
        const originY = this.panY;

        let majorStep = 100;
        let minorStep = 20;
        if (this.zoom >= 16) {
            majorStep = 10;
            minorStep = 1;
        } else if (this.zoom >= 8) {
            majorStep = 20;
            minorStep = 5;
        } else if (this.zoom >= 4) {
            majorStep = 50;
            minorStep = 10;
        } else if (this.zoom >= 1) {
            majorStep = 100;
            minorStep = 20;
        } else {
            majorStep = 200;
            minorStep = 50;
        }

        // Top Ruler
        const tCtx = this.rulerTopCtx;
        tCtx.save();
        tCtx.scale(dpr, dpr);
        tCtx.clearRect(0, 0, topW, topH);
        tCtx.font = '9px Google Sans, sans-serif';
        tCtx.textAlign = 'left';
        tCtx.textBaseline = 'top';

        const minX = Math.floor((20 - originX) / this.zoom);
        const maxX = Math.ceil((20 + topW - originX) / this.zoom);
        const firstMinorX = Math.floor(minX / minorStep) * minorStep;

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const isLightTheme = currentTheme.startsWith('light');
        const majorColor = isLightTheme ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.45)';
        const minorColor = isLightTheme ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.18)';
        const textColor = isLightTheme ? 'rgba(0, 0, 0, 0.70)' : 'rgba(255, 255, 255, 0.65)';
        const boundaryColor = isLightTheme ? '#0284c7' : '#3b82f6';

        for (let x = firstMinorX; x <= maxX; x += minorStep) {
            const sx = Math.round((originX - 20) + x * this.zoom) + 0.5;
            if (sx < 0 || sx > topW) continue;
            const isMajor = (x % majorStep === 0);
            const isBoundary = (x === 0 || x === this.config.width);

            tCtx.strokeStyle = isBoundary ? boundaryColor : (isMajor ? majorColor : minorColor);
            tCtx.lineWidth = isBoundary ? 1.5 : 1;
            tCtx.beginPath();
            tCtx.moveTo(sx, isMajor || isBoundary ? 9 : 14);
            tCtx.lineTo(sx, 20);
            tCtx.stroke();

            if (isMajor && sx + 25 <= topW) {
                tCtx.fillStyle = isBoundary ? boundaryColor : textColor;
                tCtx.fillText(`${x}`, sx + 2, 1);
            }
        }

        if (this.currentMousePos?.isInside) {
            const cursorX = Math.round((originX - 20) + this.currentMousePos.x * this.zoom) + 0.5;
            if (cursorX >= 0 && cursorX <= topW) {
                tCtx.strokeStyle = '#EC4899';
                tCtx.lineWidth = 1;
                tCtx.beginPath();
                tCtx.moveTo(cursorX, 0);
                tCtx.lineTo(cursorX, 20);
                tCtx.stroke();
            }
        }
        tCtx.restore();

        // Left Ruler
        const lCtx = this.rulerLeftCtx;
        lCtx.save();
        lCtx.scale(dpr, dpr);
        lCtx.clearRect(0, 0, leftW, leftH);
        lCtx.font = '9px Google Sans, sans-serif';
        lCtx.textAlign = 'right';
        lCtx.textBaseline = 'top';

        const minY = Math.floor((58 - originY) / this.zoom);
        const maxY = Math.ceil((58 + leftH - originY) / this.zoom);
        const firstMinorY = Math.floor(minY / minorStep) * minorStep;

        for (let y = firstMinorY; y <= maxY; y += minorStep) {
            const sy = Math.round((originY - 58) + y * this.zoom) + 0.5;
            if (sy < 0 || sy > leftH) continue;
            const isMajor = (y % majorStep === 0);
            const isBoundary = (y === 0 || y === this.config.height);

            lCtx.strokeStyle = isBoundary ? boundaryColor : (isMajor ? majorColor : minorColor);
            lCtx.lineWidth = isBoundary ? 1.5 : 1;
            lCtx.beginPath();
            lCtx.moveTo(isMajor || isBoundary ? 9 : 14, sy);
            lCtx.lineTo(20, sy);
            lCtx.stroke();

            if (isMajor && sy + 14 <= leftH) {
                lCtx.save();
                lCtx.translate(8, sy + 2);
                lCtx.rotate(-Math.PI / 2);
                lCtx.fillStyle = isBoundary ? boundaryColor : textColor;
                lCtx.fillText(`${y}`, 0, 0);
                lCtx.restore();
            }
        }

        if (this.currentMousePos?.isInside) {
            const cursorY = Math.round((originY - 58) + this.currentMousePos.y * this.zoom) + 0.5;
            if (cursorY >= 0 && cursorY <= leftH) {
                lCtx.strokeStyle = '#EC4899';
                lCtx.lineWidth = 1;
                lCtx.beginPath();
                lCtx.moveTo(0, cursorY);
                lCtx.lineTo(20, cursorY);
                lCtx.stroke();
            }
        }
        lCtx.restore();
    }

    setupRulersAndGuides() {
        const btnRulers = document.getElementById('btn-toggle-rulers');
        const btnGuides = document.getElementById('btn-toggle-guides');
        const btnClearGuides = document.getElementById('btn-clear-guides');

        btnRulers?.addEventListener('click', () => this.toggleRulers());
        btnGuides?.addEventListener('click', () => this.toggleGuides());
        btnClearGuides?.addEventListener('click', () => this.clearGuides());

        this.rulerTop?.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            this.activeGuideDrag = { type: 'horizontal', pos: 0, fromRuler: true };
            this.handleGuideDragMove(e);
        });

        this.rulerLeft?.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            this.activeGuideDrag = { type: 'vertical', pos: 0, fromRuler: true };
            this.handleGuideDragMove(e);
        });

        window.addEventListener('pointermove', (e) => {
            if (this.activeGuideDrag) {
                this.handleGuideDragMove(e);
            }
        });

        window.addEventListener('pointerup', (e) => {
            if (this.activeGuideDrag) {
                this.finishGuideDrag(e);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;
            if (primaryModifier(e) && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К')) {
                e.preventDefault();
                this.toggleRulers();
            } else if (primaryModifier(e) && (e.code === 'Semicolon' || e.key === ';' || e.key === 'ж' || e.key === 'Ж')) {
                e.preventDefault();
                this.toggleGuides();
            }
        });
    }

    handleGuideDragMove(e) {
        if (!this.activeGuideDrag || !this.canvas) return;
        const canvasRect = this.canvas.getBoundingClientRect();
        if (this.activeGuideDrag.type === 'horizontal') {
            const rawY = Math.round((e.clientY - canvasRect.top) / this.zoom);
            this.activeGuideDrag.pos = Math.max(0, Math.min(this.config.height, rawY));
        } else {
            const rawX = Math.round((e.clientX - canvasRect.left) / this.zoom);
            this.activeGuideDrag.pos = Math.max(0, Math.min(this.config.width, rawX));
        }
        this.renderGrid();
    }

    finishGuideDrag(e) {
        if (!this.activeGuideDrag || !this.canvas) return;
        const canvasRect = this.canvas.getBoundingClientRect();
        const pos = this.activeGuideDrag.pos;

        const isH = this.activeGuideDrag.type === 'horizontal';
        const inside = isH 
            ? (e.clientY >= canvasRect.top - 20 && e.clientY <= canvasRect.bottom + 20)
            : (e.clientX >= canvasRect.left - 20 && e.clientX <= canvasRect.right + 20);

        if (inside && pos >= 0 && pos <= (isH ? this.config.height : this.config.width)) {
            const arr = isH ? this.guides.horizontal : this.guides.vertical;
            if (!arr.includes(pos)) {
                arr.push(pos);
                arr.sort((a, b) => a - b);
            }
            window.mollyEditor?.showToast?.(`Направляющая установлена на ${isH ? 'Y' : 'X'} = ${pos}px`, 'info');
        } else if (!this.activeGuideDrag.fromRuler) {
            window.mollyEditor?.showToast?.('Направляющая удалена', 'info');
        }

        this.activeGuideDrag = null;
        this.renderGrid();
        this.bus.emit('CANVAS_UPDATED');
    }

    toggleRulers(force) {
        this.rulersVisible = force !== undefined ? force : !this.rulersVisible;
        const canvasArea = this.workspace?.closest('.canvas-area') || this.workspace;
        canvasArea?.classList.toggle('rulers-hidden', !this.rulersVisible);
        document.getElementById('btn-toggle-rulers')?.classList.toggle('active', this.rulersVisible);
        this.renderGrid();
    }

    toggleGuides(force) {
        this.guidesVisible = force !== undefined ? force : !this.guidesVisible;
        document.getElementById('btn-toggle-guides')?.classList.toggle('active', this.guidesVisible);
        this.renderGrid();
        this.bus.emit('CANVAS_UPDATED');
    }

    clearGuides() {
        this.guides.horizontal = [];
        this.guides.vertical = [];
        this.renderGrid();
        this.bus.emit('CANVAS_UPDATED');
        window.mollyEditor?.showToast?.('Все направляющие удалены', 'info');
    }

    setupTiling() {
        const btnTiling = document.getElementById('btn-toggle-tiling');
        btnTiling?.addEventListener('click', () => this.toggleTiling());

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;
            const isW = e.code === 'KeyW' || e.key === 'w' || e.key === 'W' || e.key === 'ц' || e.key === 'Ц';
            if (isW && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                this.toggleTiling();
            }
        });
    }

    toggleTiling(force) {
        this.tilingMode = force !== undefined ? force : !this.tilingMode;
        document.getElementById('btn-toggle-tiling')?.classList.toggle('active', this.tilingMode);
        this.renderGrid();
        this.bus.emit('CANVAS_UPDATED');
        const msg = this.tilingMode ? 'Режим тайлинга 3×3 включен (W)' : 'Режим тайлинга выключен';
        window.mollyEditor?.showToast?.(msg, 'info');
    }

    setupReferenceImage() {
        const btnRefBadge = document.getElementById('status-ref-badge');
        const inputRefFile = document.getElementById('input-ref-file');

        inputRefFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                this.loadReferenceImage(file);
                e.target.value = '';
            }
        });

        btnRefBadge?.addEventListener('click', () => {
            if (!this.referenceImg?.getAttribute('src')) return;
            if (this.referenceOpacity === 0.4) this.setReferenceOpacity(0.7);
            else if (this.referenceOpacity === 0.7) this.setReferenceOpacity(0.2);
            else this.setReferenceOpacity(0.4);
        });

        btnRefBadge?.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.clearReferenceImage();
        });
    }

    loadReferenceImage(fileOrUrl) {
        if (!this.referenceImg) return;
        const setSrc = (src) => {
            if (typeof src !== 'string' || src.length > 24 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(src)) {
                window.mollyEditor?.showToast?.('Подложка должна быть PNG, JPEG, WebP или GIF размером до 18 МБ.', 'error');
                return;
            }
            this.referenceImg.src = src;
            this.referenceImg.style.display = 'block';
            this.referenceImg.style.opacity = `${this.referenceOpacity}`;
            this.referenceImg.style.width = `${this.config.width}px`;
            this.referenceImg.style.height = `${this.config.height}px`;

            const badge = document.getElementById('status-ref-badge');
            if (badge) {
                badge.style.display = 'inline-flex';
                badge.classList.add('active');
            }
            window.mollyEditor?.showToast?.('Подложка загружена (Клик — прозрачность, ПКМ — сброс)', 'success');
            this.bus.emit('CANVAS_UPDATED');
        };

        if (typeof fileOrUrl === 'string') {
            setSrc(fileOrUrl);
        } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
            if (fileOrUrl.size > 18 * 1024 * 1024) { window.mollyEditor?.showToast?.('Подложка превышает 18 МБ.', 'error'); return; }
            const projectId = window.mollyEditor?.activeProjectId;
            const reader = new FileReader();
            reader.onload = (e) => { if (window.mollyEditor?.activeProjectId === projectId) setSrc(e.target.result); };
            reader.readAsDataURL(fileOrUrl);
        }
    }

    setReferenceOpacity(val) {
        this.referenceOpacity = Math.max(0.05, Math.min(1.0, val));
        if (this.referenceImg) {
            this.referenceImg.style.opacity = `${this.referenceOpacity}`;
        }
        window.mollyEditor?.showToast?.(`Прозрачность подложки: ${Math.round(this.referenceOpacity * 100)}%`, 'info');
        this.bus.emit('CANVAS_UPDATED');
    }

    clearReferenceImage() {
        if (this.referenceImg) {
            this.referenceImg.removeAttribute('src');
            this.referenceImg.style.display = 'none';
        }
        const badge = document.getElementById('status-ref-badge');
        if (badge) {
            badge.style.display = 'none';
            badge.classList.remove('active');
        }
        window.mollyEditor?.showToast?.('Подложка удалена', 'info');
        this.bus.emit('CANVAS_UPDATED');
    }
}
