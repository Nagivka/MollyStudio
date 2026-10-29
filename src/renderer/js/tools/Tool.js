import { AddLayerCommand, DrawCommand } from '../core/Commands.js';
import { imageDataEquals } from '../core/ImageDataUtils.js';
import { regionsOf, containsPixel } from './SelectionGeometry.mjs';

export default class Tool {
    constructor(bus, layerManager, history) {
        this.bus = bus;
        this.layerManager = layerManager;
        this.history = history;
    }

    onPointerDown(x, y, color, size, layer, e) {}
    onPointerMove(x, y, color, size, layer, e) {}
    onPointerUp(x, y, color, size, layer, e) { this.discardCreatedLayer(); }
    onKeyDown(e) {}
    deactivate() {}

    getSelection() {
        return this.toolManager?.tools?.marquee?.selection || null;
    }

    isSelectedPixel(x, y) {
        const area = this.getSelection();
        return !area || containsPixel(area,x,y);
    }

    clipToSelection(ctx, area=this.getSelection(), offsetX=0, offsetY=0) {
        if (!area) return;
        ctx.beginPath();
        for(const r of regionsOf(area))ctx.rect(r.x-offsetX,r.y-offsetY,r.width,r.height);
        ctx.clip();
    }

    withSelection(ctx, draw) {
        ctx.save();
        try { this.clipToSelection(ctx); draw(); } finally { ctx.restore(); }
    }

    retainSelectedObject(layer, previousLayer) {
        if (!this.getSelection()) return true;
        // Cropped shapes become pixels: their original geometry would redraw
        // content outside the mask on a later transform or property edit.
        layer.shapeData = null;
        layer.buttonData = null;
        if (layer.getBounds()) return true;
        this.layerManager.removeLayer(layer.id);
        if (previousLayer) this.layerManager.setActive(previousLayer.id);
        return false;
    }

    createObjectLayer(name, parent, draw) {
        const previousId = this.layerManager.activeLayerId;
        const layer = this.layerManager.addLayer(name);
        if (!layer) return null;
        const remove = () => {
            this.layerManager.removeLayer(layer.id);
            if (previousId) this.layerManager.setActive(previousId);
        };
        try {
            layer.groupId = parent?.isGroup || parent?.type === 'group' ? parent.id : parent?.groupId || null;
            draw(layer);
            layer.invalidateSource();
            if (!layer.getBounds()) { remove(); return null; }
            if (!this.retainSelectedObject(layer,parent)) return null;
            this.history.push(new AddLayerCommand(this.layerManager,layer));
            this.bus.emit('CANVAS_UPDATED');
            return layer;
        } catch (error) { remove(); throw error; }
    }

    getEditableLayer(layer, { create = true, name = 'Слой рисования' } = {}) {
        const editable = item => item && !item.locked && item.visible !== false
            && (this.layerManager.isEditable?.(item) ?? true);
        if (layer && !editable(layer)) return null;
        if (layer && !layer.isBase && layer.type !== 'text' && !layer.isGroup && layer.type !== 'group') return layer;
        const groupId = layer?.isGroup || layer?.type === 'group' ? layer.id : layer?.groupId;
        if (groupId) {
            const children = this.layerManager.getGroupLayers?.(groupId) || [];
            const target = [...children].reverse().find(item => editable(item) && !item.isBase && !item.isGroup && item.type !== 'text' && item.type !== 'group');
            if (target) {
                this.layerManager.setActive(target.id);
                return target;
            }
        }
        if (!create) return null;
        const previousId = this.layerManager.activeLayerId;
        const target = this.layerManager.addLayer(name);
        if (target) {
            target.groupId = groupId || null;
            this.createdLayerCommand = new AddLayerCommand(this.layerManager, target);
            this.createdLayerPreviousId = previousId;
        }
        return target;
    }

    cancelAction() {
        if (this.beforeData && this.targetLayer) {
            this.targetLayer.putImageData(this.beforeData);
            this.targetLayer.contentRevision = this.beforeData.mollySnapshot?.contentRevision ?? this.targetLayer.contentRevision;
        }
        this.beforeData = null;
        this.targetLayer = null;
        this.isDrawing = false;
        this.discardCreatedLayer();
        this.bus.emit('PREVIEW_CLEARED');
        this.bus.emit('CANVAS_UPDATED');
    }

    discardCreatedLayer() {
        const command = this.createdLayerCommand;
        this.createdLayerCommand = null;
        if (!command) return;
        command.undo();
        if (this.layerManager.layers.some(layer => layer.id === this.createdLayerPreviousId)) this.layerManager.setActive(this.createdLayerPreviousId);
        this.createdLayerPreviousId = null;
    }

    commitRasterEdit(layer, before, name = 'Рисование', icon = 'brush', { preserveSource = false } = {}) {
        if (!layer || !before) return false;
        const after = layer.getImageData();
        const sourceChanged = preserveSource && (before.mollySnapshot?.sourceCanvas !== after.mollySnapshot?.sourceCanvas || JSON.stringify(before.mollySnapshot?.sourceRect) !== JSON.stringify(after.mollySnapshot?.sourceRect));
        if (imageDataEquals(before, after) && !sourceChanged) {
            layer.putImageData(before);
            layer.contentRevision = before.mollySnapshot?.contentRevision ?? layer.contentRevision;
            this.discardCreatedLayer();
            this.bus.emit('CANVAS_UPDATED');
            return false;
        }
        layer.shapeData = null;
        layer.buttonData = null;
        layer.invalidateSource?.(!preserveSource);
        if (after.mollySnapshot) after.mollySnapshot = { ...after.mollySnapshot, contentIdentity: layer.contentIdentity, shapeData: null, buttonData:null, ...(preserveSource ? {} : { sourceCanvas: null, sourceRect: null }) };
        const command = this.createdLayerCommand?.layer === layer ? this.createdLayerCommand : new DrawCommand(layer, before, after, name, icon);
        this.createdLayerCommand = null;
        this.createdLayerPreviousId = null;
        command.name = name; command.icon = icon;
        this.history.push(command);
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }
}
