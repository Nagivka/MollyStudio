import { pngData } from './helpers/png.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ProjectManager from '../www/js/core/ProjectManager.mjs';
import { readProjectThumbnail } from '../www/js/core/ProjectThumbnailCache.mjs';

class MemoryStorage {
    values = new Map();
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
}

function createIndexedDbMock() {
    const databases = new Map();
    const open = name => {
        const request = {};
        queueMicrotask(() => {
            let database = databases.get(name);
            if (!database) {
                const stores = new Map();
                database = {
                    objectStoreNames: { contains: storeName => stores.has(storeName) },
                    createObjectStore: (storeName, options = {}) => {
                        stores.set(storeName, { records: new Map(), keyPath: options.keyPath || 'id' });
                    },
                    transaction: storeName => {
                        const transaction = {};
                        const definition = stores.get(storeName);
                        const records = definition.records;
                        const transactionStore = {
                            put: record => records.set(record[definition.keyPath], record),
                            delete: key => {
                                records.delete(key);
                                return createRequest(() => undefined, transaction);
                            },
                            get: key => createRequest(() => records.get(key), transaction),
                            getAll: () => createRequest(() => [...records.values()], transaction)
                        };
                        transaction.objectStore = () => transactionStore;
                        return transaction;
                    }
                };
                databases.set(name, database);
                request.result = database;
                request.onupgradeneeded?.();
            }
            request.result = database;
            request.onsuccess?.();
        });
        return request;
    };
    return { open };
}

function createRequest(read, transaction = null) {
    const request = {};
    queueMicrotask(() => {
        request.result = read();
        request.onsuccess?.();
        if (transaction) queueMicrotask(() => transaction.oncomplete?.());
    });
    return request;
}

/*
 * Exercise the same save path used by Ctrl+S and Save As, including the
 * preview's persistent cache and the recent-project revision marker.
 */
test('successful project save refreshes its revisioned thumbnail before returning home', async t => {
    const globals = ['window', 'localStorage', 'document', 'Image', 'indexedDB'];
    const previous = new Map(globals.map(key => [key, globalThis[key]]));
    t.after(() => globals.forEach(key => {
        if (previous.get(key) === undefined) delete globalThis[key];
        else globalThis[key] = previous.get(key);
    }));

    const storage = new MemoryStorage();
    const writes = [];
    globalThis.localStorage = storage;
    globalThis.indexedDB = createIndexedDbMock();
    globalThis.window = {
        electronAPI: {
            async writeFile(path, contents) { writes.push({ path, contents }); }
        }
    };
    globalThis.document = {
        createElement: () => ({
            getContext: () => ({
                save() {}, restore() {}, translate() {}, scale() {}, drawImage() {}, fillRect() {}
            }),
            toDataURL: () => 'data:image/png;base64,BB=='
        })
    };
    globalThis.Image = class {
        naturalWidth = 32;
        naturalHeight = 32;
        set src(_value) { queueMicrotask(() => this.onload?.()); }
    };

    const path = 'C:\\projects\\preview.mlst';
    const layer = {
        id: 'layer-1', name: 'Layer', width: 32, height: 32, type: 'bitmap', visible: true,
        opacity: 1, blendMode: 'source-over', canvas: { toDataURL: () => pngData() }
    };
    const project = { id: 'project-1', name: 'Preview', type: 'canvas', filePath: path, config: { width: 32, height: 32 } };
    const app = {
        projects: [project], activeProjectId: project.id, config: project.config,
        layerManager: { getLayers: () => [layer] },
        showToast() {}, saveProjectState() {}
    };
    const manager = new ProjectManager(app);

    await manager.saveProject();
    await manager.waitForPendingSaves();

    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, path);
    const recent = JSON.parse(storage.getItem('molly_recent'));
    const savedProject = recent.find(item => item.path === path);
    assert.ok(savedProject?.previewRevision, 'save marks the card thumbnail as a new revision');
    assert.deepEqual(await readProjectThumbnail(path, savedProject.previewRevision), {
        dataUrl: 'data:image/png;base64,BB==', width: 32, height: 32
    });

    manager.addToRecent(path, project.name, project.type);
    assert.equal(JSON.parse(storage.getItem('molly_recent')).find(item => item.path === path).previewRevision, '');
});
