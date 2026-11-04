const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {PNG} = require('pngjs');
const {app, root, profile, ready, makeWindow, command} = require('./lib/electron-harness.cjs');

const png = url => Buffer.from(url.split(',')[1], 'base64');

function comparePixels(expectedBytes, actualBytes, type) {
    const expected = PNG.sync.read(expectedBytes), actual = PNG.sync.read(actualBytes);
    assert.equal(actual.width, expected.width, `${type}: PNG width`);
    assert.equal(actual.height, expected.height, `${type}: PNG height`);
    if (type !== 'title') {
        assert.ok(actual.data.equals(expected.data), `${type}: PNG pixels differ`);
        return 'identical pixels';
    }
    let union = 0, shared = 0, difference = 0;
    for (let i = 0; i < actual.data.length; i += 4) {
        const alphaA = actual.data[i + 3], alphaB = expected.data[i + 3];
        if (!alphaA && !alphaB) continue;
        union++;
        if (alphaA && alphaB) shared++;
        difference += Math.abs(alphaA - alphaB);
        for (let channel = 0; channel < 3; channel++) difference += Math.abs(actual.data[i + channel] * alphaA - expected.data[i + channel] * alphaB) / 255;
    }
    assert.ok(union && shared / union >= .98 && difference / (4 * union) <= 4,
        `title: cross-GPU mismatch (coverage ${shared / union}, mean error ${difference / (4 * union)})`);
    return {coverage: shared / union, meanChannelError: difference / (4 * union)};
}

function editable(document) {
    const fields = ['type', 'name', 'config', 'templatePath', 'hasFrame', 'prefixData', 'titleData'];
    const state = Object.fromEntries(fields.map(key => [key, document[key]]));
    if (document.type === 'gui') state.layers = document.layers.map(layer => {
        const keys = ['id', 'name', 'type', 'groupId', 'textData', 'shapeData', 'buttonData', 'sourceRect', 'visible', 'opacity'];
        return Object.fromEntries(keys.map(key => [key, layer[key]]));
    });
    return state;
}

async function exportProject(page) {
    return png(await page.evaluate(async () => {
        const panel = mollyEditor.exportPanel;
        if (!await panel.open('project')) throw Error('Cannot open PNG export');
        try {
            const options = panel.read();
            const canvas = panel.source(panel.entries(options)[0], options);
            return canvas.toDataURL('image/png');
        } finally { panel.close(); }
    }));
}

async function main() {
    const [mode, directoryArg] = process.argv.slice(2);
    assert.ok(process.env.CI && ['generate', 'verify'].includes(mode) && directoryArg, 'Run the private transfer workflow');
    const directory = path.resolve(directoryArg);
    const {webgl} = await ready({graphics: true});
    const win = makeWindow(1280, 800);
    await win.loadFile(path.join(root, 'src/renderer/editor.html'), {query: {new: 'true', type: mode === 'generate' ? 'title' : 'canvas', name: 'Перенос проектов'}});
    const page = win.page;
    if (mode === 'generate') {
        const file = await page.evaluate(async () => {
            const project = mollyEditor.getActiveProject(), editor = mollyEditor.titleEditor;
            if (!await project.prefixLoadPromise || !editor.change(data => {data.text = 'MOLLY';data.yaw = 21;})) throw Error('Cannot generate the reference 3D title');
            if (!await mollyEditor.projectManager.saveProjectAs()) throw Error('Cannot save the reference title');
            return project.filePath;
        });
        await fs.copyFile(file, path.join(directory, 'title.mlst'));
        await fs.writeFile(path.join(directory, 'title.png'), await exportProject(page));
        return;
    }

    const checks = {};
    for (const type of ['gui', 'prefix', 'title']) {
        if (type === 'title' && webgl === false) { checks.title = 'WebGL unavailable on this runner'; continue; }
        const source = path.join(directory, `${type}.mlst`), file = path.join(profile, `Перенос ${type}.mlst`);
        await fs.copyFile(source, file);
        await command('test-control', {operation: 'grant-file', path: file});
        await page.evaluate(async file => {
            if (!await mollyEditor.projectManager.openRecentProject(file)) throw Error('Cannot open transferred MLST');
            const project = mollyEditor.getActiveProject();
            await project.templateLoadPromise;
            if (await project.prefixLoadPromise === false) throw Error('Cannot load transferred project resources');
            if (!await mollyEditor.projectManager.saveProject()) throw Error('Cannot re-save transferred MLST');
        }, file);
        const before = JSON.parse(await fs.readFile(source, 'utf8')), after = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.deepEqual(editable(after), editable(before), `${type}: editable fields changed during transfer`);
        const baseline = await fs.readFile(path.join(directory, `${type}.png`));
        const unedited = await exportProject(page);
        const comparison = comparePixels(baseline, unedited, type);
        const changed = await page.evaluate(type => {
            const editor = mollyEditor;
            if (type === 'gui') {
                const layer = editor.layerManager.layers.find(item => item.textData);
                return editor.tools.tools.text.changeTextData(layer, data => {data.text = 'EDITED MENU';});
            }
            if (type === 'prefix') {
                editor.prefixEditor.change(data => {data.blocks[0].text = 'EDITED';});
                return editor.getActiveProject().prefixData.blocks[0].text === 'EDITED';
            }
            return editor.titleEditor.change(data => {data.yaw += 25;});
        }, type);
        assert.ok(changed, `${type}: imported document must remain editable`);
        assert.ok(!unedited.equals(await exportProject(page)), `${type}: editing must change the exported PNG`);
        checks[type] = {comparison, editable: true};
    }
    if (win.__testErrors.length) throw Error(win.__testErrors.join('\n'));
    const output = path.join(root, '.test-output', 'project-transfer.json');
    await fs.writeFile(output, JSON.stringify({platform: process.platform, arch: process.arch, checks}, null, 2));
    console.log(JSON.stringify(checks));
}

const timeout = setTimeout(() => app.exit(1), 180000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    clearTimeout(timeout);
    app.exit(process.exitCode || 0);
});
