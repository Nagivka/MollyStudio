const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash,generateKeyPairSync}=require('node:crypto');
const {prepareReleaseBundle}=require('../../scripts/release/bundle.cjs');
const {publishNative}=require('../../scripts/release/publish-native.cjs');
const {readManifest}=require('../../src/main/update-security.cjs');
const {updateTarget,targetReleaseNames}=require('../../src/main/update-targets.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'molly-native-bundle-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'dist'));
    const info={version:'1.4.6',notesPath:path.join(root,'notes.md')};await fs.writeFile(info.notesPath,'Native release');
    const keys=generateKeyPairSync('ed25519'),key=keys.privateKey.export({type:'pkcs8',format:'pem'}),publicKey=keys.publicKey.export({type:'spki',format:'pem'});
    async function artifact(name,magic){const bytes=Buffer.alloc(1_000_000);bytes.set(magic);await fs.writeFile(path.join(root,'dist',name),bytes);await fs.writeFile(path.join(root,'dist',name+'.sha256'),`${hash(bytes)}  ${name}\n`);return {name,size:bytes.length,sha256:hash(bytes)};}
    const win=targetReleaseNames(info.version);await artifact(win[0],[0x4d,0x5a]);await fs.writeFile(path.join(root,'dist',win[1]),'blockmap');await fs.writeFile(path.join(root,'dist',win[2]),'version: 1.4.6\n');
    async function native(platform,arch,signed){const target=updateTarget(platform,arch),name=targetReleaseNames(info.version,target)[0],files=[await artifact(name,platform==='darwin'?[0x50,0x4b,3,4]:[0x7f,0x45,0x4c,0x46])];
        const extras=platform==='darwin'?[name.replace(/\.zip$/,'.dmg')]:[name.replace(/\.AppImage$/,'.deb'),name.replace(/\.AppImage$/,'.rpm'),name.replace(/\.AppImage$/,'.tar.gz')];for(const extra of extras)files.push(await artifact(extra,[1,2,3]));
        await fs.writeFile(path.join(root,'dist',target.metadata),'version: 1.4.6\n');const report=path.join(root,'dist',`build-${platform}-${arch}.json`);await fs.writeFile(report,JSON.stringify({version:info.version,platform,arch,signed,files}));return {target,name,report};}
    return {root,info,key,publicKey,native};
}
test('native release staging includes checked artifacts only, and keeps ad-hoc Mac builds out of automatic updates',async t=>{
    const f=await fixture(t),mac=await f.native('darwin','arm64',false),linux=await f.native('linux','x64',false);await fs.writeFile(path.join(f.root,'dist','source.zip'),'private source');
    const files=await prepareReleaseBundle(f.root,f.info,f.key,f.publicKey),names=files.map(file=>file.name);
    assert.ok(names.includes(mac.name)&&names.includes(mac.name.replace(/\.zip$/,'.dmg')));assert.ok(!names.includes(mac.target.metadata)&&!names.includes(mac.target.manifest));assert.ok(!names.includes('source.zip'));
    assert.ok(names.includes(linux.name.replace(/\.AppImage$/,'.rpm')),'Only checked RPM files are included in release staging');
    const manifest=readManifest(files.find(file=>file.name===linux.target.manifest).bytes.toString(),f.info.version,f.publicKey,linux.target);assert.equal(manifest.platform,'linux');assert.equal(manifest.arch,'x64');assert.equal(new Set(names).size,names.length);
});
test('signed Mac release staging provides its own architecture-specific signed update manifest',async t=>{
    const f=await fixture(t),mac=await f.native('darwin','x64',true),files=await prepareReleaseBundle(f.root,f.info,f.key,f.publicKey);
    const manifest=readManifest(files.find(file=>file.name===mac.target.manifest).bytes.toString(),f.info.version,f.publicKey,mac.target);assert.equal(manifest.arch,'x64');assert.ok(files.some(file=>file.name===mac.target.metadata));
});

