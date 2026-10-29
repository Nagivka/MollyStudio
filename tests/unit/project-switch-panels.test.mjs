import test from 'node:test';
import assert from 'node:assert/strict';
import App from '../../src/renderer/js/core/App.js';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import History from '../../src/renderer/js/core/History.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

test('switching between populated projects replaces layer rows and broadcasts the new document', t => {
    const previous={document:globalThis.document,window:globalThis.window};
    globalThis.document={getElementById:()=>null,createElement:()=>new RasterCanvas()};globalThis.window={};
    t.after(()=>Object.assign(globalThis,previous));
    const bus=new EventBus(),config={width:8,height:8},manager=new LayerManager(bus,config),history=new History(bus);
    const a=new Layer('a','First',8,8),b=new Layer('b','Second',8,8),rows=[];
    const projects=[{id:'p',name:'P',layers:[a],activeLayerId:a.id,config},{id:'q',name:'Q',layers:[b],activeLayerId:b.id,config}];
    let switched=0;bus.on('PROJECT_SWITCHED',()=>switched++);
    const app=Object.assign(Object.create(App.prototype),{projects,activeProjectId:'p',config,bus,layerManager:manager,history,
        renderer:{resize(){},render(){}},workspace:{fitToScreen(){},updateTransform(){}},
        layerPanel:{render(){rows.splice(0,rows.length,...manager.getLayers().map(layer=>layer.id));},closeLayerContextMenu(){}},updateProjectTypeUI(){},renderTabs(){}});
    app.loadProjectState('p');assert.deepEqual(rows,['a']);
    app.loadProjectState('q');assert.deepEqual(rows,['b']);assert.equal(switched,2);
    assert.equal(manager.getActiveLayer(),b);
});
