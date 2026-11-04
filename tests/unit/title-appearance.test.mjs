import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeTitleAppearance,titleMaterialRecord,titleMaterialState} from '../../src/renderer/js/core/TitleAppearance.mjs';
import {normalizeTitleDocument,titleRowSettings} from '../../src/renderer/js/core/TitleDocument.mjs';
import {TITLE_FONT_CATALOG} from '../../src/renderer/js/core/TitleFontCatalog.mjs';
import {TITLE_MATERIAL_CATALOG} from '../../src/renderer/js/core/TitleMaterialCatalog.mjs';
import {TITLE_FONT_MODELS} from '../../src/renderer/js/utils/TitleFontModels.js';
import {buildTitleMesh} from '../../src/renderer/js/graphics/TitleMesh.mjs';

test('all registered source materials, overlays and tileables are bundled unchanged',async()=>{
 const catalog=TITLE_MATERIAL_CATALOG;
 assert.equal(Object.keys(catalog.fonts).length,13);
 assert.equal(Object.values(catalog.fonts).reduce((n,font)=>n+font.textures.length,0),309);
 assert.equal(Object.values(catalog.fonts).reduce((n,font)=>n+font.overlays.length,0),58);
 assert.equal(Object.keys(catalog.tileables).length,148);
 const base=new URL('../../src/renderer/assets/title_generator/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('manifest.json',base),'utf8'));
 for(const [source,asset] of Object.entries(manifest.assetPaths)){
  const bytes=await fs.readFile(new URL(asset,base));assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sourceHashes[source],asset);
 }
 for(const [font,entry] of Object.entries(catalog.fonts)){
  assert.equal(new Set(entry.textures.map(item=>item.id)).size,entry.textures.length);
  assert.deepEqual(entry.textures.map(item=>item.id),TITLE_FONT_CATALOG[font].materials);
  for(const item of entry.textures){assert.equal(titleMaterialRecord(font,item.id),item);assert.ok(item.author&&item.sourceId&&item.asset);}
 }
});

test('appearance normalization bounds files and color operations without changing stop identities',()=>{
 const appearance=normalizeTitleAppearance({source:'eval()',stops:[{color:'url(x)',at:4},{color:'#112233',at:-1}],hue:Infinity,saturation:999,tileScale:0,overlayOpacity:-5,image:'https://example.com/private.png',overlayImage:'data:text/html;base64,PHNjcmlwdD4=',tintBlend:'invalid'});
 assert.equal(appearance.source,'texture');assert.equal(appearance.stops[0].at,1);assert.equal(appearance.stops[1].at,0);
 assert.equal(appearance.saturation,200);assert.equal(appearance.tileScale,.05);assert.equal(appearance.overlayOpacity,0);
 assert.equal(appearance.image,null);assert.equal(appearance.overlayImage,null);assert.equal(appearance.tintBlend,'multiply');
 assert.deepEqual(normalizeTitleAppearance(appearance),appearance);
 assert.equal(normalizeTitleAppearance({image:'data:image/png;base64,AA=='}).image,'data:image/png;base64,AA==');
});

test('row-specific settings remain independent and survive normalization',()=>{
 const data=normalizeTitleDocument({font:'minecraft-ten',text:'ONE\nTWO\nTHREE',rows:[null,{font:'minecraft-five-bold',texture:'gold',role:'small',scale:[2,.5,1],appearance:{source:'gradient',hue:25}},null]});
 assert.equal(titleRowSettings(data,0).font,'minecraft-ten');assert.equal(titleRowSettings(data,1).font,'minecraft-five-bold');assert.equal(titleRowSettings(data,1).role,'small');assert.equal(titleRowSettings(data,1).appearance.hue,25);
 assert.deepEqual(titleRowSettings(data,1).scale,[2,.5,1]);assert.equal(titleRowSettings(data,2).font,'minecraft-ten');assert.deepEqual(normalizeTitleDocument(data),data);
});

test('native mode retains source cuboid counts, signed bounds and exact face UVs',()=>{
 for(const font of ['minecraft-ten','minecraft-five-bold','minecraft-dungeons']){
  const data=normalizeTitleDocument({font,text:'A',creeperA:false}),scene=buildTitleMesh(data),source=TITLE_FONT_MODELS[font].characters.a;
  assert.equal(data.meshMode,'original');assert.equal(scene.nodes.filter(node=>node.type==='cube').length,source.length);
  const cube=scene.nodes.find(node=>node.type==='cube'),expected=source[0].to.map((n,i)=>Math.abs(n-source[0].from[i])/4);
  assert.deepEqual(cube.bounds.max.map((n,i)=>n-cube.bounds.min[i]),expected);
  const first=scene.batches.flatMap(batch=>batch.triangles).find(t=>t.objectId===cube.id),uv=source[0].faces.north;
  assert.deepEqual(first.uv,[[uv[0]/16,uv[1]/16],[uv[0]/16,uv[3]/16],[uv[2]/16,uv[3]/16]]);
 }
});

test('source spacers, forced terminators and font-specific default spacing work',()=>{
 const data=normalizeTitleDocument({font:'minecraft-five-bold-block',text:'AB',spacing:4}),scene=buildTitleMesh(data);
 assert.ok(scene.nodes.some(node=>node.type==='glyph'&&node.id.includes('-200b')));
 assert.ok(scene.nodes.some(node=>node.type==='glyph'&&node.id.includes('-252b')));
 assert.ok(scene.nodes.some(node=>node.type==='glyph'&&node.id.includes('-2523')));
 assert.equal(normalizeTitleDocument({font:'minecraft-sga'}).spacing,5);assert.equal(normalizeTitleDocument({font:'minecraft-sga',spacing:0}).spacing,0);
});

test('material identities depend on appearance, not camera or object position',()=>{
 const data=normalizeTitleDocument({appearance:{source:'gradient',stops:[{color:'#FF0000',at:0},{color:'#0000FF',at:1}]}}),first=titleMaterialState(data).key;
 assert.equal(titleMaterialState({...data,yaw:80,transforms:{'row-0':{position:[0,30,0]}}}).key,first);
 assert.notEqual(titleMaterialState({...data,appearance:{...data.appearance,hue:25}}).key,first);
 assert.notEqual(titleMaterialState({...data,texture:'gold'}).key,first);
});
