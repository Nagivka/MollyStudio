const fs = require('node:fs/promises');
const path = require('node:path');
const {atomicWrite, readLimited, createQueue, pathKey, MAX_BYTES} = require('./storage.cjs');

const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^index$/i.test(id)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
const validDraft = (draft, id) => draft?.draftId === id && Array.isArray(draft?.project?.layers);
const timestampOf = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const validSummary = item => item?.cacheVersion === 1 && typeof item.project?.name === 'string' && item.project.name.trim().length > 0
    && ['gui', 'canvas', 'prefix', 'title'].includes(item.project.type) && Number.isFinite(item.timestamp);

class RecoveryStore {
    constructor(directory) { this.root = directory; this.run = createQueue(); }
    idle() { return this.run(() => true); }
    async fileFor(id, knownNames) {
        if (!validId(id)) throw Error('Некорректный идентификатор черновика.');
        const name = `${id}.json`;
        const names = knownNames || await fs.readdir(this.root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        if (names.some(other => other !== name && other.toLowerCase() === name.toLowerCase())) throw Error('Идентификатор конфликтует с другой автокопией.');
        return path.join(this.root, name);
    }
    async readDraft(id, knownNames) {
        const draft = JSON.parse((await readLimited(await this.fileFor(id, knownNames))).toString('utf8'));
        if (!validDraft(draft, id)) throw Error('Файл черновика повреждён.');
        return draft;
    }
    async summaries() {
        let cached = [];
        try { cached = JSON.parse((await readLimited(path.join(this.root, 'index.json'))).toString('utf8')); } catch {}
        const known = new Map((Array.isArray(cached) ? cached : []).filter(item => validId(item?.draftId)).map(item => [item.draftId, item]));
        const result = [];
        const names = await fs.readdir(this.root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names) {
            if (!name.endsWith('.json') || !validId(name.slice(0, -5))) continue;
            const id = name.slice(0, -5);
            try {
                const file = await this.fileFor(id, names), stat = await fs.stat(file), old = known.get(id);
                if (!stat.isFile() || stat.size > MAX_BYTES) continue;
                if (validSummary(old) && old.fileBytes === stat.size && old.fileMtimeMs === stat.mtimeMs) {
                    result.push({...old, draftId: id, key: id, summary: true}); continue;
                }
                const draft = await this.readDraft(id, names);
                result.push({draftId: id, key: id, timestamp: timestampOf(draft.timestamp), summary: true, cacheVersion: 1,
                    fileBytes: stat.size, fileMtimeMs: stat.mtimeMs,
                    project: {name: String(draft.project.name || '').trim() || 'Несохранённый проект', type: draft.project.type || 'gui'}});
            } catch (error) { console.warn('Recovery draft:', name, error.message); }
        }
        return result.sort((a, b) => b.timestamp - a.timestamp);
    }
    async cache() {
        const entries = await this.summaries();
        await fs.mkdir(this.root, {recursive: true});
        await atomicWrite(path.join(this.root, 'index.json'), JSON.stringify(entries)).catch(error => console.warn('Recovery index:', error.message));
        return entries;
    }
    write(draft) {
        return this.run(async () => {
            if (!validDraft(draft, draft?.draftId)) throw Error('Некорректный черновик.');
            await fs.mkdir(this.root, {recursive: true});
            await atomicWrite(await this.fileFor(draft.draftId), JSON.stringify(draft));
            await this.cache();
            return true;
        });
    }
    read(id) { return this.run(() => this.readDraft(id)); }
    list() { return this.run(() => this.cache()); }
    delete(id) {
        return this.run(async () => {
            await fs.rm(await this.fileFor(id), {force: true});
            await fs.mkdir(this.root, {recursive: true});
            await this.cache();
            return true;
        });
    }
    importFrom(directories) {
        return this.run(async () => {
            const marker = path.join(this.root, '.imported-sources.json');
            let imported = new Set();
            try {
                const saved = JSON.parse((await readLimited(marker)).toString('utf8'));
                if (saved.version === 1 && Array.isArray(saved.sources)) imported = new Set(saved.sources.filter(value => typeof value === 'string'));
            } catch { /* A missing or damaged migration cache never hides drafts. */ }
            for (const directory of directories) {
                let sourceRoot;
                try { sourceRoot = await fs.realpath(directory); }
                catch (error) { if (error.code !== 'ENOENT') console.warn('Recovery migration folder:', error.message); continue; }
                const key = pathKey(sourceRoot);
                if (key === pathKey(path.resolve(this.root)) || imported.has(key)) continue;
                const source = new RecoveryStore(sourceRoot);
                let summaries;
                try { summaries = await source.summaries(); }
                catch (error) { console.warn('Recovery migration folder:', error.message); continue; }
                let complete = true;
                for (const summary of summaries) {
                    try {
                        const draft = await source.readDraft(summary.draftId);
                        let existing;
                        try { existing = await this.readDraft(summary.draftId); }
                        catch (error) { if (error.code !== 'ENOENT') throw error; }
                        if (existing && timestampOf(existing.timestamp) >= timestampOf(draft.timestamp)) continue;
                        await fs.mkdir(this.root, {recursive: true});
                        await atomicWrite(await this.fileFor(draft.draftId), JSON.stringify(draft));
                    } catch (error) { complete = false; console.warn('Recovery migration:', error.message); }
                }
                if (complete) {
                    // Once imported, a draft deleted in Electron must not return
                    // from the preserved source profile on the next launch.
                    imported.add(key);
                    await fs.mkdir(this.root, {recursive: true});
                    await atomicWrite(marker, JSON.stringify({version: 1, sources: [...imported]}));
                }
            }
            if (await fs.stat(this.root).catch(() => null)) await this.cache();
        });
    }
}

module.exports = {RecoveryStore, validId};
