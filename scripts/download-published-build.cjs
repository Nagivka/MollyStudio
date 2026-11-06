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
 const primary=targetReleaseNames(version,target)[0],names=platform==='darwin'?[primary.replace(/\.zip$/,'.dmg')]:platform==='linux'?[primary,...['deb','rpm'].map(ext=>primary.replace(/\.AppImage$/,'.'+ext))]:[primary,primary+'.blockmap'];
 const optional=platform==='darwin'?primary:platform==='linux'?primary.replace(/\.AppImage$/,'.tar.gz'):null;
 if(optional&&release.assets.some(a=>a.name===optional))names.push(optional);
 const checksums=new Map();if(release.assets.some(a=>a.name==='SHA256SUMS.txt')){
  const c=await fetch(base+'SHA256SUMS.txt',{signal:AbortSignal.timeout(30000)});if(!c.ok)throw Error('Published checksum list is unavailable');
  for(const line of (await c.text()).trim().split(/\r?\n/)){const match=/^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);if(!match||checksums.has(match[2]))throw Error('Invalid checksum list');checksums.set(match[2],match[1]);}
 }
 const signedFiles = new Map();
 if (platform !== 'darwin') {
  const response = await fetch(base + target.manifest, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Missing signed update manifest');
  const manifest = readManifest(await response.text(), version, PUBLIC_KEY, target);
  for (const file of manifest.files) signedFiles.set(file.name, file);
  const metadata = await fetch(base + target.metadata, {signal: AbortSignal.timeout(30000)});
  if (!metadata.ok) throw Error('Missing signed update metadata');
  const bytes = Buffer.from(await metadata.arrayBuffer());
  const expected = signedFiles.get(target.metadata);
  if (bytes.length !== expected.size || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
   throw Error('Signed update metadata mismatch');
  }
 }
 const verified=[];
 for(const name of names){
  const asset=release.assets.find(a=>a.name===name);if(!asset||asset.state!=='uploaded'||asset.size<1||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||asset.browser_download_url!==base+name)throw Error('Missing or invalid release asset: '+name);
  const sha256 = asset.digest.slice('sha256:'.length);
  const signed = signedFiles.get(name);
  if (signed && (signed.sha256 !== sha256 || signed.size !== asset.size)) throw Error('Signed package hash mismatch');
  if(!name.endsWith('.blockmap')){
   if(checksums.has(name)){if(checksums.get(name)!==sha256)throw Error('Published checksum list mismatch');}
   else{const c=await fetch(base+name+'.sha256',{signal:AbortSignal.timeout(30000)});if(!c.ok||(await c.text()).trim()!==`${sha256}  ${name}`)throw Error('Published checksum mismatch');}
  }
  const final = path.join(directory, name);
  const temporary = final + '.' + crypto.randomUUID() + '.download';
  const download = await fetch(asset.browser_download_url, {signal: AbortSignal.timeout(600000)});
  if (!download.ok) throw Error('Package download HTTP ' + download.status);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  async function* chunks() {
   for await (const chunk of Readable.fromWeb(download.body)) {
    bytes += chunk.length;
    if (bytes > asset.size) throw Error('Package size exceeded');
    hash.update(chunk);
    yield chunk;
   }
  }
  try {
   await pipeline(chunks(), fss.createWriteStream(temporary, {flags: 'wx'}));
   if (bytes !== asset.size || hash.digest('hex') !== sha256) throw Error('Published package hash mismatch');
   if (name.endsWith('.AppImage')) await fs.chmod(temporary, 0o755);
   await fs.rename(temporary, final);
  } finally {
   await fs.rm(temporary, {force: true});
  }
  verified.push({name, size: bytes, sha256});
 }
 const unpacked=platform==='darwin'?`dist/published-mac-${arch}/MollyStudio.app`:platform==='linux'?'dist/linux-unpacked':'dist/published-win';
 const report={version,platform,arch,unpacked,downloadedFrom:release.html_url,files:verified,verifiedAt:new Date().toISOString()};
 await fs.writeFile(path.join(directory,`build-${platform}-${arch}.json`),JSON.stringify(report,null,2));await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/published-build-download.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
}
if(require.main===module)downloadPublished().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={downloadPublished};
