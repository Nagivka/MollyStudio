export interface SaveSnapshot<T> {
    document: T;
    revision: number;
    fingerprint: string;
}
/** Capture the document and its identity synchronously, before any async codec/dialog. */
export function captureSaveSnapshot<T>(serialize: () => T, revision: () => number, fingerprint: () => string): SaveSnapshot<T> {
    const document = serialize();
    return { document, revision: revision(), fingerprint: fingerprint() };
}
export function matchesSaveSnapshot(snapshot: Pick<SaveSnapshot<unknown>, 'revision' | 'fingerprint'>, revision: number, fingerprint: string): boolean {
    return snapshot.revision === revision && snapshot.fingerprint === fingerprint;
}
