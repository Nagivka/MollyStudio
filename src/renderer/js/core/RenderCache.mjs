/** Free derived images of detached layers without touching pixels or masters. */
export function releaseLayerCaches(layers, retained = []) {
    const keep = new Set(retained);
    for (const layer of new Set(layers)) if (layer && !keep.has(layer)) layer.releaseRenderCache?.();
}

export function releaseProjectRenderCaches(project) {
    const layers = new Set(project.layers || []), seen = new Set();
    const pending = [...(project.undoStack || []), ...(project.redoStack || [])];
    while (pending.length) {
        const command = pending.pop();
        if (!command || seen.has(command)) continue;
        seen.add(command);
        for (const key of ['layer', 'lowerLayer', 'upperLayer', 'group']) if (command[key]) layers.add(command[key]);
        for (const key of ['oldLayers', 'newLayers', 'oldLayersOrder', 'newLayersOrder', 'childLayers']) {
            for (const layer of command[key] || []) layers.add(layer);
        }
        pending.push(...(command.commands || []));
    }
    releaseLayerCaches(layers);
}
