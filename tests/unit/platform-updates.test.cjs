const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter,once}=require('node:events'),{generateKeyPairSync,createHash}=require('node:crypto');
const {updateTarget,targetReleaseNames}=require('../../src/main/update-targets.cjs'),security=require('../../src/main/update-security.cjs');
const {UpdateService}=require('../../src/main/updates.cjs'),{prepareRelease}=require('../../scripts/release/sign.cjs');
for(const platform of ['darwin','linux'])for(const arch of ['x64','arm64'])test(`${platform}/${arch} checks and installs only its signed artifact`,async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'molly-native-update-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.mkdir(path.join(directory,'dist'));
    const target=updateTarget(platform,arch),version='1.4.6',names=targetReleaseNames(version,target),bytes=Buffer.alloc(1_000_000);
    if(platform==='darwin')bytes.set([0x50,0x4b,3,4]);else bytes.set([0x7f,0x45,0x4c,0x46]);
    const filename=path.join(directory,'dist',names[0]),sha512=createHash('sha512').update(bytes).digest('base64');
    await fs.writeFile(filename,bytes);await fs.writeFile(filename+'.sha256',`${createHash('sha256').update(bytes).digest('hex')}  ${names[0]}\n`);
    const yaml=Buffer.from(`version: ${version}\nfiles:\n  - url: ${names[0]}\n    sha512: ${sha512}\n    size: ${bytes.length}\n`);await fs.writeFile(path.join(directory,'dist',target.metadata),yaml);
    const notesPath=path.join(directory,'notes.md');await fs.writeFile(notesPath,'Native release');
    const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'});
    const files=await prepareRelease(directory,{version,notesPath},privateKey,publicKey,target),envelope=files.at(-1).bytes.toString();
    const manifest=security.readManifest(envelope,version,publicKey,target);assert.equal(manifest.platform,platform);
    assert.throws(()=>security.readManifest(envelope,version,publicKey,updateTarget(platform,arch==='x64'?'arm64':'x64')),/MANIFEST/);
    const info={version,files:[{url:names[0],sha512,size:bytes.length}]},engine=new EventEmitter();
    engine.setFeedURL=value=>engine.feed=value;engine.checkForUpdates=async()=>{engine.updateInfoAndProvider={info};return {isUpdateAvailable:true,updateInfo:info};};engine.downloadUpdate=async()=>[filename];
    engine.quitAndInstall=()=>engine.emit('installed'); // MacUpdater has no BaseUpdater.quitAndInstallCalled.
    const app=new EventEmitter();Object.assign(app,{isPackaged:true,getPath:()=>directory,getVersion:()=> '1.4.5',quit:()=>app.emit('will-quit',{preventDefault(){}})});
    const main=new EventEmitter();main.id=1;main.close=()=>{};
    const windows={get:()=>main,closing:new Map(),broadcast(){},create(){throw Error('Unexpected reopen');}},release={tag_name:'v'+version,draft:false,prerelease:false,assets:files.map(file=>({name:file.name,size:file.bytes.length,browser_download_url:security.downloadBase(version)+file.name}))};
    const request=async url=>url.endsWith('/releases/latest')?Buffer.from(JSON.stringify(release)):url.endsWith(target.manifest)?Buffer.from(envelope):url.endsWith(target.metadata)?yaml:Promise.reject(Error('Unexpected URL'));
    app.relaunch=()=>engine.emit('installed');
    const replaceAppImage=async options=>{assert.equal(options.download,filename);assert.equal(options.expected.name,names[0]);await options.relaunch(options.current);};
    const service=new UpdateService({app,windows,platform,arch,portable:false,macSigned:true,appImage:'/tmp/AppImage',publicKey,request,engineFactory:()=>engine,replaceAppImage});t.after(()=>service.dispose());
    await service.check();assert.equal(service.status().status,'available');assert.equal(engine.feed.channel,target.channel);
    await service.download();assert.equal(service.status().status,'downloaded');assert.equal(await service.install(),true);
    const installed=once(engine,'installed');main.emit('closed');await installed;
    assert.equal(service.status().error,'');
});
test('unsupported native packaging is explicit and does not query updates',async t=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'molly-native-capability-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
    for(const [platform,options,reason] of [['darwin',{macSigned:false},'mac-signing'],['linux',{appImage:''},'linuxNative']]){
        let requests=0;const service=new UpdateService({app:{isPackaged:true,getPath:()=>directory,getVersion:()=> '1.4.5'},windows:{broadcast(){}},platform,arch:'arm64',portable:false,...options,request:async()=>{requests++;throw Error('Unexpected request');}});
        await service.start();assert.equal(service.status().supported,false);assert.equal(service.status().unavailableReason,reason);assert.equal(requests,0);service.dispose();
    }
});
