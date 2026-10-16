const fs = require('node:fs/promises');
const { atomicWriteFile } = require('../../src/main/fileStore.js');
const [target, phase] = process.argv.slice(2);
const checkpoint = async () => {
    setInterval(() => {}, 1000);
    process.send({ phase });
    // The parent intentionally kills this isolated writer at the checkpoint.
    await new Promise(() => {});
};
const open = fs.open.bind(fs), rename = fs.rename.bind(fs);
fs.open = async (...args) => {
    const handle = await open(...args);
    const writeFile = handle.writeFile.bind(handle), sync = handle.sync.bind(handle);
    handle.writeFile = async data => {
        if (phase === 'partial-write') {
            await handle.write(Buffer.from(data).subarray(0, 100));
            await checkpoint();
        }
        return writeFile(data);
    };
    handle.sync = async () => { await sync(); if (phase === 'synced') await checkpoint(); };
    return handle;
};
fs.rename = async (...args) => {
    await rename(...args);
    if (phase === 'renamed') await checkpoint();
};
atomicWriteFile(target, JSON.stringify({ version: 'new', pixels: 'x'.repeat(100000) }))
    .catch(error => { console.error(error); process.exitCode = 1; });
