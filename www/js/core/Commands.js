/**
 * Commands - Complete Command Pattern implementation for MollyStudio.
 * Supports rock-solid Undo / Redo for drawing, transforms, layer manipulations,
 * layer property edits (opacity, blend mode, visibility, lock, rename),
 * text changes, and floating selection operations.
 */

export class DrawCommand {
    constructor(layer, beforeData, afterData, name = 'Рисование', icon = 'brush') {
        this.layer = layer;
        this.beforeData = beforeData;
        this.afterData = afterData;
        this.name = name;
        this.icon = icon;
    }

    execute() {
        if (this.layer && this.afterData) {
            this.layer.putImageData(this.afterData);
        }
    }

    undo() {
        if (this.layer && this.beforeData) {
            this.layer.putImageData(this.beforeData);
        }
    }
}

export class TransformCommand extends DrawCommand {
    constructor(layer, beforeData, afterData, oldSnap, oldBox, newSnap, newBox) {
        super(layer, beforeData, afterData, 'Трансформация', 'open_with');
        this.oldSnap = oldSnap;
        this.oldBox = oldBox ? { ...oldBox } : null;
        this.newSnap = newSnap;
        this.newBox = newBox ? { ...newBox } : null;
    }

    execute() {
        super.execute();
        if (this.layer) {
            this.layer.transformSnapshot = this.newSnap;
            this.layer.currentBox = this.newBox ? { ...this.newBox } : null;
        }
    }

    undo() {
        super.undo();
        if (this.layer) {
            this.layer.transformSnapshot = this.oldSnap;
            this.layer.currentBox = this.oldBox ? { ...this.oldBox } : null;
        }
    }
}

export class AddLayerCommand {
    constructor(layerManager, layer, index = null) {
        this.layerManager = layerManager;
        this.layer = layer;
        this.index = index !== null ? index : layerManager.layers.indexOf(layer);
        this.name = `Новый слой: ${layer?.name || ''}`;
        this.icon = 'add_box';
    }

    execute() {
        if (!this.layerManager.layers.includes(this.layer)) {
            if (this.index >= 0 && this.index <= this.layerManager.layers.length) {
                this.layerManager.layers.splice(this.index, 0, this.layer);
            } else {
                this.layerManager.layers.push(this.layer);
            }
            this.layerManager.setActive(this.layer.id);
            this.layerManager.bus.emit('LAYER_ADDED', this.layer);
            this.layerManager.bus.emit('CANVAS_UPDATED');
        }
    }

    undo() {
        const idx = this.layerManager.layers.findIndex(l => l.id === this.layer.id);
        if (idx !== -1) {
            this.index = idx;
            this.layerManager.layers.splice(idx, 1);
            this.layerManager.selectedLayerIds?.delete(this.layer.id);
            if (this.layerManager.activeLayerId === this.layer.id) {
                const next = this.layerManager.layers[Math.max(0, idx - 1)];
                if (next) this.layerManager.setActive(next.id);
                else this.layerManager.activeLayerId = null;
            }
            this.layerManager.bus.emit('LAYER_REMOVED', this.layer.id);
            this.layerManager.bus.emit('CANVAS_UPDATED');
        }
    }
}

export class RemoveLayerCommand {
    constructor(layerManager, layer, index) {
        this.layerManager = layerManager;
        this.layer = layer;
        this.children = layer?.isGroup ? layerManager.layers.filter(item => item.groupId === layer.id) : [];
        this.index = index !== undefined && index !== null ? index : layerManager.layers.indexOf(layer);
        this.name = `Удален слой: ${layer?.name || ''}`;
        this.icon = 'delete';
    }

    execute() {
        const idx = this.layerManager.layers.findIndex(l => l.id === this.layer.id);
        if (idx !== -1) {
            for (const child of this.children) child.groupId = this.layer.groupId || null;
            this.index = idx;
            this.layerManager.layers.splice(idx, 1);
            this.layerManager.selectedLayerIds?.delete(this.layer.id);
            if (this.layerManager.activeLayerId === this.layer.id) {
                const next = this.layerManager.layers[Math.max(0, idx - 1)];
                if (next) this.layerManager.setActive(next.id);
                else this.layerManager.activeLayerId = null;
            }
            this.layerManager.bus.emit('LAYER_REMOVED', this.layer.id);
            this.layerManager.bus.emit('CANVAS_UPDATED');
        }
    }

