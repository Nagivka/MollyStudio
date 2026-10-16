import { validateProjectDocument } from '../core/ProjectValidation.mjs';
import { drawLayers } from '../graphics/LayerCompositing.js';
import Layer from '../graphics/Layer.js';
import { menuSize, INVENTORIES } from '../core/DeluxeMenuDocument.mjs';
import { menuEditorView, indexMenuItemsBySlot } from '../core/MenuDocument.mjs';

const PREVIEW_WIDTH = 384;
const PREVIEW_HEIGHT = 216;
const PREVIEW_PADDING = 10;
function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Не удалось прочитать изображение слоя.'));
        image.src = dataUrl;
    });
}

/** Composites a saved MollyStudio document into a small transparent preview. */
export async function createProjectThumbnail(project) {
    const dimensions = validateProjectDocument(project);
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Canvas preview is unavailable.');

    if (project.type === 'deluxemenu') {
        const { findMenuMaterial } = await import('../utils/MinecraftCatalog.js');
        const config = menuEditorView(project.deluxeData, project.menuPlugin);
        const size = menuSize(config);
        const columns = INVENTORIES[config.inventory_type || 'CHEST'].columns;
        const slotIndex = indexMenuItemsBySlot(config, project.menuPlugin);
        const rows = Math.ceil(size / columns);
        const cellSize = Math.min(26, 284 / columns, 166 / rows);
        const gap = 2;
        const panelWidth = columns * cellSize + (columns - 1) * gap + 16;
        const panelHeight = rows * cellSize + (rows - 1) * gap + 43;
        const x = (PREVIEW_WIDTH - panelWidth) / 2;
        const y = (PREVIEW_HEIGHT - panelHeight) / 2;
        context.fillStyle = '#c6c6c6';
        context.fillRect(x, y, panelWidth, panelHeight);
        context.fillStyle = '#fff'; context.fillRect(x, y, panelWidth, 3);
        context.fillStyle = '#555'; context.fillRect(x, y + panelHeight - 3, panelWidth, 3);
        context.font = '12px Google Sans, Arial, sans-serif';
        context.fillStyle = '#252525';
        const title = String(config.menu_title || '').replace(/(?:&|§)(?:#[0-9a-f]{6}|[0-9a-fl-or])/gi, '').slice(0, 48);
        context.fillText(title, x + 8, y + 18, panelWidth - 16);

        const icons = [];
        for (let slot = 0; slot < size; slot++) {
            const cellX = x + 8 + (slot % columns) * (cellSize + gap);
            const cellY = y + 27 + Math.floor(slot / columns) * (cellSize + gap);
            context.fillStyle = '#888'; context.fillRect(cellX, cellY, cellSize, cellSize);
            context.fillStyle = '#555'; context.fillRect(cellX, cellY, cellSize, 2);
            context.fillStyle = '#eee'; context.fillRect(cellX, cellY + cellSize - 2, cellSize, 2);
            const entry = slotIndex[slot][0] || (config.fill_material ? ['fill', {material:config.fill_material}] : null);
            if (!entry) continue;
            const material = findMenuMaterial(entry[1].material);
            if (material) icons.push((async () => {
                try {
                    const image = await decodeImage(material.path);
                    const inset = cellSize * .14;
                    context.drawImage(image, cellX + inset, cellY + inset, cellSize - inset * 2, cellSize - inset * 2);
                    if (entry[1].enchantment_glint_override) { context.fillStyle = '#c599ff55'; context.fillRect(cellX + 3, cellY + 3, cellSize - 6, cellSize - 6); }
                    if ((entry[1].amount || 1) > 1) { context.font = `bold ${Math.max(8, cellSize * .38)}px Arial`; context.textAlign = 'right'; context.fillStyle = '#fff'; context.shadowColor = '#111'; context.shadowBlur = 2; context.fillText(String(entry[1].amount), cellX + cellSize - 2, cellY + cellSize - 3); context.shadowBlur = 0; context.textAlign = 'start'; }
                } catch (_) { /* Custom materials are represented by their empty game slot. */ }
            })());
        }
        await Promise.all(icons);
        return { dataUrl: canvas.toDataURL('image/png'), width: dimensions.width, height: dimensions.height };
    }

    const scale = Math.min(
        (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / dimensions.width,
        (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / dimensions.height
    );
    const offsetX = (PREVIEW_WIDTH - dimensions.width * scale) / 2;
    const offsetY = (PREVIEW_HEIGHT - dimensions.height * scale) / 2;
    context.imageSmoothingEnabled = false;
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);

    if (project.bg === 'white' || project.bg === 'black') {
        context.fillStyle = project.bg;
        context.fillRect(0, 0, dimensions.width, dimensions.height);
    }

    const prepared = [];
    for (const layer of project.layers) if (layer.isGroup || layer.type === 'group') prepared.push({ ...layer, width: layer.width || dimensions.width, height: layer.height || dimensions.height });

    for (const layer of project.layers || []) {
        if (!layer || layer.isGroup || layer.type === 'group' || layer.visible === false || !layer.dataUrl) continue;

        try {
            const image = await decodeImage(layer.dataUrl);
            const layerWidth = Number(layer.width) || dimensions.width;
            const layerHeight = Number(layer.height) || dimensions.height;
            if (image.naturalWidth !== layerWidth || image.naturalHeight !== layerHeight) continue;

            let source = image;
            if (layer.fx?.outline?.enabled || layer.fx?.shadow?.enabled) {
                const effectLayer = Object.create(Layer.prototype);
                Object.assign(effectLayer, { width: layerWidth, height: layerHeight, fx: layer.fx, fxDirty: true, fxScratch: Object.create(null) });
                effectLayer.canvas = document.createElement('canvas');
                effectLayer.canvas.width = layerWidth; effectLayer.canvas.height = layerHeight;
                effectLayer.ctx = effectLayer.canvas.getContext('2d', { willReadFrequently: true });
                effectLayer.ctx.drawImage(image, 0, 0);
                source = effectLayer.getRenderCanvas();
            }
            prepared.push({ ...layer, canvas: source });
        } catch (_) {
            // A damaged layer should not prevent the rest of the document preview from rendering.
        }
    }

    const order = new Map(project.layers.map((layer, index) => [layer.id, index]));
    prepared.sort((a, b) => order.get(a.id) - order.get(b.id));
    drawLayers(context, prepared);
    context.restore();
    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: dimensions.width,
        height: dimensions.height
    };
}
