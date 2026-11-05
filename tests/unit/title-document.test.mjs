import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTitleDocument,normalizeTitleTransform,TITLE_FONTS,titleMaterials,titleRowSettings,addTitleRow,removeTitleRow,replaceTitleText} from '../../src/renderer/js/core/TitleDocument.mjs';
import {TITLE_FONT_CATALOG} from '../../src/renderer/js/core/TitleFontCatalog.mjs';
import {createProjectFromForm,buildEditorUrl} from '../../src/renderer/js/core/ProjectFactory.mjs';
import {readDocumentState} from '../../src/renderer/js/core/typed/DocumentState.mjs';
import {buildTitleMesh,resolveTitleGlyph} from '../../src/renderer/js/graphics/TitleMesh.mjs';
import {TITLE_FONT_MODELS} from '../../src/renderer/js/utils/TitleFontModels.js';
import {createTitleBlockbenchModel} from '../../src/renderer/js/graphics/TitleModelExport.mjs';
import {titleOutputPlan,titleEditingPlan,fitTitleFrame,turnTitlePoint} from '../../src/renderer/js/graphics/TitleCamera.mjs';
test('title settings bound malformed files and preserve Cyrillic',()=>{
 const data=normalizeTitleDocument({text:('Привет'.repeat(30)+'\n').repeat(8),depth:Infinity,scale:999,pitch:-999,top:'url(x)',font:'invalid'});
 assert.equal(data.text.split('\n').length,3);assert.ok(data.text.split('\n').every(line=>[...line].length<=64));
 assert.equal(data.depth,22);assert.equal(data.pitch,-80);assert.equal(data.top,'#BEB9AA');assert.equal(data.font,'minecraft-ten-cyrillic');
 assert.equal(normalizeTitleDocument().projection,'perspective');assert.equal(normalizeTitleDocument({projection:'orthographic'}).projection,'orthographic');
 assert.deepEqual(normalizeTitleDocument(data),data);
});

test('whole-title settings read the shared defaults independently of a first-row override',()=>{
 const data=normalizeTitleDocument({text:'MOLLY\nSTUDIO',font:'minecraft-ten',texture:'stone',spacing:2,rows:[{font:'minecraft-five-bold',texture:'gold',spacing:5,appearance:{source:'gradient'}},null,null]});
 const before=structuredClone(data),shared=titleRowSettings(data,-1),first=titleRowSettings(data,0);
 assert.equal(shared.font,data.font);assert.equal(shared.texture,data.texture);assert.equal(shared.spacing,2);assert.equal(shared.appearance.source,'texture');
 assert.equal(first.font,'minecraft-five-bold');assert.equal(first.texture,'gold');assert.equal(first.spacing,5);assert.equal(first.appearance.source,'gradient');
 assert.equal(titleRowSettings(data,1).font,shared.font);assert.deepEqual(data,before);
});

test('adding and deleting headings preserves remaining settings, languages and object transforms',()=>{
 const data=normalizeTitleDocument({text:'ONE\nTWO\nTHREE',rowLanguages:['en','en','en'],rows:[null,{font:'minecraft-five-bold'},null],transforms:{'row-1/char-0-54':{position:[1,2,3]},'row-2':{position:[4,5,6]}}});
 const before=structuredClone(data),removed=removeTitleRow(data,0);
 assert.equal(removed.text,'TWO\nTHREE');assert.equal(removed.rows[0].font,'minecraft-five-bold');
 assert.equal(removed.rows[0].role,'bottom');assert.equal(removed.rows[1].role,'small');
 assert.deepEqual(removed.transforms['row-0/char-0-54'].position,[1,2,3]);assert.deepEqual(removed.transforms['row-1'].position,[4,5,6]);assert.deepEqual(data,before);
 assert.equal(addTitleRow(data),null);assert.equal(removeTitleRow(data,-1),null);
 const single=removeTitleRow(removed,1),added=addTitleRow(single);
 assert.equal(added.text,'TWO\n');assert.equal(added.layout,'stacked');assert.equal(added.rows[0].role,'bottom');assert.equal(added.rows[1].role,'top');assert.equal(removeTitleRow(single,0),null);
 const centered=buildTitleMesh(normalizeTitleDocument({text:'TITLE',rows:[{role:'top'}]}));
 assert.ok(Math.abs(centered.baseBounds.min[1]+centered.baseBounds.max[1])<1e-8);
});

