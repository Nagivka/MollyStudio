import test from 'node:test';
import assert from 'node:assert/strict';
import App from '../../src/renderer/js/core/App.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import History from '../../src/renderer/js/core/History.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

for (const existingBase of [true, false]) test(`a failed GUI template replacement restores every layer (existing base=${existingBase})`, async t => {
    const previous = {document: globalThis.document, window: globalThis.window, Image: globalThis.Image};
    globalThis.document = {getElementById: () => null, createElement: () => new RasterCanvas()};
    globalThis.window = {};
    globalThis.Image = class extends RasterCanvas {
        constructor() {super(12, 10); this.naturalWidth = 12; this.naturalHeight = 10; this.context.fillStyle='#99bbdd';this.context.fillRect(0,0,12,10);}
        set src(value) {queueMicrotask(() => this.onload());}
    };
    t.after(() => Object.assign(globalThis, previous));
    const bus = new EventBus(), config = {width: 8, height: 8}, manager = new LayerManager(bus, config), history = new History(bus);
    if (existingBase) {const base = manager.addLayer('GUI');base.isBase=true;}
    const layer = manager.addLayer('Drawing');layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(1,1,3,2);layer.invalidateSource();
    const layers = [...manager.layers], snapshots = layers.map(item => item.getImageData());
    const project = {id:'p',type:'gui',config,layers,name:'Original',templatePath:'old.png',templateName:'old',hasFrame:false};
    const app = Object.assign(Object.create(App.prototype), {bus,config,history,layerManager:manager,projects:[project],activeProjectId:'p',getActiveProject:()=>project,
        tools:{finishDocument:()=>true},renderer:{resize(){}},workspace:{fitToScreen(){}},updateProjectTypeUI(){},saveProjectState(){},renderTabs(){},showToast(){}});
    const resize = layer.resize.bind(layer); let fail = true;
    layer.resize = (...args) => {resize(...args);if(fail){fail=false;throw Error('Partial resize');}};
    assert.equal(await app.loadTemplate('new.png'), false);
    assert.deepEqual(config,{width:8,height:8});assert.deepEqual(project.config,config);assert.equal(project.templatePath,'old.png');assert.equal(project.templateName,'old');
    assert.deepEqual(manager.layers,layers);assert.equal(history.undoStack.length,0);
    layers.forEach((item,index) => {const snapshot=item.getImageData();assert.deepEqual(snapshot.data,snapshots[index].data);assert.deepEqual(snapshot.mollySnapshot,snapshots[index].mollySnapshot);});
    assert.equal(await app.loadTemplate('new.png'), true);assert.equal(history.undoStack.length,1);assert.equal(config.width,12);
    assert.equal(history.undo(),true);assert.deepEqual(config,{width:8,height:8});assert.equal(project.templatePath,'old.png');
    assert.equal(history.redo(),true);assert.equal(config.width,12);assert.equal(project.templatePath,'new.png');
});
