// Development only: expose the existing bitmap SmallCaps atlas to native textareas.
const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {PNG}=require('pngjs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const {fontMaps,normalizeBitmapText,resolveBitmapGlyph,bitmapGlyphOffsetY}=await import('../src/renderer/js/utils/FontData.js');
 const {smallCaps}=await import('../src/renderer/js/utils/MinecraftUtilities.mjs');
 const sheets={};for(const [id,name]of Object.entries({smallcaps:'smallcaps',minecraft:'default','minecraft-ten':'ten'}))sheets[id]=PNG.sync.read(await fs.readFile(path.join(root,'src/renderer/assets/images/'+name+'.png')));
 const glyphs={};
 for(const char of new Set([...fontMaps.smallcaps,...fontMaps.minecraft])){
  const actual=normalizeBitmapText(char,'smallcaps'),resolved=resolveBitmapGlyph(actual,'smallcaps');if(resolved.index<0)continue;
  const sheet=sheets[resolved.fontId],offset=bitmapGlyphOffsetY(resolved.fontId,actual),pixels=[];
  for(let y=0;y<8-offset;y++)for(let x=0;x<8;x++)if(sheet.data[((Math.floor(resolved.index/16)*8+y)*sheet.width+resolved.index%16*8+x)*4+3])pixels.push([x,y+offset]);
  const glyph={pixels};glyphs[char]=glyph;const alias=smallCaps(char);if([...alias].length===1)glyphs[alias]=glyph;
 }
 const input=path.join(root,'.test-output/smallcaps-ui.json');await fs.mkdir(path.dirname(input),{recursive:true});await fs.writeFile(input,JSON.stringify(glyphs));
 const result=spawnSync('python',[path.join(__dirname,'build-smallcaps-ui.py'),input,path.join(root,'src/renderer/assets/fonts/SmallCapsUI.woff2'),path.join(root,'.test-output/fonttools')],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)throw Error('Font generation failed. Install scripts/requirements-font-tools.txt into the Python environment.');
 const regular={};
 for(const char of new Set([...fontMaps.minecraft,...fontMaps['minecraft-ten']])){
  const actual=normalizeBitmapText(char,'minecraft'),resolved=resolveBitmapGlyph(actual,'minecraft');if(resolved.index<0)continue;
  const sheet=sheets[resolved.fontId],pixels=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(sheet.data[((Math.floor(resolved.index/16)*8+y)*sheet.width+resolved.index%16*8+x)*4+3])pixels.push([x,y]);
  regular[char]={pixels};
 }
 await fs.writeFile(input,JSON.stringify(regular));
 const normal=spawnSync('python',[path.join(__dirname,'build-smallcaps-ui.py'),input,path.join(root,'src/renderer/assets/fonts/MinecraftBitmapUI.woff2'),path.join(root,'.test-output/fonttools'),'Molly Minecraft Bitmap'],{stdio:'inherit',windowsHide:true});
 if(normal.status!==0)throw Error('Minecraft UI font generation failed');
})().catch(error=>{console.error(error);process.exitCode=1;});
