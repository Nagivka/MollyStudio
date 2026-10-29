import { pngData } from '../helpers/png.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectDocument, parseProjectJSON } from '../../src/renderer/js/core/ProjectValidation.mjs';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';

const project = overrides => ({
    mollyVersion: 2,
    type: 'canvas',
    config: { width: 32, height: 32 },
    layers: [{ id: 'layer-1', width: 32, height: 32, dataUrl: pngData() }],
    ...overrides
});

test('BOM documents parse without changing the original text used for revision hashing', () => {
    const text = '\uFEFF' + JSON.stringify(project({name: 'Название'}));
    assert.equal(parseProjectJSON(text).name, 'Название');
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.throws(() => validateProjectDocument(project({name: {unexpected: true}})), /Название проекта/);
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

test('unknown project types and nonfinite shape stroke values fail before importing layers', () => {
    assert.throws(()=>validateProjectDocument(project({type:'future-editor'})),/тип проекта/);
    assert.throws(()=>validateProjectDocument(project({layers:[{width:32,height:32,shapeData:{stroke:Infinity}}]})),/параметры слоя/);
});

test('live layer creation and duplication reject unsaveable allocations before creating canvases', () => {
    const manager=new LayerManager({emit(){}},{width:4096,height:4096});
    manager.layers=Array.from({length:4},(_,index)=>({id:String(index),width:4096,height:4096}));
    assert.equal(manager.addLayer(),null);assert.equal(manager.addGroup(),null);
    assert.equal(manager.duplicateLayer('0'),null);assert.equal(manager.layers.length,4);
    manager.config={width:1,height:1};manager.layers=Array.from({length:512},(_,index)=>({id:String(index),width:1,height:1}));
    assert.equal(manager.addLayer(),null);assert.equal(manager.layers.length,512);
    manager.layers=[{width:4096,height:4096,sourceCanvas:{width:4096,height:4096}}];
    assert.equal(manager.canAllocateLayers(1,40*1024*1024),false);
});