test('an unverified RPM cannot enter a release beside verified AppImage binaries',async t=>{
 const f=await fixture(t),linux=await f.native('linux','x64',false);
 await fs.appendFile(path.join(f.root,'dist',linux.name.replace(/\.AppImage$/,'.rpm')),'changed');
 await assert.rejects(prepareReleaseBundle(f.root,f.info,f.key,f.publicKey),/does not match its checked build/);
});
test('native build version and artifact tampering stop staging before any publication',async t=>{
    const f=await fixture(t),native=await f.native('linux','arm64',false),report=JSON.parse(await fs.readFile(native.report,'utf8'));report.version='1.4.5';await fs.writeFile(native.report,JSON.stringify(report));
    await assert.rejects(prepareReleaseBundle(f.root,f.info,f.key,f.publicKey),/report does not match/);report.version=f.info.version;await fs.writeFile(native.report,JSON.stringify(report));
    await fs.appendFile(path.join(f.root,'dist',native.name),'changed');await assert.rejects(prepareReleaseBundle(f.root,f.info,f.key,f.publicKey),/does not match its checked build/);
});

async function nativePublication(t,{runChanges={},existing=[]}={}){
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'package.json'),JSON.stringify({version:f.info.version}));await fs.writeFile(path.join(f.root,'electron-builder.cjs'),"module.exports={buildVersion:'1.4.6.0'}");await fs.mkdir(path.join(f.root,'releases'));await fs.writeFile(path.join(f.root,'releases/1.4.6.md'),'Native release');
 for(const platform of ['darwin','linux'])for(const arch of ['x64','arm64'])await f.native(platform,arch,false);
 const calls=[],sha='a'.repeat(40),env={GITHUB_REPOSITORY:'Nagivka/MollyStudio',SOURCE_TOKEN:'source-fixture',RELEASES_TOKEN:'target-fixture',UPDATES_SIGNING_KEY:f.key,NATIVE_BUILD_RUN:'123',NATIVE_BUILD_SHA:sha};
 const fetchImpl=async(url,options)=>{calls.push({url,...options});let data;
  if(url.endsWith('/actions/runs/123'))data={conclusion:'success',head_repository:{full_name:'Nagivka/MollyStudio'},path:'.github/workflows/platform-compatibility.yml',head_branch:'main',head_sha:sha,...runChanges};
  else if(url.endsWith('/releases/tags/v1.4.6'))data={id:42,tag_name:'v1.4.6',draft:false,prerelease:false,assets:existing,html_url:'https://github.com/Nagivka/MollyStudio-Releases/releases/tag/v1.4.6'};
  else if(url.startsWith('https://uploads.github.com/'))data={name:new URL(url).searchParams.get('name'),state:'uploaded',size:options.body.length,digest:'sha256:'+hash(options.body)};
  else data={full_name:'Nagivka/MollyStudio-Releases',private:false,permissions:{push:true}};
  return {ok:true,json:async()=>data};
 };
 return {root:f.root,env,publicKey:f.publicKey,fetchImpl,calls};
}
test('native append publishes four checked platforms and never touches Windows assets',async t=>{
 const f=await nativePublication(t),result=await publishNative(f),uploads=f.calls.filter(c=>c.method==='POST');
 assert.equal(result.files.length,28);assert.equal(uploads.length,28);
 assert.ok(result.files.includes('release-manifest-linux-arm64.json'));
 assert.ok(!result.files.some(name=>name.includes('setup.exe')||name==='latest.yml'||name==='release-manifest.json'||name.startsWith('release-manifest-darwin')));
 assert.ok(f.calls.every(c=>c.method!=='PATCH'&&c.method!=='DELETE'));
});
test('native append rejects a failed or foreign build before release writes',async t=>{
 for(const runChanges of [{conclusion:'failure'},{head_sha:'b'.repeat(40)},{head_branch:'fork'},{head_repository:{full_name:'someone/MollyStudio'}}]){
  const f=await nativePublication(t,{runChanges});await assert.rejects(publishNative(f),/successful official native build/);assert.equal(f.calls.length,1);
 }
});
test('native append preflights conflicting published packages before uploading anything',async t=>{
 const f=await nativePublication(t,{existing:[{name:'MollyStudio-1.4.6.0-x64-mac.zip',size:12,digest:'sha256:wrong'}]});await assert.rejects(publishNative(f),/Existing native artifact differs/);assert.ok(f.calls.every(c=>c.method==='GET'));
});
