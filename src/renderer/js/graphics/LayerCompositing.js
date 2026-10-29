const BLEND_MODES = new Set([
    'source-over', 'source-in', 'source-out', 'source-atop', 'destination-over',
    'destination-in', 'destination-out', 'destination-atop', 'lighter', 'copy', 'xor',
    'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
    'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'
]);

export function safeBlendMode(value) {
    return BLEND_MODES.has(value) ? value : 'source-over';
}

export function layerState(layer, byId) {
    let opacity = 1;
    let locked = false;
    const visited = new Set();
    for (let current = layer; current; current = byId.get(String(current.groupId))) {
        if (visited.has(current)) return { visible: false, opacity: 0, locked: true };
        visited.add(current);
        if (current.visible === false) return { visible: false, opacity: 0, locked: true };
        const value = current.opacity == null ? 1 : Number(current.opacity);
        opacity *= Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
        locked ||= Boolean(current.locked);
        if (current.groupId == null) break;
    }
    return { visible: opacity > 0, opacity, locked };
}

const groupCache = new WeakMap();
let groupRevision = 0;

export function releaseGroupCache(layer) {
    const cached = groupCache.get(layer);
    if (!cached) return;
    cached.canvas.width = cached.canvas.height = 1;
    groupCache.delete(layer);
}

/** Groups are composited once before their opacity and blend mode are applied. */
export function drawLayers(context, layers, { exclude = new Set(), source = layer => layer.getRenderCanvas?.() || layer.canvas } = {}) {
    const byId = new Map(layers.map(layer => [String(layer.id), layer]));
    const children = new Map();
    for (const layer of layers) {
        const parent = byId.get(String(layer.groupId));
        const key = parent?.isGroup || parent?.type === 'group' ? String(parent.id) : null;
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(layer);
    }
    const prepare = (layer, ancestors) => {
        if (layer.visible === false || Number(layer.opacity ?? 1) <= 0 || ancestors.has(layer.id)) return null;
        const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1) || 0));
        const blend = safeBlendMode(layer.blendMode);
        if (!layer.isGroup && layer.type !== 'group') {
            if (exclude.has(layer.id)) return null;
            return { image: source(layer), opacity, blend,
                unstable: !Number.isFinite(layer.contentRevision), key: JSON.stringify([layer.id, layer.contentRevision, opacity, blend, layer.fx]) };
        }
        const branch = new Set(ancestors); branch.add(layer.id);
        const parts = (children.get(String(layer.id)) || []).map(child => prepare(child, branch)).filter(part => part?.image);
        if (!parts.length) return null;
        const unstable=parts.some(part=>part.unstable);
        const signature = JSON.stringify([layer.width, layer.height, parts.map(part => part.key)]);
        let cached = groupCache.get(layer);
        if (!cached || cached.signature !== signature || unstable) {
            const canvas = cached?.canvas || document.createElement('canvas');
            if (canvas.width !== layer.width) canvas.width = layer.width;
            if (canvas.height !== layer.height) canvas.height = layer.height;
            try {
                const target = canvas.getContext('2d'); target.clearRect(0, 0, canvas.width, canvas.height);
                for (const part of parts) paint(target, part);
            } catch (error) {
                // A reused buffer is no longer the previous cached image after
                // clearRect. Invalidate it even if compositing failed halfway.
                groupCache.delete(layer);canvas.width=canvas.height=1;throw error;
            }
            cached = { canvas, signature, revision: ++groupRevision }; groupCache.set(layer, cached);
        }
        // Keep ancestor cache keys bounded: nesting JSON signatures inside JSON
        // repeatedly escaped them and grew exponentially with group depth.
        return { image: cached.canvas, opacity, blend, unstable, key: JSON.stringify([layer.id, cached.revision, opacity, blend]) };
    };
    function paint(target, part) {
        if (!part?.image) return;
        target.save();
        try { target.globalAlpha = part.opacity; target.globalCompositeOperation = part.blend;
            target.imageSmoothingEnabled = false; target.drawImage(part.image, 0, 0); }
        finally { target.restore(); }
    }
    for (const layer of children.get(null) || []) paint(context, prepare(layer, new Set()));
}
