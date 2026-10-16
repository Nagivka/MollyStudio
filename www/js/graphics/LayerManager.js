import Layer from './Layer.js';
import { DrawCommand, CompoundCommand } from '../core/Commands.js';
import { drawLayers, layerState } from './LayerCompositing.js';

export default class LayerManager {
    constructor(bus, config = { width: 256, height: 256 }) {
        this.bus = bus;
        this.config = config;
        this.layers = [];
        this.activeLayerId = null;
        this.selectedLayerIds = new Set();
        this.counter = 1;
        this.groupCounter = 1;
    }

    clearLayers() {
        this.layers = [];
        this.activeLayerId = null;
        this.selectedLayerIds.clear();
        this.counter = 1;
        this.groupCounter = 1;
    }

    setLayers(layers) {
        this.layers = layers;
        this.selectedLayerIds.clear();
        if (layers.length > 0) {
            this.activeLayerId = layers[layers.length - 1].id;
            this.selectedLayerIds.add(this.activeLayerId);
        } else {
            this.activeLayerId = null;
        }
    }

    getNextObjectName(prefix) {
        const regex = new RegExp(`^${prefix}\\s+(\\d+)$`);
        let maxNum = 0;
        for (const l of this.layers) {
            const match = l.name.match(regex);
            if (match) {
                const n = parseInt(match[1], 10);
                if (n > maxNum) maxNum = n;
            }
        }
        return `${prefix} ${maxNum + 1}`;
    }

    getNextGroupName() {
        const regex = /^Папка\s+(\d+)$/;
        let maxNum = 0;
        for (const l of this.layers) {
            const match = l.name.match(regex);
            if (match) {
                const n = parseInt(match[1], 10);
                if (n > maxNum) maxNum = n;
            }
        }
        return `Папка ${maxNum + 1}`;
    }

