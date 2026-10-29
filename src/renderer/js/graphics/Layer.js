import {normalizeTexture, applySurfaceTexture} from './SurfaceTexture.mjs';
import {releaseGroupCache} from './LayerCompositing.js';
import {normalizeResourceDesign,applyResourceDesign} from './ResourceDesign.mjs';
let nextContentIdentity = 0;
/**
 * Layer - Represents an individual canvas layer in the document stack
 */
export default class Layer {
    constructor(id, name, width = 256, height = 256, type = 'bitmap') {
        this.id = id;
        this.name = name;
        this.width = width;
        this.height = height;
        this.type = type; // 'bitmap' or 'text'
        this.contentIdentity = ++nextContentIdentity;
        this.visible = true;
        this.locked = false;
        this.alphaLocked = false;
        this.opacity = 1.0;
        this.blendMode = 'source-over';
        this.colorLabel = 'none';
        this.isBase = false;

        this.sourceCanvas = null;
        this.sourceRect = null;
        this.transformSnapshot = null;
        this.currentBox = null;
        this.groupId = null;
        this.isGroup = (type === 'group');
        this.expanded = true;

        this.textData = null;
        if (type === 'text') {
            this.textData = {
                text: 'Текст',
                fontId: 'minecraft',
                color: '#D5D4D8',
                shadow: true,
                shadowOffsetX: 1,
                shadowOffsetY: 1,
                shadowColor: '#353535',
                x: 20,
                y: 20
            };
        }

        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: true });
        this.ctx.imageSmoothingEnabled = false;
        if ('mozImageSmoothingEnabled' in this.ctx) this.ctx.mozImageSmoothingEnabled = false;
        if ('webkitImageSmoothingEnabled' in this.ctx) this.ctx.webkitImageSmoothingEnabled = false;
        if ('msImageSmoothingEnabled' in this.ctx) this.ctx.msImageSmoothingEnabled = false;

        // Non-destructive Layer FX
        this.fx = {
            outline: { enabled: false, color: '#000000' },
            shadow: { enabled: false, offsetX: 1, offsetY: 1, color: 'rgba(0, 0, 0, 0.5)' }
        };
        this.fxCanvas = null;
        this.fxDirty = true;
        this.fxScratch = Object.create(null);

        // Thumbnail canvas for layer panel
        this.thumbCanvas = document.createElement('canvas');
        this.thumbCanvas.width = 36;
        this.thumbCanvas.height = 36;
        this.thumbCtx = this.thumbCanvas.getContext('2d');
        this.thumbCtx.imageSmoothingEnabled = false;
        this.thumbNeedsUpdate = true;
    }

    invalidateSource(clearMasterSource = true) {
        this.contentRevision = (this.contentRevision || 0) + 1;
        this.contentIdentity = ++nextContentIdentity;
        if (clearMasterSource) {
            this.sourceCanvas = null;
            this.sourceRect = null;
            this.buttonData = null;
        }
        this.thumbNeedsUpdate = true;
        this.fxDirty = true;
        this.boundsDirty = true;
    }

    hasFX() {
        const texture=normalizeTexture(this.fx?.texture);
        const design=normalizeResourceDesign(this.fx?.resourceDesign);
        return Boolean(this.fx?.outline?.enabled || this.fx?.shadow?.enabled || (texture.type!=='none'&&texture.amount) || (design&&design.preset!=='vanilla'));
    }

    releaseRenderCache() {
        // History and the clipboard can share pristine sources. Only disposable
        // render buffers are released; sourceCanvas and the editable pixels stay.
        const buffers = new Set([this.fxCanvas, ...Object.values(this.fxScratch)]);
        for (const buffer of buffers) if (buffer) buffer.width = buffer.height = 1;
        this.fxCanvas = null;
        this.fxScratch = Object.create(null);
        this.fxDirty = true;
        this.thumbNeedsUpdate = true;
        this.thumbnailDataUrl = null;
        releaseGroupCache(this);
    }

    getScratchCanvas(key, width, height) {
        let canvas = this.fxScratch[key];
        if (!canvas) {
            canvas = document.createElement('canvas');
            this.fxScratch[key] = canvas;
        }
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        return canvas;
    }

    setFX(fxSettings) {
        this.fx = fxSettings && typeof fxSettings==='object' && !Array.isArray(fxSettings) ? JSON.parse(JSON.stringify(fxSettings)) : null;
        if(this.fx?.texture)this.fx.texture=normalizeTexture(this.fx.texture);
        if(this.fx?.resourceDesign)this.fx.resourceDesign=normalizeResourceDesign(this.fx.resourceDesign);
        if(this.fx?.shadow&&typeof this.fx.shadow==='object'&&!Array.isArray(this.fx.shadow)){
            for(const key of ['offsetX','offsetY']){
                const value=this.fx.shadow[key]==null?NaN:Number(this.fx.shadow[key]);
                this.fx.shadow[key]=Number.isFinite(value)?Math.max(-4096,Math.min(4096,Math.round(value))):1;
            }
        }else if(this.fx)delete this.fx.shadow;
        const texture=normalizeTexture(this.fx?.texture);
        for(const key of Object.keys(this.fxScratch)){
            const keep=key==='texture'?(texture.type!=='none'&&texture.amount)||(this.fx?.resourceDesign&&this.fx.resourceDesign.preset!=='vanilla'):key==='shadow'?this.fx?.shadow?.enabled:this.fx?.outline?.enabled;
            if(!keep){this.fxScratch[key].width=this.fxScratch[key].height=1;delete this.fxScratch[key];}
        }
        if(!this.hasFX()&&this.fxCanvas){this.fxCanvas.width=this.fxCanvas.height=1;this.fxCanvas=null;}
        this.fxDirty = true;
        this.thumbNeedsUpdate = true;
    }

    getRenderCanvas() {
        if (!this.hasFX()) {
            return this.canvas;
        }

        if (!this.fxDirty && this.fxCanvas) {
            return this.fxCanvas;
        }

        if (!this.fxCanvas) this.fxCanvas = document.createElement('canvas');
        if (this.fxCanvas.width !== this.width) this.fxCanvas.width = this.width;
        if (this.fxCanvas.height !== this.height) this.fxCanvas.height = this.height;
        const fCtx = this.fxCanvas.getContext('2d');
        fCtx.imageSmoothingEnabled = false;
        fCtx.clearRect(0, 0, this.width, this.height);

        const w = this.width;
        const h = this.height;

        // 1. Live Shadow
        if (this.fx.shadow?.enabled) {
            const ox = Math.round(this.fx.shadow.offsetX ?? 1);
            const oy = Math.round(this.fx.shadow.offsetY ?? 1);
            const scolor = this.fx.shadow.color || 'rgba(0, 0, 0, 0.5)';

            const shadowC = this.getScratchCanvas('shadow', w, h);
            const sCtx = shadowC.getContext('2d');
            sCtx.imageSmoothingEnabled = false;
            sCtx.globalAlpha = 1;
            sCtx.globalCompositeOperation = 'source-over';
            sCtx.clearRect(0, 0, w, h);
            sCtx.drawImage(this.canvas, 0, 0);
            sCtx.globalCompositeOperation = 'source-in';
            sCtx.fillStyle = scolor;
            sCtx.fillRect(0, 0, w, h);

            fCtx.drawImage(shadowC, ox, oy);
        }

        // 2. Live 1px 8-directional Outline
        if (this.fx.outline?.enabled) {
            const ocolor = this.fx.outline.color || '#000000';
            const srcData = this.ctx.getImageData(0, 0, w, h);
            const src32 = new Uint32Array(srcData.data.buffer);

            const outData = fCtx.createImageData(w, h);
            const out32 = new Uint32Array(outData.data.buffer);

            const dummy = this.getScratchCanvas('color', 1, 1);
            const dCtx = dummy.getContext('2d');
            dCtx.clearRect(0, 0, 1, 1);
            dCtx.fillStyle = ocolor;
            dCtx.fillRect(0, 0, 1, 1);
            const color32 = new Uint32Array(dCtx.getImageData(0, 0, 1, 1).data.buffer)[0];

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const idx = y * w + x;
                    const alpha = (src32[idx] >> 24) & 255;
                    if (alpha === 0) {
                        const hasNeighbor = 
                            (x > 0 && ((src32[idx - 1] >> 24) & 255) > 0) ||
                            (x < w - 1 && ((src32[idx + 1] >> 24) & 255) > 0) ||
                            (y > 0 && ((src32[idx - w] >> 24) & 255) > 0) ||
                            (y < h - 1 && ((src32[idx + w] >> 24) & 255) > 0) ||
                            (x > 0 && y > 0 && ((src32[idx - w - 1] >> 24) & 255) > 0) ||
                            (x < w - 1 && y > 0 && ((src32[idx - w + 1] >> 24) & 255) > 0) ||
                            (x > 0 && y < h - 1 && ((src32[idx + w - 1] >> 24) & 255) > 0) ||
                            (x < w - 1 && y < h - 1 && ((src32[idx + w + 1] >> 24) & 255) > 0);
                        if (hasNeighbor) {
                            out32[idx] = color32;
                        }
                    }
                }
            }

            const outC = this.getScratchCanvas('outline', w, h);
            outC.getContext('2d').putImageData(outData, 0, 0);
            fCtx.drawImage(outC, 0, 0);
        }

        // 3. Draw original layer content on top
        const texture=normalizeTexture(this.fx?.texture);
        const design=normalizeResourceDesign(this.fx?.resourceDesign);
        if((texture.type!=='none'&&texture.amount)||(design&&design.preset!=='vanilla')){
            const textured=this.getScratchCanvas('texture',w,h),target=textured.getContext('2d');
            target.putImageData(applySurfaceTexture(applyResourceDesign(this.ctx.getImageData(0,0,w,h),design),texture),0,0);
            fCtx.drawImage(textured,0,0);
        }else fCtx.drawImage(this.canvas, 0, 0);

        this.fxDirty = false;
        return this.fxCanvas;
    }

    setMasterSource(canvas, rect = null) {
        this.contentRevision = (this.contentRevision || 0) + 1;
        this.contentIdentity = ++nextContentIdentity;
        this.sourceCanvas = canvas;
        if(this.buttonData){
            canvas.buttonSourceMap ||= structuredClone(this.buttonData.sourceMap)||{width:canvas.width,height:canvas.height,matrix:[canvas.width,0,0,canvas.height,0,0]};
            this.buttonData={...this.buttonData,sourceMap:structuredClone(canvas.buttonSourceMap)};
        }
        this.sourceRect = rect ? { ...rect } : null;
        this.thumbNeedsUpdate = true;
        this.fxDirty = true;
        this.boundsDirty = true;
    }

    clear(clearMasterSource = false) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.invalidateSource(clearMasterSource);
    }

    cloneCanvas() {
        const clone = document.createElement('canvas');
        clone.width = this.width;
        clone.height = this.height;
        const ctx = clone.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        ctx.putImageData(this.ctx.getImageData(0,0,this.width,this.height),0,0);
        return clone;
    }

    getImageData() {
        const image = this.ctx.getImageData(0, 0, this.width, this.height);
        image.mollySnapshot = {
            contentRevision: this.contentRevision || 0,
            contentIdentity: this.contentIdentity,
            type: this.type,
            textData: this.textData ? JSON.parse(JSON.stringify(this.textData)) : null,
            textLayoutBounds: this.textLayoutBounds ? {...this.textLayoutBounds} : null,
            shapeData: this.shapeData ? { ...this.shapeData } : null,
            buttonData: this.buttonData ? structuredClone(this.buttonData) : null,
            objectType: this.objectType || null,
            opacity: this.opacity,
            blendMode: this.blendMode,
            fx: this.fx ? JSON.parse(JSON.stringify(this.fx)) : null,
            sourceCanvas: this.sourceCanvas,
            sourceRect: this.sourceRect ? { ...this.sourceRect } : null
        };
        return image;
    }

    putImageData(imageData, clearMasterSource = true) {
        if (this.width !== imageData.width || this.height !== imageData.height) {
            this.width = this.canvas.width = imageData.width;
            this.height = this.canvas.height = imageData.height;
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            this.ctx.imageSmoothingEnabled = false;
        }
        this.ctx.putImageData(imageData, 0, 0);
        this.invalidateSource(clearMasterSource);
        this.restoreSnapshot(imageData.mollySnapshot);
    }

    applyPixelPatch(patch) {
        if(this.width!==patch.width||this.height!==patch.height)throw new Error('Размер слоя не соответствует снимку истории.');
        if(patch.patchWidth&&patch.patchHeight){
            const image=this.ctx.createImageData(patch.patchWidth,patch.patchHeight);image.data.set(patch.data);
            this.ctx.putImageData(image,patch.x,patch.y);
        }
        this.invalidateSource();this.restoreSnapshot(patch.mollySnapshot);
    }

    restoreSnapshot(state) {
        if (state) {
            // The renderer revision stays monotonic. Only the identity of the
            // restored document content returns to its previous save point.
            if (Number.isFinite(state.contentIdentity)) this.contentIdentity = state.contentIdentity;
            this.type = state.type;
            this.textData = state.textData ? JSON.parse(JSON.stringify(state.textData)) : null;
            this.textLayoutBounds = state.textLayoutBounds ? {...state.textLayoutBounds} : null;
            this.shapeData = state.shapeData ? { ...state.shapeData } : null;
            this.buttonData = state.buttonData ? structuredClone(state.buttonData) : null;
            this.objectType = state.objectType;
            this.opacity = state.opacity ?? this.opacity;
            this.blendMode = state.blendMode || this.blendMode;
            if (Object.hasOwn(state, 'fx')) this.setFX(state.fx);
            this.sourceCanvas = state.sourceCanvas;
            this.sourceRect = state.sourceRect ? { ...state.sourceRect } : null;
        }
    }

    getThumbnailDataUrl() {
        if (this.thumbNeedsUpdate) {
            this.thumbCtx.clearRect(0, 0, 36, 36);
            const src = this.hasFX() ? this.getRenderCanvas() : this.canvas;
            this.thumbCtx.drawImage(src, 0, 0, 36, 36);
            this.thumbNeedsUpdate = false;
            this.thumbnailDataUrl = this.thumbCanvas.toDataURL('image/png');
        }
        return this.thumbnailDataUrl;
    }

    getBounds() {
        if (!this.boundsDirty && this.cachedBounds !== undefined) return this.cachedBounds ? { ...this.cachedBounds } : null;
        const data = this.ctx.getImageData(0, 0, this.width, this.height).data;
        let minX = this.width, minY = this.height, maxX = -1, maxY = -1;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                if (data[(y * this.width + x) * 4 + 3] === 0) continue;
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            }
        }
        this.cachedBounds = maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
        this.boundsDirty = false;
        return this.cachedBounds ? { ...this.cachedBounds } : null;
    }

    resize(newWidth, newHeight, anchorX = 'center', anchorY = 'center', fillColor = null) {
        if (this.width === newWidth && this.height === newHeight) return;

        const oldCanvas = this.canvas;
        const newCanvas = document.createElement('canvas');
        newCanvas.width = newWidth;
        newCanvas.height = newHeight;
        const newCtx = newCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
        newCtx.imageSmoothingEnabled = false;

        if (fillColor) {
            newCtx.fillStyle = fillColor;
            newCtx.fillRect(0, 0, newWidth, newHeight);
        }

        let offsetX = 0;
        if (anchorX === 'center') offsetX = Math.round((newWidth - this.width) / 2);
        else if (anchorX === 'right') offsetX = newWidth - this.width;

        let offsetY = 0;
        if (anchorY === 'center') offsetY = Math.round((newHeight - this.height) / 2);
        else if (anchorY === 'bottom') offsetY = newHeight - this.height;

        if (this.sourceCanvas && this.sourceRect) {
            this.sourceRect = { ...this.sourceRect, x: this.sourceRect.x + offsetX, y: this.sourceRect.y + offsetY };
            const { x, y, w, h } = this.sourceRect;
            newCtx.drawImage(this.sourceCanvas, x, y, w, h);
        } else newCtx.drawImage(oldCanvas, offsetX, offsetY);
        if (this.textData) { this.textData.x += offsetX; this.textData.y += offsetY; }
        if (this.shapeData) {
            for (const key of ['x0', 'x1']) this.shapeData[key] += offsetX;
            for (const key of ['y0', 'y1']) this.shapeData[key] += offsetY;
        }

        this.width = newWidth;
        this.height = newHeight;
        this.canvas = newCanvas;
        this.ctx = newCtx;
        this.fxDirty = true;
        this.thumbNeedsUpdate = true;
        this.invalidateSource(false);
    }

    scale(newWidth, newHeight) {
        if (this.width === newWidth && this.height === newHeight) return;

        // The first resize must preserve the original too, not only imported objects.
        if (this.type === 'bitmap' && (!this.sourceCanvas || !this.sourceRect)) this.setMasterSource(this.cloneCanvas(), { x: 0, y: 0, w: this.width, h: this.height });

        const oldCanvas = this.canvas;
        const newCanvas = document.createElement('canvas');
        newCanvas.width = newWidth;
        newCanvas.height = newHeight;
        const newCtx = newCanvas.getContext('2d', { willReadFrequently: true, alpha: true });
        newCtx.imageSmoothingEnabled = false;
        const sx = newWidth / this.width, sy = newHeight / this.height;
        if (this.sourceCanvas && this.sourceRect) {
            const rect = this.sourceRect;
            // Keep precise geometry across odd-size shrink/grow cycles. Round only at rasterization.
            this.sourceRect = { x: rect.x * sx, y: rect.y * sy, w: rect.w * sx, h: rect.h * sy };
            const { x, y, w, h } = this.sourceRect;
            newCtx.drawImage(this.sourceCanvas, x, y, w, h);
        } else newCtx.drawImage(oldCanvas, 0, 0, newWidth, newHeight);
        if (this.textData) {
            this.textData.x *= sx; this.textData.y *= sy;
            const swappedAxes = (Number(this.textData.rotation) || 0) % 180 !== 0;
            this.textData.scaleX = (this.textData.scaleX || 1) * (swappedAxes ? sy : sx);
            this.textData.scaleY = (this.textData.scaleY || 1) * (swappedAxes ? sx : sy);
        }
        if (this.shapeData) {
            for (const key of ['x0', 'x1']) this.shapeData[key] *= sx;
            for (const key of ['y0', 'y1']) this.shapeData[key] *= sy;
            if (Number.isFinite(this.shapeData.radius)) this.shapeData.radius *= Math.min(sx, sy);
        }

        this.width = newWidth;
        this.height = newHeight;
        this.canvas = newCanvas;
        this.ctx = newCtx;
        this.fxDirty = true;
        this.thumbNeedsUpdate = true;
        this.invalidateSource(false);
    }
}
