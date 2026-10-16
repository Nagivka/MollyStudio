'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const MAX_MANIFEST_BYTES = 32 * 1024;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function releaseNames(version) {
    if (!VERSION.test(version)) throw new Error('Некорректная версия выпуска.');
    const installer = `MollyStudio-Setup-${version}.exe`;
    return [installer, `${installer}.blockmap`, 'latest.yml'];
}

function readSignedManifest(input, publicKey, expectedVersion) {
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
    if (bytes.length > MAX_MANIFEST_BYTES) throw new Error('Слишком большой манифест обновления.');
    const envelope = JSON.parse(bytes.toString('utf8'));
    if (envelope.schema !== 1 || Object.keys(envelope).sort().join(',') !== 'payload,schema,signature' || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw new Error('Некорректная подпись обновления.');
    const payloadBytes = Buffer.from(envelope.payload, 'base64');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (signature.length !== 64 || !crypto.verify(null, payloadBytes, publicKey, signature)) throw new Error('Подпись обновления не принадлежит издателю MollyStudio.');
    const payload = JSON.parse(payloadBytes.toString('utf8'));
    if (Object.keys(payload).sort().join(',') !== 'files,version' || payload.version !== expectedVersion || !VERSION.test(payload.version)) throw new Error('Версия подписи не совпадает с версией обновления.');
    const names = releaseNames(payload.version);
    if (!Array.isArray(payload.files) || payload.files.length !== names.length) throw new Error('Некорректный список файлов обновления.');
    for (const name of names) {
        const entries = payload.files.filter(file => file?.name === name);
        if (entries.length !== 1 || Object.keys(entries[0]).sort().join(',') !== 'name,sha512,size' || !Number.isSafeInteger(entries[0].size) || entries[0].size <= 0 || entries[0].size > 1024 ** 3 || !/^[a-f0-9]{128}$/.test(entries[0].sha512)) throw new Error('Некорректные параметры файла обновления.');
    }
    return payload;
}

function hashFileSync(file) {
    const digest = crypto.createHash('sha512');
    const handle = fs.openSync(file, 'r');
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    try {
        let count;
        while ((count = fs.readSync(handle, chunk, 0, chunk.length, null)) > 0) digest.update(chunk.subarray(0, count));
    } finally { fs.closeSync(handle); }
    return digest.digest('hex');
}

function verifyReleaseFile(file, payload, expectedName = path.basename(file)) {
    const entry = payload.files.find(item => item.name === expectedName);
    if (!entry || fs.statSync(file).size !== entry.size || hashFileSync(file) !== entry.sha512) throw new Error('Файл обновления повреждён или изменён после подписания.');
    return true;
}

module.exports = { MAX_MANIFEST_BYTES, releaseNames, readSignedManifest, hashFileSync, verifyReleaseFile };
