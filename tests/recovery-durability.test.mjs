import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRecoveryStore } = require('../src/main/recoveryStore.js');

async function fixture(t) {
    const root = await mkdtemp(path.join(fileURLToPath(new URL('.', import.meta.url)), '.molly-audit-durability-'));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return root;
}
const draft = (id, timestamp, name = id) => ({ draftId: id, timestamp, project: { name, type: 'canvas', layers: [] } });

for (const phase of ['partial-write', 'synced', 'renamed']) {
    test(`process death during ${phase} leaves a complete old or new file`, async t => {
        const root = await mkdtemp(path.join(fileURLToPath(new URL('.', import.meta.url)), '.molly-audit-durability-'));
        const target = path.join(root, 'fixture.mlst');
        await writeFile(target, JSON.stringify({ version: 'old' }));
        const child = fork(new URL('./helpers/atomic-write-worker.cjs', import.meta.url), [target, phase], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
        t.after(async () => {
            if (child.exitCode == null && child.signalCode == null) {
                const exited = once(child, 'exit');
                child.kill();
                await exited;
            }
            await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        });
        await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('Writer exited before checkpoint'); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Writer checkpoint timed out')), 5000); timer.unref(); })]);
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
        const recovered = JSON.parse(await readFile(target, 'utf8'));
        assert.equal(recovered.version, phase === 'renamed' ? 'new' : 'old');
        if (phase === 'renamed') assert.equal(recovered.pixels.length, 100000);
    });
}

test('recovery rebuilds stale metadata when a crash interrupts the index update', async t => {
    const root = await fixture(t), store = createRecoveryStore(root);
    await store.write(draft('first', 100, 'Before'));
    await store.write(draft('second', 200));
    await writeFile(path.join(root, 'first.json'), JSON.stringify(draft('first', 300, 'Recovered after crash')));
    const restarted = createRecoveryStore(root), entries = await restarted.list();
    assert.equal(entries[0].draftId, 'first');
    assert.equal(entries[0].project.name, 'Recovered after crash');
    assert.equal(entries[0].timestamp, 300);
    await writeFile(path.join(root, 'index.json'), '{');
    assert.equal((await createRecoveryStore(root).list()).length, 2);
});

test('101 unsaved projects retain their first recovery copy after restart', async t => {
    const root = await fixture(t), store = createRecoveryStore(root);
    for (let index = 0; index < 101; index++) await store.write(draft(`project-${index}`, index));
    const restarted = createRecoveryStore(root);
    assert.equal((await restarted.list()).length, 101);
    assert.equal((await restarted.read('project-0')).project.name, 'project-0');
});

test('recovery rejects index, path traversal and case aliases without overwriting another draft', async t => {
    const root = await fixture(t), store = createRecoveryStore(root);
    for (const id of ['index', 'INDEX', '../escape', 'a/b']) await assert.rejects(async () => store.write(draft(id, 1)));
    await store.write(draft('Case', 1));
    await assert.rejects(store.write(draft('case', 2)), /конфликтует/);
    await assert.rejects(store.read('case'), /конфликтует/);
    await assert.rejects(store.delete('case'), /конфликтует/);
    assert.equal((await store.read('Case')).timestamp, 1);
    await store.delete('Case');
    assert.equal((await store.list()).length, 0);
});
