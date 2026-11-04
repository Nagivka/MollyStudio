import Tool from './Tool.js';
import { DrawCommand, AddLayerCommand } from '../core/Commands.js';
import { imageDataEquals } from '../core/ImageDataUtils.js';
import { isShortcutTarget } from '../ui/KeyboardNavigation.js';
import {regionsOf,containsPixel,combineSelection,transformSelection,rotateSelection,selectionEdges,selectionFromAlpha,maskPixels,forSelectedPixels} from './SelectionGeometry.mjs';
import {resizeAtAnchor} from './TransformGeometry.mjs';
import {polygonSelection,colorSelection} from './PixelSelection.mjs';
import {drawLayers} from '../graphics/LayerCompositing.js';
import {layerBranch} from '../core/LayerOrganization.mjs';
import {restoreLayerSnapshot} from '../graphics/LayerEdit.mjs';

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
        this.floatingMaster = null; this.floatingMaskSource = null; // immutable original shared by every resize gesture
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
        const updateAnimation=()=>{this.stopAntsAnimation();this.startAntsAnimation();this.renderSelectionOverlay();};
        document.addEventListener('visibilitychange',updateAnimation);
        window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change',updateAnimation);
        this.bus.on('SETTINGS_CHANGED',updateAnimation);

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
        document.getElementById('btn-prop-sel-content')?.addEventListener('click',()=>this.selectContent());
        document.getElementById('btn-prop-sel-invert')?.addEventListener('click',()=>this.invertSelection());
        document.getElementById('btn-prop-sel-grow')?.addEventListener('click',()=>this.changeBoundary(1));
        document.getElementById('btn-prop-sel-shrink')?.addEventListener('click',()=>this.changeBoundary(-1));
    }

    startAntsAnimation() {
        if (this.antsTimer || !this.selection || document.hidden || window.mollyEditor?.settingsManager?.get('animationsEnabled')===false || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        this.antsTimer = setInterval(() => {
            if (this.selection) {
                this.antsOffset = (this.antsOffset + 1) % 8;
                this.renderSelectionOverlay();
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
        const radius = 6 / zoom;
        const handles = this.getHandles(this.selection);
        let closest = null, distance = Infinity;
        for (const h of handles) {
            const dx = Math.abs(px - h.x);
            const dy = Math.abs(py - h.y);
            if (dx <= radius && dy <= radius && dx * dx + dy * dy < distance) {
                closest = h;
                distance = dx * dx + dy * dy;
            }
        }
        return closest;
    }

    cloneCanvas(srcCanvas) {
        if (!srcCanvas) return null;
        const c = document.createElement('canvas');
        c.width = srcCanvas.width;
        c.height = srcCanvas.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        try {
            ctx.putImageData(srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0,0,srcCanvas.width,srcCanvas.height),0,0);
            return c;
        } catch (error) { c.width = c.height = 1; throw error; }
    }

    scaleCanvas(srcCanvas, targetW, targetH) {
        if (!srcCanvas || srcCanvas.width <= 0 || srcCanvas.height <= 0) return srcCanvas;
        const nw = Math.max(1, Math.round(Math.abs(targetW)));
        const nh = Math.max(1, Math.round(Math.abs(targetH)));
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        try { ctx.drawImage(srcCanvas, 0, 0, nw, nh); return c; }
        catch (error) { c.width = c.height = 1; throw error; }
    }

    onPointerDown(x, y, color, size, layer, e) {
        const px = Math.floor(x);
        const py = Math.floor(y);
        this.downX = px;
        this.downY = py;
        const editPixels = document.getElementById('marquee-transform-mode')?.value === 'pixels' || e?.ctrlKey || e?.metaKey;
        this.combineMode=document.getElementById('marquee-combine-mode')?.value||'replace';
        const kind=this.toolManager?.currentToolId||'marquee';
        if(kind==='lasso'||kind==='wand'){
            if(this.hasFloating()&&!this.commitFloating(this.floatingLayer||layer))return;
            this.combineMode=e?.shiftKey&&e?.altKey?'intersect':e?.shiftKey?'add':e?.altKey?'subtract':this.combineMode;
            this.selectionBeforeDrag=this.selection;
            if(kind==='lasso'){
                this.lassoPoints=[{x:Math.max(0,Math.min(this.layerManager.config.width,x)),y:Math.max(0,Math.min(this.layerManager.config.height,y))}];
                this.isSelecting=true;this.updatePreview();
            }else{
                try{
                    const toleranceInput=document.getElementById('wand-tolerance');
                    if(toleranceInput&&(!toleranceInput.checkValidity()||toleranceInput.value===''))throw Error('Допуск должен быть целым числом от 0 до 255.');
                    let image;
                    if(document.getElementById('wand-source')?.value==='visible'||layer?.isGroup||layer?.type==='group'){
                        const canvas=document.createElement('canvas');canvas.width=this.layerManager.config.width;canvas.height=this.layerManager.config.height;
                        const ctx=canvas.getContext('2d',{willReadFrequently:true}),isolation=this.layerManager.getIsolationIds?.();
                        const layers=this.layerManager.getLayers(),branch=document.getElementById('wand-source')?.value!=='visible'&&layer?layerBranch(layers,layer.id):null;
                        const exclude=new Set(layers.filter(item=>isolation&&!isolation.has(item.id)||branch&&!branch.has(item.id)).map(item=>item.id));
                        drawLayers(ctx,layers,{exclude});image=ctx.getImageData(0,0,canvas.width,canvas.height);canvas.width=canvas.height=1;
                    }else{if(!layer)throw Error('Выберите слой для волшебной палочки.');image=layer.ctx.getImageData(0,0,layer.width,layer.height);}
                    const area=colorSelection(image,px,py,{tolerance:Number(toleranceInput?.value||0),contiguous:document.getElementById('wand-contiguous')?.checked!==false});
                    this.selection=combineSelection(this.selectionBeforeDrag,area,this.combineMode);this.startAntsAnimation();this.updatePreview();this.bus.emit('CANVAS_UPDATED');
                }catch(error){this.selection=this.selectionBeforeDrag;window.mollyEditor?.showToast(error.message,'warning');}
                this.selectionBeforeDrag=null;
            }
            return;
        }

        // 1. Check if clicking on an active transform handle
        if (this.selection && this.combineMode==='replace') {
            const handle = this.findHandleAt(px, py);
            if (handle) {
                // If not yet lifted into floating pixels, lift now if layer is editable
                if (editPixels && !this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
                    if (this.liftSelectionToFloating(layer) === false) return;
                }

                this.isTransformingHandle = true;
                this.activeHandle = handle;
                this.boxStart = { ...this.selection };
                this.handleFlipX=this.handleFlipY=false;
                if (this.hasFloating()) {
                    this.transformSourceCanvas = this.getFloatingMaster();
                }
                return;
            }
        }

        // 2. Check if clicking inside existing selection -> Start moving floating pixels
        if (this.selection && this.combineMode==='replace' && this.pointInSelection(px, py)) {
            if (editPixels && !this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
                if (this.liftSelectionToFloating(layer) === false) return;
            }
            this.isMovingFloating = true;
            this.moveStartX = px;
            this.moveStartY = py;
            this.floatingStartPos = { x: this.selection.x, y: this.selection.y, selection: this.selection };
            return;
        }

        // 3. Click outside selection -> Commit any active floating pixels and start new selection
        if (this.hasFloating()) {
            if (!this.commitFloating(layer)) return;
        }

        this.isSelecting = true;
        this.selectionBeforeDrag=this.selection;
        this.startX = Math.max(0, Math.min(this.layerManager.config.width - 1, px));
        this.startY = Math.max(0, Math.min(this.layerManager.config.height - 1, py));
        if(this.combineMode==='replace')this.selection = null;
        this.updatePreview();
    }

    liftSelectionToFloating(layer) {
        if (layer?.alphaLocked) return false;
        if (!layer || !this.selection || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') return false;

        const sx = Math.max(0, this.selection.x);
        const sy = Math.max(0, this.selection.y);
        const sw = Math.min(layer.width, this.selection.x + this.selection.width) - sx;
        const sh = Math.min(layer.height, this.selection.y + this.selection.height) - sy;

        if (sw <= 0 || sh <= 0) return false;
        let before, canvas, master, clearing = false;
        try {
            before = layer.getImageData();
            const data = maskPixels(layer.ctx.getImageData(sx,sy,sw,sh),sx,sy,this.selection);
            canvas = document.createElement('canvas');
            canvas.width = sw; canvas.height = sh;
            const ctx = canvas.getContext('2d', {willReadFrequently:true});
            ctx.imageSmoothingEnabled = false;
            ctx.putImageData(data,0,0);
            const rect = layer.sourceRect;
            master = !this.selection.regions&&layer.sourceCanvas&&rect&&sx===rect.x&&sy===rect.y&&sw===rect.w&&sh===rect.h ? layer.sourceCanvas : this.cloneCanvas(canvas);
            const selection = combineSelection(this.selection,{x:sx,y:sy,width:sw,height:sh},'intersect');
            const mask = transformSelection(selection,{x:0,y:0,width:master.width,height:master.height});
            clearing = true;
            this.withSelection(layer.ctx,()=>layer.ctx.clearRect(sx,sy,sw,sh));
            layer.shapeData = null;
            layer.invalidateSource?.();
            Object.assign(this,{beforeData:before,floatingLayer:layer,floatingData:data,floatingCanvas:canvas,floatingMaster:master,
                floatingX:sx,floatingY:sy,selection,floatingMaskSource:mask});
        } catch (error) {
            if (canvas) canvas.width = canvas.height = 1;
            if (master && master !== before?.mollySnapshot?.sourceCanvas && master !== canvas) master.width = master.height = 1;
            if (clearing) restoreLayerSnapshot(layer,before);
            this.reportSelectionFailure(error);
            return false;
        }
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }

    scaleSelectionFromHandle(handleId, dx, dy, shift, alt) {
        if (!this.boxStart || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
        if (alt) { dx *= 2; dy *= 2; }
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

        const normW = Math.max(1, Math.min(4096, Math.abs(Math.round(w))));
        const normH = Math.max(1, Math.min(4096, Math.abs(Math.round(h))));
        // Keep the opposite edge fixed after rounding, reflection and size limits.
        const signedW = w < 0 ? -normW : normW, signedH = h < 0 ? -normH : normH;
        x = handleId.includes('w') ? bs.x + bs.width - signedW : bs.x;
        y = handleId.includes('n') ? bs.y + bs.height - signedH : bs.y;
        const centered = alt ? resizeAtAnchor({x:bs.x,y:bs.y,w:bs.width,h:bs.height},normW,normH,{x:.5,y:.5}) : null;
        const normX = centered ? centered.x : Math.round(x + Math.min(0,signedW));
        const normY = centered ? centered.y : Math.round(y + Math.min(0,signedH));

        this.selection = transformSelection(this.hasFloating()?this.getFloatingMask():bs,{x:normX,y:normY,width:normW,height:normH},{flipX:w<0,flipY:h<0});

        if (this.transformSourceCanvas) {
            this.floatingCanvas = this.scaleCanvas(this.transformSourceCanvas, normW, normH);
            if(w<0||h<0)this.floatingCanvas=this.reflectCanvas(this.floatingCanvas,w<0,h<0);
        }
        this.handleFlipX=w<0;this.handleFlipY=h<0;

        this.updatePreview();
    }

    onPointerMove(x, y, color, size, layer, e) {
        if(this.isSelecting&&this.lassoPoints){
            const point={x:Math.max(0,Math.min(this.layerManager.config.width,x)),y:Math.max(0,Math.min(this.layerManager.config.height,y))},last=this.lassoPoints.at(-1);
            if(Math.abs(point.x-last.x)+Math.abs(point.y-last.y)>=.5){
                if(this.lassoPoints.length>=4096){this.selection=this.selectionBeforeDrag;this.lassoPoints=null;this.isSelecting=false;window.mollyEditor?.showToast('Лассо слишком длинное. Обведите меньшую область.','warning');}
                else this.lassoPoints.push(point);
            }
            this.updatePreview();return;
        }
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
            this.selection=transformSelection(this.floatingStartPos.selection,{...this.floatingStartPos.selection,x:this.floatingStartPos.x+dx,y:this.floatingStartPos.y+dy});
            this.floatingX = this.selection.x;
            this.floatingY = this.selection.y;

            this.updatePreview();
            return;
        }

        // 3. Creating new selection rectangle
        if (!this.isSelecting) return;

        let dx = Math.max(0, Math.min(this.layerManager.config.width - 1, px)) - this.startX;
        let dy = Math.max(0, Math.min(this.layerManager.config.height - 1, py)) - this.startY;

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

        const right = Math.min(this.layerManager.config.width, x0 + w), bottom = Math.min(this.layerManager.config.height, y0 + h);
        x0 = Math.max(0, x0); y0 = Math.max(0, y0);
        try{this.selection=combineSelection(this.selectionBeforeDrag,{x:x0,y:y0,width:Math.max(1,right-x0),height:Math.max(1,bottom-y0)},this.combineMode||'replace');}
        catch(error){window.mollyEditor?.showToast(error.message,'warning');this.isSelecting=false;this.selection=this.selectionBeforeDrag;}
        this.startAntsAnimation();
        this.updatePreview();
    }

    onPointerUp(x, y, color, size, layer, e) {
        if (Number.isFinite(x) && Number.isFinite(y) && (this.isSelecting || this.isMovingFloating || this.isTransformingHandle)) this.onPointerMove(x, y, color, size, layer, e);
        if(this.lassoPoints){
            try{const area=polygonSelection(this.lassoPoints,this.layerManager.config.width,this.layerManager.config.height);this.selection=area?combineSelection(this.selectionBeforeDrag,area,this.combineMode):this.selectionBeforeDrag;}
            catch(error){this.selection=this.selectionBeforeDrag;window.mollyEditor?.showToast(error.message,'warning');}
            this.lassoPoints=null;this.isSelecting=false;this.selectionBeforeDrag=null;this.startAntsAnimation();this.updatePreview();this.bus.emit('CANVAS_UPDATED');return;
        }
        if (this.isTransformingHandle) {
            if(this.transformSourceCanvas&&(this.handleFlipX||this.handleFlipY)){
                const source=this.transformSourceCanvas;
                this.floatingMaskSource=transformSelection(this.getFloatingMask(),{x:0,y:0,width:source.width,height:source.height},{flipX:this.handleFlipX,flipY:this.handleFlipY});
                this.floatingMaster=this.reflectCanvas(source,this.handleFlipX,this.handleFlipY);
            }
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
        this.selectionBeforeDrag=null;

        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    onHoverMove(x, y) {
        if(['lasso','wand'].includes(this.toolManager?.currentToolId)){const canvas=document.getElementById('main-canvas');if(canvas)canvas.style.cursor='crosshair';return;}
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

    renderSelectionOverlay() {
        if(this.isSelecting&&this.lassoPoints){
            const points=[...this.lassoPoints];this.bus.emit('SELECTION_OVERLAY_UPDATED',ctx=>{if(points.length<2)return;const zoom=window.mollyEditor?.workspace?.zoom||1;ctx.save();ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const point of points.slice(1))ctx.lineTo(point.x,point.y);ctx.closePath();ctx.fillStyle='rgba(100,160,255,.12)';ctx.fill('evenodd');ctx.lineWidth=3/zoom;ctx.strokeStyle='#000';ctx.stroke();ctx.lineWidth=1/zoom;ctx.strokeStyle='#fff';ctx.setLineDash([4/zoom,4/zoom]);ctx.stroke();ctx.restore();});return;
        }
        this.bus.emit('SELECTION_OVERLAY_UPDATED', this.selection ? ctx => {
            if (!this.selection) return;
            if(this.toolManager?.currentToolId!=='marquee'&&!this.hasFloating()){
                ctx.save();ctx.beginPath();ctx.rect(0,0,this.layerManager.config.width,this.layerManager.config.height);ctx.clip();
                ctx.beginPath();ctx.rect(0,0,this.layerManager.config.width,this.layerManager.config.height);
                for(const region of this.selection.regions||[this.selection])ctx.rect(region.x,region.y,region.width,region.height);
                ctx.fillStyle='rgba(0,0,0,.25)';ctx.fill('evenodd');ctx.restore();
            }
            const floating = this.getFloatingCanvas();
            if (floating) { ctx.imageSmoothingEnabled = false; ctx.drawImage(floating, this.selection.x, this.selection.y); }
            this.drawMarchingAnts(ctx, this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        } : null);
    }

    updatePreview() {
        this.renderSelectionOverlay();
        this.bus.emit('PREVIEW_CLEARED');
    }

    pointInSelection(px, py) {
        return containsPixel(this.selection,px,py);
    }

    drawMarchingAnts(ctx, x, y, w, h) {
        const zoom = window.mollyEditor?.workspace?.zoom || 1;
        ctx.save();
        // 1. Solid dark border outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.lineWidth = 1 / zoom;
        this.drawSelectionPath(ctx,x,y,w,h);ctx.stroke();

        // 2. Animated marching ants dash
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1 / zoom;
        ctx.lineDashOffset = this.antsOffset / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);
        this.drawSelectionPath(ctx,x,y,w,h);ctx.stroke();

        // 3. 8 Transform handles
        const handles = this.toolManager?.currentToolId === 'marquee' ? this.getHandles({ x, y, width: w, height: h }) : [];
        const handleSize = 6 / zoom;
        const half = handleSize / 2;

        ctx.setLineDash([]);
        for (const hn of handles) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(hn.x - half, hn.y - half, handleSize, handleSize);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1 / zoom;
            ctx.strokeRect(hn.x - half, hn.y - half, handleSize, handleSize);
        }
        if(handles.length){
            ctx.font=`${11/zoom}px "Google Sans", sans-serif`;ctx.textBaseline='bottom';ctx.textAlign='left';
            const text=`${w} × ${h} px`,padding=4/zoom,tx=x,ty=y-8/zoom;
            ctx.fillStyle='#202124';ctx.fillRect(tx-padding,ty-14/zoom,ctx.measureText(text).width+padding*2,17/zoom);
            ctx.fillStyle='#fff';ctx.fillText(text,tx,ty);
        }
        ctx.restore();
    }

    hasFloating() {
        return Boolean(this.floatingCanvas || this.floatingData);
    }

    getSelectionEdges() {
        if(this.edgeCache?.selection!==this.selection)this.edgeCache={selection:this.selection,edges:selectionEdges(this.selection)};
        return this.edgeCache.edges;
    }

    drawSelectionPath(ctx,x,y,w,h) {
        ctx.beginPath();
        if(!this.selection?.regions){ctx.rect(x,y,w,h);return;}
        for(const edge of this.getSelectionEdges()){
            ctx.moveTo(edge.x,edge.y);const horizontal=['top','bottom'].includes(edge.side);
            ctx.lineTo(edge.x+(horizontal?edge.length:0),edge.y+(horizontal?0:edge.length));
        }
    }

    paintSelectionOutline(ctx,offsetX=0,offsetY=0) {
        for(const e of this.getSelectionEdges()){
            const horizontal=['top','bottom'].includes(e.side);
            ctx.fillRect(e.x-offsetX-(e.side==='right'?1:0),e.y-offsetY-(e.side==='bottom'?1:0),horizontal?e.length:1,horizontal?1:e.length);
        }
    }

    selectContent() {
        if(this.hasFloating()&&!this.commitFloating(this.floatingLayer))return false;
        const layer=this.layerManager.getActiveLayer();if(!layer)return false;
        try{this.selection=selectionFromAlpha(layer.ctx.getImageData(0,0,layer.width,layer.height));}
        catch(error){window.mollyEditor?.showToast(error.message,'warning');return false;}
        if(this.selection)this.startAntsAnimation();else this.stopAntsAnimation();
        this.updatePreview();this.bus.emit('CANVAS_UPDATED');return true;
    }

    invertSelection() {
        if(this.hasFloating()&&!this.commitFloating(this.floatingLayer))return false;
        const canvas={x:0,y:0,width:this.layerManager.config.width,height:this.layerManager.config.height};
        try{this.selection=combineSelection(canvas,this.selection,'subtract');}
        catch(error){window.mollyEditor?.showToast(error.message,'warning');return false;}
        if(this.selection)this.startAntsAnimation();else this.stopAntsAnimation();
        this.updatePreview();this.bus.emit('CANVAS_UPDATED');return true;
    }

    changeBoundary(delta) {
        if(!this.selection||this.hasFloating()&&!this.commitFloating(this.floatingLayer))return false;
        const canvas={x:0,y:0,width:this.layerManager.config.width,height:this.layerManager.config.height};
        try{
            const source=delta>0?this.selection:combineSelection({x:-1,y:-1,width:canvas.width+2,height:canvas.height+2},this.selection,'subtract');
            let expanded=null;
            for(const r of regionsOf(source))expanded=combineSelection(expanded,{x:r.x-1,y:r.y-1,width:r.width+2,height:r.height+2},'add');
            this.selection=combineSelection(canvas,expanded,delta>0?'intersect':'subtract');
        }catch(error){window.mollyEditor?.showToast(error.message,'warning');return false;}
        if(this.selection)this.startAntsAnimation();else this.stopAntsAnimation();
        this.updatePreview();this.bus.emit('CANVAS_UPDATED');return true;
    }

    getFloatingMaster() {
        return this.floatingMaster ??= this.cloneCanvas(this.getFloatingCanvas());
    }

    resetFloatingMaster() {
        this.floatingMaster = this.cloneCanvas(this.getFloatingCanvas());
        this.floatingMaskSource=transformSelection(this.selection,{x:0,y:0,width:this.floatingMaster.width,height:this.floatingMaster.height});
    }

    getFloatingMask() {
        if(!this.floatingMaskSource){const source=this.getFloatingMaster();this.floatingMaskSource=transformSelection(this.selection,{x:0,y:0,width:source.width,height:source.height});}
        return this.floatingMaskSource;
    }

    getFloatingCanvas() {
        if (this.floatingCanvas) return this.floatingCanvas;
        if (!this.floatingData) return null;

        const canvas = document.createElement('canvas');
        canvas.width = this.floatingData.width;
        canvas.height = this.floatingData.height;
        canvas.getContext('2d', { willReadFrequently: true }).putImageData(this.floatingData, 0, 0);
        this.floatingCanvas = canvas;
        return canvas;
    }

    commitFloating(layer) {
        if (!this.hasFloating() || !this.selection) return false;

        const originalLayer = this.floatingLayer;
        const previousActiveId = this.layerManager.activeLayerId;
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
        // A standalone object can remain editable from its original after committing.
        const preserveSource = !target.alphaLocked && !target.getBounds?.();
        try {
            const floatingCanvas = this.getFloatingCanvas();
            if (floatingCanvas) {
                target.ctx.save();
                try {
                    target.ctx.imageSmoothingEnabled = false;
                    if (target.alphaLocked) target.ctx.globalCompositeOperation = 'source-atop';
                    target.ctx.drawImage(floatingCanvas, this.selection.x, this.selection.y);
                } finally { target.ctx.restore(); }
            } else if (this.floatingData) {
                target.ctx.putImageData(this.floatingData, this.selection.x, this.selection.y);
            }
            if (preserveSource) target.setMasterSource?.(this.getFloatingMaster(), { x: this.selection.x, y: this.selection.y, w: this.selection.width, h: this.selection.height });
            if (isNew) {
                target.invalidateSource?.(!preserveSource);
                this.history.push(new AddLayerCommand(this.layerManager, target));
            } else {
                const beforeData = target === originalLayer ? this.beforeData : targetBeforeData;
                if (beforeData) this.commitRasterEdit(target, beforeData, 'Выделение', 'crop_square', { preserveSource });
            }
        } catch (error) {
            if (isNew) {
                this.layerManager.removeLayer(target.id);
                if (previousActiveId) this.layerManager.setActive(previousActiveId);
            }
            else {
                target.putImageData(targetBeforeData);
                target.contentRevision = targetBeforeData.mollySnapshot?.contentRevision ?? target.contentRevision;
            }
            globalThis.window?.mollyEditor?.showToast?.('Не удалось закрепить выделение. Повторите действие или отмените выделение.', 'error');
            this.bus.emit('CANVAS_UPDATED');
            return false;
        }

        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingMaster = null; this.floatingMaskSource = null;
        this.floatingLayer = null;
        this.beforeData = null;
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }

    cancelFloating() {
        const layer = this.floatingLayer || this.layerManager.getActiveLayer();
        if (this.beforeData && layer) {
            layer.putImageData(this.beforeData);
            layer.contentRevision = this.beforeData.mollySnapshot?.contentRevision ?? layer.contentRevision;
        }
        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingMaster = null; this.floatingMaskSource = null;
        this.floatingLayer = null;
        this.beforeData = null;
        this.selection = null;
        this.stopAntsAnimation();
        this.bus.emit('PREVIEW_CLEARED');
        this.bus.emit('SELECTION_OVERLAY_UPDATED', null);
        this.bus.emit('CANVAS_UPDATED');
    }

    cancelAction() {
        const previous=this.isSelecting?this.selectionBeforeDrag:null;this.lassoPoints=null;
        this.isSelecting = false;
        this.isMovingFloating = false;
        this.isTransformingHandle = false;
        this.activeHandle = null;
        this.transformSourceCanvas = null;
        if (this.hasFloating()) this.cancelFloating();
        else { this.selection = previous; this.stopAntsAnimation();this.startAntsAnimation();this.bus.emit('PREVIEW_CLEARED');this.renderSelectionOverlay(); }
    }

    clearSelection() {
        this.lassoPoints=null;this.isSelecting=false;
        const layer = this.layerManager.getActiveLayer();
        if (this.hasFloating()) {
            if (!this.commitFloating(this.floatingLayer || layer)) return;
        }
        this.selection = null;
        this.floatingData = null;
        this.floatingCanvas = null;
        this.floatingMaster = null; this.floatingMaskSource = null;
        this.floatingLayer = null;
        this.stopAntsAnimation();
        this.bus.emit('PREVIEW_CLEARED');
        this.bus.emit('SELECTION_OVERLAY_UPDATED', null);
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

    reportSelectionFailure(error) {
        console.error('[Selection] Operation failed:', error);
        globalThis.window?.mollyEditor?.showToast?.('Не удалось изменить выделение. Повторите действие; предыдущее состояние сохранено.', 'error');
        this.bus.emit('CANVAS_UPDATED');
    }

    editSelectionPixels(layer, draw, name = 'Выделение', icon = 'crop_square') {
        let before;
        try {
            before = layer.getImageData();
            layer.ctx.save();
            try { draw(layer.ctx); } finally { layer.ctx.restore(); }
            return this.commitRasterEdit(layer, before, name, icon);
        } catch (error) {
            if (before) {
                try { restoreLayerSnapshot(layer, before); }
                catch (restoreError) { throw new AggregateError([error, restoreError], 'Не удалось восстановить выделение.', {cause: error}); }
            }
            this.reportSelectionFailure(error);
            return null;
        }
    }

    editFloatingPixels(draw) {
        let candidate;
        try {
            // Work on a separate canvas: the current master may also belong to
            // the clipboard or history and must stay immutable even on failure.
            candidate = this.cloneCanvas(this.getFloatingCanvas());
            if (!candidate) return false;
            const ctx = candidate.getContext('2d', {willReadFrequently: true});
            ctx.save();
            try { draw(ctx, candidate); } finally { ctx.restore(); }
            const mask = transformSelection(this.selection, {x:0,y:0,width:candidate.width,height:candidate.height});
            this.floatingCanvas = candidate;
            this.floatingData = null;
            this.floatingMaster = candidate;
            this.floatingMaskSource = mask;
        } catch (error) {
            if (candidate) candidate.width = candidate.height = 1;
            this.reportSelectionFailure(error);
            return false;
        }
        this.updatePreview();
        return true;
    }

    copy() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.selection) return false;
        let copyCanvas;
        try {
            if (this.hasFloating()) {
                copyCanvas = this.cloneCanvas(this.getFloatingCanvas());
                this.clipboard = {canvas:copyCanvas,master:this.getFloatingMaster(),mask:this.getFloatingMask(),width:copyCanvas.width,height:copyCanvas.height};
            } else {
                const sx = Math.max(0,this.selection.x), sy = Math.max(0,this.selection.y);
                const sw = Math.min(layer.width,this.selection.x+this.selection.width)-sx;
                const sh = Math.min(layer.height,this.selection.y+this.selection.height)-sy;
                if (sw <= 0 || sh <= 0) return false;
                copyCanvas = document.createElement('canvas');
                copyCanvas.width = sw; copyCanvas.height = sh;
                const ctx = copyCanvas.getContext('2d', {willReadFrequently:true});
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(layer.canvas,sx,sy,sw,sh,0,0,sw,sh);
                if (this.selection.regions) ctx.putImageData(maskPixels(ctx.getImageData(0,0,sw,sh),sx,sy,this.selection),0,0);
                const rect = layer.sourceRect;
                const master = !this.selection.regions&&layer.sourceCanvas&&rect&&rect.x===sx&&rect.y===sy&&rect.w===sw&&rect.h===sh ? layer.sourceCanvas : copyCanvas;
                const clipped = combineSelection(this.selection,{x:sx,y:sy,width:sw,height:sh},'intersect');
                this.clipboard = {canvas:copyCanvas,master,mask:transformSelection(clipped,{x:0,y:0,width:master.width,height:master.height}),width:sw,height:sh};
            }
        } catch (error) {
            if (copyCanvas) copyCanvas.width = copyCanvas.height = 1;
            this.reportSelectionFailure(error);
            return false;
        }
        this.bus?.emit?.('SELECTION_CLIPBOARD_CHANGED');
        return true;
    }

    removeFloatingPixels(name, icon) {
        const target = this.floatingLayer || this.layerManager.getActiveLayer();
        try {
            if (this.beforeData && target) {
                const after = target.getImageData();
                if (!imageDataEquals(this.beforeData,after)) this.history.push(new DrawCommand(target,this.beforeData,after,name,icon));
            }
        } catch (error) { this.reportSelectionFailure(error); return false; }
        this.floatingCanvas = this.floatingData = this.floatingLayer = this.beforeData = null;
        this.clearSelection();
        return true;
    }

    cut() {
        if (this.layerManager.getActiveLayer()?.alphaLocked) return;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (this.copy() === false) return;

        if (this.hasFloating()) {
            this.removeFloatingPixels('Вырезать выделение','content_cut');
            return;
        }

        const changed = this.editSelectionPixels(layer, ctx => {
            this.withSelection(ctx,()=>ctx.clearRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height));
        });
        if (changed !== null) this.clearSelection();
    }

    paste() {
        if (!this.clipboard) return;
        if (this.hasFloating() && !this.commitFloating(this.floatingLayer || this.layerManager.getActiveLayer())) return;

        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') {
            const master=this.clipboard.master||this.clipboard.canvas;
            if(this.layerManager.canAllocateLayers?.(1,this.layerManager.config.width*this.layerManager.config.height+master.width*master.height)===false)return;
            const previousId = this.layerManager.activeLayerId;
            let newLayer;
            try {
                newLayer = this.layerManager.addLayer('Вставка');
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
                newLayer.setMasterSource?.(master,{x:dx,y:dy,w:this.clipboard.width,h:this.clipboard.height});
                this.history.push(new AddLayerCommand(this.layerManager, newLayer));
            } catch (error) {
                if (newLayer) this.layerManager.removeLayer(newLayer.id);
                if (previousId) this.layerManager.setActive(previousId);
                this.reportSelectionFailure(error);
                return false;
            }
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        const px = this.selection ? this.selection.x : Math.round((layer.width - this.clipboard.width) / 2);
        const py = this.selection ? this.selection.y : Math.round((layer.height - this.clipboard.height) / 2);
        let canvas;
        try {
            const before = layer.getImageData();
            canvas = this.cloneCanvas(this.clipboard.canvas);
            const master = this.clipboard.master || canvas;
            const mask = this.clipboard.mask || {x:0,y:0,width:master.width,height:master.height};
            const data = canvas.getContext('2d', {willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
            const selection = transformSelection(mask,{x:px,y:py,width:this.clipboard.width,height:this.clipboard.height});
            Object.assign(this,{beforeData:before,floatingLayer:layer,floatingCanvas:canvas,floatingMaster:master,floatingMaskSource:mask,floatingData:data,selection});
        } catch (error) {
            if (canvas) canvas.width = canvas.height = 1;
            this.reportSelectionFailure(error);
            return false;
        }
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
            this.removeFloatingPixels('Удалить выделение','delete');
            return;
        }

        this.editSelectionPixels(layer, ctx => {
            this.withSelection(ctx,()=>ctx.clearRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height));
        });
    }

    fillSelection(fillColor = null) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        const color = fillColor || window.mollyEditor?.tools?.color || '#3B82F6';

        if (this.hasFloating()) {
            this.editFloatingPixels((ctx, canvas) => {
                this.clipToSelection(ctx,this.selection,this.selection.x,this.selection.y);
                ctx.fillStyle = color;
                ctx.fillRect(0,0,canvas.width,canvas.height);
            });
            return;
        }

        this.editSelectionPixels(layer, ctx => {
            this.clipToSelection(ctx);
            if (layer.alphaLocked) ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = color;
            ctx.fillRect(this.selection.x,this.selection.y,this.selection.width,this.selection.height);
        });
    }

    strokeSelection(strokeColor = null) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        const color = strokeColor || window.mollyEditor?.tools?.color || '#3B82F6';
        if (this.hasFloating()) {
            this.editFloatingPixels(ctx => {
                ctx.fillStyle = color;
                this.paintSelectionOutline(ctx,this.selection.x,this.selection.y);
            });
            return;
        }

        this.editSelectionPixels(layer, ctx => {
            if (layer.alphaLocked) ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = color;
            this.paintSelectionOutline(ctx);
        });
    }

    flipFloating(horizontal = true, vertical = false) {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (!this.hasFloating()) {
            if (this.liftSelectionToFloating(layer) === false) return;
        }

        const sourceCanvas = this.getFloatingMaster();
        if (!sourceCanvas) return;

        const temp = document.createElement('canvas');
        temp.width = sourceCanvas.width;
        temp.height = sourceCanvas.height;
        const tCtx = temp.getContext('2d', { willReadFrequently: true });
        tCtx.imageSmoothingEnabled = false;

        tCtx.save();
        tCtx.translate(horizontal ? temp.width : 0, vertical ? temp.height : 0);
        tCtx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
        tCtx.drawImage(sourceCanvas, 0, 0);
        tCtx.restore();

        this.floatingMaskSource=transformSelection(this.getFloatingMask(),{x:0,y:0,width:temp.width,height:temp.height},{flipX:horizontal,flipY:vertical});
        this.floatingMaster = temp;
        this.floatingCanvas = this.scaleCanvas(temp, this.selection.width, this.selection.height);
        this.selection=transformSelection(this.floatingMaskSource,this.selection);
        this.updatePreview();
    }

    rotateFloating(deg = 90) {
        if (!Number.isFinite(deg) || deg % 90 !== 0 || deg % 360 === 0) return;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        if (!this.hasFloating()) {
            if (this.liftSelectionToFloating(layer) === false) return;
        }

        const sourceCanvas = this.getFloatingMaster();
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
        const tCtx = temp.getContext('2d', { willReadFrequently: true });
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
        const width = isSwap ? this.selection.height : this.selection.width;
        const height = isSwap ? this.selection.width : this.selection.height;
        const nx = Math.round(cx - width / 2);
        const ny = Math.round(cy - height / 2);

        this.floatingMaskSource=rotateSelection(this.getFloatingMask(),normDeg,{x:0,y:0,width:temp.width,height:temp.height});
        this.floatingMaster = temp;
        this.floatingCanvas = this.scaleCanvas(temp, width, height);
        this.selection=transformSelection(this.floatingMaskSource,{x:nx,y:ny,width,height});
        this.floatingX = nx;
        this.floatingY = ny;
        this.updatePreview();
    }

    nudge(dx, dy) {
        if (!this.selection) return;
        const layer = this.layerManager.getActiveLayer();
        if (document.getElementById('marquee-transform-mode')?.value === 'pixels' && !this.hasFloating() && layer && !layer.locked && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') {
            if (this.liftSelectionToFloating(layer) === false) return;
        }

        this.selection=transformSelection(this.selection,{...this.selection,x:this.selection.x+dx,y:this.selection.y+dy});
        this.floatingX = this.selection.x;
        this.floatingY = this.selection.y;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    invertSelectedColors() {
        const layer = this.layerManager.getActiveLayer();
        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group' || !this.selection) return;

        const invert = (ctx, x, y, width, height) => {
            const imgData = ctx.getImageData(x, y, width, height);
            const d = imgData.data;
            forSelectedPixels(imgData,this.selection.x,this.selection.y,this.selection,i=>{
                if (d[i + 3] > 0) {
                    d[i] = 255 - d[i];
                    d[i + 1] = 255 - d[i + 1];
                    d[i + 2] = 255 - d[i + 2];
                }
            });
            ctx.putImageData(imgData,x,y);
        };
        if (this.hasFloating()) {
            this.editFloatingPixels((ctx, canvas) => invert(ctx,0,0,canvas.width,canvas.height));
            return;
        }
        this.editSelectionPixels(layer, ctx => invert(ctx,this.selection.x,this.selection.y,this.selection.width,this.selection.height), 'Цвет выделения', 'palette');
    }

    recolorSelection(hexColor) {
        const layer = this.layerManager.getActiveLayer();
        if (!this.selection) return;

        const color = hexColor || '#3B82F6';

        if (this.hasFloating()) {
            this.editFloatingPixels((ctx, canvas) => {
                ctx.globalCompositeOperation = 'source-in';
                ctx.fillStyle = color;
                ctx.fillRect(0,0,canvas.width,canvas.height);
            });
            return;
        }

        if (!layer || layer.locked || (this.layerManager.isEditable && !this.layerManager.isEditable(layer)) || layer.isBase || layer.type === 'text' || layer.isGroup || layer.type === 'group') return;

        this.editSelectionPixels(layer, ctx => {
            const temp = document.createElement('canvas');
            try {
                temp.width = this.selection.width;
                temp.height = this.selection.height;
                const tCtx = temp.getContext('2d', {willReadFrequently:true});
                tCtx.drawImage(layer.canvas,this.selection.x,this.selection.y,this.selection.width,this.selection.height,0,0,temp.width,temp.height);
                tCtx.globalCompositeOperation = 'source-in';
                tCtx.fillStyle = color;
                tCtx.fillRect(0,0,temp.width,temp.height);
                this.withSelection(ctx,()=>{
                    ctx.clearRect(this.selection.x,this.selection.y,this.selection.width,this.selection.height);
                    ctx.drawImage(temp,this.selection.x,this.selection.y);
                });
            } finally { temp.width = temp.height = 1; }
        }, 'Цвет выделения', 'palette');
    }

    setSelectionPosition(newX, newY) {
        if (!this.selection || !Number.isFinite(newX) || !Number.isFinite(newY)||Math.abs(newX)>1000000||Math.abs(newY)>1000000||!this.prepareNumericSelection()) return;
        this.selection=transformSelection(this.selection,{...this.selection,x:Math.round(newX),y:Math.round(newY)});
        this.floatingX = this.selection.x;
        this.floatingY = this.selection.y;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    reflectCanvas(source,horizontal,vertical) {
        const result=document.createElement('canvas');result.width=source.width;result.height=source.height;
        const ctx=result.getContext('2d');ctx.translate(horizontal?result.width:0,vertical?result.height:0);ctx.scale(horizontal?-1:1,vertical?-1:1);ctx.drawImage(source,0,0);return result;
    }

    prepareNumericSelection() {
        if(this.hasFloating()||document.getElementById('marquee-transform-mode')?.value!=='pixels')return true;
        const layer=this.layerManager.getActiveLayer();
        if(!layer||layer.isBase||layer.type==='text'||layer.isGroup||this.layerManager.isEditable(layer)===false)return false;
        this.liftSelectionToFloating(layer);return this.hasFloating();
    }

    setSelectionDimensions(newW, newH,axis=null) {
        if (!this.selection) return;
        if (!Number.isFinite(Number(newW)) || !Number.isFinite(Number(newH))||!this.prepareNumericSelection()) return;
        let w = Math.max(1, Math.min(4096, Math.round(newW)));
        let h = Math.max(1, Math.min(4096, Math.round(newH)));
        if(axis&&document.getElementById('prop-lock-aspect')?.checked){if(axis==='w')h=Math.max(1,Math.min(4096,Math.round(w*this.selection.height/this.selection.width)));else w=Math.max(1,Math.min(4096,Math.round(h*this.selection.width/this.selection.height)));}
        const [ax,ay]=(document.getElementById('prop-resize-anchor')?.value||'0,0').split(',').map(Number);
        const rect=resizeAtAnchor({x:this.selection.x,y:this.selection.y,w:this.selection.width,h:this.selection.height},w,h,{x:ax,y:ay});
        if(!rect)return;
        if (this.hasFloating()) {
            this.floatingCanvas = this.scaleCanvas(this.getFloatingMaster(), w, h);
        }
        this.selection=transformSelection(this.hasFloating()?this.getFloatingMask():this.selection,{x:rect.x,y:rect.y,width:w,height:h});
        this.floatingX=rect.x;this.floatingY=rect.y;
        this.updatePreview();
        this.bus.emit('CANVAS_UPDATED');
    }

    deactivate() {
        const layer = this.layerManager.getActiveLayer();
        if (this.hasFloating()) {
            if (!this.commitFloating(this.floatingLayer || layer)) return false;
        }
        this.bus.emit('PREVIEW_CLEARED');
        this.updatePreview();
        return true;
    }

    onKeyDown(e) {
        if (e?.defaultPrevented || isShortcutTarget(e?.target, e)) return;
        const active = window.mollyEditor?.tools?.currentToolId;
        if (!['marquee','lasso','wand'].includes(active)) {
            if (this.selection && (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.code === 'KeyD'))) {
                e.preventDefault(); this.clearSelection();
            }
            return;
        }

        // Clipboard
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
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
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyI') {
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
