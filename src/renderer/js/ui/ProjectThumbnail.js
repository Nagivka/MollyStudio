import { validateProjectDocument } from '../core/ProjectValidation.mjs';
import { drawLayers, layerState } from '../graphics/LayerCompositing.js';
import Layer from '../graphics/Layer.js';

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

    const scale = Math.min(
        (PREVIEW_WIDTH - PREVIEW_PADDING * 2) / dimensions.width,
        (PREVIEW_HEIGHT - PREVIEW_PADDING * 2) / dimensions.height
    );
    const offsetX = (PREVIEW_WIDTH - dimensions.width * scale) / 2;
    const offsetY = (PREVIEW_HEIGHT - dimensions.height * scale) / 2;
    context.imageSmoothingEnabled = project.type==='title';
    if(project.type==='title')context.imageSmoothingQuality='high';
    context.save();
    context.translate(offsetX, offsetY);
    context.scale(scale, scale);

    if (project.bg === 'white' || project.bg === 'black') {
        context.fillStyle = project.bg;
        context.fillRect(0, 0, dimensions.width, dimensions.height);
    }

    const prepared = [];
    const ownedCanvases=new Set([canvas]),byId=new Map(project.layers.map(layer=>[String(layer.id),layer]));
    try {
        for (const layer of project.layers) if (layer.isGroup || layer.type === 'group') prepared.push({ ...layer, width: layer.width || dimensions.width, height: layer.height || dimensions.height });

        for (const layer of project.layers || []) {
            if (!layer || layer.isGroup || layer.type === 'group' || !layerState(layer,byId).visible || !layer.dataUrl) continue;

            let effectLayer;
            try {
                const image = await decodeImage(layer.dataUrl);
                const layerWidth = Number(layer.width) || dimensions.width;
                const layerHeight = Number(layer.height) || dimensions.height;
                if (image.naturalWidth !== layerWidth || image.naturalHeight !== layerHeight) continue;

                let source = image;
                if (Layer.prototype.hasFX.call(layer)) {
                    effectLayer = Object.create(Layer.prototype);
                    Object.assign(effectLayer, { width: layerWidth, height: layerHeight, fx: layer.fx, fxDirty: true, fxScratch: Object.create(null) });
                    effectLayer.setFX(layer.fx);
                    effectLayer.canvas = document.createElement('canvas');
                    effectLayer.canvas.width = layerWidth; effectLayer.canvas.height = layerHeight;
                    effectLayer.ctx = effectLayer.canvas.getContext('2d', { willReadFrequently: true });
                    effectLayer.ctx.drawImage(image, 0, 0);
                    source = effectLayer.getRenderCanvas();
                }
                prepared.push({ ...layer, canvas: source });
            } catch (_) {
                // A damaged layer should not prevent the rest of the document preview from rendering.
            } finally {
                if(effectLayer)for(const buffer of [effectLayer.canvas,effectLayer.fxCanvas,...Object.values(effectLayer.fxScratch)])if(buffer)ownedCanvases.add(buffer);
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
    } finally {
        // Encoding is finished; full-size FX buffers must not wait for browser GC.
        for(const buffer of ownedCanvases)buffer.width=buffer.height=1;
    }
}