test('row structure changes keep inherited subtitle materials and effective appearance',()=>{
 const data=normalizeTitleDocument({text:'FIRST\nSECOND',texture:'stone',subtitleTexture:'gold',depth:31,creeperA:false,appearance:{source:'gradient',hue:17}});
 const expected=titleRowSettings(data,1),added=addTitleRow(data),removed=removeTitleRow(data,0);
 for(const [value,index] of [[added,1],[removed,0]]){
  const actual=titleRowSettings(value,index);
  for(const key of ['texture','font','role','depth','creeperA','appearance','scale'])assert.deepEqual(actual[key],expected[key],key);
 }
});

test('letter and cuboid transforms follow surviving text across insertion, case changes and deletion',()=>{
 const data=normalizeTitleDocument({text:'ABBA',transforms:{'row-0':{position:[1,0,0]},'row-0/char-1-42':{position:[2,0,0]},'row-0/char-1-42/cube-0':{scale:[2,2,2]},'row-0/char-3-41':{position:[3,0,0]}}});
 const inserted=replaceTitleText(data,'XAbBA');
 assert.deepEqual(inserted.transforms['row-0/char-2-62'].position,[2,0,0]);
 assert.deepEqual(inserted.transforms['row-0/char-2-62/cube-0'].scale,[2,2,2]);
 assert.deepEqual(inserted.transforms['row-0/char-4-41'].position,[3,0,0]);
 const deleted=replaceTitleText(data,'AA');
 assert.deepEqual(Object.keys(deleted.transforms).sort(),['row-0','row-0/char-1-41']);
 assert.deepEqual(deleted.transforms['row-0/char-1-41'].position,[3,0,0]);
 assert.ok(data.transforms['row-0/char-1-42']);
});

test('custom output dimensions preserve camera projection and keep tiny frames valid',()=>{
 for(const projection of ['perspective','orthographic'])for(const [width,height] of [[1537,863],[33,17],[1,1]]){
  const data=normalizeTitleDocument({text:'TITLE',projection,resolution:width,output:'custom',outputHeight:height,padding:128});
  const mesh=buildTitleMesh(data),plan=titleOutputPlan(mesh.bounds,data,mesh.baseBounds);
  assert.equal(plan.width,width);assert.equal(plan.height,height);assert.equal(plan.ratio,width/height);
  assert.ok(Number.isFinite(plan.halfHeight)&&plan.halfHeight>0);
 }
});

test('automatic image height stays inside editable document limits while custom export permits taller images',()=>{
 const bounds={min:[-1,-500,0],max:[1,500,1]},data=normalizeTitleDocument({resolution:2048,projection:'orthographic'});
 assert.equal(titleOutputPlan(bounds,data).height,4096);
 assert.equal(titleOutputPlan(bounds,{...data,output:'custom',outputHeight:8192}).height,8192);
});

test('the complete reference catalog uses real, independently authored font models',()=>{
 assert.equal(TITLE_FONTS.length,13);assert.deepEqual(new Set(TITLE_FONTS),new Set(Object.keys(TITLE_FONT_MODELS)));
 for(const font of TITLE_FONTS){
  const data=normalizeTitleDocument({font,text:font.endsWith('cyrillic')?'ПРИВЕТ 123':'MINECRAFT 123'}),model=TITLE_FONT_MODELS[font];
  assert.equal(data.font,font);assert.ok(Object.keys(model.profiles).length>=26);assert.ok(TITLE_FONT_CATALOG[font].height>0);
  assert.deepEqual(buildTitleMesh(data).missing,[]);assert.ok(titleMaterials(font).includes(data.texture));
 }
 assert.equal(resolveTitleGlyph('minecraft-five-bold','Ж').font,'minecraft-ten-cyrillic');
 assert.equal(resolveTitleGlyph('minecraft-five-bold-cyrillic','B').font,'minecraft-five-bold');
 assert.equal(resolveTitleGlyph('minecraft-ten-v2','Ж').font,'minecraft-ten-cyrillic');
 assert.equal(resolveTitleGlyph('minecraft-ten-cyrillic','B').font,'minecraft-ten');
 assert.equal(resolveTitleGlyph('minecraft-sga','B').font,'minecraft-sga');
 assert.notDeepEqual(resolveTitleGlyph('minecraft-ten','&').profile,resolveTitleGlyph('minecraft-ten-v2','&').profile);
});

