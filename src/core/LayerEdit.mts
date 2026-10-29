export interface PixelSnapshot {
    pixelPatch?: unknown;
    mollySnapshot?: {
        contentRevision?: number;
    };
}
export interface EditablePixels<T extends PixelSnapshot> {
    contentRevision?: number;
    getImageData(): T;
    putImageData(snapshot: T): unknown;
    applyPixelPatch(snapshot: T): unknown;
}
/** Restore failed edits without creating a false document revision. */
export function restoreLayerSnapshot<T extends PixelSnapshot>(layer: EditablePixels<T>, snapshot: T, revision = snapshot.mollySnapshot?.contentRevision) {
    if (snapshot.pixelPatch)
        layer.applyPixelPatch(snapshot);
    else
        layer.putImageData(snapshot);
    if (typeof revision === 'number' && Number.isFinite(revision))
        layer.contentRevision = revision;
}
/** Pixel writes and metadata changes commit together, including readback failures. */
export function editLayerPixels<T extends PixelSnapshot>(layer: EditablePixels<T>, edit: () => unknown, before = layer.getImageData()) {
    try {
        edit();
        return { before, after: layer.getImageData() };
    }
    catch (error) {
        try {
            restoreLayerSnapshot(layer, before);
        }
        catch (restoreError) {
            throw new AggregateError([error, restoreError], 'Не удалось восстановить слой после ошибки рисования.', { cause: error });
        }
        throw error;
    }
}