    undo() {
        if (!this.layerManager.layers.includes(this.layer)) {
            for (const child of this.children) child.groupId = this.layer.id;
            if (this.index >= 0 && this.index <= this.layerManager.layers.length) {
                this.layerManager.layers.splice(this.index, 0, this.layer);
            } else {
                this.layerManager.layers.push(this.layer);
            }
            this.layerManager.setActive(this.layer.id);
            this.layerManager.bus.emit('LAYER_ADDED', this.layer);
            this.layerManager.bus.emit('CANVAS_UPDATED');
        }
    }
}

export class MergeLayersCommand {
    constructor(layerManager, lowerLayer, lowerBeforeData, upperLayer, upperIndex) {
        this.layerManager = layerManager;
        this.lowerLayer = lowerLayer;
        this.lowerBeforeData = lowerBeforeData;
        this.lowerAfterData = lowerLayer.getImageData();
        this.upperLayer = upperLayer;
        this.upperIndex = upperIndex;
        this.name = 'Слияние слоев';
        this.icon = 'call_merge';
    }

    execute() {
        const uIdx = this.layerManager.layers.findIndex(l => l.id === this.upperLayer.id);
        if (uIdx !== -1) {
            this.layerManager.layers.splice(uIdx, 1);
        }
        this.lowerLayer.putImageData(this.lowerAfterData);
        this.layerManager.setActive(this.lowerLayer.id);
        this.layerManager.bus.emit('LAYER_REMOVED', this.upperLayer.id);
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }

    undo() {
        this.lowerLayer.putImageData(this.lowerBeforeData);
        if (!this.layerManager.layers.includes(this.upperLayer)) {
            this.layerManager.layers.splice(this.upperIndex, 0, this.upperLayer);
        }
        this.layerManager.setActive(this.upperLayer.id);
        this.layerManager.bus.emit('LAYER_ADDED', this.upperLayer);
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }
}

export class FlattenLayersCommand {
    constructor(layerManager, oldLayers, newLayers) {
        this.layerManager = layerManager;
        this.oldLayers = [...oldLayers];
        this.newLayers = [...newLayers];
        this.name = 'Сведение слоев';
        this.icon = 'layers';
    }

    execute() {
        this.layerManager.layers = [...this.newLayers];
        const top = this.newLayers[this.newLayers.length - 1];
        if (top) this.layerManager.setActive(top.id);
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }

    undo() {
        this.layerManager.layers = [...this.oldLayers];
        const top = this.oldLayers[this.oldLayers.length - 1];
        if (top) this.layerManager.setActive(top.id);
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }
}

export class LayerPropertyCommand {
    constructor(layer, property, oldValue, newValue, bus) {
        this.layer = layer;
        this.property = property;
        this.oldValue = oldValue;
        this.newValue = newValue;
        this.bus = bus;
        this.name = property === 'opacity' ? 'Непрозрачность слоя' : (property === 'blendMode' ? 'Режим наложения' : `Свойство: ${property}`);
        this.icon = property === 'opacity' ? 'opacity' : (property === 'blendMode' ? 'tune' : 'edit');
    }

