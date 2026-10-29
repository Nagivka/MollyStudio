import { isControlFocused } from '../ui/ControlFocus.js';
import Tool from './Tool.js';
import { DrawCommand, TextDataCommand, CompoundCommand } from '../core/Commands.js';
import {captureTextState,restoreTextState} from '../graphics/TextEdit.mjs';
import { isShortcutTarget } from '../ui/KeyboardNavigation.js';
import { boundsOf, resizeAtAnchor, alignmentOffsets, distributionOffsets } from './TransformGeometry.mjs';
import { layerState } from '../graphics/LayerCompositing.js';
import {transformBatch} from './BatchTransform.js';
import {equalGapSnap} from './SmartGuides.mjs';
import {pickLayerAt,layersAtPoint} from '../graphics/LayerPicking.mjs';
import {inheritButtonSource} from '../graphics/ButtonSource.mjs';
import {bindAttribute} from '../core/Locale.mjs';

/**
 * Translation and bitmap transforms from an immutable source image.
 * Drag handles transform the active object; numeric operations also support batches.
 * Mixed groups retain editable text and a separate pristine master for each bitmap.
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
        const sCtx = sc.getContext('2d', { willReadFrequently: true });
        sCtx.imageSmoothingEnabled = false;
        sCtx.putImageData(target.ctx.getImageData(b.x,b.y,b.w,b.h),0,0);
        return sc;
    }

    ensureSourceCanvas(target) {
        if (!target || target.type === 'text') return null;
        if (target.sourceCanvas && target.sourceCanvas.width > 0 && target.sourceCanvas.height > 0) {
            return target.sourceCanvas;
        }
        const bounds = this.getLayerBoundingBox(target);
        if (bounds && this.layerManager.canAllocateLayers?.(0, bounds.w * bounds.h) === false) return null;
        return this.captureSourceCanvas(target);
    }

    setupListeners() {
        this.bus.on('PREVIEW_CLEARED',()=>this.clearHover());
        this.bus.on('CANVAS_UPDATED',()=>this.clearHover());
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
            this.clearHover();
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
        const autoSelect=document.getElementById('move-autosel')?.closest('label');
        if(autoSelect)bindAttribute(autoSelect,'title','Автовыбор слоя. Alt+клик — перебор перекрытых объектов.');
        const bindBtn = (id1, id2, fn) => {
            document.getElementById(id1)?.addEventListener('click', () => {
                const m=this.getActiveSelection();
                const actions={
                    'btn-prop-fliph':()=>m.flipFloating(true,false),'btn-prop-flipv':()=>m.flipFloating(false,true),
                    'btn-prop-rotcw':()=>m.rotateFloating(90),'btn-prop-rotccw':()=>m.rotateFloating(-90),
                    'btn-prop-scale2x':()=>m.setSelectionDimensions(m.selection.width*2,m.selection.height*2),
                    'btn-prop-scalehalf':()=>m.setSelectionDimensions(m.selection.width/2,m.selection.height/2),
                    'btn-prop-original-size':()=>{const source=m.getFloatingMaster();if(source)m.setSelectionDimensions(source.width,source.height);},
                    'btn-prop-invert':()=>m.invertSelectedColors()
                };
                if(m&&actions[id1])actions[id1]();else fn();
            });
            if (id2) document.getElementById(id2)?.addEventListener('click', fn);
        };

        bindBtn('btn-prop-fliph', 'btn-transform-fliph', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.flip(true, false);
        });

        bindBtn('btn-prop-flipv', 'btn-transform-flipv', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.flip(false, true);
        });

        bindBtn('btn-prop-rotcw', 'btn-transform-rotcw', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.rotateFixed(90);
        });

        bindBtn('btn-prop-rotccw', 'btn-transform-rotccw', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.rotateFixed(-90);
        });

        bindBtn('btn-prop-scale2x', 'btn-transform-scale2x', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.scaleUniform(2);
        });

        bindBtn('btn-prop-scalehalf', 'btn-transform-scalehalf', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.scaleUniform(0.5);
        });
        bindBtn('btn-prop-original-size', null, () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target?.sourceCanvas) this.setBoxDimensions(target.sourceCanvas.width, target.sourceCanvas.height);
        });

        bindBtn('btn-prop-invert', 'btn-transform-invert', () => {
            const target = this.targetLayer || this.getEditableLayer();
            if (target && (target.isBase || target.type === 'text' && !this.isBatchTarget(target))) return;
            this.invert();
        });

        // Alignment Buttons
        bindBtn('btn-prop-align-center-h', 'btn-align-center-h', () => this.alignLayer('center-h'));
        bindBtn('btn-prop-align-center-v', 'btn-align-center-v', () => this.alignLayer('center-v'));
        for(const type of ['left','right','top','bottom'])bindBtn(`btn-prop-align-${type}`,null,()=>this.alignLayer(type));
        for(const axis of ['x','y'])bindBtn(`btn-prop-distribute-${axis}`,null,()=>this.distributeLayers(axis));
        bindBtn('btn-prop-apply-transform',null,()=>this.applySource());
        document.getElementById('prop-transform-target')?.addEventListener('change',()=>{this.syncBoxWithActiveLayer();window.mollyEditor?.syncPropertiesPanel();});

        // Properties Panel Input listeners (X, Y, W, H)
        ['prop-pos-x', 'prop-pos-y'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const posX = document.getElementById('prop-pos-x');
                const posY = document.getElementById('prop-pos-y');
                if (posX && posY) {
                    const x = parseFloat(posX.value), y = parseFloat(posY.value);
                    if (![x, y].every(Number.isFinite)) return;
                    const selection = this.getActiveSelection();
                    if (selection) {
                        selection.setSelectionPosition(x, y);
                    } else {
                        this.setBoxPosition(x, y);
                    }
                }
            });
        });

        ['prop-size-w', 'prop-size-h'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const sizeW = document.getElementById('prop-size-w');
                const sizeH = document.getElementById('prop-size-h');
                if (sizeW && sizeH) {
                    const width = parseFloat(sizeW.value), height = parseFloat(sizeH.value);
                    if (![width, height].every(Number.isFinite)) return;
                    const selection = this.getActiveSelection();
                    if (selection) {
                        selection.setSelectionDimensions(width, height, id === 'prop-size-w' ? 'w' : 'h');
                    } else {
                        this.setBoxDimensions(width, height, id === 'prop-size-w' ? 'w' : 'h');
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
            window.mollyEditor?.settingsManager?.set('moveLockAspect',this.isLockAspect());
            if (this.isTransforming) {
                this.drawOverlay();
            }
        });
    }

    translateTargets(layer, dx, dy) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
        dx = Math.round(dx); dy = Math.round(dy);
        return this.translateItems(this.getMoveTargets(layer).map(target=>({target,dx,dy})), 'Перемещение');
    }

    translateItems(items, name='Выравнивание') {
        items=items.filter(({target,dx,dy})=>target&&Number.isFinite(dx)&&Number.isFinite(dy)&&(dx||dy)&&this.layerManager.isEditable?.(target)!==false);
        if(items.some(({target,dx,dy})=>{const box=target.type==='text'?target.textData:target.sourceRect||this.getLayerBoundingBox(target);return box&&(Math.abs(box.x+dx)>1000000||Math.abs(box.y+dy)>1000000);})){window.mollyEditor?.showToast('Положение выходит за допустимые координаты.','warning');return false;}
        const extra=items.reduce((sum,{target})=>{const b=target.sourceCanvas||target.type==='text'?null:this.getLayerBoundingBox(target);return sum+(b?b.w*b.h:0);},0);
        if(this.layerManager.canAllocateLayers?.(0,extra)===false)return false;
        const prepared=items.map(item=>({...item,source:item.target.type==='text'?null:this.ensureSourceCanvas(item.target),
            before:item.target.type==='text'?structuredClone(item.target.textData):item.target.getImageData(),
            textState:item.target.type==='text'?captureTextState(item.target):null,revision:item.target.contentRevision||0}));
        if(prepared.some(item=>item.target.type!=='text'&&!item.source))return false;
        const commands = [],applied=[];
        try {
            for (const item of prepared) {
                const {target,dx,dy,source,before}=item;
                if (target.isGroup || target.type === 'group' || target.locked || target.visible === false
                    || this.layerManager.isEditable?.(target) === false) continue;
                if (target.type === 'text' && target.textData) {
                    applied.push(item);
                    target.textData.x += dx;
                    target.textData.y += dy;
                    this.bus.emit('RENDER_TEXT_LAYER', target, {throwErrors:true});
                    commands.push(new TextDataCommand(target, before, target.textData, this.bus));
                } else {
                    const box = target.sourceRect || this.getLayerBoundingBox(target);
                    if (!box || !source) continue;
                    applied.push(item);
                    target.clear(false);
                    this.drawResampled(target.ctx, source, box.x + dx, box.y + dy, box.w, box.h, 0, this.getResampleMode());
                    target.setMasterSource(source, { ...box, x: box.x + dx, y: box.y + dy });
                    this.translateShape(target, dx, dy);
                    commands.push(new DrawCommand(target, before, target.getImageData()));
                }
            }
        } catch(error) {
            const failures=[];
            for(const {target,before,textState,revision} of applied.reverse()){
                try{if(textState)restoreTextState(target,textState);else{target.putImageData(before);target.contentRevision=revision;}}
                catch(failure){failures.push(failure);}
            }
            if(failures.length)console.error(new AggregateError([error,...failures],'Не удалось полностью восстановить перемещение.'));
            globalThis.window?.mollyEditor?.showToast?.(failures.length?'Перемещение прервано. Не все объекты удалось восстановить; проверьте документ.':'Перемещение прервано. Исходное положение объектов восстановлено.','error');
            this.syncBoxWithActiveLayer();this.bus.emit('CANVAS_UPDATED');return false;
        }
        if (commands.length) {
            const command = new CompoundCommand(commands);
            command.name = name;
            command.icon = 'open_with';
            this.history.push(command);
        }
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
        return commands.length>0;
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
        const box = this.getNumericBox(layer);
        if (!box) return;
        const dx=Math.round(newX - (layer.type==='text'&&!this.isBatchTarget(layer)?layer.textData.x:box.x)),dy=Math.round(newY - (layer.type==='text'&&!this.isBatchTarget(layer)?layer.textData.y:box.y));
        this.translateItems(this.getMoveTargets(layer,this.isBatchTarget(layer)).map(target=>({target,dx,dy})),'Положение объектов');
    }

    applyBitmapTransform(layer, source, rect, beforeData) {
        let command;
        try {
            layer.clear(false);
            this.drawResampled(layer.ctx,source,rect.x,rect.y,rect.w,rect.h,0,this.getResampleMode());
            layer.setMasterSource(source,rect);
            layer.shapeData=null;
            command=new DrawCommand(layer,beforeData,layer.getImageData(),'Изменение размера объекта','aspect_ratio');
        } catch(error) {
            layer.putImageData(beforeData);
            layer.contentRevision=beforeData.mollySnapshot?.contentRevision??layer.contentRevision;
            globalThis.window?.mollyEditor?.showToast?.('Не удалось применить преобразование. Исходное изображение восстановлено.','error');
            this.syncBoxWithActiveLayer();this.bus.emit('CANVAS_UPDATED');return false;
        }
        this.history.push(command);
        this.syncBoxWithActiveLayer();this.bus.emit('CANVAS_UPDATED');return true;
    }

    setBoxDimensions(newW, newH, axis = null) {
        const layer = this.getEditableLayer();
        if(this.isBatchTarget(layer))return transformBatch(this,'resize',{width:newW,height:newH,axis});
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
        const [ax,ay]=(document.getElementById('prop-resize-anchor')?.value||'0,0').split(',').map(Number);
        const rect=resizeAtAnchor(box,w,h,{x:ax,y:ay});
        if(!rect)return;
        const beforeData = layer.getImageData();
        return this.applyBitmapTransform(layer,src,rect,beforeData);
    }

    alignLayer(type) {
        const m=this.getActiveSelection();
        if(m){const box={x:m.selection.x,y:m.selection.y,w:m.selection.width,h:m.selection.height};const [{dx,dy}]=alignmentOffsets([box],type,{x:0,y:0,w:this.layerManager.config.width,h:this.layerManager.config.height});m.setSelectionPosition(box.x+dx,box.y+dy);return;}
        const layer = this.targetLayer || this.getEditableLayer();
        if (!layer || layer.locked) return;
        if (this.isTransforming || this.isMoving) this.commitAction();
        const units=this.getAlignmentUnits(layer),boxes=units.map(item=>item.box);
        if(!boxes.length)return;
        const reference=document.getElementById('prop-align-reference')?.value==='selection'&&boxes.length>1?boundsOf(boxes):{x:0,y:0,w:this.layerManager.config.width,h:this.layerManager.config.height};
        const offsets=alignmentOffsets(boxes,type,reference);
        this.translateItems(units.flatMap((item,index)=>this.getMoveTargets(item.layer,false).map(target=>({target,...offsets[index]}))));
    }

    getAlignmentUnits(active=this.getEditableLayer()) {
        const selected=this.layerManager.getSelectedLayers?.()||[],roots=selected.includes(active)?selected:[active];
        const ids=new Set(roots.filter(Boolean).map(layer=>layer.id)),byId=new Map(this.layerManager.getLayers().map(layer=>[layer.id,layer]));
        return roots.filter(layer=>{
            if(!layer||layer.isBase||this.layerManager.isEditable?.(layer)===false)return false;
            const seen=new Set();let parent=layer.groupId;
            while(parent&&!seen.has(parent)){if(ids.has(parent))return false;seen.add(parent);parent=byId.get(parent)?.groupId;}
            return true;
        }).map(layer=>({layer,box:layer.isGroup||layer.type==='group'?this.getGroupBoundingBox(layer.id):layer.sourceRect||this.getLayerBoundingBox(layer)})).filter(item=>item.box);
    }

    isBatchTarget(layer=this.getEditableLayer()) {
        return Boolean(layer&&(layer.isGroup||layer.type==='group'||document.getElementById('prop-transform-target')?.value==='selection'&&(this.layerManager.getSelectedLayers?.().length||0)>1));
    }

    getActiveSelection() {
        const app=window.mollyEditor,m=app?.tools?.tools?.marquee;
        return ['marquee','lasso','wand'].includes(app?.tools?.currentToolId)&&m?.selection?m:null;
    }

    getNumericBox(layer=this.getEditableLayer()) {
        if(!layer)return null;
        if(this.isBatchTarget(layer))return boundsOf(this.getAlignmentUnits(layer).map(item=>item.box));
        return layer.sourceRect||this.getLayerBoundingBox(layer);
    }

    distributeLayers(axis) {
        if(this.isTransforming||this.isMoving)this.commitAction();
        const units=this.getAlignmentUnits();
        if(units.length<3){window.mollyEditor?.showToast('Для распределения выберите не менее трёх объектов.','info');return false;}
        const offsets=distributionOffsets(units.map(item=>item.box),axis);
        return this.translateItems(units.flatMap((item,index)=>this.getMoveTargets(item.layer,false).map(target=>({target,...offsets[index]}))),'Распределение объектов');
    }

    applySource() {
        if(this.isTransforming||this.isMoving)this.commitAction();
        const layer=this.getEditableLayer();
        if(!layer?.sourceCanvas||layer.type==='text'||layer.isGroup||layer.isBase)return false;
        const before=layer.getImageData();let command;
        try{
            layer.invalidateSource();layer.shapeData=null;
            command=new DrawCommand(layer,before,layer.getImageData(),'Применение трансформаций','done_all');
        }catch(error){
            layer.putImageData(before);layer.contentRevision=before.mollySnapshot?.contentRevision??layer.contentRevision;
            globalThis.window?.mollyEditor?.showToast?.('Не удалось применить трансформации. Исходник сохранён.','error');
            this.syncBoxWithActiveLayer();this.bus.emit('CANVAS_UPDATED');return false;
        }
        this.history.push(command);
        this.syncBoxWithActiveLayer();this.bus.emit('CANVAS_UPDATED');return true;
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
        const originalSize = document.getElementById('btn-prop-original-size');
        if (originalSize) originalSize.disabled = !layer.sourceCanvas || layer.type === 'text' || layer.isBase || layer.isGroup;
        const applySource=document.getElementById('btn-prop-apply-transform');if(applySource)applySource.disabled=originalSize?.disabled??true;

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
        if(layer?.type==='text'&&layer.textLayoutBounds)return {...layer.textLayoutBounds};
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
        return pickLayerAt(this.layerManager.getLayers(),px,py,{canPick:layer=>this.layerManager.isEditable?.(layer)!==false});
    }

    resolvePointerTarget(px,py,event) {
        const active=this.getEditableLayer();
        const onlyMoveable=active&&(active.type==='text'||active.isBase||active.isGroup||active.type==='group');
        const handle=active&&!onlyMoveable?this.findHandleAt(px,py):null;
        const autoSelect=document.getElementById('move-autosel')?.checked??true;
        if(!autoSelect||this.isTransforming||this.isMoving)return {target:active,handle};
        if(event?.altKey){
            const hits=layersAtPoint(this.layerManager.getLayers(),px,py,{canPick:layer=>this.layerManager.isEditable?.(layer)!==false});
            if(handle&&hits[0]===active)return {target:active,handle};
            if(hits.length)return {target:hits[(hits.indexOf(active)+1)%hits.length],handle:null};
        }
        const hit=this.findLayerAtPoint(px,py);
        // A foreground object wins over an invisible handle of the selected
        // background. Handles outside painted objects remain reachable.
        if(handle&&(!hit||hit===active||this.getMoveTargets(active).includes(hit)))return {target:active,handle};
        if(!hit||hit===active)return {target:active,handle:null};
        // An already selected companion or a descendant belongs to the current
        // move gesture. Unrelated foreground objects must not be trapped by its box.
        const keepSelection=active&&this.isInsideBox(px,py)&&this.getMoveTargets(active).includes(hit);
        return {target:keepSelection?active:hit,handle:null};
    }

    onPointerDown(x, y, color, size, layer, e) {
        this.clearHover();
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const px = x;
        const py = y;

        let activeTarget = this.getEditableLayer();
        if (activeTarget && !this.currentBox) {
            this.syncBoxWithActiveLayer();
        }

        const resolved=this.resolvePointerTarget(px,py,e);
        if(resolved.target&&resolved.target!==activeTarget){
            this.layerManager.setActive(resolved.target.id);
            this.syncBoxWithActiveLayer();
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
        // Newly selected handles were not visible when the pointer went down.
        // That first gesture selects/moves the object instead of unexpectedly resizing it.
        this.activeHandle = isTargetOnlyMoveable ? null : resolved.handle;

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
        this.textStartState = target.textData ? captureTextState(target) : null;
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
                    textState: item.textData ? captureTextState(item) : null,
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
            this.activeGapGuides = [];
            return { x: rawX, y: rawY };
        }

        const threshold = (window.mollyEditor?.settingsManager?.get('snapThreshold') ?? 5)/Math.max(.01,window.mollyEditor?.workspace?.zoom||1);
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
        const byId=new Map(layers.map(layer=>[String(layer.id),layer]));
        const references=[];
        const movingIds = new Set([this.targetLayer?.id, ...(this.selectedLayersStart || []).map(item => item.layer.id)]);
        for (const l of layers) {
            if (movingIds.has(l.id) || !layerState(l,byId).visible || this.layerManager.isInIsolation?.(l.id) === false || l.isGroup || l.type === 'group') continue;
            const b = this.getLayerBoundingBox(l);
            if (b) {
                if(!l.isBase)references.push(b);
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

        const gaps=equalGapSnap({x:rawX,y:rawY,w,h},references,threshold);
        const gapAxes=new Set(gaps.guides.map(guide=>guide.axis));
        for(const axis of ['x','y']){
            const raw=axis==='x'?rawX:rawY, edgeDifference=axis==='x'?minDiffX:minDiffY;
            if(gapAxes.has(axis)&&Math.abs(gaps[axis]-raw)<edgeDifference){
                if(axis==='x')finalX=gaps.x;else finalY=gaps.y;
            }else gapAxes.delete(axis);
        }
        this.activeGapGuides=gaps.guides.filter(guide=>gapAxes.has(guide.axis));
        this.activeSnapLines = snapLines.filter(line=>!gapAxes.has(line.type==='v'?'x':'y'));
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
            const rawX = this.boxStart.x + (shiftKey&&Math.abs(dy)>Math.abs(dx)?0:dx);
            const rawY = this.boxStart.y + (shiftKey&&Math.abs(dx)>=Math.abs(dy)?0:dy);
            const snapped = e?.ctrlKey?{x:rawX,y:rawY}:this.computeSnapping(rawX, rawY, this.boxStart.w, this.boxStart.h);
            if(e?.ctrlKey){this.activeSnapLines=[];this.activeGapGuides=[];}
            if(shiftKey){
                const lockedAxis=Math.abs(dx)>=Math.abs(dy)?'y':'x';
                snapped[lockedAxis]=this.boxStart[lockedAxis];
                this.activeSnapLines=this.activeSnapLines.filter(line=>(line.type==='v'?'x':'y')!==lockedAxis);
                this.activeGapGuides=this.activeGapGuides?.filter(guide=>guide.axis!==lockedAxis)||[];
            }

            if (this.targetLayer && this.targetLayer.type === 'text' && this.targetLayer.textData) {
                const textDx = snapped.x - this.boxStart.x;
                const textDy = snapped.y - this.boxStart.y;
                this.targetLayer.textData.x = this.textStartX + textDx;
                this.targetLayer.textData.y = this.textStartY + textDy;
                this.bus.emit('RENDER_TEXT_LAYER', this.targetLayer, {throwErrors:true});
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
        if(this.isMoving){
            this.updateDimensionBadge(this.currentBox.w,this.currentBox.h,this.activeSourceCanvas?.width,this.activeSourceCanvas?.height);
            const badge=document.getElementById('move-dimension-badge');
            if(badge)badge.textContent=`X ${Math.round(this.currentBox.x)} · Y ${Math.round(this.currentBox.y)} · Δ ${Math.round(this.currentBox.x-this.boxStart.x)}, ${Math.round(this.currentBox.y-this.boxStart.y)} px`;
        }
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
                    this.bus.emit('RENDER_TEXT_LAYER', item.layer, {throwErrors:true});
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
                try {
                    this.drawResampled(target.ctx, rotated.canvas, rotated.rect.x, rotated.rect.y, rotated.rect.w, rotated.rect.h, 0, this.getResampleMode());
                } finally {
                    rotated.canvas.width=rotated.canvas.height=1;
                }
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

        const centered=resizeAtAnchor(bs,Math.abs(w),Math.abs(h),{x:.5,y:.5});
        this.currentBox.x = alt || handleId === 'n' || handleId === 's' ? centered.x + (w < 0 ? -w : 0) : Math.round(x);
        this.currentBox.y = alt || handleId === 'e' || handleId === 'w' ? centered.y + (h < 0 ? -h : 0) : Math.round(y);
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
        this.textStartState = null;
        this.selectedLayersStart = null;
        this.boxStart = null;
        this.lastPointerEvent = null;
        this.activeSnapLines = [];
        this.updateDimensionBadge(null, null);
        this.syncBoxWithActiveLayer();
        this.bus.emit('CANVAS_UPDATED');
    }

    createRotatedSource(source, box, angle) {
        const turns=Math.round(angle/(Math.PI/2));
        if(Math.abs(angle-turns*Math.PI/2)<1e-8){
            const quarter=((turns%4)+4)%4,swap=quarter%2===1;
            const canvas=document.createElement('canvas');canvas.width=swap?source.height:source.width;canvas.height=swap?source.width:source.height;
            try{
                const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
                if(quarter===1)ctx.transform(0,1,-1,0,canvas.width,0);
                else if(quarter===2)ctx.transform(-1,0,0,-1,canvas.width,canvas.height);
                else if(quarter===3)ctx.transform(0,-1,1,0,0,canvas.height);
                ctx.drawImage(source,0,0);
                inheritButtonSource(source,canvas,ctx);
                const w=swap?box.h:box.w,h=swap?box.w:box.h;
                return {canvas,rect:{x:Math.round(box.x+(box.w-w)/2),y:Math.round(box.y+(box.h-h)/2),w,h}};
            }catch(error){canvas.width=canvas.height=1;throw error;}
        }
        const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
        const w = Math.max(1, Math.ceil(box.w * cos + box.h * sin - 1e-8));
        const h = Math.max(1, Math.ceil(box.w * sin + box.h * cos - 1e-8));
        const resolution = Math.min(Math.max(source.width / box.w, source.height / box.h, 1), 4096 / w, 4096 / h);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * resolution));
        canvas.height = Math.max(1, Math.round(h * resolution));
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.imageSmoothingEnabled = this.getResampleMode() === 'smooth';
            ctx.scale(canvas.width / w, canvas.height / h);
            ctx.translate(w / 2, h / 2);
            ctx.rotate(angle);
            ctx.drawImage(source, -box.w / 2, -box.h / 2, box.w, box.h);
            inheritButtonSource(source,canvas,ctx,[box.w/source.width,0,0,box.h/source.height,-box.w/2,-box.h/2]);
            return { canvas, rect: { x: Math.floor(box.x + box.w / 2) - Math.floor(w / 2), y: Math.floor(box.y + box.h / 2) - Math.floor(h / 2), w, h } };
        } catch(error) { canvas.width=canvas.height=1;throw error; }
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
                beforeData: this.beforeData, sourceCanvas: this.activeSourceCanvas, textData: this.textBeforeData, textState: this.textStartState
            });
            for (const item of items) {
                const layer = item.layer;
                if (layer.locked || layer.visible === false || this.layerManager.isEditable?.(layer) === false) {
                    if (item.beforeData) layer.putImageData(item.beforeData);
                    if (item.textState) restoreTextState(layer,item.textState);
                    else if (item.textData) { layer.textData = structuredClone(item.textData); this.bus.emit('RENDER_TEXT_LAYER', layer, {throwErrors:true}); }
                    continue;
                }
                if (layer.type === 'text' && item.textData) {
                    layer.textData.x = item.textData.x + dx;
                    layer.textData.y = item.textData.y + dy;
                    this.bus.emit('RENDER_TEXT_LAYER', layer, {throwErrors:true});
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
                    const ctx = flipped.getContext('2d', { willReadFrequently: true });
                    ctx.translate(box.w < 0 ? flipped.width : 0, box.h < 0 ? flipped.height : 0);
                    ctx.scale(box.w < 0 ? -1 : 1, box.h < 0 ? -1 : 1);
                    ctx.drawImage(source, 0, 0);
                    inheritButtonSource(source,flipped,ctx);
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
        const failures=[],restore=action=>{try{action();}catch(error){failures.push(error);}};
        try{
            if(this.hasMoved&&this.targetLayer){
                if(this.beforeData)restore(()=>{this.targetLayer.putImageData(this.beforeData);this.targetLayer.contentRevision=this.beforeData.mollySnapshot?.contentRevision??this.targetLayer.contentRevision;});
                if(this.textBeforeData)restore(()=>{
                    if(this.textStartState)restoreTextState(this.targetLayer,this.textStartState);
                    else{this.targetLayer.textData=structuredClone(this.textBeforeData);this.bus.emit('RENDER_TEXT_LAYER',this.targetLayer,{throwErrors:true});this.targetLayer.contentRevision=this.textStartRevision;}
                });
            }
            for(const item of this.hasMoved?this.selectedLayersStart||[]:[])restore(()=>{
                if(item.beforeData)item.layer.putImageData(item.beforeData);
                if(item.textState)restoreTextState(item.layer,item.textState);
                else if(item.textData){item.layer.textData=structuredClone(item.textData);this.bus.emit('RENDER_TEXT_LAYER',item.layer,{throwErrors:true});}
                if(!item.textState)item.layer.contentRevision=item.revision;
            });
        }finally{this.resetActionState();}
        if(failures.length)throw new AggregateError(failures,'Не удалось полностью отменить перемещение объектов.');
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
        if (!this.isActive || this.isPointerDown) return;
        const px = x;
        const py = y;
        this.hoverPos = { x: px, y: py };

        this.drawOverlay();

        const resolved=this.resolvePointerTarget(px,py,e),h=resolved.handle;
        const candidate=resolved.target;
        this.showHover(candidate&&!h&&(candidate!==this.getEditableLayer()||this.isInsideBox(px,py))?candidate:null);

        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;

        if (h) {
            canvas.style.cursor = h.cursor || 'pointer';
        } else if (resolved.target&&(resolved.target!==this.getEditableLayer()||this.isInsideBox(px,py))) {
            canvas.style.cursor = 'move';
        } else {
            canvas.style.cursor = 'default';
        }
    }

    clearHover(){
        this.hoverRow?.classList.remove('layer-hover-target');this.hoverRow=null;this.hoverTarget=null;
        this.bus.emit('OBJECT_HOVER_UPDATED',null);
    }

    showHover(layer){
        this.clearHover();if(!layer)return;
        const bounds=layer===this.targetLayer?this.currentBox:this.getLayerBoundingBox(layer);if(!bounds)return;
        this.hoverTarget=layer;
        this.hoverRow=globalThis.window?.mollyEditor?.layerPanel?.layerElements?.get(layer.id);
        this.hoverRow?.classList.add('layer-hover-target');
        if(layer===this.targetLayer)return;
        this.bus.emit('OBJECT_HOVER_UPDATED',ctx=>{
            const unit=1/(globalThis.window?.mollyEditor?.workspace?.zoom||1);
            ctx.save();ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim()||'#3B82F6';ctx.lineWidth=2*unit;
            ctx.setLineDash([4*unit,3*unit]);ctx.strokeRect(bounds.x,bounds.y,bounds.w,bounds.h);ctx.restore();
        });
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
            if(this.isMoving&&this.activeGapGuides?.length)this.drawGapGuides(pCtx);

            // Draw Smart Magnetic Snap Guides across the canvas (Figma Magenta style)
            if (this.activeSnapLines && this.activeSnapLines.length > 0) {
                const cw = this.layerManager.config.width;
                const ch = this.layerManager.config.height;

                pCtx.save();
                pCtx.strokeStyle = '#E11D48';
                const guideUnit=1/(window.mollyEditor?.workspace?.zoom||1);
                pCtx.lineWidth = guideUnit;
                pCtx.setLineDash([3*guideUnit, 2*guideUnit]);

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

    drawGapGuides(ctx) {
        const unit=1/(window.mollyEditor?.workspace?.zoom||1);
        ctx.save();ctx.lineWidth=unit;ctx.strokeStyle='#e11d48';ctx.font=`${11*unit}px "Google Sans", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
        for(const guide of this.activeGapGuides){
            const horizontal=guide.axis==='x',point=value=>horizontal?[value,guide.at]:[guide.at,value];
            const a=point(guide.from),b=point(guide.to);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);
            for(const p of [a,b]){ctx.moveTo(p[0]-(horizontal?0:3*unit),p[1]-(horizontal?3*unit:0));ctx.lineTo(p[0]+(horizontal?0:3*unit),p[1]+(horizontal?3*unit:0));}ctx.stroke();
            const label=`${Math.round(guide.distance*100)/100} px`,middle=point((guide.from+guide.to)/2),width=ctx.measureText(label).width+8*unit;
            ctx.fillStyle='#202124';ctx.fillRect(middle[0]-width/2,middle[1]-8*unit,width,16*unit);ctx.fillStyle='#fff';ctx.fillText(label,...middle);
        }ctx.restore();
    }

    drawAltInspector(pCtx) {
        const b = this.currentBox;
        if (!b) return;
        const unit=1/(window.mollyEditor?.workspace?.zoom||1);

        const cw = this.layerManager.config.width;
        const ch = this.layerManager.config.height;
        const bx1 = Math.min(b.x, b.x + b.w);
        const by1 = Math.min(b.y, b.y + b.h);
        const bx2 = bx1 + Math.abs(b.w);
        const by2 = by1 + Math.abs(b.h);

        pCtx.save();
        pCtx.font = `bold ${11*unit}px "Google Sans", sans-serif`;
        pCtx.textAlign = 'center';
        pCtx.textBaseline = 'middle';
        pCtx.lineWidth = unit;
        pCtx.strokeStyle = '#E11D48';
        pCtx.fillStyle = '#E11D48';

        let targetB = null;
        if (this.hoverPos && (this.hoverPos.x >= 0 && this.hoverPos.y >= 0)) {
            const layers = this.layerManager.getLayers();
            const byId=new Map(layers.map(item=>[String(item.id),item]));
            const excluded=new Set(this.getMoveTargets(this.targetLayer).map(item=>item.id));
            for (let i = layers.length - 1; i >= 0; i--) {
                const l = layers[i];
                if (l.id === this.targetLayer?.id || excluded.has(l.id) || l.isGroup || !layerState(l,byId).visible || this.layerManager.isInIsolation?.(l.id)===false) continue;
                const lb = this.getLayerBoundingBox(l);
                if (lb && this.hoverPos.x >= lb.x && this.hoverPos.x <= lb.x + lb.w &&
                    this.hoverPos.y >= lb.y && this.hoverPos.y <= lb.y + lb.h) {
                    targetB = lb;
                    break;
                }
            }
        }

        const drawBadge = (badgeX, badgeY, text) => {
            const tw = Math.max(22*unit, pCtx.measureText(text).width + 8*unit);
            const th = 16*unit;
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
            pCtx.moveTo(lineX, topY);
            pCtx.lineTo(lineX, botY);
            pCtx.moveTo(lineX - 4*unit, topY);
            pCtx.lineTo(lineX + 4*unit, topY);
            pCtx.moveTo(lineX - 4*unit, botY);
            pCtx.lineTo(lineX + 4*unit, botY);
            pCtx.stroke();
            drawBadge(lineX, (topY + botY) / 2, `${Math.round(val*100)/100} px`);
        };

        const drawDistH = (lineY, leftX, rightX, val) => {
            if (val <= 0) return;
            pCtx.strokeStyle = '#E11D48';
            pCtx.beginPath();
            pCtx.moveTo(leftX, lineY);
            pCtx.lineTo(rightX, lineY);
            pCtx.moveTo(leftX, lineY - 4*unit);
            pCtx.lineTo(leftX, lineY + 4*unit);
            pCtx.moveTo(rightX, lineY - 4*unit);
            pCtx.lineTo(rightX, lineY + 4*unit);
            pCtx.stroke();
            drawBadge((leftX + rightX) / 2, lineY, `${Math.round(val*100)/100} px`);
        };

        if (targetB) {
            pCtx.setLineDash([2*unit, 2*unit]);
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
                if(this.hoverPos.x>=0&&!this.isPointerDown)this.onHoverMove(this.hoverPos.x,this.hoverPos.y,e);
            }
        }

        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            if (this.isPointerDown || e.ctrlKey || e.metaKey || e.altKey) return;
            // If Marquee has active selection, let Marquee handle its selection nudge
            const marquee = window.mollyEditor?.tools?.tools?.['marquee'];
            if (['marquee','lasso','wand'].includes(window.mollyEditor?.tools?.currentToolId) && marquee?.selection) {
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
                if(this.hoverPos.x>=0&&!this.isPointerDown)this.onHoverMove(this.hoverPos.x,this.hoverPos.y,e);
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
        if(this.isBatchTarget(layer))return transformBatch(this,'flip',{horizontal:h,vertical:v});
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
        const fCtx = fCanvas.getContext('2d', { willReadFrequently: true });
        fCtx.imageSmoothingEnabled = false;
        fCtx.save();
        fCtx.translate(h ? fCanvas.width : 0, v ? fCanvas.height : 0);
        fCtx.scale(h ? -1 : 1, v ? -1 : 1);
        fCtx.drawImage(src, 0, 0);
        inheritButtonSource(src,fCanvas,fCtx);
        fCtx.restore();

        return this.applyBitmapTransform(layer,fCanvas,{x:b.x,y:b.y,w:b.w,h:b.h},beforeData);
    }

    rotateFixed(deg) {
        if (!Number.isFinite(deg) || deg % 90 !== 0 || deg % 360 === 0) return;
        const layer = this.targetLayer || this.layerManager.getActiveLayer();
        if(this.isBatchTarget(layer))return transformBatch(this,'rotate',{angle:deg});
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
        const rCtx = rCanvas.getContext('2d', { willReadFrequently: true });
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
        inheritButtonSource(src,rCanvas,rCtx);
        rCtx.restore();

        const curW = isSwap ? b.h : b.w;
        const curH = isSwap ? b.w : b.h;
        const cx = b.x + Math.floor(b.w / 2);
        const cy = b.y + Math.floor(b.h / 2);
        const nx = cx - Math.floor(curW / 2);
        const ny = cy - Math.floor(curH / 2);

        return this.applyBitmapTransform(layer,rCanvas,{x:nx,y:ny,w:curW,h:curH},beforeData);
    }

    scaleUniform(factor) {
        if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
        const layer = this.targetLayer || this.layerManager.getActiveLayer();
        if(this.isBatchTarget(layer))return transformBatch(this,'scale',{factor});
        if (!layer || layer.locked || this.layerManager.isEditable?.(layer) === false || layer.isGroup || layer.type === 'text' || layer.isBase) return;
        const b = layer.sourceRect || this.getLayerBoundingBox(layer);
        if (!b) return;

        const beforeData = layer.getImageData();
        const nw = Math.max(1, Math.min(4096, Math.round(b.w * factor)));
        const nh = Math.max(1, Math.min(4096, Math.round(b.h * factor)));
        if (nw === b.w && nh === b.h) return;
        const {x:nx,y:ny}=resizeAtAnchor(b,nw,nh,{x:.5,y:.5});

        // Get pristine master source - NEVER crop downscaled pixels!
        const srcCanvas = this.ensureSourceCanvas(layer);
        if (!srcCanvas) return;

        return this.applyBitmapTransform(layer,srcCanvas,{x:nx,y:ny,w:nw,h:nh},beforeData);
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
        const context = inverted.getContext('2d', { willReadFrequently: true });
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
        layer.buttonData=null;
        return this.applyBitmapTransform(layer,inverted,rect,beforeData);
    }
}