test('every generated letter body and contour is a closed outward-facing volume',()=>{
 const sub=(a,b)=>a.map((n,i)=>n-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
 for(const font of TITLE_FONTS)for(const input of Object.keys(TITLE_FONT_MODELS[font].profiles)){
  if(input===' ')continue;
  const data=normalizeTitleDocument({font,text:input,creeperA:false,depth:22,meshMode:'solid'}),scene=buildTitleMesh(data),parts=new Map();
  for(const batch of scene.batches)for(const t of batch.triangles){
   const part=parts.get(t.objectId)||{flux:[0,0,0],volume:0};parts.set(t.objectId,part);
   const [a,b,c]=t.points,n=cross(sub(b,a),sub(c,a));
   part.flux=part.flux.map((value,i)=>value+n[i]);part.volume+=dot(a,cross(b,c))/6;
  }
  assert.ok(parts.size>0,font+' '+input+' has actual geometry');
  for(const part of parts.values()){
   assert.ok(part.flux.every(n=>Math.abs(n)<1e-7),font+' '+input+' has no open or reversed walls');
   assert.ok(part.volume>0,font+' '+input+' has outward-facing surfaces');
  }
 }
});

test('letter caps partition the exact silhouette without overlapping sheets',()=>{
 for(const font of TITLE_FONTS)for(const profile of Object.values(TITLE_FONT_MODELS[font].profiles)){
  const occupied=new Set();
  for(const [x0,y0,x1,y1] of profile.caps)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const key=x+','+y;assert.ok(!occupied.has(key),'Body caps must not overlap');occupied.add(key);
  }
  for(const [x0,y0,x1,y1] of profile.ring)for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)assert.ok(!occupied.has(x+','+y),'Outline caps must not cover the letter');
 }
 const zero=buildTitleMesh(normalizeTitleDocument({text:'A',depth:0}));assert.ok(zero.batches.every(b=>b.vertices.every(Number.isFinite)));
});

test('adjoining triangles share matching edges, including holes and all three row roles',()=>{
 for(const font of TITLE_FONTS){
  const scene=buildTitleMesh(normalizeTitleDocument({font,text:'ARC?\nПЙЩ\nEDIT',creeperA:true,meshMode:'solid'})),parts=new Map();
  for(const batch of scene.batches)for(const triangle of batch.triangles){
   let edges=parts.get(triangle.objectId);if(!edges)parts.set(triangle.objectId,edges=new Map());
   const points=triangle.points.map(point=>point.map(n=>n.toFixed(7)).join(','));
   for(let i=0;i<3;i++){
    const a=points[i],b=points[(i+1)%3],key=a<b?a+'>'+b:b+'>'+a;
    edges.set(key,(edges.get(key)||0)+(a<b?1:-1));
   }
  }
  for(const [id,edges] of parts)assert.ok([...edges.values()].every(n=>n===0),font+' '+id+' has unmatched triangle edges');
 }
});
test('original title models produce finite geometry, unit normals and UV coordinates',()=>{
 const data=normalizeTitleDocument({text:'MOLLY\nСТУДИЯ\nJAVA EDITION'}),mesh=buildTitleMesh(data);
 assert.deepEqual(mesh.missing,[]);assert.ok(mesh.batches.some(batch=>batch.texture.includes('cyrillic')));
 for(const batch of mesh.batches){
  assert.equal(batch.vertices.length%24,0);
  assert.ok(batch.vertices.every(Number.isFinite));
  for(let i=0;i<batch.vertices.length;i+=8){assert.ok(Math.abs(Math.hypot(...batch.vertices.slice(i+3,i+6))-1)<1e-6);assert.ok(batch.vertices.slice(i+6,i+8).every(n=>n>=0&&n<=1));}
 }
 assert.ok(mesh.bounds.min.every((value,axis)=>value<mesh.bounds.max[axis]));
});
test('font and layout choices change actual geometry; unsupported characters are reported',()=>{
 const first=buildTitleMesh(normalizeTitleDocument({text:'TITLE\nSTUDIO',layout:'logo'}));
 const stacked=buildTitleMesh(normalizeTitleDocument({text:'TITLE\nSTUDIO',layout:'stacked'}));
 assert.notDeepEqual(first.bounds,stacked.bounds);
 for(const font of ['minecraft-ten','minecraft-five-bold','minecraft-dungeons']){
  const mesh=buildTitleMesh(normalizeTitleDocument({font,text:'Hello 123!?\nПривет'}));
  assert.deepEqual(mesh.missing,[]);assert.ok(mesh.batches.length>0);
 }
 assert.ok(TITLE_FONT_MODELS['minecraft-ten'].characters['😳']);
 assert.notDeepEqual(buildTitleMesh(normalizeTitleDocument({text:'A',creeperA:true})),buildTitleMesh(normalizeTitleDocument({text:'A',creeperA:false})));
 assert.deepEqual(buildTitleMesh(normalizeTitleDocument({text:'🚀'})).missing,['🚀']);
 assert.deepEqual(buildTitleMesh(normalizeTitleDocument({text:''})).batches,[]);
});
test('title creation and canonical serialization retain editable parameters',()=>{
 const source={getElementById:id=>id==='new-title-name'?{value:'Сервер'}:null};
 const project=createProjectFromForm(source,'title');assert.equal(project.type,'title');assert.equal(project.name,'Сервер');
 assert.match(buildEditorUrl(project),/type=title/);
 const titleData=normalizeTitleDocument({text:'ПРИВЕТ'}),state=readDocumentState({...project,config:{width:256,height:64},titleData});
 assert.deepEqual(state.titleData,titleData);assert.notEqual(state.titleData,titleData);
});

