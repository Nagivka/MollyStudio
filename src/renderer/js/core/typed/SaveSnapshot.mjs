/** Capture the document and its identity synchronously, before any async codec/dialog. */
export function captureSaveSnapshot(serialize, revision, fingerprint) {
    const document = serialize();
    return { document, revision: revision(), fingerprint: fingerprint() };
}
export function matchesSaveSnapshot(snapshot, revision, fingerprint) {
    return snapshot.revision === revision && snapshot.fingerprint === fingerprint;
}
