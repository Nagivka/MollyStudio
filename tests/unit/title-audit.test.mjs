import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTitleDocument,TITLE_FONTS} from '../../src/renderer/js/core/TitleDocument.mjs';
import {normalizeTitleAppearance,titleMaterialState} from '../../src/renderer/js/core/TitleAppearance.mjs';
import {buildTitleMesh,titleMeshKey} from '../../src/renderer/js/graphics/TitleMesh.mjs';

test('nonuniform subtitle scale acts on model axes before the bottom-row rotation',()=>{
 for(const meshMode of ['original','solid'])for(const text of ['A','Ж']){
  const make=scale=>buildTitleMesh(normalizeTitleDocument({font:'minecraft-ten',text,creeperA:false,meshMode,rows:[{role:'bottom',scale}]}));
  const normal=make([1,1,1]),scaled=make([1,.5,2]),size=mesh=>mesh.baseBounds.max.map((n,i)=>n-mesh.baseBounds.min[i]);
  const a=size(normal),b=size(scaled);assert.ok(Math.abs(b[1]/a[1]-2)<1e-10,meshMode+'/'+text+' local Z');assert.ok(Math.abs(b[2]/a[2]-.5)<1e-10,meshMode+'/'+text+' local Y');
 }
});

test('blank lines never create end caps, orphan scene nodes or background frames',()=>{
 for(const font of TITLE_FONTS)for(const text of ['', ' \n  \n ']){
  const scene=buildTitleMesh(normalizeTitleDocument({font,text,terminators:true}));assert.deepEqual(scene.nodes,[],font);assert.deepEqual(scene.batches,[],font);assert.ok(scene.bounds.min.every(Number.isFinite));
 }
});

test('large embedded images keep material and geometry keys compact and camera-independent',()=>{
 const image='data:image/png;base64,'+'A'.repeat(1024*1024),data=normalizeTitleDocument({appearance:{source:'file',image}}),state=titleMaterialState(data),first=titleMeshKey(data,[state]);
 assert.ok(state.key.length<160);assert.ok(first.length<4096);assert.ok(!first.includes(image));
 assert.equal(titleMeshKey({...data,yaw:40,zoom:200,resolution:4096},[titleMaterialState(data)]),first);
 const changed=normalizeTitleDocument({...data,appearance:{...data.appearance,image:image.slice(0,-1)+'B'}});assert.notEqual(titleMaterialState(changed).key,state.key);
 const copy=normalizeTitleAppearance(data.appearance);copy.image='data:image/png;base64,AA==';assert.notEqual(titleMaterialState({...data,appearance:copy}).key,state.key);
 copy.image='https://example.com/remote.png';assert.equal(normalizeTitleAppearance(copy).image,null);
});

test('switching fonts removes unavailable overlays but preserves embedded overlays',()=>{
 const data=normalizeTitleDocument({font:'minecraft-sga',appearance:{overlay:'not-an-overlay',overlayImage:'data:image/png;base64,AA=='}});
 assert.equal(data.appearance.overlay,'none');assert.equal(data.appearance.overlayImage,'data:image/png;base64,AA==');
});

test('stacked rows keep their gap with different fonts, scale, accents and blank lines',()=>{
 for(const meshMode of ['original','solid'])for(const text of ['ЁЖ\nШРИФТ\nABC','ЁЖ\n\nABC']){
  const scene=buildTitleMesh(normalizeTitleDocument({font:'minecraft-ten-outline',text,layout:'stacked',meshMode,rows:[null,{font:'block-serif',scale:[1,2,1]},{font:'minecraft-five'}]}));
  const rows=scene.nodes.filter(node=>node.type==='row');for(let i=1;i<rows.length;i++)assert.ok(rows[i].baseBounds.max[1]<rows[i-1].baseBounds.min[1],meshMode+'/'+text+' overlap');
 }
});