    addLayer(name = null, index = null, isBase = false, type = 'bitmap') {
        const layerName = name || (type === 'text' ? `Текст ${this.counter++}` : (type === 'group' ? this.getNextGroupName() : `Слой ${this.counter++}`));
        const id = (type === 'group' ? `group_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` : `layer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);
        const layer = new Layer(id, layerName, this.config.width, this.config.height, type);
        layer.isBase = isBase;
        if (isBase) {
            layer.locked = false;
        }

        if (index !== null && index >= 0 && index <= this.layers.length) {
            this.layers.splice(index, 0, layer);
        } else {
            this.layers.push(layer);
        }

        if (!isBase || this.layers.length === 1) {
            this.setActive(id);
        }

        this.bus.emit('LAYER_ADDED', layer);
        this.bus.emit('CANVAS_UPDATED');
        return layer;
    }

    addGroup(name = null) {
        const groupName = name || this.getNextGroupName();
        const id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const group = new Layer(id, groupName, this.config.width, this.config.height, 'group');
        group.isGroup = true;
        group.expanded = true;

        const activeIndex = this.layers.findIndex(l => l.id === this.activeLayerId);
        const insertIndex = activeIndex !== -1 ? activeIndex + 1 : this.layers.length;
        this.layers.splice(insertIndex, 0, group);

        this.setActive(group.id);
        this.bus.emit('LAYER_ADDED', group);
        this.bus.emit('CANVAS_UPDATED');
        return group;
    }

    groupSelectedLayers(name = null) {
        let targets = this.getSelectedLayers().filter(l => !l.isBase && !l.isGroup);
        if (targets.length === 0) {
            const active = this.getActiveLayer();
            if (active && !active.isBase && !active.isGroup) {
                targets = [active];
            }
        }
        if (targets.length === 0) return null;

        const oldOrder = [...this.layers];
        const oldGroupIds = new Map(targets.map(layer => [layer.id, layer.groupId]));
        const group = this.addGroup(name);

        for (const l of targets) {
            l.groupId = group.id;
        }

        const targetIds = new Set(targets.map(l => l.id));
        const remaining = this.layers.filter(l => !targetIds.has(l.id));
        const groupIndex = remaining.findIndex(l => l.id === group.id);

        remaining.splice(groupIndex, 0, ...targets);
        this.layers = remaining;

        this.bus.emit('LAYER_ORDER_CHANGED');
        this.bus.emit('CANVAS_UPDATED');
        return { group, targets, oldOrder, oldGroupIds };
    }

    ungroup(groupId) {
        const group = this.layers.find(l => l.id === groupId);
        if (!group) return;

        for (const l of this.layers) {
            if (l.groupId === groupId) {
                l.groupId = group.groupId || null;
            }
        }

        this.removeLayer(groupId);
        this.bus.emit('LAYER_ORDER_CHANGED');
        this.bus.emit('CANVAS_UPDATED');
    }

    toggleGroupExpand(groupId) {
        const group = this.layers.find(l => l.id === groupId);
        if (group && group.isGroup) {
            group.expanded = !group.expanded;
            this.bus.emit('LAYER_ORDER_CHANGED');
        }
    }

    getGroupLayers(groupId) {
        return this.layers.filter(l => l.groupId === groupId);
    }

    setLayerGroup(layerId, groupId) {
        const layer = this.layers.find(item => item.id === layerId);
        if (!layer || layer.isBase) return false;
        if (groupId != null) {
            const visited = new Set([layer.id]);
            let parent = this.layers.find(item => item.id === groupId);
            if (!parent?.isGroup) return false;
            while (parent) {
                if (visited.has(parent.id)) return false;
                visited.add(parent.id);
                parent = this.layers.find(item => item.id === parent.groupId);
            }
        }
        layer.groupId = groupId || null;
        this.bus.emit('LAYER_ORDER_CHANGED'); this.bus.emit('CANVAS_UPDATED');
        return true;
    }

    addTextLayer(name = null, textData = null) {
        const layer = this.addLayer(name, null, false, 'text');
        if (textData && layer.textData) {
            layer.textData = { ...layer.textData, ...textData };
        }
        return layer;
    }

    removeLayer(id) {

        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return false;

        const layer = this.layers[index];
        if (layer.isBase) return false;

        if (layer.isGroup) {
            for (const l of this.layers) {
                if (l.groupId === id) {
                    l.groupId = layer.groupId || null;
                }
            }
        }

        this.layers.splice(index, 1);
        this.selectedLayerIds.delete(id);

        if (this.activeLayerId === id) {
            const nextActive = this.layers[Math.max(0, index - 1)];
            if (nextActive) this.setActive(nextActive.id);
            else { this.activeLayerId = null; this.bus.emit('LAYER_ACTIVE_CHANGED', null); }
        }

        this.bus.emit('LAYER_REMOVED', id);
        this.bus.emit('CANVAS_UPDATED');
        return true;
    }

    setActive(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) {
            this.activeLayerId = layer.id;
            if (!this.selectedLayerIds.has(layer.id)) {
                this.selectedLayerIds.clear();
                this.selectedLayerIds.add(layer.id);
            }
            this.bus.emit('LAYER_ACTIVE_CHANGED', layer);
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    selectLayer(id, isMulti = false, isRange = false) {
        const layer = this.layers.find(l => l.id === id);
        if (!layer) return;

        if (!isMulti && !isRange) {
            this.selectedLayerIds.clear();
            this.selectedLayerIds.add(id);
            this.activeLayerId = id;
        } else if (isMulti) {
            if (this.selectedLayerIds.has(id)) {
                if (this.selectedLayerIds.size > 1) {
                    this.selectedLayerIds.delete(id);
                    if (this.activeLayerId === id) {
                        const remaining = Array.from(this.selectedLayerIds);
                        this.activeLayerId = remaining[remaining.length - 1];
                    }
                }
            } else {
                this.selectedLayerIds.add(id);
                this.activeLayerId = id;
            }
        } else if (isRange) {
            const curIdx = this.layers.findIndex(l => l.id === this.activeLayerId);
            const targetIdx = this.layers.findIndex(l => l.id === id);
            if (curIdx !== -1 && targetIdx !== -1) {
                const min = Math.min(curIdx, targetIdx);
                const max = Math.max(curIdx, targetIdx);
                for (let i = min; i <= max; i++) {
                    this.selectedLayerIds.add(this.layers[i].id);
                }
                this.activeLayerId = id;
            }
        }

        const active = this.getActiveLayer();
        this.bus.emit('LAYER_ACTIVE_CHANGED', active);
        this.bus.emit('LAYER_SELECTION_CHANGED', Array.from(this.selectedLayerIds));
        this.bus.emit('CANVAS_UPDATED');
    }

    isLayerSelected(id) {
        return this.selectedLayerIds.has(id);
    }

    getSelectedLayers() {
        return this.layers.filter(l => this.selectedLayerIds.has(l.id));
    }

    getActiveLayer() {
        return this.layers.find(l => l.id === this.activeLayerId) || null;
    }

    getBaseLayer() {
        return this.layers.find(l => l.isBase) || this.layers[0] || null;
    }

    getLayers() {
        return this.layers;
    }

    isEditable(layer) {
        if (!layer) return false;
        const state = layerState(layer, new Map(this.layers.map(item => [String(item.id), item])));
        return state.visible && !state.locked;
    }

    moveLayer(id, direction) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index === -1) return;
        const layer = this.layers[index];
        if (layer.isBase) return;

        const targetIndex = index + direction;
        const baseIndex = this.layers.findIndex(l => l.isBase);
        const minIndex = baseIndex !== -1 ? baseIndex + 1 : 0;

        if (targetIndex >= minIndex && targetIndex < this.layers.length) {
            const [moved] = this.layers.splice(index, 1);
            this.layers.splice(targetIndex, 0, moved);
            this.bus.emit('LAYER_ORDER_CHANGED');
            this.bus.emit('CANVAS_UPDATED');
        }
    }

    duplicateLayer(id) {
        const original = this.layers.find(layer => layer.id === id);
        if (!original || original.isBase) return null;
        const included = new Set([id]);
        if (original.isGroup) {
            for (let pass = 0; pass < this.layers.length; pass++) {
                const count = included.size;
                for (const layer of this.layers) if (included.has(layer.groupId)) included.add(layer.id);
                if (count === included.size) break;
            }
        }
        const originals = this.layers.filter(layer => included.has(layer.id));
        const copies = new Map();
        for (const layer of originals) {
            const copy = new Layer(`layer_${crypto.randomUUID()}`, `${layer.name} копия`, layer.width, layer.height, layer.type);
            Object.assign(copy, { visible: layer.visible, locked: layer.locked, alphaLocked: layer.alphaLocked,
                opacity: layer.opacity, blendMode: layer.blendMode, isGroup: layer.isGroup, expanded: layer.expanded,
                shapeData: layer.shapeData ? { ...layer.shapeData } : null, objectType: layer.objectType,
                textData: layer.textData ? JSON.parse(JSON.stringify(layer.textData)) : null });
            copy.setFX(layer.fx);
            copy.ctx.drawImage(layer.canvas, 0, 0);
            copy.invalidateSource();
            if (layer.sourceCanvas && layer.sourceRect) copy.setMasterSource(layer.sourceCanvas, layer.sourceRect);
            copies.set(layer.id, copy);
        }
        for (const layer of originals) copies.get(layer.id).groupId = copies.get(layer.groupId)?.id || layer.groupId || null;
        this.layers.splice(this.layers.indexOf(original) + 1, 0, ...copies.values());
        const result = copies.get(id);
        this.setActive(result.id);
        this.bus.emit('LAYER_ORDER_CHANGED');
        this.bus.emit('CANVAS_UPDATED');
        return result;
    }

    mergeDown(id) {
        const index = this.layers.findIndex(l => l.id === id);
        if (index <= 0) return null; // Cannot merge bottom layer or non-existent

        const upperLayer = this.layers[index];
        const lowerLayer = this.layers[index - 1];

        if (upperLayer.isBase || lowerLayer.isBase || upperLayer.isGroup || lowerLayer.isGroup
            || upperLayer.groupId !== lowerLayer.groupId || !this.isEditable(upperLayer) || !this.isEditable(lowerLayer)) return null; // Don't merge into locked base or groups

        const composite = document.createElement('canvas');
        composite.width = lowerLayer.width; composite.height = lowerLayer.height;
        drawLayers(composite.getContext('2d'), [lowerLayer, upperLayer]);
        lowerLayer.ctx.clearRect(0, 0, lowerLayer.width, lowerLayer.height);
        lowerLayer.ctx.drawImage(composite, 0, 0);
        lowerLayer.opacity = 1;
        lowerLayer.blendMode = 'source-over';
        lowerLayer.setFX(null);
        lowerLayer.invalidateSource();
        lowerLayer.type = 'bitmap';
        lowerLayer.textData = null;
        lowerLayer.shapeData = null;

        // Remove upper layer
        this.layers.splice(index, 1);
        this.setActive(lowerLayer.id);

        this.bus.emit('LAYER_REMOVED', upperLayer.id);
        this.bus.emit('LAYER_ADDED', lowerLayer);
        this.bus.emit('CANVAS_UPDATED');

        return { lowerLayer, upperLayer, index };
    }

    mergeGroup(groupId) {
        const group = this.layers.find(l => l.id === groupId);
        if (!group || !group.isGroup) return null;
        const childIds = new Set([group.id]);
        for (let pass = 0; pass < this.layers.length; pass++) {
            const size = childIds.size;
            for (const layer of this.layers) if (childIds.has(layer.groupId)) childIds.add(layer.id);
            if (size === childIds.size) break;
        }
        const children = this.layers.filter(layer => layer !== group && childIds.has(layer.id));
        if (!children.length) return null;
        const mergedLayer = new Layer(`layer_${crypto.randomUUID()}`, group.name, this.config.width, this.config.height, 'bitmap');
        Object.assign(mergedLayer, { opacity: group.opacity ?? 1, blendMode: group.blendMode || 'source-over',
            visible: group.visible, locked: group.locked, groupId: group.groupId || null });
        // Omit the root group here: its opacity/blend remain editable on the result.
        drawLayers(mergedLayer.ctx, children);
        mergedLayer.invalidateSource();
        const groupIndex = this.layers.slice(0, this.layers.indexOf(group)).filter(l => !childIds.has(l.id)).length;
        const newLayers = this.layers.filter(l => !childIds.has(l.id));
        newLayers.splice(groupIndex, 0, mergedLayer);
        this.layers = newLayers;
        this.setActive(mergedLayer.id);

        this.bus.emit('LAYER_ORDER_CHANGED');
        this.bus.emit('CANVAS_UPDATED');
        return mergedLayer;
    }

    flattenImage() {
        if (this.layers.length <= 1) return null;

        const baseLayer = this.getBaseLayer();
        const newLayer = new Layer(
            `layer_${Date.now()}_flat`,
            'Сведенное изображение',
            this.config.width,
            this.config.height,
            'bitmap'
        );

        // Keep the template editable separately without drawing it a second time.
        const retainedBase = this.layers.find(layer => layer.isBase) || null;
        drawLayers(newLayer.ctx, this.layers, { exclude: new Set(retainedBase ? [retainedBase.id] : []) });
        newLayer.ctx.globalAlpha = 1.0;
        newLayer.ctx.globalCompositeOperation = 'source-over';
        newLayer.invalidateSource();

        const oldLayers = [...this.layers];

        if (retainedBase) {
            this.layers = [retainedBase, newLayer];
        } else {
            this.layers = [newLayer];
        }
        this.setActive(newLayer.id);

        this.bus.emit('LAYER_ORDER_CHANGED');
        this.bus.emit('CANVAS_UPDATED');

        return { oldLayers, newLayers: [...this.layers] };
    }

    findLayerAt(px, py) {
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (!this.isEditable(layer) || layer.isBase || layer.isGroup) continue;
            if (px < 0 || py < 0 || px >= layer.width || py >= layer.height) continue;

            const pixel = layer.ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3] > 0) {
                return layer;
            }
        }
        return null;
    }

    createOutline(color = '#000000', layer = null) {
        const target = layer || this.getActiveLayer();
        if (!target || !this.isEditable(target) || target.isBase || target.isGroup || target.alphaLocked) {
            window.mollyEditor?.showToast?.('Выберите редактируемый слой для создания контура', 'warning');
            return null;
        }

        const w = target.width;
        const h = target.height;
        const beforeData = target.getImageData();
        const srcData = target.ctx.getImageData(0, 0, w, h);
        const src32 = new Uint32Array(srcData.data.buffer);

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext('2d');
        const outData = outCtx.createImageData(w, h);
        const out32 = new Uint32Array(outData.data.buffer);

        const dummy = document.createElement('canvas');
        dummy.width = 1;
        dummy.height = 1;
        const dCtx = dummy.getContext('2d');
        dCtx.fillStyle = color;
        dCtx.fillRect(0, 0, 1, 1);
        const color32 = new Uint32Array(dCtx.getImageData(0, 0, 1, 1).data.buffer)[0];

        // 1px 8-directional smart pixel outline
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

        outCtx.putImageData(outData, 0, 0);
        outCtx.drawImage(target.canvas, 0, 0);

        target.clear(false);
        target.ctx.drawImage(outCanvas, 0, 0);
        target.type = 'bitmap';
        target.textData = null;
        target.shapeData = null;
        target.invalidateSource?.();

        const afterData = target.getImageData();
        if (window.mollyEditor?.history) {
            window.mollyEditor.history.push(new DrawCommand(target, beforeData, afterData));
        }

        this.bus.emit('CANVAS_UPDATED');
        window.mollyEditor?.showToast?.('Пиксельный контур 1px создан', 'check_circle');
        return target;
    }

    createDropShadow(offsetX = 1, offsetY = 1, color = 'rgba(0,0,0,0.5)', layer = null) {
        const target = layer || this.getActiveLayer();
        if (!target || !this.isEditable(target) || target.isBase || target.isGroup || target.alphaLocked) {
            window.mollyEditor?.showToast?.('Выберите редактируемый слой для создания тени', 'warning');
            return null;
        }

        const w = target.width;
        const h = target.height;
        const beforeData = target.getImageData();

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext('2d');

        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = w;
        shadowCanvas.height = h;
        const sCtx = shadowCanvas.getContext('2d');
        sCtx.drawImage(target.canvas, 0, 0);
        sCtx.globalCompositeOperation = 'source-in';
        sCtx.fillStyle = color;
        sCtx.fillRect(0, 0, w, h);

        outCtx.drawImage(shadowCanvas, offsetX, offsetY);
        outCtx.drawImage(target.canvas, 0, 0);

        target.clear(false);
        target.ctx.drawImage(outCanvas, 0, 0);
        target.type = 'bitmap';
        target.textData = null;
        target.shapeData = null;
        target.invalidateSource?.();

        const afterData = target.getImageData();
        if (window.mollyEditor?.history) {
            window.mollyEditor.history.push(new DrawCommand(target, beforeData, afterData));
        }

        this.bus.emit('CANVAS_UPDATED');
        window.mollyEditor?.showToast?.('Пиксельная тень создана', 'check_circle');
        return target;
    }

    replaceColor(fromHex, toHex, tolerance = 0, allLayers = false) {
        if (![fromHex, toHex].every(color => typeof color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color))) return 0;
        tolerance = Math.max(0, Math.min(255, Number(tolerance) || 0));
        const commands = [];
        const layersToProcess = allLayers 
            ? this.layers.filter(l => this.isEditable(l) && !l.isBase && !l.isGroup && l.type !== 'text')
            : [this.getActiveLayer()].filter(l => l && this.isEditable(l) && !l.isBase && !l.isGroup && l.type !== 'text');

        if (layersToProcess.length === 0) {
            window.mollyEditor?.showToast?.('Нет доступных слоев для замены цвета', 'warning');
            return 0;
        }

        const parseHex = (h) => {
            let c = h.replace('#', '');
            if (c.length === 3) c = c.split('').map(x => x + x).join('');
            const num = parseInt(c, 16);
            return {
                r: (num >> 16) & 255,
                g: (num >> 8) & 255,
                b: num & 255
            };
        };

        const srcRgb = parseHex(fromHex);
        const dstRgb = parseHex(toHex);

        let totalPixelsChanged = 0;

        for (const layer of layersToProcess) {
            const w = layer.width;
            const h = layer.height;
            const beforeData = layer.getImageData();
            const imgData = layer.ctx.getImageData(0, 0, w, h);
            const data = imgData.data;

            let changed = 0;
            for (let i = 0; i < data.length; i += 4) {
                const a = data[i + 3];
                if (a === 0) continue;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                const diff = Math.max(Math.abs(r - srcRgb.r), Math.abs(g - srcRgb.g), Math.abs(b - srcRgb.b));
                if (diff <= tolerance) {
                    data[i] = dstRgb.r;
                    data[i + 1] = dstRgb.g;
                    data[i + 2] = dstRgb.b;
                    changed++;
                }
            }

            if (changed > 0) {
                totalPixelsChanged += changed;
                layer.putImageData(imgData);
                layer.shapeData = null;
                layer.invalidateSource?.();
                const afterData = layer.getImageData();
                if (window.mollyEditor?.history) {
                    commands.push(new DrawCommand(layer, beforeData, afterData));
                }
            }
        }

        if (commands.length) { const command = new CompoundCommand(commands); command.name = 'Замена цвета'; window.mollyEditor.history.push(command); }
        this.bus.emit('CANVAS_UPDATED');
        window.mollyEditor?.showToast?.(`Заменено пикселей: ${totalPixelsChanged}`, 'check_circle');
        return totalPixelsChanged;
    }

    resizeCanvas(newWidth, newHeight, anchorX = 'center', anchorY = 'center', scale = false, bg = null) {
        this.config.width = newWidth;
        this.config.height = newHeight;
        for (const layer of this.layers) {
            const isBgLayer = (layer.name === 'Фон' || layer.name === 'Background') && (bg === 'white' || bg === 'black');
            const fillColor = isBgLayer ? (bg === 'white' ? '#FFFFFF' : '#000000') : null;
            if (scale) {
                layer.scale(newWidth, newHeight);
            } else {
                layer.resize(newWidth, newHeight, anchorX, anchorY, fillColor);
            }
        }
        this.bus.emit('CANVAS_UPDATED');
    }
}
