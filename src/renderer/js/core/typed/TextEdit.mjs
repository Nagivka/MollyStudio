/** Text rendering publishes a new canvas, so rollback needs references, not PNGs. */
export function captureTextState(layer) {
    return {
        textData: structuredClone(layer.textData), name: layer.name,
        canvas: layer.canvas, ctx: layer.ctx, textLayoutBounds: layer.textLayoutBounds,
        sourceCanvas: layer.sourceCanvas, sourceRect: layer.sourceRect ? { ...layer.sourceRect } : null,
        contentRevision: layer.contentRevision, contentIdentity: layer.contentIdentity
    };
}
export function restoreTextState(layer, state) {
    Object.assign(layer, state, { textData: structuredClone(state.textData) });
    layer.fxDirty = layer.thumbNeedsUpdate = layer.boundsDirty = true;
}
export function editTextData(layer, data, render) {
    const before = captureTextState(layer);
    try {
        layer.textData = structuredClone(data);
        render();
    }
    catch (error) {
        restoreTextState(layer, before);
        throw error;
    }
}
