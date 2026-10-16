'use strict';

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '..');

function verifyBuild() {
    const resources = path.join(root, 'dist/win-unpacked/resources');
    const archive = path.join(resources, 'app.asar');
    const feed = yaml.load(fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (feed.provider !== 'github' || feed.owner !== 'Nagivka' || feed.repo !== 'MollyStudio-Updates' || feed.private || feed.token || feed.requestHeaders) throw new Error('Сборка настроена на неверный или приватный канал обновлений.');
    const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
    if (pkg.version !== require('../package.json').version) throw new Error('В сборке устаревшая версия приложения.');
    const files = asar.listPackage(archive);
    if (files.some(file => /(^|[/\\])(\.secrets|\.git)([/\\]|$)|(^|[/\\])\.env($|\.)|\.(pem|pfx|p12|key|private-key)$/i.test(file) || /^[/\\](tests|scripts|docs)([/\\]|$)/.test(file))) throw new Error('В сборку попали закрытые материалы или служебные файлы.');
    for (const file of ['src/main/main.js', 'src/main/autoUpdater.js', 'src/main/updateSignature.js', 'src/main/update-trust.json']) {
        if (!asar.extractFile(archive, file.split('/').join(path.sep)).equals(fs.readFileSync(path.join(root, file)))) throw new Error(`Сборка не содержит актуальный файл ${file}. Пересоберите установщик.`);
    }
    console.log(`Сборка ${pkg.version}: публичный канал обновлений, актуальный код и открытый ключ; закрытых ключей и служебных файлов нет.`);
    return true;
}

if (require.main === module) verifyBuild();
module.exports = { verifyBuild };
