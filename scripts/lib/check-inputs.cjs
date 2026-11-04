const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');

// Hash code, binary resources and the checks themselves, including untracked
// files. Test output, local profiles and release artifacts are not inputs.
const inputs = ['src', 'scripts', 'tests', '.github', 'build-config','package.json', 'package-lock.json', 'electron-builder.cjs', 'tsconfig.json'];
const ignored = new Set(['node_modules', '__pycache__', '.test-output']);

function checkInputs(root) {
    const hash = createHash('sha256');
    let files = 0;
    function visit(relative, ancestors = new Set()) {
        const file = path.join(root, relative), link = fs.lstatSync(file).isSymbolicLink(), stat = fs.statSync(file);
        if (link) hash.update(JSON.stringify([relative, 'link', fs.readlinkSync(file)]));
        if (stat.isDirectory()) {
            const real = fs.realpathSync(file);
            if (ancestors.has(real)) throw Error('Directory link cycle in check inputs: ' + relative);
            const next = new Set(ancestors);next.add(real);
            for (const name of fs.readdirSync(file).sort()) if (!ignored.has(name)) visit(relative + '/' + name, next);
        } else if (stat.isFile()) {
            const bytes = fs.readFileSync(file);
            hash.update(JSON.stringify([relative, 'file', bytes.length]));
            hash.update('\0');hash.update(bytes);files++;
        }
    }
    for (const relative of inputs) if (fs.existsSync(path.join(root, relative))) visit(relative);
    return {sha256: hash.digest('hex'), files};
}

function checkContext(root, tasks, runtime = {node: process.version, platform: process.platform, arch: process.arch}) {
    return {inputs: checkInputs(root), plan: createHash('sha256').update(JSON.stringify(tasks)).digest('hex'), runtime};
}

function resumeChecks(previous, context, tasks) {
    const restart = reason => ({results: [], reason});
    if (previous?.schemaVersion !== 1 || !previous.context) return restart('В старом отчёте нет контрольных сумм исходников.');
    if (JSON.stringify(previous.context) !== JSON.stringify(context)) return restart('Изменились исходники, ресурсы, проверки или среда запуска.');
    if (!Array.isArray(previous.results)) return restart('Повреждён список результатов проверки.');
    const results = [];
    for (const entry of previous.results) {
        if (!entry || tasks[results.length]?.[0] !== entry.name || typeof entry.passed !== 'boolean') return restart('Изменился или повреждён порядок проверок.');
        if (!entry.passed) break;
        results.push(entry);
    }
    return {results, reason: null};
}

module.exports = {checkInputs, checkContext, resumeChecks};
