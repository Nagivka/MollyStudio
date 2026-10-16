const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const writes = new Map();

/** Replace a file only after its complete contents have reached the filesystem. */
function atomicWriteFile(filePath, data, options = {}) {
    const target = path.resolve(filePath);
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    const previous = writes.get(key) || Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
        const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        let handle;
        try {
            handle = await fs.open(temporary, 'wx');
            await handle.writeFile(data, options);
            await handle.sync();
            await handle.close();
            handle = null;
            await fs.rename(temporary, target);
        } catch (error) {
            await handle?.close().catch(() => {});
            await fs.rm(temporary, { force: true }).catch(() => {});
            throw error;
        }
    });
    writes.set(key, pending);
    const remove = () => { if (writes.get(key) === pending) writes.delete(key); };
    pending.then(remove, remove);
    return pending;
}

module.exports = { atomicWriteFile };