test('every letter owns stable, independent cuboids and hierarchical transforms',()=>{
 const data=normalizeTitleDocument({text:'AB'}),initial=buildTitleMesh(data),letters=initial.nodes.filter(n=>n.type==='glyph');
 assert.equal(letters.length,2);assert.notEqual(letters[0].id,letters[1].id);
 const first=letters[0],second=letters[1],cubes=initial.nodes.filter(n=>n.parent===first.id);
 assert.ok(cubes.length>0);assert.ok(initial.batches.every(b=>b.triangles.every(t=>t.glyphId&&t.objectId)));
 const shifted=buildTitleMesh({...data,transforms:{[first.id]:normalizeTitleTransform({position:[3,4,5],rotation:[0,20,0]})}});
 assert.notDeepEqual(shifted.nodes.find(n=>n.id===first.id).bounds,first.bounds);
 assert.deepEqual(shifted.nodes.find(n=>n.id===second.id).bounds,second.bounds);
 const shiftedCube=buildTitleMesh({...data,transforms:{[cubes[0].id]:normalizeTitleTransform({scale:[2,1,1]})}});
 assert.notDeepEqual(shiftedCube.nodes.find(n=>n.id===cubes[0].id).bounds,cubes[0].bounds);
 for(const cube of cubes.slice(1))assert.deepEqual(shiftedCube.nodes.find(n=>n.id===cube.id).bounds,cube.bounds);
 const hidden=buildTitleMesh({...data,transforms:{[first.id]:normalizeTitleTransform({visible:false})}});
 assert.ok(hidden.batches.every(b=>b.triangles.every(t=>t.glyphId!==first.id)));
 const rowShifted=buildTitleMesh({...data,transforms:{'row-0':normalizeTitleTransform({position:[1,2,3]})}});
 for(const letter of letters)assert.deepEqual(rowShifted.nodes.find(n=>n.id===letter.id).bounds.min,letter.bounds.min.map((n,i)=>n+[1,2,3][i]));
});

test('3D object parameters reject corrupt transforms and retain decimal precision',()=>{
 const value=normalizeTitleDocument({transforms:{'__proto__':{},'row-0/char-0-41':{position:[.12345,Infinity,99999],rotation:[999,0,-999],scale:[0,NaN,100],visible:false,locked:true},bad:{}}});
 assert.deepEqual(Object.keys(value.transforms),['row-0/char-0-41']);
 assert.deepEqual(value.transforms['row-0/char-0-41'],{position:[.123,0,4096],rotation:[180,0,-180],scale:[.01,1,20],visible:false,locked:true});
 assert.deepEqual(normalizeTitleDocument(value),value);
});

test('PNG camera has one canonical aspect and fits every window without changing its projection',()=>{
 for(const projection of ['perspective','orthographic'])for(const output of ['auto','square']){
  const data=normalizeTitleDocument({text:'MINECRAFT\nСТУДИЯ',projection,output}),scene=buildTitleMesh(data),plan=titleOutputPlan(scene.bounds,data);
  assert.equal(plan.width,2048);assert.equal(plan.ratio,plan.width/plan.height);assert.equal(plan.perspective,projection==='perspective');
  if(output==='square')assert.equal(plan.width,plan.height);
  assert.ok([plan.halfHeight,plan.distance,plan.tangent,plan.depth].every(n=>Number.isFinite(n)&&n>0));
  for(const [width,height] of [[800,450],[1280,900],[1920,1080],[300,700]]){
   const frame=fitTitleFrame(width,height,plan.width,plan.height);
   assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.width<=width+1&&frame.y+frame.height<=height+1);
   assert.ok(Math.abs(frame.width-frame.height*plan.ratio)<plan.ratio+1);
  }
 }
});

