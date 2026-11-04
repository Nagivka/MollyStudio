import test from 'node:test';
import assert from 'node:assert/strict';
import TitleRenderer from '../../src/renderer/js/graphics/TitleRenderer.js';

function fixture(t) {
    const originalDocument = globalThis.document, originalImage = globalThis.Image, images = [];
    globalThis.document = {createElement: () => ({addEventListener() {}})};
    globalThis.Image = class {
        constructor() { this.width = this.height = 32; images.push(this); }
    };
    t.after(() => {
        if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
        if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
    });
    return {renderer: new TitleRenderer(), images};
}

const artwork = 'data:image/png;base64,AA==';

test('closing the final scene prevents a late image from repopulating the cache', async t => {
    const {renderer, images} = fixture(t), pending = renderer.loadImage(artwork);
    renderer.releaseSceneResources();
    images[0].onload();
    await pending;
    assert.equal(renderer.images.has(artwork), false);
    assert.equal(renderer.imageUse.has(artwork), false);
    assert.equal(renderer.imageRequests.size, 0);
});

test('an old image request cannot replace or remove a reopened scene request', async t => {
    const {renderer, images} = fixture(t), old = renderer.loadImage(artwork);
    renderer.releaseSceneResources();
    const reopened = renderer.loadImage(artwork);
    assert.notEqual(old, reopened);
    images[0].onload();
    await old;
    assert.equal(renderer.images.has(artwork), false);
    assert.equal(renderer.imageRequests.get(artwork), reopened);
    images[1].onload();
    await reopened;
    assert.equal(renderer.images.get(artwork), images[1]);
    assert.equal(renderer.imageRequests.size, 0);
});

test('an old image failure does not evict a newer request for the same artwork', async t => {
    const {renderer, images} = fixture(t), old = renderer.loadImage(artwork);
    const rejected = assert.rejects(old, /Не удалось загрузить/);
    renderer.releaseSceneResources();
    const reopened = renderer.loadImage(artwork);
    images[0].onerror();
    await rejected;
    assert.equal(renderer.imageRequests.get(artwork), reopened);
    images[1].onload();
    await reopened;
    assert.equal(renderer.images.get(artwork), images[1]);
});

test('releasing a scene preserves shared boot resources that are still loading', async t => {
    const {renderer, images} = fixture(t), pending = renderer.loadImage('contour-swatches.png');
    renderer.releaseSceneResources();
    assert.equal(renderer.loadImage('contour-swatches.png'), pending);
    images[0].onload();
    await pending;
    assert.equal(renderer.images.get('contour-swatches.png'), images[0]);
});

test('disposing the renderer prevents pending images from retaining decoded resources', async t => {
    const {renderer, images} = fixture(t), pending = renderer.loadImage(artwork);
    renderer.dispose();
    images[0].onload();
    await pending;
    assert.equal(renderer.images.size, 0);
    assert.equal(renderer.imageUse.size, 0);
    assert.equal(renderer.imageRequests.size, 0);
});
