import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeTitleDocument} from '../../src/renderer/js/core/TitleDocument.mjs';
import {buildTitleMesh} from '../../src/renderer/js/graphics/TitleMesh.mjs';

test('every mirrored title resource retains the checksum of its pinned source',async()=>{
 const root=new URL('../../src/renderer/assets/title_generator/',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8'));
 assert.equal(Object.keys(manifest.assetPaths).length,885);
 for(const [source,local] of Object.entries(manifest.assetPaths)){
  const file=new URL(local,root);assert.ok(file.href.startsWith(root.href));
  assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'),manifest.sourceHashes[source],source);
 }
 assert.equal(Object.hasOwn(manifest,'shapes'),false);assert.equal(Object.hasOwn(manifest.materialCatalog,'shapes'),false);
 assert.ok(Object.keys(manifest.sourceHashes).every(path=>!path.startsWith('shapes/')&&path!=='shapes.json'));
});

test('legacy decorative objects are discarded while the title and its transforms remain usable',()=>{
 const value={text:'MOLLY',shapes:[{id:'shape-old',kind:'heart'}],transforms:{'shape-old':{position:[12,3,4]},'shape-old/char-0-61/cube-0':{visible:false},'row-0':{position:[2,3,4]}}};
 const data=normalizeTitleDocument(value);
 assert.equal(Object.hasOwn(data,'shapes'),false);assert.deepEqual(Object.keys(data.transforms),['row-0']);
 assert.deepEqual(normalizeTitleDocument(data),data);
 const scene=buildTitleMesh(data);assert.deepEqual(scene.missing,[]);assert.ok(scene.nodes.length);assert.ok(scene.nodes.every(node=>node.id.startsWith('row-')));
});