test('export is a uniform crop of the editing camera, including wide titles and moved letters',()=>{
 for(const projection of ['perspective','orthographic'])for(const text of ['MINECRAFT','ABCDEFGHIJKLMN\nСТУДИЯ']){
  const data=normalizeTitleDocument({text,projection,cameraTarget:[2.125,-1.375,0],yaw:18.375,pitch:-24.125});
  const initial=buildTitleMesh(data),id=initial.nodes.find(n=>n.type==='glyph').id;
  const scene=buildTitleMesh({...data,transforms:{[id]:normalizeTitleTransform({position:[3,2,4]})}});
  const output=titleOutputPlan(scene.bounds,data,scene.baseBounds);
  const project=(point,plan)=>{
   const p=turnTitlePoint(point.map((n,i)=>n-plan.target[i]),plan.yaw,plan.pitch),s=plan.shift||[0,0];
   return plan.perspective?[(p[0]/(plan.distance-p[2])-s[0])/(plan.tangent*plan.ratio),(p[1]/(plan.distance-p[2])-s[1])/plan.tangent]:[(p[0]-s[0])/(plan.halfHeight*plan.ratio),(p[1]-s[1])/plan.halfHeight];
  };
  const points=scene.batches.flatMap(b=>b.triangles.flatMap(t=>t.points)).slice(0,60);
  for(const [width,height] of [[870,550],[1280,900],[300,700]]){
   const edit=titleEditingPlan(scene.bounds,scene.baseBounds,data,width,height);
   assert.equal(output.distance,edit.distance);assert.deepEqual(output.target,edit.target);
   const scale=output.perspective?edit.tangent/output.tangent*output.height/edit.height:edit.halfHeight/output.halfHeight*output.height/edit.height;
   const e=project(points[0],edit).map((n,i)=>n*[edit.width,edit.height][i]/2),o=project(points[0],output).map((n,i)=>n*[output.width,output.height][i]/2);
   for(const point of points){const a=project(point,edit),b=project(point,output);for(let i=0;i<2;i++)assert.ok(Math.abs((a[i]*[edit.width,edit.height][i]/2-e[i])*scale-(b[i]*[output.width,output.height][i]/2-o[i]))<1e-7);}
  }
 }
});

test('an object pivot inherits its parent transform and stays fixed during its own rotation',()=>{
 const data=normalizeTitleDocument({text:'AB'}),scene=buildTitleMesh(data),letter=scene.nodes.find(n=>n.type==='glyph');
 const changed=buildTitleMesh({...data,transforms:{[letter.id]:normalizeTitleTransform({rotation:[30,20,10],scale:[2,3,4]}),'row-0':normalizeTitleTransform({position:[2,3,4]})}});
 assert.deepEqual(changed.nodes.find(n=>n.id===letter.id).worldPivot,letter.pivot.map((n,i)=>n+[2,3,4][i]));
});

test('Blockbench export embeds materials and separate row, letter and cuboid objects',()=>{
 const scene=buildTitleMesh(normalizeTitleDocument({text:'AB'}));
 const images=Object.fromEntries(scene.batches.map(b=>[b.texture,{width:1000,height:320,source:'data:image/png;base64,AA=='}]));
 const model=createTitleBlockbenchModel(scene,images,'Model');
 assert.equal(model.meta.model_format,'free');assert.equal(model.outliner.length,1);assert.equal(model.outliner[0].children.length,2);
 assert.equal(model.elements.length,scene.nodes.filter(n=>n.type==='cube').length);
 assert.ok(model.elements.every(e=>e.type==='mesh'&&Object.keys(e.faces).length>0));
 for(const element of model.elements){
  const points=Object.values(element.vertices).map(p=>p.join(','));
  assert.equal(points.length,new Set(points).size,'Export must weld shared vertices, retaining per-face UVs');
 }
 assert.ok(model.textures.every(t=>t.source.startsWith('data:image/png;base64,')&&t.render_sides==='front'));
 const hidden=buildTitleMesh(normalizeTitleDocument({text:'AB',transforms:{'row-0':normalizeTitleTransform({visible:false})}})),hiddenModel=createTitleBlockbenchModel(hidden,images,'Hidden');
 assert.equal(hiddenModel.elements.length,model.elements.length);assert.equal(hiddenModel.outliner[0].visibility,false);
 const ids=model.elements.map(e=>e.uuid);assert.equal(new Set(ids).size,ids.length);
});
