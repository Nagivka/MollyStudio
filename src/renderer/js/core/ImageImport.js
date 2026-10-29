import Layer from '../graphics/Layer.js';
import {AddLayerCommand} from './Commands.js';

export function loadImportImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const fail = () => { clearTimeout(timeout); image.onload = image.onerror = null; image.removeAttribute('src'); reject(new Error('Не удалось прочитать изображение.')); };
        const timeout = setTimeout(fail, 30000);
        image.onload = () => { clearTimeout(timeout); image.onload = image.onerror = null; resolve(image); };
        image.onerror = fail;
        try { image.src = url; } catch { fail(); }
    });
}

/** Prepare both the raster and original master before publishing a layer. */
export function insertDecodedImage(app, image, {name = 'Изображение', position = 'center', x = null, y = null, fx = null} = {}) {
    const project = app.getActiveProject();
    if (!project || project.type === 'prefix') throw new Error('Для импорта изображения откройте GUI-проект или обычный холст.');
    if (app.tools.finishDocument({preserveSelection: true}) === false) return false;
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) throw new Error('Размер изображения должен быть от 1 до 4096 пикселей.');
    const manager = app.layerManager, {width, height} = app.config;
    if (!manager.canAllocateLayers(1, width * height + w * h)) return false;
    let dx = position === 'origin' ? 0 : Math.round((width - w) / 2);
    let dy = position === 'origin' ? 0 : Math.round((height - h) / 2);
    if (Number.isFinite(x) && Number.isFinite(y)) { dx = Math.round(x - w / 2); dy = Math.round(y - h / 2); }
    else if (position === 'center') { dx = Math.max(0, dx); dy = Math.max(0, dy); }
    let layer, source, previous, published = false, committed = false;
    try {
        const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        layer = new Layer(`image_${id}`, String(name), width, height, 'bitmap');
        source = document.createElement('canvas'); source.width = w; source.height = h;
        const context = source.getContext('2d', {willReadFrequently: true});
        if (!context) throw new Error('Не удалось выделить память для изображения.');
        context.imageSmoothingEnabled = false; context.drawImage(image, 0, 0, w, h);
        layer.ctx.imageSmoothingEnabled = false; layer.ctx.drawImage(image, dx, dy, w, h);
        // Reject unreadable SVG/foreign-content pixels before they can make
        // saving and exporting the complete document fail.
        context.getImageData(0, 0, 1, 1); layer.ctx.getImageData(0, 0, 1, 1);
        layer.setMasterSource(source, {x: dx, y: dy, w, h});
        if(fx)layer.setFX(fx);
        const active = manager.getActiveLayer(), isolated = manager.layers.find(item => item.id === manager.isolatedLayerId);
        layer.groupId = active?.isGroup ? active.id : active?.groupId || (isolated?.isGroup ? isolated.id : null);
        previous = {active: manager.activeLayerId, selected: new Set(manager.selectedLayerIds), isolation: manager.isolatedLayerId,
            undo: app.history ? [...app.history.undoStack] : [], redo: app.history ? [...app.history.redoStack] : []};
        const index = manager.layers.length;
        manager.layers.push(layer); published = true;
        if (isolated && !isolated.isGroup) manager.toggleIsolation(isolated.id);
        manager.isolationMembers = null;
        manager.setActive(layer.id);
        app.history?.push(new AddLayerCommand(manager, layer, index));
        committed = true;
        app.bus.emit('LAYER_ADDED', layer); app.bus.emit('CANVAS_UPDATED'); app.bus.emit('REQUEST_TOOL_CHANGE', 'move');
        return layer;
    } catch (error) {
        if (published && !committed) {
            const index = manager.layers.indexOf(layer);
            if (index !== -1) manager.layers.splice(index, 1);
            manager.activeLayerId = previous.active; manager.selectedLayerIds = previous.selected;
            manager.isolatedLayerId = previous.isolation; manager.isolationMembers = null;
            if (app.history) {
                app.history.undoStack = previous.undo; app.history.redoStack = previous.redo;
                try { app.history.notifyChanged(); } catch (failure) { console.error('Import history rollback:', failure); }
            }
            for (const [event, data] of [['ISOLATION_CHANGED', previous.isolation], ['LAYER_ACTIVE_CHANGED', manager.getActiveLayer()], ['LAYER_ORDER_CHANGED'], ['CANVAS_UPDATED']]) {
                try { app.bus.emit(event, data); } catch (failure) { console.error('Import rollback notification:', failure); }
            }
        }
        if (committed) { app.showToast('Изображение добавлено. Не удалось обновить интерфейс.', 'warning'); return layer; }
        if (error.name === 'SecurityError') throw new Error('Не удалось прочитать пиксели изображения. Сохраните его в PNG и повторите импорт.', {cause: error});
        throw error;
    } finally {
        if (!committed) {
            if (layer) { layer.releaseRenderCache(); layer.canvas.width = layer.canvas.height = layer.thumbCanvas.width = layer.thumbCanvas.height = 1; layer.sourceCanvas = layer.sourceRect = null; }
            if (source) source.width = source.height = 1;
        }
    }
}

export async function importImage(app, source, options) {
    const project = app.getActiveProject();
    if (!project || project.type === 'prefix') throw new Error('Для импорта изображения откройте GUI-проект или обычный холст.');
    if (app.tools.finishDocument({preserveSelection: true}) === false) return false;
    let url, image, ownedUrl = false;
    try {
        if (typeof source === 'string') url = source;
        else {
            if (!(source instanceof Blob) || source.size > 512 * 1024 * 1024) throw new Error('Файл превышает предел 512 МБ или не является изображением.');
            url = URL.createObjectURL(source); ownedUrl = true;
        }
        image = await loadImportImage(url);
        if (app.getActiveProject() !== project) throw new Error('Вкладка изменилась. Повторите импорт в нужном проекте.');
        return insertDecodedImage(app, image, options);
    } finally {
        if (ownedUrl) URL.revokeObjectURL(url);
        image?.removeAttribute('src');
    }
}
