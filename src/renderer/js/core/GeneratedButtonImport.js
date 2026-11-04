import Layer from '../graphics/Layer.js';
import {AddLayerCommand, CompoundCommand} from './Commands.js';
import {normalizeButtonData} from './ButtonDocument.mjs';

function loadButtonImage(url, width, height) {
    return new Promise((resolve, reject) => {
        if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) {
            reject(new Error('Некорректное изображение кнопки.'));
            return;
        }
        const image = new Image();
        image.onload = () => image.naturalWidth === width && image.naturalHeight === height
            ? resolve(image) : reject(new Error('Размер изображения кнопки не совпадает с указанным.'));
        image.onerror = () => reject(new Error('Не удалось прочитать изображение кнопки.'));
        image.src = url;
    });
}

/** Prepare all pixels before publishing layers or a history entry. */
export async function importGeneratedButton(app, data) {
    const project = app.getActiveProject();
    if (!project || ['prefix','title'].includes(project.type)) {
        app.showToast('Откройте GUI-проект или обычный холст для вставки кнопки.', 'info');
        return false;
    }
    if (!data) return false;
    const w = Number(data.w), h = Number(data.h);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) {
        app.showToast('Некорректный размер кнопки.', 'error');
        return false;
    }
    const mode = data.mode || (data.pressedDataUrl ? 'both' : 'normal');
    if (!['normal', 'pressed', 'both'].includes(mode)) {
        app.showToast('Некорректное изображение кнопки.', 'error');
        return false;
    }
    app.buttonImports ||= new Set();
    const importId = typeof data.importId === 'string' ? data.importId.slice(0, 128) : null;
    if (importId && app.buttonImports.has(importId)) return false;
    if (importId) app.buttonImports.add(importId);

    const layers = [], sources = new Set();
    let committed = false, published = false, previous;
    const manager = app.layerManager;
    const ensureTarget = () => {
        if (data.transferId && window.desktopAPI?.isTransferActive && !window.desktopAPI.isTransferActive(data.transferId)) throw new Error('Передача кнопки отменена.');
        if (app.getActiveProject() !== project) throw new Error('Вкладка изменилась во время загрузки кнопки. Повторите вставку.');
    };
    try {
        if (app.tools.finishDocument({preserveSelection: true}) === false) return false;
        ensureTarget();
        const states = mode === 'both' ? ['normal', 'pressed'] : [mode];
        const images = await Promise.all(states.map(state => loadButtonImage(data[`${state}DataUrl`], w, h)));
        ensureTarget();
        // A stroke or transform may have started while PNG decoding was pending.
        if (app.tools.finishDocument({preserveSelection: true}) === false) return false;
        ensureTarget();
        const {width, height} = app.config, count = states.length + (mode === 'both' ? 1 : 0);
        if (!manager.canAllocateLayers(count, count * width * height + states.length * w * h)) return false;
        const coordinate = (value, maximum) => Number.isInteger(value) && value >= 0 && value <= maximum;
        const positioned = coordinate(data.guiCol, 8) && coordinate(data.guiRow, 5);
        let x = positioned ? (data.slotMode === 'full' ? 7 : 8) + data.guiCol * 18 : Math.max(0, Math.round((width - w) / 2));
        let y = positioned ? (data.slotMode === 'full' ? 17 : 18) + data.guiRow * 18 : Math.max(0, Math.round((height - h) / 2));
        if (x + w > width) x = Math.max(0, Math.round((width - w) / 2));
        if (y + h > height) y = Math.max(0, Math.round((height - h) / 2));
        const title = coordinate(data.cols, 9) && data.cols > 0 && coordinate(data.rows, 6) && data.rows > 0
            ? `${data.cols}×${data.rows} [${w}×${h} px]` : `${w}×${h} px`;
        const isolated = manager.layers.find(layer => layer.id === manager.isolatedLayerId);
        const parent = isolated?.isGroup ? isolated.id : null;
        const makeLayer = (name, type = 'bitmap') => {
            const id = `${type}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`}`;
            const layer = new Layer(id, name, width, height, type);
            layers.push(layer);
            layer.groupId = parent;
            return layer;
        };
        const group = mode === 'both' ? makeLayer(`Кнопка ${title}`, 'group') : null;
        for (const [index, state] of states.entries()) {
            const source = document.createElement('canvas');
            sources.add(source);source.width = w;source.height = h;
            const context = source.getContext('2d');context.imageSmoothingEnabled = false;
            context.drawImage(images[index], 0, 0);
            const layer = makeLayer(`Кнопка ${title}${state === 'pressed' ? ' — нажатая' : ''}`);
            layer.groupId = group?.id || parent;
            layer.visible = mode !== 'both' || state === 'normal';
            layer.objectType='button';
            layer.buttonData=normalizeButtonData(data.buttonData);
            layer.ctx.drawImage(source, x, y);
            layer.setMasterSource(source, {x, y, w, h});
        }
        const activeIndex = manager.layers.findIndex(layer => layer.id === manager.activeLayerId);
        const insertion = group && activeIndex >= 0 ? activeIndex + 1 : manager.layers.length;
        const commands = layers.map((layer, index) => new AddLayerCommand(manager, layer, insertion + index));
        const command = group ? new CompoundCommand(commands) : commands[0];
        command.name = `Создание кнопки GUI ${title}`;
        previous = {active: manager.activeLayerId, selected: new Set(manager.selectedLayerIds),
            isolation: manager.isolatedLayerId, undo: app.history ? [...app.history.undoStack] : [],
            redo: app.history ? [...app.history.redoStack] : []};
        manager.layers.splice(insertion, 0, ...layers);published = true;
        if (isolated && !isolated.isGroup) manager.toggleIsolation(isolated.id);
        manager.isolationMembers = null;
        manager.setActive(layers[group ? 1 : 0].id);
        app.history?.push(command);
        committed = true;
        app.bus.emit('LAYER_ORDER_CHANGED');
        app.bus.emit('CANVAS_UPDATED');
        app.bus.emit('REQUEST_TOOL_CHANGE', 'move');
        app.showToast(`Кнопка ${title} добавлена на холст.`, 'smart_button');
        return true;
    } catch (error) {
        if (published && !committed) {
            for (const layer of layers) {
                const index = manager.layers.indexOf(layer);
                if (index >= 0) manager.layers.splice(index, 1);
            }
            manager.activeLayerId = previous.active;manager.selectedLayerIds = previous.selected;
            manager.isolatedLayerId = previous.isolation;manager.isolationMembers = null;
            if (app.history) {
                app.history.undoStack = previous.undo;app.history.redoStack = previous.redo;
                app.history.notifyChanged();
            }
            app.bus.emit('ISOLATION_CHANGED', previous.isolation);
            app.bus.emit('LAYER_ACTIVE_CHANGED', manager.getActiveLayer());
            app.bus.emit('LAYER_ORDER_CHANGED');app.bus.emit('CANVAS_UPDATED');
        }
        console.error('Failed to insert generated button:', error);
        app.showToast(committed ? 'Кнопка добавлена. Не удалось обновить интерфейс.' : error.message, 'error');
        return committed;
    } finally {
        if (!committed) {
            if (importId) app.buttonImports.delete(importId);
            for (const layer of layers) {
                layer.releaseRenderCache();layer.canvas.width = layer.canvas.height = layer.thumbCanvas.width = layer.thumbCanvas.height = 1;
                layer.sourceCanvas = layer.sourceRect = null;
            }
            for (const source of sources) source.width = source.height = 1;
        } else if (app.buttonImports.size > 256) {
            app.buttonImports.delete(app.buttonImports.values().next().value);
        }
    }
}
