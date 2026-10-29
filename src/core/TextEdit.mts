export interface TextLayer<T> {
    textData: T;
    name: string;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;
    textLayoutBounds?: unknown;
    sourceCanvas: HTMLCanvasElement | null;
    sourceRect: {
        x: number;
        y: number;
        w: number;
        h: number;
    } | null;
    contentRevision?: number;
    contentIdentity?: number;
    fxDirty: boolean;
    thumbNeedsUpdate: boolean;
    boundsDirty: boolean;
}
/** Text rendering publishes a new canvas, so rollback needs references, not PNGs. */
export function captureTextState<T>(layer: TextLayer<T>) {
    return {
        textData: structuredClone(layer.textData), name: layer.name,
        canvas: layer.canvas, ctx: layer.ctx, textLayoutBounds: layer.textLayoutBounds,
        sourceCanvas: layer.sourceCanvas, sourceRect: layer.sourceRect ? { ...layer.sourceRect } : null,
        contentRevision: layer.contentRevision, contentIdentity: layer.contentIdentity
    };
}
export function restoreTextState<T>(layer: TextLayer<T>, state: ReturnType<typeof captureTextState<T>>) {
    Object.assign(layer, state, { textData: structuredClone(state.textData) });
    layer.fxDirty = layer.thumbNeedsUpdate = layer.boundsDirty = true;
}
export function editTextData<T>(layer: TextLayer<T>, data: T, render: () => unknown) {
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
