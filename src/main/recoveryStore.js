const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWriteFile } = require('./fileStore.js');

const MAX_RECOVERY_FILE_BYTES = 512 * 1024 * 1024;

function isRecoveryId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) && !/^index$/i.test(value);
}

/** Durable drafts with a rebuildable index. Each operation is serialized across windows. */
function createRecoveryStore(directory) {
    const root = path.resolve(directory);
    const indexFile = path.join(root, 'index.json');
    let queue = Promise.resolve();
    const serialize = operation => {
        const pending = queue.then(operation, operation);
        queue = pending.catch(() => {});
        return pending;
    };
    const fileFor = id => {
        if (!isRecoveryId(id)) throw new Error('Некорректный идентификатор черновика.');
        return path.join(root, `${id}.json`);
    };
    const assertExactCase = async id => {
        fileFor(id);
        const name = `${id}.json`;
        const names = await fs.readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        if (names.some(other => other !== name && other.toLowerCase() === name.toLowerCase())) {
            throw new Error('Идентификатор черновика конфликтует с другой автокопией.');
        }
    };
    const validDraft = (draft, id) => draft?.draftId === id && Array.isArray(draft.project?.layers);
    const readDraft = async id => {
        const file = fileFor(id);
        const stat = await fs.stat(file);
        if (stat.size > MAX_RECOVERY_FILE_BYTES) throw new Error('Файл черновика превышает допустимый размер.');
        const draft = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!validDraft(draft, id)) throw new Error('Файл черновика повреждён.');
        return draft;
    };
    const summary = (draft, stat) => ({
        draftId: draft.draftId,
        timestamp: Number.isFinite(Number(draft.timestamp)) ? Number(draft.timestamp) : 0,
        name: String(draft.project.name || 'Несохранённый проект'),
        type: draft.project.type === 'canvas' ? 'canvas' : 'gui',
        fileBytes: stat.size,
        fileMtimeMs: stat.mtimeMs
    });
    const readIndex = async updatedDraft => {
        let cached = [];
        try {
            const value = JSON.parse(await fs.readFile(indexFile, 'utf8'));
            if (Array.isArray(value)) cached = value;
        } catch (_) {}
        const known = new Map(cached.filter(item => isRecoveryId(item?.draftId)).map(item => [item.draftId, item]));
        const entries = [];
        for (const name of await fs.readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
            if (!name.endsWith('.json')) continue;
            const id = name.slice(0, -5);
            if (!isRecoveryId(id)) continue;
            try {
                const stat = await fs.stat(fileFor(id));
                if (stat.size > MAX_RECOVERY_FILE_BYTES) continue;
                const previous = known.get(id);
                // A crash after the draft rename but before the index rename invalidates this cache.
                if (updatedDraft?.draftId === id) entries.push(summary(updatedDraft, stat));
                else if (previous?.fileBytes === stat.size && previous?.fileMtimeMs === stat.mtimeMs) entries.push(previous);
                else entries.push(summary(await readDraft(id), stat));
            } catch (error) {
                console.warn('Unreadable recovery draft:', name, error.message);
            }
        }
        return entries.sort((a, b) => b.timestamp - a.timestamp);
    };
    return {
        write(draft) {
            if (!validDraft(draft, draft?.draftId)) return Promise.reject(new Error('Некорректный черновик для восстановления.'));
            const file = fileFor(draft.draftId);
            const json = JSON.stringify(draft);
            if (Buffer.byteLength(json) > MAX_RECOVERY_FILE_BYTES) return Promise.reject(new Error('Черновик слишком велик для аварийного сохранения.'));
            return serialize(async () => {
                await fs.mkdir(root, { recursive: true });
                await assertExactCase(draft.draftId);
                await atomicWriteFile(file, json, { encoding: 'utf8' });
                const entries = await readIndex(draft);
                await atomicWriteFile(indexFile, JSON.stringify(entries), { encoding: 'utf8' });
                // Never evict unsaved user work merely because another project was opened.
                return true;
            });
        },
        read(id) { return serialize(async () => { await assertExactCase(String(id)); return readDraft(String(id)); }); },
        list() {
            return serialize(async () => (await readIndex()).map(item => ({
                key: item.draftId, draftId: item.draftId, timestamp: item.timestamp,
                summary: true, project: { name: item.name, type: item.type }
            })));
        },
        delete(id) {
            return serialize(async () => {
                await assertExactCase(String(id));
                await fs.rm(fileFor(String(id)), { force: true });
                const entries = await readIndex();
                await fs.mkdir(root, { recursive: true });
                await atomicWriteFile(indexFile, JSON.stringify(entries), { encoding: 'utf8' });
                return true;
            });
        }
    };
}

module.exports = { createRecoveryStore, isRecoveryId, MAX_RECOVERY_FILE_BYTES };
