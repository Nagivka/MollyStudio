import {
    LEGACY_DRAFT_KEY,
    PROJECT_DRAFT_PREFIX,
    isValidDraft,
    listProjectDrafts,
    projectDraftKey,
    readProjectDraft,
    writeProjectDraft
} from './ProjectDraftStore.mjs';

const DATABASE_NAME = 'mollystudio-recovery';
const DATABASE_VERSION = 1;
const OBJECT_STORE = 'drafts';
let databasePromise;

function desktopBridge() {
    return globalThis.window?.desktopAPI || null;
}

function announceChange() {
    try {
        const channel = new BroadcastChannel('molly_recovery_drafts');
        channel.postMessage({ type: 'changed' });
        channel.close();
    } catch (_) {}
}

function openDatabase() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(OBJECT_STORE)) {
                    db.createObjectStore(OBJECT_STORE, { keyPath: 'draftId' });
                }
            };
            request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => { database.close(); databasePromise = null; };
                resolve(database);
            };
            request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище черновиков.'));
            request.onblocked = () => reject(new Error('Хранилище черновиков занято другим окном.'));
        }).catch(error => {
            databasePromise = null;
            throw error;
        });
    }
    return databasePromise;
}

function runTransaction(db, mode, action) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(OBJECT_STORE, mode);
        const request = action(transaction.objectStore(OBJECT_STORE));
        // A request can succeed while the enclosing write still fails to commit.
        transaction.oncomplete = () => resolve(request.result);
        request.onerror = () => reject(request.error || transaction.error || new Error('Не удалось обновить черновик.'));
        transaction.onerror = () => reject(transaction.error || new Error('Не удалось обновить черновик.'));
        transaction.onabort = () => reject(transaction.error || new Error('Сохранение черновика прервано.'));
    });
}

function normalizeEntry(draft, key = null) {
    if (!isValidDraft(draft) && !(draft?.summary === true && draft.project?.name)) return null;
    const draftId = String(draft.draftId || draft.project.draftId || (key === LEGACY_DRAFT_KEY ? '' : ''));
    return {
        key: key || (draftId ? projectDraftKey(draftId) : LEGACY_DRAFT_KEY),
        draft,
        draftId: draftId || null,
        timestamp: Number(draft.timestamp) || 0
    };
}

export async function writeRecoveryDraft(storage, draftId, project, timestamp = Date.now()) {
    const safeId = String(draftId || '').trim();
    if (!safeId) throw new Error('Не задан идентификатор черновика.');
    const draft = { draftId: safeId, timestamp, project, hasChanges: true };
    const bridge = desktopBridge();

    if (typeof bridge?.writeRecoveryDraft === 'function') {
        try {
            await bridge.writeRecoveryDraft(draft);
            announceChange();
            return draft;
        } catch (error) {
            console.warn('[Autosave] Desktop recovery store failed; trying browser storage.', error);
        }
    }

    const db = await openDatabase().catch(() => null);
    if (db) {
        try {
            await runTransaction(db, 'readwrite', store => store.put(draft));
        } catch (databaseError) {
            try { writeProjectDraft(storage, safeId, project, timestamp); }
            catch (storageError) { throw new AggregateError([databaseError, storageError], 'Не удалось сохранить черновик ни в одном хранилище.'); }
        }
    } else {
        writeProjectDraft(storage, safeId, project, timestamp);
    }
    announceChange();
    return draft;
}

export async function readRecoveryDraft(storage, token = 'true') {
    const bridge = desktopBridge();
    const requestedId = token === 'true' || token == null ? null : decodeURIComponentSafe(token);

    if (!requestedId) {
        for (const candidate of await listRecoveryDrafts(storage)) {
            const entry = candidate.draft?.summary && candidate.draftId
                ? await readRecoveryDraft(storage, candidate.draftId) : candidate;
            if (entry && isValidDraft(entry.draft)) return entry;
        }
        return null;
    }

    const candidates = [];

    if (requestedId && typeof bridge?.readRecoveryDraft === 'function') {
        try {
            const draft = await bridge.readRecoveryDraft(requestedId);
            const entry = normalizeEntry(draft, projectDraftKey(requestedId));
            if (entry && isValidDraft(entry.draft) && entry.draftId === requestedId) candidates.push(entry);
        } catch (_) {}
    }

    const db = await openDatabase().catch(() => null);
    if (db && requestedId) {
        const draft = await runTransaction(db, 'readonly', store => store.get(requestedId)).catch(() => null);
        const entry = normalizeEntry(draft);
        if (entry && isValidDraft(entry.draft) && entry.draftId === requestedId) candidates.push(entry);
    }

    const legacy = readProjectDraft(storage, token);
    if (legacy) candidates.push(normalizeEntry(legacy.draft, legacy.key));
    // A disk write can fail while a newer browser fallback commits successfully.
    return candidates.filter(Boolean).sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}

export async function listRecoveryDrafts(storage) {
    const bridge = desktopBridge();
    let desktopEntries = [];
    if (typeof bridge?.listRecoveryDrafts === 'function') {
        try {
            desktopEntries = (await bridge.listRecoveryDrafts()) || [];
        } catch (error) {
            console.warn('[Autosave] Could not list desktop recovery drafts.', error);
        }
    }

    const db = await openDatabase().catch(() => null);
    const browserEntries = db
        ? await runTransaction(db, 'readonly', store => store.getAll()).catch(() => [])
        : [];
    const localEntries = listProjectDrafts(storage);
    const merged = new Map();

    for (const raw of [...desktopEntries, ...browserEntries]) {
        const entry = normalizeEntry(raw.draft || raw, raw.key);
        const identity = entry?.draftId || entry?.key;
        if (entry && (!merged.has(identity) || merged.get(identity).timestamp < entry.timestamp)) {
            merged.set(identity, entry);
        }
    }
    for (const entry of localEntries) {
        const normalized = normalizeEntry(entry.draft, entry.key);
        if (!normalized) continue;
        const identity = normalized.draftId || normalized.key;
        if (!merged.has(identity) || merged.get(identity).timestamp < normalized.timestamp) {
            merged.set(identity, normalized);
        }
    }
    return [...merged.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteRecoveryDraft(storage, draftId, key = null) {
    const safeId = draftId ? String(draftId) : null;
    const bridge = desktopBridge();
    if (safeId && typeof bridge?.deleteRecoveryDraft === 'function') {
        await bridge.deleteRecoveryDraft(safeId);
    }
    const db = await openDatabase().catch(() => null);
    if (db && safeId) await runTransaction(db, 'readwrite', store => store.delete(safeId));
    if (key === LEGACY_DRAFT_KEY) storage.removeItem(LEGACY_DRAFT_KEY);
    if (key?.startsWith(PROJECT_DRAFT_PREFIX)) storage.removeItem(key);
    if (safeId) storage.removeItem(projectDraftKey(safeId));
    announceChange();
}

export const RECOVERY_DRAFT_CHANNEL = 'molly_recovery_drafts';

function decodeURIComponentSafe(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
}
