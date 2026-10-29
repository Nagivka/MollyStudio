const DATABASE_NAME = 'molly-project-thumbnail-cache';
const STORE_NAME = 'thumbnails';
const DATABASE_VERSION = 1;
const MAX_CACHED_PROJECTS = 24;

let databasePromise;

function openDatabase() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
    if (databasePromise) return databasePromise;

    databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'path' });
            }
        };
        request.onsuccess = () => {
                const database = request.result;
                database.onversionchange = () => { database.close(); databasePromise = null; };
                resolve(database);
            };
        request.onerror = () => reject(request.error || new Error('Could not open the thumbnail cache.'));
        request.onblocked = () => reject(new Error('Thumbnail cache upgrade is blocked.'));
    }).catch(error => {
        databasePromise = null;
        throw error;
    });

    return databasePromise;
}

/** Returns a cached image only when it belongs to the exact saved revision. */
export async function readProjectThumbnail(path, revision) {
    if (typeof path !== 'string' || !path || typeof revision !== 'string' || !revision) return null;
    try {
        const database = await openDatabase();
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const record = await new Promise((resolve, reject) => {
            const request = transaction.objectStore(STORE_NAME).get(path);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
        if (record?.revision !== revision || typeof record.dataUrl !== 'string') return null;
        return { dataUrl: record.dataUrl, width: record.width, height: record.height };
    } catch (_) {
        return null;
    }
}

/** Keeps only a small number of recent project previews in browser storage. */
export async function writeProjectThumbnail(path, revision, preview) {
    if (typeof path !== 'string' || !path || typeof revision !== 'string' || !revision || !preview?.dataUrl) return false;
    try {
        const database = await openDatabase();
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put({
            path,
            revision,
            dataUrl: preview.dataUrl,
            width: preview.width,
            height: preview.height,
            cachedAt: Date.now()
        });

        const entriesRequest = store.getAll();
        entriesRequest.onsuccess = () => {
            const entries = entriesRequest.result || [];
            entries.sort((a, b) => Number(b.cachedAt) - Number(a.cachedAt));
            entries.slice(MAX_CACHED_PROJECTS).forEach(entry => store.delete(entry.path));
        };
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Could not save the thumbnail.'));
            transaction.onabort = () => reject(transaction.error || new Error('Thumbnail cache update was aborted.'));
        });
        return true;
    } catch (_) {
        return false;
    }
}
