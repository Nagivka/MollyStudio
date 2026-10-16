import { pngData } from './helpers/png.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectDocument } from '../www/js/core/ProjectValidation.mjs';

const project = overrides => ({
    mollyVersion: 2,
    type: 'canvas',
    config: { width: 32, height: 32 },
    layers: [{ id: 'layer-1', width: 32, height: 32, dataUrl: pngData() }],
    ...overrides
});

test('project validation accepts bounded PNG layers and returns memory estimates', () => {
    assert.deepEqual(validateProjectDocument(project()), {
        width: 32,
        height: 32,
        layerCount: 1,
        pixelCount: 1024,
        encodedBytes: pngData().length
    });
});

test('project validation rejects corrupt images, duplicate layers, and oversized projects', () => {
    assert.throws(() => validateProjectDocument(project({ layers: [{ id: 'x' }, { id: 'x' }] })), /повторяющиеся слои/);
    assert.throws(() => validateProjectDocument(project({ layers: [{ width: 32, height: 32, dataUrl: 'file:///secret.png' }] })), /повреждённое изображение/);
    assert.throws(() => validateProjectDocument(project({
        config: { width: 4096, height: 4096 },
        layers: Array.from({ length: 5 }, (_, index) => ({ id: String(index), width: 4096, height: 4096 }))
    })), /слишком велик/);
    assert.throws(() => validateProjectDocument(project({ mollyVersion: 99 })), /более новой версии/);
});
