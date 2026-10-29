const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {EventEmitter, once} = require('node:events');
const {generateKeyPairSync, createHash, sign} = require('node:crypto');
const security = require('../../src/main/update-security.cjs');
const {allowedURL} = require('../../src/main/update-network.cjs');
const {UpdateService} = require('../../src/main/updates.cjs');
const {prepareRelease} = require('../../scripts/release/sign.cjs');

async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'molly-update-unit-'));
    t.after(() => fs.rm(root, {recursive:true,force:true}));
    await fs.mkdir(path.join(root,'dist'));
    const keys = generateKeyPairSync('ed25519'), version = '1.4.1';
    const publicKey = keys.publicKey.export({type:'spki',format:'pem'}), privateKey = keys.privateKey.export({type:'pkcs8',format:'pem'});
    const [name,blockmap] = security.releaseNames(version);
    const bytes = Buffer.alloc(1_000_000); bytes.write('MZ');
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    await fs.writeFile(path.join(root,'dist',name),bytes);
    await fs.writeFile(path.join(root,'dist',name+'.sha256'),createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n');
    await fs.writeFile(path.join(root,'dist',blockmap),'blockmap');
    const metadata = Buffer.from(`version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\n`);
    await fs.writeFile(path.join(root,'dist','latest.yml'),metadata);
    const notesPath=path.join(root,'notes.md');await fs.writeFile(notesPath,'New features');
    const files = await prepareRelease(root,{version,filename:name,notesPath},privateKey,publicKey);
    const envelope = files.at(-1).bytes.toString('utf8');
    const manifest = security.readManifest(envelope,version,publicKey);
    const info = {version,files:[{url:name,sha512,size:bytes.length}],path:name,sha512};
    const release = {tag_name:'v'+version,draft:false,prerelease:false,assets:files.map(file=>({name:file.name,size:file.bytes.length,browser_download_url:security.downloadBase(version)+file.name}))};
    const engine = new EventEmitter();
    engine.setFeedURL = value => {engine.feed=value;};
    engine.checkForUpdates = async () => {engine.updateInfoAndProvider={info};return {isUpdateAvailable:true,updateInfo:info};};
    engine.downloadUpdate = async () => [path.join(root,'dist',name)];
    engine.quitAndInstall = (...args) => {engine.quitAndInstallCalled=true;engine.emit('installed',args);};
    const main = new EventEmitter();main.id=1;main.close=()=>{main.closedRequested=true;};
    const app = new EventEmitter();app.isPackaged=true;app.getPath=()=>root;app.getVersion=()=> '1.4.0';
    app.quit=()=>{app.emit('will-quit',{preventDefault(){}});};
    const states=[],windows={broadcast:(name,value)=>states.push(value),get:()=>main,closing:new Map(),create:()=>{windows.reopened=true;}};
    let time=1_000_000;
    const requested=[];
    const request=async url=>{requested.push(url);if(url.endsWith('/releases/latest'))return Buffer.from(JSON.stringify(release));if(url.endsWith('release-manifest.json'))return Buffer.from(envelope);if(url.endsWith('latest.yml'))return metadata;throw Error('Unexpected request');};
    const service = new UpdateService({app,windows,platform:'win32',arch:'x64',portable:false,request,publicKey,engineFactory:()=>engine,now:()=>time,...options});
    t.after(()=>service.dispose());await service.ready;
    return {root,name,version,privateKey,publicKey,envelope,manifest,files,bytes,engine,info,release,service,main,app,windows,states,requested,advance:()=>time+=31000};
}

