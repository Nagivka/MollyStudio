const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {checkInputs, checkContext, resumeChecks} = require('../../scripts/lib/check-inputs.cjs');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molly-check-inputs-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const write = (file, content) => {
        const target = path.join(directory, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});fs.writeFileSync(target, content);
    };
    write('src/example.js', 'first');write('package-lock.json', '{}');
    return {directory, write};
}

test('check inputs detect equal-size edits, new files, renames, resources and dependency changes', t => {
    const {directory, write} = fixture(t);
    let previous = checkInputs(directory);
    assert.deepEqual(checkInputs(directory), previous);
    for (const [file, bytes] of [['src/example.js', 'other'], ['src/new.js', 'first'], ['src/pixel.png', Buffer.from([0,1,2])], ['package-lock.json', '{ }']]) {
        write(file, bytes);const current = checkInputs(directory);
        assert.notEqual(current.sha256, previous.sha256, file);previous = current;
    }
    fs.renameSync(path.join(directory, 'src/new.js'), path.join(directory, 'src/renamed.js'));
    assert.notEqual(checkInputs(directory).sha256, previous.sha256);
});

test('reports, profiles and dependency installation output do not invalidate unchanged source checks', t => {
    const {directory, write} = fixture(t), before = checkInputs(directory);
    write('.test-output/check-all.json', '{}');write('dist/setup.exe', 'binary');
    write('node_modules/runtime.js', 'installed');write('scripts/__pycache__/cache.pyc', 'cache');
    // A new empty scripts directory is not a new source file.
    assert.deepEqual(checkInputs(directory), before);
});

test('linked source directories include their content and reject cycles instead of reusing stale results', t => {
    const {directory, write} = fixture(t);
    write('linked-source/asset.png', 'first');
    fs.symlinkSync(path.join(directory, 'linked-source'), path.join(directory, 'src/reference'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = checkInputs(directory);
    write('linked-source/asset.png', 'other');
    assert.notEqual(checkInputs(directory).sha256, before.sha256);
    fs.symlinkSync(path.join(directory, 'src'), path.join(directory, 'src/cycle'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => checkInputs(directory), /link cycle/);
});

test('resume reuses only the passing prefix of an unchanged run', t => {
    const {directory} = fixture(t), tasks = [['unit', ['unit.cjs']], ['desktop', ['desktop.cjs']]], context = checkContext(directory, tasks);
    const passed = {name: 'unit', passed: true, durationMs: 4};
    const report = {schemaVersion: 1, context, results: [passed, {name: 'desktop', passed: false}]};
    assert.deepEqual(resumeChecks(report, context, tasks), {results: [passed], reason: null});
    for (const previous of [null, {...report, schemaVersion: 0}, {...report, results: null}, {...report, results: [{...passed, name: 'unknown'}]}]) {
        const result = resumeChecks(previous, context, tasks);assert.deepEqual(result.results, []);assert.ok(result.reason);
    }
});

test('source edits, changed test commands and changed Node runtime cannot reuse old passes', t => {
    const {directory, write} = fixture(t), tasks = [['unit', ['old.cjs']]], context = checkContext(directory, tasks);
    const report = {schemaVersion: 1, context, results: [{name: 'unit', passed: true}]};
    const changedRuntime = checkContext(directory, tasks, {...context.runtime, node: 'other'});
    const changedPlan = checkContext(directory, [['unit', ['new.cjs']]]);
    write('src/example.js', 'later');const changedSource = checkContext(directory, tasks);
    for (const changed of [changedRuntime, changedPlan, changedSource]) {
        const result = resumeChecks(report, changed, tasks);assert.deepEqual(result.results, []);assert.ok(result.reason);
    }
});
