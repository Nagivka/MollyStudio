import test from 'node:test';
import assert from 'node:assert/strict';
import {attachProjectState} from '../../src/renderer/js/core/typed/ProjectState.mjs';
import History from '../../src/renderer/js/core/History.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import {planSpriteSheet} from '../../src/renderer/js/graphics/ExportPlan.mjs';
import {textLocalPoint,transformTextAxes} from '../../src/renderer/js/graphics/TextTransform.mjs';
import {makeSelection} from '../../src/renderer/js/tools/SelectionGeometry.mjs';

const bus={on(){},emit(){}};
test('project stores separate document and editor data without duplicating mutable content',()=>{
    const layers=[{id:'one'}],project={name:'A',layers,zoom:3,filePath:'private',undoStack:[],redoStack:[]};
    const state=attachProjectState(project);
    assert.equal(attachProjectState(project),state);assert.equal(state.document.layers,layers);
    assert.equal(state.document.zoom,undefined);assert.equal(state.document.filePath,undefined);
    project.name='B';assert.equal(state.document.name,'B');state.editor.zoom=4;assert.equal(project.zoom,4);
    assert.equal(Object.keys(project).includes('documentState'),false);assert.equal(Object.keys(project).includes('editorState'),false);
});
test('clearing or replacing bound history releases the same stacks exposed by the project',()=>{
    const project={undoStack:[],redoStack:[]},state=attachProjectState(project),history=new History(bus);
    history.bindState(state.editor);history.push({execute(){},undo(){}});
    assert.equal(project.undoStack,history.undoStack);history.undo();assert.equal(project.redoStack,history.redoStack);
    history.clear();assert.deepEqual(project.undoStack,[]);assert.deepEqual(project.redoStack,[]);
    history.bindState({undoStack:[],redoStack:[]});history.push({});assert.equal(project.undoStack.length,0);
});
test('layer array replacement updates its document while detaching preserves other tabs',()=>{
    const manager=new LayerManager(bus),first={layers:[]},second={layers:[]};
    manager.bindDocument(first);manager.layers=[{id:'first'}];assert.equal(first.layers,manager.layers);
    manager.detachDocument();manager.clearLayers();manager.bindDocument(second);manager.layers=[{id:'second'}];
    assert.equal(first.layers[0].id,'first');assert.equal(second.layers[0].id,'second');
});
test('export rejects impossible image sizes and singular text transforms never produce NaN state',()=>{
    for(const width of [NaN,Infinity,0,-1,1.5])assert.throws(()=>planSpriteSheet([{width,height:4}]));
    assert.throws(()=>transformTextAxes({x:0,y:0},()=>({x:0,y:0})),RangeError);
    assert.throws(()=>textLocalPoint({scaleX:1e-200,scaleY:1e-200},{x:1,y:1}),RangeError);
    assert.throws(()=>makeSelection([{x:0,y:0,width:Infinity,height:10}]),RangeError);
});
