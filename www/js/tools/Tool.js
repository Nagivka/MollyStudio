import { AddLayerCommand, DrawCommand } from '../core/Commands.js';
import { imageDataEquals } from '../core/ImageDataUtils.js';

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

    commitRasterEdit(layer, before, name = 'Рисование', icon = 'brush') {
        if (!layer || !before) return false;
        const after = layer.getImageData();
        if (imageDataEquals(before, after)) {
            layer.putImageData(before);
            layer.contentRevision = before.mollySnapshot?.contentRevision ?? layer.contentRevision;
            this.discardCreatedLayer();
            this.bus.emit('CANVAS_UPDATED');
            return false;
        }
        layer.shapeData = null;
        layer.invalidateSource?.();
        if (after.mollySnapshot) after.mollySnapshot = { ...after.mollySnapshot, shapeData: null, sourceCanvas: null, sourceRect: null };
        const command = this.createdLayerCommand?.layer === layer ? this.createdLayerCommand : new DrawCommand(layer, before, after, name, icon);
        this.createdLayerCommand = null;
        this.createdLayerPreviousId = null;
        command.name = name; command.icon = icon;
        this.history.push(command);
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }
}
