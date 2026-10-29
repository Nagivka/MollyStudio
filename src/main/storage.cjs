const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {setTimeout: delay} = require('node:timers/promises');

const MAX_BYTES = 512 * 1024 * 1024;
const pendingWrites = new Map();
const revision = bytes => createHash('sha256').update(bytes).digest('hex');
const pathKey = file => process.platform === 'win32' ? file.toLowerCase() : file;
const readableExtensions = new Set(['.mlst', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function createQueue() {
    let tail = Promise.resolve();
    return operation => {
        const result = tail.then(operation, operation);
        tail = result.catch(() => {});
        return result;
    };
}

async function canonicalFile(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw Error('Требуется абсолютный путь к файлу.');
    const name = path.basename(value);
    if (!name || process.platform === 'win32' && (/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
        || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))) throw Error('Недопустимое имя файла.');
    const parent = await fs.realpath(path.dirname(value));
    const file = path.join(parent, name);
    // Pin access to the actual file, including projects reached through a link.
    try { return await fs.realpath(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return file; }
}

async function readLimited(file) {
    const handle = await fs.open(file, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('Файл превышает допустимый размер 512 МБ или не является обычным файлом.');
        const chunks = [];
        let length = 0;
        while (true) {
            const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, MAX_BYTES + 1 - length));
            const {bytesRead} = await handle.read(chunk);
            if (!bytesRead) break;
            length += bytesRead;
            if (length > MAX_BYTES) throw Error('Файл превышает допустимый размер 512 МБ.');
            chunks.push(chunk.subarray(0, bytesRead));
        }
        return Buffer.concat(chunks, length);
    } finally { await handle.close(); }
}

function atomicWrite(file, bytes, expected = null) {
    if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes, 'utf8');
    if (bytes.length > MAX_BYTES) return Promise.reject(Error('Файл слишком велик.'));
    if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) return Promise.reject(Error('Некорректная версия файла.'));
    const key = pathKey(file), previous = pendingWrites.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
        const temporary = path.join(path.dirname(file), `.molly-${randomUUID()}.tmp`);
        let handle;
        try {
            handle = await fs.open(temporary, 'wx');
            await handle.writeFile(bytes);
            await handle.sync();
            await handle.close();
            handle = null;
            for (const wait of [0, 20, 40, 80, 160, 240, 320]) {
                if (wait) await delay(wait);
                if (expected !== null) {
                    let current;
                    try { current = await readLimited(file); }
                    catch { throw Error('FILE_CHANGED: Исходный файл недоступен. Сохраните проект отдельно.'); }
                    if (revision(current) !== expected) throw Error('FILE_CHANGED: Файл изменён другой программой или вкладкой. Сохраните свою версию отдельным файлом.');
                }
                try { await fs.rename(temporary, file); return; }
                catch (error) {
                    if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || wait === 320) throw error;
                }
            }
        } finally {
            await handle?.close().catch(() => {});
            await fs.rm(temporary, {force: true}).catch(() => {});
        }
    });
    pendingWrites.set(key, result);
    const finish = () => { if (pendingWrites.get(key) === result) pendingWrites.delete(key); };
    result.then(finish, finish);
    return result;
}

function decode(data, encoding = 'utf-8') {
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_BYTES) throw Error('Недопустимые или слишком большие данные файла.');
    if (encoding === 'utf-8' || encoding === 'utf8') return Buffer.from(data, 'utf8');
    if (encoding !== 'base64') throw Error('Неподдерживаемая кодировка файла.');
    const base64 = data.replace(/^data:image\/png;base64,/, '');
    // A repeated four-character capture can exhaust RegExp's backtracking stack
    // for large PNGs. Check the alphabet, length and final padding independently.
    const padding = base64.indexOf('=');
    if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64)
        || padding !== -1 && (padding < base64.length - 2 || !/^={1,2}$/.test(base64.slice(padding)))) throw Error('Некорректные данные Base64.');
    return Buffer.from(base64, 'base64');
}

class FileAccess {
    constructor() { this.reads = new Set(); this.writes = new Set(); this.run = createQueue(); }
    idle() { return this.run(() => true); }
    async grant(file, write = false) {
        const target = await canonicalFile(file);
        this.reads.add(pathKey(target));
        if (write) this.writes.add(pathKey(target));
        return target;
    }
    read(file, encoding = 'utf-8') {
        return this.run(async () => {
            const target = await canonicalFile(file);
            if (!readableExtensions.has(path.extname(target).toLowerCase()) && !this.reads.has(pathKey(target))) throw Error('Выберите файл в диалоге открытия.');
            if (!['utf-8', 'utf8', 'base64'].includes(encoding)) throw Error('Неподдерживаемая кодировка файла.');
            const bytes = await readLimited(target);
            const project = path.extname(target).toLowerCase() === '.mlst';
            // Keep the BOM in returned text so the renderer hashes the original
            // bytes. JSON parsers can ignore it independently of revision checks.
            const decoded = project || encoding !== 'base64' ? new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes) : null;
            if (project) {
                if (!Array.isArray(JSON.parse(decoded.replace(/^\uFEFF/, ''))?.layers)) throw Error('Некорректный проект MollyStudio.');
                this.writes.add(pathKey(target));
            }
            return encoding === 'base64' ? bytes.toString('base64') : decoded;
        });
    }
    write(file, data, encoding = 'utf-8', expected = null, project = false) {
        return this.run(async () => {
            const target = await canonicalFile(file);
            if (!this.writes.has(pathKey(target))) throw Error('Сначала выберите файл в диалоге сохранения или откройте проект.');
            const bytes = decode(data, encoding);
            if (project && !Array.isArray(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))?.layers)) throw Error('Некорректный проект MollyStudio.');
            await atomicWrite(target, bytes, expected);
            return project ? revision(bytes) : true;
        });
    }
}

module.exports = {MAX_BYTES, revision, pathKey, canonicalFile, readLimited, atomicWrite, createQueue, decode, FileAccess};
