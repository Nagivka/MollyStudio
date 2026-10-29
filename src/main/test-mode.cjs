// Development fixtures only; excluded from every distributable.
const fs = require('node:fs/promises');
const path = require('node:path');
const {canonicalFile} = require('./storage.cjs');

function createTestControls(runtime, profile) {
    let sequence = 0;
    async function safeTestPath(value) {
        const file = await canonicalFile(value), relative = path.relative(profile, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Test IO escaped the private fixture directory.');
        return file;
    }
    async function testSavePath(options) {
        let decision;
        try { decision = JSON.parse(await fs.readFile(path.join(profile, 'save-dialog.json'), 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (decision?.canceled) return {canceled: true, filePath: ''};
        const file = decision?.filePath || path.join(profile, `${++sequence}-${path.basename(options.defaultPath || 'fixture.mlst')}`);
        return {canceled: false, filePath: await safeTestPath(file)};
    }
    async function testControl(data) {
        switch (data?.operation) {
        case 'create': runtime.windows.create(data.label, 'index.html'); return data.label;
        case 'destroy': runtime.windows.get(data.label)?.destroy(); return true;
        case 'emit': runtime.windows.broadcast(data.name, data.payload); return true;
        case 'grant-file': await runtime.files.grant(await safeTestPath(data.path), true); return true;
        case 'open-project': runtime.enqueue([await safeTestPath(data.path)], profile); return true;
        case 'delayed-recovery': setTimeout(() => runtime.recovery.write(data.draft).catch(console.error), 200); return true;
        case 'update-fixture': return require('../../tests/helpers/update-fixture.cjs').installFixture(require('electron'),runtime,profile);
        default: throw Error('Unknown fixture operation.');
        }
    }
    return {safeTestPath, testSavePath, testControl};
}
module.exports = {createTestControls};
