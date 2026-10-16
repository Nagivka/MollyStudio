'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const privateFile = path.join(root, '.secrets', 'updates.private.pem');
const publicFile = path.join(root, 'src/main/update-trust.json');

if (fs.existsSync(publicFile)) {
    if (!fs.existsSync(privateFile)) throw new Error('Открытый ключ уже закреплён. Восстановите закрытый ключ из своей резервной копии: новый ключ нарушит обновления установленных приложений.');
    const actual = crypto.createPublicKey(fs.readFileSync(privateFile)).export({ type: 'spki', format: 'pem' });
    if (actual !== JSON.parse(fs.readFileSync(publicFile, 'utf8')).publicKey) throw new Error('Закрытый ключ не соответствует закреплённому открытому ключу.');
    console.log('Ключ подписи обновлений уже настроен. Закрытый ключ не выводится.');
} else {
    if (fs.existsSync(privateFile)) throw new Error('Закрытый ключ уже существует. Восстановите соответствующий update-trust.json, чтобы избежать случайной замены ключа.');
    const keys = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    fs.mkdirSync(path.dirname(privateFile), { recursive: true });
    fs.writeFileSync(privateFile, keys.privateKey, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(publicFile, JSON.stringify({ algorithm: 'Ed25519', publicKey: keys.publicKey }, null, 2) + '\n', { flag: 'wx' });
    console.log('Ключ подписи создан. Сохраните резервную копию .secrets/updates.private.pem в защищённом месте. В Git и установщик входит только открытый ключ.');
}
