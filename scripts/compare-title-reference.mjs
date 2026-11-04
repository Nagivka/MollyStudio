/** Developer-only conformance check. The plugin is NEVER loaded by MollyStudio.
 * Pass the downloaded official plugin file explicitly; its pinned hash is checked
 * before running just its two pure model-assembly functions in a restricted VM.
 */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TITLE_FONT_MODELS} from '../src/renderer/js/utils/TitleFontModels.js';
import {TITLE_FONT_CATALOG} from '../src/renderer/js/core/TitleFontCatalog.mjs';
import {normalizeTitleDocument} from '../src/renderer/js/core/TitleDocument.mjs';
import {buildTitleMesh} from '../src/renderer/js/graphics/TitleMesh.mjs';

const manifest=JSON.parse(await fs.readFile(new URL('../src/renderer/assets/title_generator/manifest.json',import.meta.url),'utf8'));
const file=process.argv[2];if(!file)throw Error('Pass the official Minecraft Title Generator plugin file. Source: '+manifest.referencePlugin.source);
const bytes=await fs.readFile(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.referencePlugin.sha256,'Reference plugin checksum mismatch');
const source=bytes.toString('utf8');
const word=source.slice(source.indexOf('  function makeWord('),source.indexOf('  const charMap ='));
const character=source.slice(source.indexOf('  function makeCharacter('),source.indexOf('  const makeName ='));
assert.ok(word.startsWith('  function makeWord(')&&character.startsWith('  function makeCharacter('));
const directions=['north','south','east','west','up','down'];
class Group{
 constructor(name){this.name=name;this.children=[];}
 addTo(parent){if(parent?.children)parent.children.push(this);return this;}
 init(){return this;}
}
class Cube{
 constructor(value){this.from=[...value.from];this.to=[...value.to];this.faces=Object.fromEntries(directions.map(side=>[side,{uv:[...(value.faces?.[side]?.uv||[0,0,0,0])],texture:null}]));}
 addTo(parent){parent.children.push(this);return this;}
 init(){return this;}
}
const quad=(from,to,side)=>{
 const [x0,y0,z0]=from,[x1,y1,z1]=to;
 return {north:[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]],south:[[x0,y1,z1],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1]],east:[[x1,y1,z1],[x1,y0,z1],[x1,y0,z0],[x1,y1,z0]],west:[[x0,y1,z0],[x0,y0,z0],[x0,y0,z1],[x0,y1,z1]],up:[[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],down:[[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]]}[side];
};
const bounds=points=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
const sameCloud=(first,second)=>first.every(p=>second.some(q=>p.every((n,i)=>Math.abs(n-q[i])<1e-8)))&&second.every(p=>first.some(q=>p.every((n,i)=>Math.abs(n-q[i])<1e-8)));
const visibleFace=(cube,side,face)=>{
 if(face.texture===null)return false;
 const q=quad(cube.from,cube.to,side),a=q[1].map((n,i)=>n-q[0][i]),b=q[2].map((n,i)=>n-q[0][i]);return Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-9;
};
let checked=0;
for(const [font,metadata] of Object.entries(TITLE_FONT_CATALOG))for(const text of font.endsWith('cyrillic')?['мп','абвгдеёжзийклмнопрстуфхцчшщъыьэюя']:['ab'])for(const role of ['top','bottom','small'])for(const scale of [[1,1,1],[1.5,.75,1.25]])for(const spacing of [0,3]){
 const data=normalizeTitleDocument({font,text,creeperA:false,spacing,rows:[{font,role,scale,spacing,lineGap:0}]});
 const scene=buildTitleMesh(data),fonts={[font]:{...metadata,type:'font',textureWidth:1000,textureHeight:320,characters:structuredClone(TITLE_FONT_MODELS[font].characters)}};
 const context=vm.createContext({fonts,Group,Cube,charMap:{},makeName:value=>value});
 vm.runInContext(word+'\n'+character,context,{timeout:1000});
 const args={font,texture:'atlas',row:0,type:role,characterSpacing:spacing,rowSpacing:0,scale,disableCharacterShifting:false,elements:[]};
 let prepared=text;
 if(spacing&&fonts[font].characters['\u200b']){prepared=[...prepared].join('\u200b');args.spacerWidth=spacing-1;args.characterSpacing=0;}
 if(metadata.forcedTerminators)prepared=metadata.terminatorSpace?'┫ '+prepared+' ┣':'┫'+prepared+'┣';
 const words=fonts[font].characters[' ']?[prepared]:prepared.split(' ');let offset=0,lastCharacter;
 for(const part of words){const result=context.makeWord(part,offset,new Group('root'),{...args,lastCharacter},part.length);offset=result[1]+((metadata.spaceWidth??8)+args.characterSpacing)*scale[0];lastCharacter=result[2];}
 const points=args.elements.map(cube=>Object.entries(cube.faces).filter(([side,face])=>visibleFace(cube,side,face)).flatMap(([side])=>quad(cube.from,cube.to,side)).map(point=>{
  let [x,y,z]=point;if(role==='bottom')[y,z]=[z,-y];return [-x/4,y/4,-z/4];
 }));
 const expectedBounds=bounds(points.flat()),actualBounds=scene.bounds;
 const expectedCenter=expectedBounds.min.map((n,i)=>(n+expectedBounds.max[i])/2),actualCenter=actualBounds.min.map((n,i)=>(n+actualBounds.max[i])/2);
 const actualParts=new Map(),actualUvs=new Map();for(const batch of scene.batches)for(const triangle of batch.triangles){if(!actualParts.has(triangle.objectId)){actualParts.set(triangle.objectId,[]);actualUvs.set(triangle.objectId,[]);}actualParts.get(triangle.objectId).push(...triangle.points);actualUvs.get(triangle.objectId).push(...triangle.uv);}
 assert.equal(actualParts.size,points.length,font+'/'+role+' cuboid count');
 const actual=[...actualParts.values()];
 const uvs=[...actualUvs.values()];
 for(let i=0;i<points.length;i++){
  const label=font+'/'+role+' scale='+scale+' spacing='+spacing+' cube='+i;
  assert.ok(sameCloud(actual[i].map(p=>p.map((n,a)=>n-actualCenter[a])),points[i].map(p=>p.map((n,a)=>n-expectedCenter[a]))),label+' geometry');
  const expectedUvs=Object.entries(args.elements[i].faces).filter(([side,face])=>visibleFace(args.elements[i],side,face)).flatMap(([,face])=>{const [u0,v0,u1,v1]=face.uv;return [[u0/1000,v0/320],[u0/1000,v1/320],[u1/1000,v1/320],[u1/1000,v0/320]];});
  assert.ok(sameCloud(uvs[i],expectedUvs),label+' UVs');
 }
 checked++;
}
await fs.mkdir(new URL('../.test-output/',import.meta.url),{recursive:true});
const report={passed:true,cases:checked,geometryTolerance:1e-8,uvTolerance:1e-8,version:manifest.referencePlugin.version,sha256:manifest.referencePlugin.sha256};
await fs.writeFile(new URL('../.test-output/title-reference-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
