import { layerBranch } from '../core/LayerOrganization.mjs';
import { layerState } from './LayerCompositing.js';

export function inspectExportLayers(layers, {width, height}, roots = null) {
    const included = roots ? new Set(roots.flatMap(id => [...layerBranch(layers, id)])) : null;
    const byId = new Map(layers.map(layer => [String(layer.id), layer]));
    const counts = {hidden: 0, outside: 0, fractional: 0};
    for (const layer of layers) {
        if (layer.isGroup || layer.type === 'group' || included && !included.has(layer.id)) continue;
        if (!layerState(layer, byId).visible) { counts.hidden++; continue; }
        const box = layer.sourceRect || layer.getBounds?.();
        if (box && (box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height)) counts.outside++;
        const values = layer.type === 'text' ? [layer.textData?.x, layer.textData?.y] : box ? [box.x,box.y,box.w,box.h] : [];
        if (values.some(value => Number.isFinite(value) && Math.abs(value - Math.round(value)) > 1e-6)) counts.fractional++;
    }
    return [
        counts.hidden && `Скрытых объектов: ${counts.hidden}. Они не попадут в PNG.`,
        counts.outside && `Объектов за границами холста: ${counts.outside}. Выступающие части будут обрезаны.`,
        counts.fractional && `Объектов с дробными координатами или размерами: ${counts.fractional}. Для пиксельной графики проверьте привязку.`
    ].filter(Boolean);
}
