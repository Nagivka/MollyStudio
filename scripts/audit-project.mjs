import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = [], issues = [], counts = {};
const excluded = new Set(['node_modules', 'dist', '.git', '.codex', '.agents', '.playwright-mcp', '.test-output', '.rollback', '.secrets']);

function crc32(data) {
    let crc = 0xffffffff;
    for (const value of data) {
        crc ^= value;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (excluded.has(entry.name) || entry.name.startsWith('.molly-audit-') || /^\.env(?:\.|$)/.test(entry.name) || /\.(pem|pfx|p12|key|private-key)$/i.test(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { await visit(file); continue; }
        if (!entry.isFile()) continue;
        const relative = path.relative(root, file).replaceAll('\\', '/');
        if (relative === 'docs/audit-inventory.json') continue;
        const data = await fs.readFile(file), extension = path.extname(file).toLowerCase();
        const record = { file: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), checks: [] };
        const fail = message => issues.push({ file: relative, message });
        const source = () => data.toString('utf8').replace(/^\uFEFF/, '');
        const checkReference = async reference => {
            try { reference = decodeURIComponent(reference); } catch (_) { fail('Invalid URL encoding'); return; }
            if (!reference || /^(?:[a-z]+:|#|\/\/)/i.test(reference) || reference.includes('${')) return;
            const target = path.resolve(path.dirname(file), decodeURIComponent(reference.split(/[?#]/)[0]));
            if (!await fs.stat(target).catch(() => null)) fail(`Missing reference: ${reference}`);
        };
        if (['.js', '.mjs', '.cjs'].includes(extension)) {
            const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
            if (result.status !== 0) fail(result.stderr || result.error?.message || 'Syntax check failed');
            record.checks.push('javascript-syntax');
            const references = [...source().matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"](\.[^'"]+)['"]/g)];
            for (const reference of references) {
                const target = path.resolve(path.dirname(file), reference[1].split(/[?#]/)[0]);
                if (!await fs.stat(target).catch(() => null) && !await fs.stat(`${target}.js`).catch(() => null)) fail(`Missing module: ${reference[1]}`);
            }
            record.checks.push('relative-module-references');
        } else if (extension === '.json' || extension === '.mcmeta') {
            try { JSON.parse(source()); record.checks.push('json'); } catch (error) { fail(error.message); }
        } else if (extension === '.html') {
            const html = source().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
            const ids = new Set();
            for (const match of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
                if (ids.has(match[1])) fail(`Duplicate HTML id: ${match[1]}`);
                ids.add(match[1]);
            }
            for (const match of source().matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) await checkReference(match[1]);
            record.checks.push('html-ids', 'html-local-references');
        } else if (extension === '.css') {
            for (const match of source().matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) await checkReference(match[1]);
            record.checks.push('css-local-references');
        } else if (extension === '.png') {
            try {
                if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
                let offset = 8, complete = false;
                while (offset + 12 <= data.length) {
                    const length = data.readUInt32BE(offset), end = offset + 12 + length;
                    if (end > data.length) throw new Error('Truncated PNG chunk');
                    if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw new Error('PNG checksum mismatch');
                    if (data.toString('ascii', offset + 4, offset + 8) === 'IEND') { complete = true; break; }
                    offset = end;
                }
                if (!complete) throw new Error('Missing PNG end marker');
                record.checks.push('png-signature-and-chunk-checksums');
            } catch (error) { fail(error.message); }
        } else if (['.woff', '.woff2', '.ttf', '.otf'].includes(extension)) {
            const signature = data.toString('ascii', 0, 4);
            if (!['wOFF', 'wOF2', 'OTTO', 'true'].includes(signature) && data.readUInt32BE(0) !== 0x00010000) fail('Unknown font signature');
            record.checks.push('font-signature');
        }
        record.checks.push('read-and-sha256');
        counts[extension || '(none)'] = (counts[extension || '(none)'] || 0) + 1;
        inventory.push(record);
    }
}

await visit(root);
await fs.mkdir(path.join(root, 'docs'), { recursive: true });
await fs.writeFile(path.join(root, 'docs/audit-inventory.json'), JSON.stringify({ generatedAt: new Date().toISOString(), counts, issues, inventory }, null, 2) + '\n');
console.log(JSON.stringify({ files: inventory.length, counts, issues }, null, 2));
process.exitCode = issues.length ? 1 : 0;
