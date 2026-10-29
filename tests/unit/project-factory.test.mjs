import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildEditorUrl,
    createCanvasProject,
    createGuiProject,
    createProjectFromForm
} from '../../src/renderer/js/core/ProjectFactory.mjs';

test('GUI factory keeps supported template sets and falls back from retired styles', () => {
    assert.deepEqual(
        (({ type, template, width, height, hasFrame }) => ({ type, template, width, height, hasFrame }))(
            createGuiProject({ template: 'container_54', style: 'medieval', frame: false })
        ),
        {
            type: 'gui',
            template: 'container/default/container_54.png',
            width: 256,
            height: 256,
            hasFrame: false
        }
    );
    assert.equal(createGuiProject({ template: 'container_54', style: 'modern_dark' }).template, 'container/default/container_54_frame.png');
    assert.equal(createGuiProject({ template: 'container_27', style: 'bedrock' }).template, 'container/bedrock/container_27_frame.png');
    assert.equal(createGuiProject({ template: 'gui_container/villager.png' }).width, 512);
    assert.equal(createGuiProject({ template: 'gui_container/villager.png' }).height, 256);
    assert.equal(createGuiProject({ template: 'gui_container/gamemode_switcher.png' }).width, 128);
    assert.equal(createGuiProject({ template: 'none' }).template, 'none');
    assert.equal(createGuiProject({ template: 'gui_container/inventory.png' }).hasFrame, false);
});

test('unsupported project kinds cannot be created or silently converted to GUI', () => {
    assert.throws(() => createProjectFromForm({}, 'retired-kind'), /не поддерживается/);
    assert.throws(() => buildEditorUrl({ type: 'retired-kind' }), /не поддерживается/);
});

test('canvas factory validates dimensions and normalizes defaults', () => {
    assert.deepEqual(
        (({ type, template, width, height, bg }) => ({ type, template, width, height, bg }))(
            createCanvasProject({ name: '  Pixel art  ', width: 32, height: 64, bg: 'white' })
        ),
        { type: 'canvas', template: 'none', width: 32, height: 64, bg: 'white' }
    );
    for (const [width, height] of [[0, 1], [4097, 1], [1, 2.5], [1, NaN]]) {
        assert.throws(() => createCanvasProject({ width, height }), RangeError);
    }
});

test('form reader and editor URL builder share the project contract', () => {
    const fields = {
        'new-proj-name': 'A & B',
        'new-proj-template': 'container_54',
        'new-proj-frame': 'yes',
    };
    const form = { getElementById: id => ({ value: fields[id] }) };
    const project = createProjectFromForm(form, 'gui');
    assert.equal(project.template, 'container/default/container_54_frame.png');
    assert.equal(project.hasFrame, true);
    const url = new URL(buildEditorUrl(project), 'https://local.test/');
    assert.equal(url.searchParams.get('name'), 'A & B');
    assert.equal(url.searchParams.get('template'), project.template);
    assert.equal(url.searchParams.get('type'), 'gui');
});
