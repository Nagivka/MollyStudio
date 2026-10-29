import test from 'node:test';
import assert from 'node:assert/strict';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import {pickLayerAt,layerPaintOrder} from '../../src/renderer/js/graphics/LayerPicking.mjs';
import {drawLayers} from '../../src/renderer/js/graphics/LayerCompositing.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

const bitmap=(id,rect=[0,0,32,32])=>{
    const canvas=new RasterCanvas(64,64),ctx=canvas.getContext('2d');ctx.fillStyle='#ff5500';ctx.fillRect(...rect);
    return {id,width:64,height:64,type:'bitmap',visible:true,canvas,ctx};
};
const group=(id,groupId=null)=>({id,groupId,type:'group',isGroup:true,width:64,height:64});
function controls(t,autoSelect=true){
    const previous=globalThis.document;
    globalThis.document={getElementById:id=>id==='move-autosel'?{checked:autoSelect}:null,createElement:()=>new RasterCanvas()};
    t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
}
function resolver(active,hit,{handle=null,inside=true,members=[active]}={}){
    const tool=Object.create(MoveTool.prototype);
    Object.assign(tool,{getEditableLayer:()=>active,findHandleAt:()=>handle,isInsideBox:()=>inside,findLayerAtPoint:()=>hit,getMoveTargets:()=>members});
    return tool;
}

test('a foreground object is picked even inside the active background bounding box',t=>{
    controls(t);const back=bitmap('background'),front=bitmap('foreground',[10,10,8,8]);
    const tool=resolver(back,front);
    assert.deepEqual(tool.resolvePointerTarget(12,12),{target:front,handle:null});
});
test('an unrelated foreground object wins over the active background handle',t=>{
    controls(t);const back=bitmap('background'),front=bitmap('foreground'),handle={id:'se'};
    const tool=resolver(back,front,{handle});
    assert.deepEqual(tool.resolvePointerTarget(32,32),{target:front,handle:null});
    assert.deepEqual(resolver(back,null,{handle}).resolvePointerTarget(32,32),{target:back,handle});
    assert.deepEqual(resolver(back,back,{handle}).resolvePointerTarget(32,32),{target:back,handle});
});
test('disabled auto-selection keeps a manually selected covered object editable',t=>{
    controls(t,false);const back=bitmap('background'),front=bitmap('foreground');
    assert.equal(resolver(back,front).resolvePointerTarget(12,12).target,back);
});
test('a click on a selected companion or group descendant preserves the current move set',t=>{
    controls(t);const active=bitmap('active'),companion=bitmap('companion'),parent=group('group');
    assert.equal(resolver(active,companion,{members:[active,companion]}).resolvePointerTarget(12,12).target,active);
    assert.equal(resolver(parent,companion,{members:[active,companion]}).resolvePointerTarget(12,12).target,parent);
    assert.equal(resolver(parent,bitmap('unrelated'),{members:[active,companion]}).resolvePointerTarget(12,12).target.id,'unrelated');
});
test('clicking a selected companion outside the active box can activate it without inventing a resize handle',t=>{
    controls(t);const active=bitmap('active'),companion=bitmap('companion');
    assert.deepEqual(resolver(active,companion,{inside:false,members:[active,companion]}).resolvePointerTarget(40,40),{target:companion,handle:null});
});
test('pixel picking passes through transparency, hidden, locked and zero-opacity layers',()=>{
    const back=bitmap('back'),front=bitmap('front',[10,10,8,8]);
    assert.equal(pickLayerAt([back,front],12,12),front);
    assert.equal(pickLayerAt([back,front],2,2),back);
    for(const flag of [{visible:false},{locked:true},{opacity:0}]){
        assert.equal(pickLayerAt([back,{...front,...flag}],12,12),back);
    }
    assert.equal(pickLayerAt([back,front],12,12,{canPick:layer=>layer!==front}),back);
});
test('pixel picking excludes the GUI base and floors continuous document coordinates',()=>{
    const base={...bitmap('base'),isBase:true},dot=bitmap('dot',[1,2,1,1]);
    assert.equal(pickLayerAt([base,dot],1.9,2.9),dot);
    assert.equal(pickLayerAt([base,dot],3,3),null);
    for(const [x,y] of [[-.1,0],[0,-.1],[64,0],[NaN,3],[3,Infinity]])assert.equal(pickLayerAt([base,dot],x,y),null);
});
test('nested group picking matches the pixels of the actual compositor rather than raw array order',t=>{
    controls(t);const outer=group('outer'),inner=group('inner','outer');
    const upper=bitmap('upper'),child={...bitmap('child'),groupId:'inner'};
    upper.ctx.fillStyle='#00ff00';upper.ctx.fillRect(0,0,32,32);
    const layers=[outer,upper,inner,child],output=new RasterCanvas(64,64);
    drawLayers(output.getContext('2d'),layers);
    assert.deepEqual(layerPaintOrder(layers),[child,upper]);
    assert.equal(pickLayerAt(layers,12,12),upper);
    assert.deepEqual([...output.getContext('2d').getImageData(12,12,1,1).data],[0,255,0,255]);
});
test('inherited group visibility, opacity and locks are respected when picking',()=>{
    const back=bitmap('back'),outer=group('outer'),inner=group('inner','outer'),child={...bitmap('child'),groupId:'inner'};
    assert.equal(pickLayerAt([back,outer,inner,child],12,12),child);
    for(const flag of [{visible:false},{locked:true},{opacity:0}])assert.equal(pickLayerAt([back,{...outer,...flag},inner,child],12,12),back);
});