    execute() {
        if (!this.layer) return;
        this.layer[this.property] = this.newValue;
        if (this.bus) {
            this.bus.emit('LAYER_ACTIVE_CHANGED', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    undo() {
        if (!this.layer) return;
        this.layer[this.property] = this.oldValue;
        if (this.bus) {
            this.bus.emit('LAYER_ACTIVE_CHANGED', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }
}

export class TextDataCommand {
    constructor(layer, oldTextData, newTextData, bus) {
        this.layer = layer;
        this.oldTextData = oldTextData ? JSON.parse(JSON.stringify(oldTextData)) : null;
        this.newTextData = newTextData ? JSON.parse(JSON.stringify(newTextData)) : null;
        this.bus = bus;
        this.name = 'Изменение текста';
        this.icon = 'text_fields';
    }

    execute() {
        if (this.layer && this.newTextData) {
            this.layer.textData = JSON.parse(JSON.stringify(this.newTextData));
            this.bus.emit('RENDER_TEXT_LAYER', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    undo() {
        if (this.layer && this.oldTextData) {
            this.layer.textData = JSON.parse(JSON.stringify(this.oldTextData));
            this.bus.emit('RENDER_TEXT_LAYER', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }
}

export class ReorderLayersCommand {
    constructor(layerManager, oldLayers, newLayers) {
        this.layerManager = layerManager;
        this.oldLayers = [...oldLayers];
        this.newLayers = [...newLayers];
        this.name = 'Порядок слоев';
        this.icon = 'swap_vert';
    }

    execute() {
        this.layerManager.layers = [...this.newLayers];
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }

    undo() {
        this.layerManager.layers = [...this.oldLayers];
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }
}

export class CompoundCommand {
    constructor(commands = []) {
        this.commands = commands;
    }

    add(cmd) {
        if (cmd) this.commands.push(cmd);
    }

    execute() {
        const applied = [];
        try {
            for (const cmd of this.commands) {
                cmd.execute();
                applied.push(cmd);
            }
        } catch (error) {
            for (const cmd of applied.reverse()) cmd.undo();
            throw error;
        }
    }

    undo() {
        const undone = [];
        try {
            for (let i = this.commands.length - 1; i >= 0; i--) {
                this.commands[i].undo();
                undone.push(this.commands[i]);
            }
        } catch (error) {
            for (const cmd of undone.reverse()) cmd.execute();
            throw error;
        }
    }
}

export class LayerFXCommand {
    constructor(layer, oldFX, newFX, bus) {
        this.layer = layer;
        this.oldFX = oldFX ? JSON.parse(JSON.stringify(oldFX)) : null;
        this.newFX = newFX ? JSON.parse(JSON.stringify(newFX)) : null;
        this.bus = bus;
        this.name = 'Эффекты слоя';
        this.icon = 'auto_fix_high';
    }

    execute() {
        if (!this.layer) return;
        this.layer.setFX(this.newFX);
        if (this.bus) {
            this.bus.emit('LAYER_FX_CHANGED', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    undo() {
        if (!this.layer) return;
        this.layer.setFX(this.oldFX);
        if (this.bus) {
            this.bus.emit('LAYER_FX_CHANGED', this.layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }
}

export class GroupLayersCommand {
    constructor(layerManager, group, childLayers, oldLayersOrder, oldGroupIds = new Map()) {
        this.layerManager = layerManager;
        this.group = group;
        this.childLayers = childLayers;
        this.oldGroupIds = oldGroupIds;
        this.oldLayersOrder = [...oldLayersOrder];
        this.newLayersOrder = [...layerManager.layers];
        this.name = `Группа: ${group.name}`;
        this.icon = 'folder';
    }

    execute() {
        this.layerManager.layers = [...this.newLayersOrder];
        for (const l of this.childLayers) {
            l.groupId = this.group.id;
        }
        this.layerManager.setActive(this.group.id);
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }

    undo() {
        for (const l of this.childLayers) {
            l.groupId = this.oldGroupIds.get(l.id) || null;
        }
        this.layerManager.layers = [...this.oldLayersOrder];
        if (this.childLayers.length > 0) {
            this.layerManager.setActive(this.childLayers[0].id);
        }
        this.layerManager.bus.emit('LAYER_ORDER_CHANGED');
        this.layerManager.bus.emit('CANVAS_UPDATED');
    }
}

export const CreateObjectCommand = AddLayerCommand;

export class ResizeCanvasCommand extends CompoundCommand {
    constructor(app, before, after, commands) {
        super(commands);
        this.app = app;
        this.before = before;
        this.after = after;
        this.name = 'Размер холста';
        this.icon = 'aspect_ratio';
    }

    applySize(size) {
        Object.assign(this.app.config, size);
        const project = this.app.getActiveProject();
        if (project) Object.assign(project.config, size);
        this.app.renderer.resize(size.width, size.height);
        this.app.updateProjectTypeUI(project);
        this.app.workspace.fitToScreen();
        this.app.bus.emit('LAYER_ORDER_CHANGED');
        this.app.bus.emit('CANVAS_UPDATED');
    }

    execute() { super.execute(); this.applySize(this.after); }
    undo() { super.undo(); this.applySize(this.before); }
}

export class TemplateCommand extends CompoundCommand {
    constructor(app, project, before, after, oldLayers, newLayers, commands) {
        super(commands);
        Object.assign(this, { app, project, before, after, oldLayers, newLayers });
        this.name = 'Сменить шаблон GUI'; this.icon = 'grid_view';
    }

    restore(state, layers) {
        Object.assign(this.project, state, { config: { ...state.config }, layers: [...layers] });
        if (this.app.activeProjectId !== this.project.id) return;
        Object.assign(this.app.config, state.config);
        this.app.layerManager.setLayers([...layers]);
        this.app.renderer.resize(state.config.width, state.config.height);
        this.app.workspace.fitToScreen();
        this.app.updateProjectTypeUI(this.project);
        this.app.bus.emit('LAYER_ORDER_CHANGED');
        this.app.bus.emit('CANVAS_UPDATED');
    }

    execute() { super.execute(); this.restore(this.after, this.newLayers); }
    undo() { super.undo(); this.restore(this.before, this.oldLayers); }
}
