const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createHash,generateKeyPairSync}=require('node:crypto');
const {prepareReleaseBundle}=require('../../scripts/release/bundle.cjs');
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
