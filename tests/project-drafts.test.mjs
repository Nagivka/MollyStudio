import test from 'node:test';
import assert from 'node:assert/strict';
import ProjectManager from '../www/js/core/ProjectManager.mjs';
import { LEGACY_DRAFT_KEY, listProjectDrafts, readProjectDraft } from '../www/js/core/ProjectDraftStore.mjs';
import { listRecoveryDrafts, readRecoveryDraft, writeRecoveryDraft } from '../www/js/core/RecoveryDraftStore.mjs';

class MemoryStorage {
    values = new Map();
    get length() { return this.values.size; }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
    key(index) { return [...this.values.keys()][index] ?? null; }
}

function createLayer(name) {
    return {
        id: `layer-${name}`,
        name,
        width: 32,
        height: 32,
        type: 'bitmap',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'source-over',
        isBase: true,
        canvas: { toDataURL: () => `data:image/png;base64,${name}` }
    };
}

test('autosave isolates each open project and serializes inactive tabs from saved state', async () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    const layerA = createLayer('A');
    const layerB = createLayer('B');
    const projectA = { id: 'tab-a', draftId: 'draft-a', name: 'Project A', type: 'canvas', config: { width: 32, height: 32 }, layers: [layerA] };
    const projectB = { id: 'tab-b', draftId: 'draft-b', name: 'Project B', type: 'gui', config: { width: 32, height: 32 }, layers: [layerB] };
    const app = {
        projects: [projectA, projectB],
        activeProjectId: projectB.id,
        layerManager: { getLayers: () => [layerB] },
        config: { width: 32, height: 32 },
        saveProjectState() {
            const active = this.projects.find(project => project.id === this.activeProjectId);
            active.layers = this.layerManager.getLayers();
            active.config = { ...this.config };
        }
    };
    const manager = new ProjectManager(app);

    manager.queueAutosave(projectA.id);
    manager.queueAutosave(projectB.id);
    assert.equal(await manager.performAutosave(projectA.id), true);
    assert.equal(await manager.performAutosave(projectB.id), true);

    const drafts = await listRecoveryDrafts(storage);
    assert.equal(drafts.length, 2);
    assert.deepEqual(new Set(drafts.map(({ draft }) => draft.project.name)), new Set(['Project A', 'Project B']));
    assert.notEqual(drafts[0].key, drafts[1].key);
    assert.equal(manager.autosaveDirtyIds.size, 0);
});

test('saving an older revision keeps newer edits queued for recovery', async () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    const project = { id: 'tab', draftId: 'draft', name: 'Editable', type: 'canvas', config: { width: 32, height: 32 }, layers: [createLayer('edit')] };
    const app = {
        projects: [project],
        activeProjectId: project.id,
        layerManager: { getLayers: () => project.layers },
        config: project.config,
        saveProjectState() {}
    };
    const manager = new ProjectManager(app);
    manager.queueAutosave(project.id);
    const savedRevision = manager.getRevision(project.id);
    manager.queueAutosave(project.id);

    assert.equal(await manager.finishSave(project.id, savedRevision), false);
    assert.equal(manager.autosaveDirtyIds.has(project.id), true);
    manager.markClean(project.id);
});

test('autosave retries when another edit arrives during recovery storage write', async () => {
    let onFirstWrite = null;
    let didQueueAnotherRevision = false;
    const storage = new MemoryStorage();
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
        if (!didQueueAnotherRevision && onFirstWrite) {
            didQueueAnotherRevision = true;
            onFirstWrite();
        }
        originalSetItem(key, value);
    };
    globalThis.localStorage = storage;
    const project = { id: 'tab-retry', draftId: 'draft-retry', name: 'Editable', type: 'canvas', config: { width: 32, height: 32 }, layers: [createLayer('before')] };
    const app = {
        projects: [project],
        activeProjectId: project.id,
        layerManager: { getLayers: () => project.layers },
        config: project.config,
        saveProjectState() {}
    };
    const manager = new ProjectManager(app);
    onFirstWrite = () => manager.queueAutosave(project.id);
    manager.queueAutosave(project.id);

    assert.equal(await manager.flushAutosaves(), true);
    assert.equal(manager.autosaveDirtyIds.has(project.id), false);
    assert.equal(didQueueAnotherRevision, true);
    manager.markClean();
});

test('recovery listing keeps legacy drafts readable and ignores malformed storage entries', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, JSON.stringify({ timestamp: 50, project: { name: 'Legacy', layers: [{}] } }));
    storage.setItem('molly_crash_recovery_draft:broken', '{');
    storage.setItem('molly_crash_recovery_draft:invalid', JSON.stringify({ project: { layers: null } }));
    const legacy = readProjectDraft(storage, 'true');
    assert.equal(legacy.draft.project.name, 'Legacy');
    assert.equal(listProjectDrafts(storage).length, 1);
});

test('an empty transparent canvas remains available for recovery', async () => {
    const storage = new MemoryStorage();
    const project = { name: 'Empty canvas', type: 'canvas', config: { width: 32, height: 32 }, layers: [] };
    await writeRecoveryDraft(storage, 'empty-canvas', project, 200);
    const recovered = await readRecoveryDraft(storage, 'empty-canvas');
    assert.deepEqual(recovered.draft.project.layers, []);
    assert.equal(recovered.draft.project.config.width, 32);
    assert.ok((await listRecoveryDrafts(storage)).some(draft => draft.draftId === 'empty-canvas'));
});

test('recovery storage round-trips large JSON drafts and deletes a saved copy', async () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    const project = { name: 'Large', type: 'canvas', layers: [createLayer('pixels')] };
    const saved = await writeRecoveryDraft(storage, 'large-draft', project, 123);
    assert.equal(saved.draftId, 'large-draft');
    assert.equal((await readRecoveryDraft(storage, 'large-draft')).draft.project.name, 'Large');
    const drafts = await listRecoveryDrafts(storage);
    assert.equal(drafts[0].draftId, 'large-draft');
    assert.equal(drafts[0].timestamp, 123);
});

test('recovery chooses a newer browser fallback over a stale disk copy', async t => {
    const previous = globalThis.window;
    t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
    const storage = new MemoryStorage();
    const old = { draftId: 'fallback-test', timestamp: 100, project: { name: 'Old disk', layers: [] } };
    globalThis.window = { electronAPI: {
        readRecoveryDraft: async () => old,
        listRecoveryDrafts: async () => [old],
        writeRecoveryDraft: async () => { throw new Error('Simulated disk full'); }
    } };
    await writeRecoveryDraft(storage, old.draftId, { name: 'Latest edits', layers: [] }, 200);
    assert.equal((await readRecoveryDraft(storage, old.draftId)).draft.project.name, 'Latest edits');
    assert.equal((await readRecoveryDraft(storage)).draft.project.name, 'Latest edits');
});

test('default recovery chooses a newer disk copy over an old legacy browser draft', async t => {
    const previous = globalThis.window;
    t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_DRAFT_KEY, JSON.stringify({ timestamp: 1, project: { name: 'Legacy', layers: [] } }));
    const fresh = { draftId: 'fresh', timestamp: 300, project: { name: 'Fresh disk', layers: [] } };
    globalThis.window = { electronAPI: { listRecoveryDrafts: async () => [{ ...fresh, summary: true, project: { name: fresh.project.name } }], readRecoveryDraft: async () => fresh } };
    assert.equal((await readRecoveryDraft(storage)).draft.project.name, 'Fresh disk');
});
