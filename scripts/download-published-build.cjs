const fs=require('node:fs/promises'),fss=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Readable}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {updateTarget,targetReleaseNames}=require('../src/main/update-targets.cjs');
const {readManifest,PUBLIC_KEY}=require('../src/main/update-security.cjs');
const root=path.resolve(__dirname,'..');
async function downloadPublished({version=require('../package.json').version,platform=process.platform,arch=process.arch}={}){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid stable version');const target=updateTarget(platform,arch);if(!target)throw Error('Unsupported release target');
 const base=`https://github.com/Nagivka/MollyStudio-Releases/releases/download/v${version}/`,directory=path.join(root,'dist');await fs.mkdir(directory,{recursive:true});
 const headers={Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN?{Authorization:'Bearer '+process.env.GITHUB_TOKEN}:{})};
 const response=await fetch(`https://api.github.com/repos/Nagivka/MollyStudio-Releases/releases/tags/v${version}`,{headers,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Release API HTTP '+response.status);const release=await response.json();
 if(release.draft||release.prerelease||release.tag_name!==`v${version}`)throw Error('Stable release not found');
 const primary=targetReleaseNames(version,target)[0],names=platform==='darwin'?[primary,primary.replace(/\.zip$/,'.dmg')]:platform==='linux'?[primary,...['deb','rpm','tar.gz'].map(ext=>primary.replace(/\.AppImage$/,'.'+ext))]:[primary,primary+'.blockmap'];
 const verified=[];
 for(const name of names){
  const asset=release.assets.find(a=>a.name===name);if(!asset||asset.state!=='uploaded'||asset.size<1||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||asset.browser_download_url!==base+name)throw Error('Missing or invalid release asset: '+name);
  const final=path.join(directory,name),temporary=final+'.download';const r=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(600000)});if(!r.ok)throw Error('Package download HTTP '+r.status);
  const hash=crypto.createHash('sha256');let bytes=0;async function* chunks(){for await(const chunk of Readable.fromWeb(r.body)){bytes+=chunk.length;if(bytes>asset.size)throw Error('Package size exceeded');hash.update(chunk);yield chunk;}}
  await pipeline(chunks(),fss.createWriteStream(temporary));const sha256=hash.digest('hex');if(bytes!==asset.size||'sha256:'+sha256!==asset.digest)throw Error('Published package hash mismatch');await fs.rename(temporary,final);if(platform==='linux'&&name.endsWith('.AppImage'))await fs.chmod(final,0o755);
  if(!name.endsWith('.blockmap')){const c=await fetch(base+name+'.sha256');if(!c.ok||(await c.text()).trim()!==`${sha256}  ${name}`)throw Error('Published checksum mismatch');}
  verified.push({name,size:bytes,sha256});
 }
 if(platform!=='darwin'){
  const r=await fetch(base+target.manifest);if(!r.ok)throw Error('Missing signed update manifest');const manifest=readManifest(await r.text(),version,PUBLIC_KEY,target);
  for(const file of verified){const entry=manifest.files.find(f=>f.name===file.name);if(entry&&(entry.sha256!==file.sha256||entry.size!==file.size))throw Error('Signed package hash mismatch');}
 }
 const unpacked=platform==='darwin'?`dist/published-mac-${arch}/MollyStudio.app`:platform==='linux'?'dist/linux-unpacked':'dist/published-win';
 const report={version,platform,arch,unpacked,downloadedFrom:release.html_url,files:verified,verifiedAt:new Date().toISOString()};
 await fs.writeFile(path.join(directory,`build-${platform}-${arch}.json`),JSON.stringify(report,null,2));await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/published-build-download.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
}
if(require.main===module)downloadPublished().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={downloadPublished};
