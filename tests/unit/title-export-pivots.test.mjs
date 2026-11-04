import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTitleDocument,normalizeTitleTransform} from '../../src/renderer/js/core/TitleDocument.mjs';
import {buildTitleMesh} from '../../src/renderer/js/graphics/TitleMesh.mjs';
import {createTitleBlockbenchModel} from '../../src/renderer/js/graphics/TitleModelExport.mjs';
import TitleRenderer from '../../src/renderer/js/graphics/TitleRenderer.js';

test('Blockbench meshes retain their moved pivots and exact visible world geometry',()=>{
 const data=normalizeTitleDocument({text:'AB\nCD',layout:'stacked'}),initial=buildTitleMesh(data),letter=initial.nodes.find(node=>node.type==='glyph');
 data.transforms={'row-0':normalizeTitleTransform({position:[4,3,2],rotation:[20,35,15],scale:[1.25,.75,2]}),[letter.id]:normalizeTitleTransform({position:[2,4,6],rotation:[10,25,30]})};
 const scene=buildTitleMesh(data),images=Object.fromEntries(scene.modelBatches.map(batch=>[batch.texture,{width:1000,height:320,source:'data:image/png;base64,AA=='}])),model=createTitleBlockbenchModel(scene,images),nodes=scene.nodes.filter(node=>node.type==='cube');
 const convert=point=>point.map((n,i)=>n*4*(i===1?1:-1)),near=(a,b)=>a.every((n,i)=>Math.abs(n-b[i])<2e-6);
 model.elements.forEach((element,index)=>{
  const node=nodes[index];assert.ok(near(element.origin,convert(node.worldPivot)),node.id+' exports its actual pivot');
  const points=scene.modelBatches.flatMap(batch=>batch.triangles.filter(triangle=>triangle.objectId===node.id).flatMap(triangle=>triangle.points)).map(convert);
  const exported=Object.values(element.vertices).map(point=>point.map((n,i)=>n+element.origin[i]));
  assert.ok(points.every(point=>exported.some(other=>near(point,other)))&&exported.every(point=>points.some(other=>near(point,other))),node.id+' keeps world positions');
 });
 const roots=scene.nodes.filter(node=>!node.parent);model.outliner.forEach((group,index)=>assert.ok(near(group.origin,convert(roots[index].worldPivot)),'Group pivots follow the edited scene'));
});

test('camera panning uses the visible PNG frame rather than its surrounding letterbox',()=>{
 for(const perspective of [false,true])for(const frame of [{x:0,y:200,width:800,height:200},{x:300,y:0,width:200,height:600}]){
  const plan={width:800,height:600,frame,ratio:frame.width/frame.height,halfHeight:2,perspective,distance:10,tangent:.2};
  const renderer={lastPlan:plan,unturn:value=>value},dx=40/800,dy=30/600;
  const delta=TitleRenderer.prototype.screenDelta.call(renderer,dx,dy);
  assert.ok(Math.abs(delta[0]-40/frame.width*4*plan.ratio)<1e-8);
  assert.ok(Math.abs(delta[1]+30/frame.height*4)<1e-8);
 }
});

test('an axis query outside the PNG frame has no intersection',()=>{
 assert.equal(TitleRenderer.prototype.axisParameter.call({screenRay:()=>null},0,0,[0,0,0],0),null);
});