test('stable version comparison rejects prereleases and prevents downgrade',()=>{
    assert.equal(security.compareVersions('1.10.0','1.9.9'),1);
    assert.equal(security.compareVersions('1.4.0','1.4.0'),0);
    assert.throws(()=>security.compareVersions('1.4.0-beta','1.4.0'));
});
test('signed manifest rejects tampering, another key, version mismatch and extra files',async t=>{
    const f=await fixture(t), envelope=JSON.parse(f.envelope);
    assert.throws(()=>security.readManifest(f.envelope,'1.4.2',f.publicKey));
    envelope.payload=Buffer.from(envelope.payload,'base64').toString().replace('New features','Changed');
    envelope.payload=Buffer.from(envelope.payload).toString('base64');
    assert.throws(()=>security.readManifest(JSON.stringify(envelope),f.version,f.publicKey),/SIGNATURE/);
    assert.throws(()=>security.readManifest(f.envelope,f.version,generateKeyPairSync('ed25519').publicKey),/SIGNATURE/);
    const payload={...f.manifest,files:[...f.manifest.files,f.manifest.files[0]]}, bytes=Buffer.from(JSON.stringify(payload));
    assert.throws(()=>security.readManifest(JSON.stringify({schema:2,payload:bytes.toString('base64'),signature:sign(null,bytes,f.privateKey).toString('base64')}),f.version,f.publicKey),/MANIFEST/);
});
test('update network denies credentials, HTTP, unrelated repositories, redirects to private addresses and nonstandard ports',()=>{
    for(const url of ['http://github.com/','https://127.0.0.1/file','https://api.github.com/user','https://github.com/other/repo/releases/download/v1/x',
        'https://user:secret@github.com/Nagivka/MollyStudio-Releases/releases/download/v1/x','https://github.com:8443/Nagivka/MollyStudio-Releases/releases/download/v1/x']) assert.throws(()=>allowedURL(url));
    assert.ok(allowedURL('https://release-assets.githubusercontent.com/test?signature=abc'));
});
test('check pins signed metadata before permitting download; installer bytes are independently verified',async t=>{
    const f=await fixture(t);await f.service.check();
    assert.equal(f.service.state.status,'available');assert.equal(f.engine.autoDownload,false);assert.equal(f.engine.autoInstallOnAppQuit,false);
    assert.equal(f.engine.feed.url,security.downloadBase(f.version));
    await f.service.download();assert.equal(f.service.state.status,'downloaded');
    assert.ok(f.requested.every(url=>url.startsWith('https://')));
    await fs.writeFile(path.join(f.root,'dist',f.name),Buffer.alloc(1_000_000));
    assert.equal(await f.service.install(),false);assert.equal(f.main.closedRequested,undefined);assert.equal(f.service.state.error,'UPDATE_INVALID_DOWNLOAD');
});
test('unsigned or rewritten release metadata never reaches the native downloader',async t=>{
    const f=await fixture(t);f.release.assets.pop();await f.service.check();
    assert.equal(f.service.state.error,'UPDATE_UNSIGNED_RELEASE');assert.equal(f.engine.feed,undefined);
    f.advance();f.release.assets=f.files.map(file=>({name:file.name,size:file.bytes.length,browser_download_url:security.downloadBase(f.version)+file.name}));
    f.info.files[0].url='https://evil.example/installer.exe';await f.service.check();
    assert.equal(f.service.state.error,'UPDATE_UNTRUSTED_METADATA');await f.service.download();assert.equal(f.service.installer,null);
});
test('checking is coalesced and throttled; older versions never offer an update',async t=>{
    const f=await fixture(t);await Promise.all([f.service.check(),f.service.check(),f.service.check()]);
    assert.equal(f.requested.length,3);await f.service.check();assert.equal(f.requested.length,3);
    f.advance();f.release.tag_name='v1.3.9';await f.service.check();assert.equal(f.service.state.status,'up-to-date');
});
test('cancelling download keeps the update available and never starts the installer',async t=>{
    const f=await fixture(t);await f.service.check();let complete;
    f.engine.downloadUpdate=()=>new Promise(resolve=>{complete=resolve;});
    const pending=f.service.download();await new Promise(resolve=>setImmediate(resolve));f.service.cancelDownload();complete([path.join(f.root,'dist',f.name)]);await pending;
    assert.equal(f.service.state.status,'available');assert.equal(f.engine.quitAndInstallCalled,undefined);
});
test('cancelled close removes the installation hook, including a later ordinary quit',async t=>{
    const f=await fixture(t);await f.service.check();await f.service.download();await f.service.install();
    assert.equal(f.main.closedRequested,true);f.main.emit('molly-close-cancelled');
    assert.equal(f.service.state.status,'downloaded');assert.equal(f.app.listenerCount('will-quit'),0);f.app.quit();
    assert.equal(f.engine.quitAndInstallCalled,undefined);
});
test('installation waits for confirmed closure and rechecks installer bytes before restart',async t=>{
    const f=await fixture(t);await f.service.check();await f.service.download();await f.service.install();
    assert.equal(f.engine.quitAndInstallCalled,undefined);
    const installed=once(f.engine,'installed');f.main.emit('closed');f.app.quit();
    assert.deepEqual((await installed)[0],[true,true]);assert.equal(f.app.listenerCount('will-quit'),0);
});
test('unsupported development and portable sessions perform no automatic network checks',async t=>{
    const f=await fixture(t,{portable:true});await f.service.start();await f.service.check();assert.equal(f.requested.length,0);assert.equal(f.service.timer,undefined);
});
test('update preferences are validated and persist independently of projects',async t=>{
    const f=await fixture(t);await f.service.configure({autoCheck:false,autoDownload:true});
    const saved=JSON.parse(await fs.readFile(path.join(f.root,'update-preferences.json'),'utf8'));
    assert.equal(saved.autoCheck,false);assert.equal(saved.autoDownload,true);
    await assert.rejects(f.service.configure({url:'https://evil.example/'}),/INVALID_PREFERENCE/);
});

test('automatic download starts after the signed check completes',async t=>{
    const f=await fixture(t);await f.service.configure({autoDownload:true});
    await f.service.check();
    for(let i=0;i<100&&f.service.state.status!=='downloaded';i++)await new Promise(resolve=>setTimeout(resolve,2));
    assert.equal(f.service.state.status,'downloaded');assert.equal(f.engine.quitAndInstallCalled,undefined);
});

test('concurrent preference edits preserve both switches on disk',async t=>{
    const f=await fixture(t);
    await Promise.all([f.service.configure({autoCheck:false}),f.service.configure({autoDownload:true})]);
    const saved=JSON.parse(await fs.readFile(path.join(f.root,'update-preferences.json'),'utf8'));
    assert.equal(saved.autoCheck,false);assert.equal(saved.autoDownload,true);
});
