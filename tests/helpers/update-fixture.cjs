// Private Electron scenario: local HTTP server, generated signing key, inert installer.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const {EventEmitter} = require('node:events');
const {generateKeyPairSync,createHash} = require('node:crypto');
const {NsisUpdater} = require('electron-updater');
const {ElectronHttpExecutor} = require('electron-updater/out/electronHttpExecutor');
const {UpdateService} = require('../../src/main/updates.cjs');
const {prepareRelease} = require('../../scripts/release/sign.cjs');
const security = require('../../src/main/update-security.cjs');

async function installFixture(electron,runtime,profile) {
    runtime.updates.dispose();
    const directory=path.join(profile,'update-fixture'),dist=path.join(directory,'dist');await fs.mkdir(dist,{recursive:true});
    const version='1.4.2',[name,blockmap]=security.releaseNames(version),bytes=Buffer.alloc(2_000_000,87);bytes.write('MZ');
    const digest=algorithm=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
    await fs.writeFile(path.join(dist,name),bytes);await fs.writeFile(path.join(dist,blockmap),'fixture');
    await fs.writeFile(path.join(dist,name+'.sha256'),`${digest('sha256')}  ${name}\n`);
    await fs.writeFile(path.join(dist,'latest.yml'),`version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${digest('sha512')}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${digest('sha512')}\n`);
    const notesPath=path.join(directory,'notes.md');await fs.writeFile(notesPath,'Проверка обновления\n- Локальный подписанный выпуск.');
    const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'});
    const files=await prepareRelease(directory,{version,filename:name,notesPath},keys.privateKey,publicKey);
    const content=new Map(files.map(file=>[file.name,file.bytes]));
    const fixture={requests:[],installed:0,confirmations:0,confirmResponse:0,mode:'normal'};
    const server=http.createServer((request,response)=>{
        const file=new URL(request.url,'http://127.0.0.1').pathname.slice(1);fixture.requests.push(file);
        const data=content.get(file);
        if(!data){response.writeHead(404);response.end();return;}
        response.writeHead(200,{'Content-Length':data.length,'Content-Type':'application/octet-stream'});response.end(data);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));fixture.server=server;
    const adapter={version:'1.4.1',name:'MollyStudio-update-fixture',isPackaged:true,
        userDataPath:directory,baseCachePath:path.join(directory,'cache'),appUpdateConfigPath:path.join(directory,'app-update.yml'),
        whenReady:()=>electron.app.whenReady(),onQuit(){},quit(){}};
    await fs.writeFile(adapter.appUpdateConfigPath,'updaterCacheDirName: fixture-updater\n');
    const engine=new NsisUpdater(undefined,adapter);engine.httpExecutor=new ElectronHttpExecutor(()=>{});
    const setFeed=engine.setFeedURL.bind(engine);engine.setFeedURL=()=>setFeed({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`,useMultipleRangeRequest:false});
    engine.quitAndInstall=()=>{engine.quitAndInstallCalled=true;fixture.installed++;};
    const fakeApp=new EventEmitter();Object.assign(fakeApp,{isPackaged:true,getPath:()=>directory,getVersion:()=> '1.4.1',quit:()=>fakeApp.emit('will-quit',{preventDefault(){}})});
    let time=Date.now();
    const request=async url=>{
        if(fixture.mode==='offline')throw Error('UPDATE_NETWORK');
        if(url.endsWith('/releases/latest'))return Buffer.from(JSON.stringify({tag_name:'v'+version,draft:false,prerelease:false,
            assets:files.map(file=>({name:file.name,size:file.bytes.length,browser_download_url:security.downloadBase(version)+file.name}))}));
        const data=content.get(url.split('/').pop());if(!data)throw Error('fixture request');return data;
    };
    const service=new UpdateService({app:fakeApp,windows:runtime.windows,testMode:false,platform:'win32',arch:'x64',portable:false,
        request,publicKey,engineFactory:()=>engine,now:()=>time});await service.ready;
    // Keep the private test process alive after its final real editor closes.
    // The inert install callback below is inspected from Playwright afterwards.
    electron.app.on('will-quit',event=>event.preventDefault());
    fixture.advance=()=>time+=31000;
    fixture.service=service;runtime.updates=service;runtime.updateFixture=fixture;
    runtime.windows.electron.dialog.showMessageBox=async()=>{fixture.confirmations++;return {response:fixture.confirmResponse};};
    return true;
}
module.exports={installFixture};
