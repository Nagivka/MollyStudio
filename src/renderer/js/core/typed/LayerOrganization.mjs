export const LAYER_LABELS = Object.freeze({
    none: ['Без метки', 'transparent'], red: ['Красная', '#e75b5b'],
    orange: ['Оранжевая', '#ee9845'], yellow: ['Жёлтая', '#e0c349'],
    green: ['Зелёная', '#65b77b'], blue: ['Синяя', '#669ee6'], violet: ['Фиолетовая', '#b58be5']
});
export const normalizeLayerLabel = (value) => Object.hasOwn(LAYER_LABELS, value) ? value : 'none';
export function topLevelSelected(layers, ids) {
    const selected = new Set(ids), byId = new Map(layers.map(layer => [layer.id, layer]));
    return layers.filter(layer => {
        if (!selected.has(layer.id))
            return false;
        const visited = new Set([layer.id]);
        let parent = layer.groupId;
        while (parent && !visited.has(parent)) {
            if (selected.has(parent))
                return false;
            visited.add(parent);
            parent = byId.get(parent)?.groupId;
        }
        return true;
    });
}
export function layerBranch(layers, id) {
    const ids = new Set([id]), children = new Map();
    for (const layer of layers) {
        if (!children.has(layer.groupId))
            children.set(layer.groupId, []);
        children.get(layer.groupId).push(layer.id);
    }
    const stack = [id];
    while (stack.length)
        for (const child of children.get(stack.pop()) || []) {
            if (!ids.has(child)) {
                ids.add(child);
                stack.push(child);
            }
        }
    return ids;
}
/** A plan only: callers apply order and membership together in one undo command. */
export function planLayerDrop(layers, sourceId, targetId, position = 'above') {
    const byId = new Map(layers.map(layer => [layer.id, layer]));
    const source = byId.get(sourceId), target = byId.get(targetId);
    if (!source || !target || source.isBase || sourceId === targetId || !['above', 'inside', 'below'].includes(position))
        return null;
    if (position === 'inside' && !target.isGroup)
        return null;
    const branch = layerBranch(layers, sourceId);
    if (branch.has(targetId))
        return null;
    const groupId = position === 'inside' && target.isGroup ? target.id : target.groupId || null;
    // Locked ancestors prohibit reparenting in either direction.
    for (let node of [source, byId.get(groupId)]) {
        const seen = new Set();
        while (node && !seen.has(node.id)) {
            if (node.locked)
                return null;
            seen.add(node.id);
            node = byId.get(node.groupId);
        }
    }
    const moving = layers.filter(layer => branch.has(layer.id));
    const remaining = layers.filter(layer => !branch.has(layer.id));
    const targetIndex = remaining.indexOf(target);
    let index = targetIndex;
    if (position === 'above')
        index++;
    else if (position === 'below' && target.isGroup) {
        const targetBranch = layerBranch(remaining, target.id);
        index = remaining.findIndex(layer => targetBranch.has(layer.id));
    }
    index = Math.max(remaining.findIndex(layer => layer.isBase) + 1, index);
    const order = [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
    if (source.groupId === groupId && order.every((layer, i) => layer === layers[i]))
        return null;
    return { order, groupId };
}
