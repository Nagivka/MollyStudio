const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{PNG}=require('pngjs');
const root=path.resolve(__dirname,'..'),json=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
(async()=>{
 const run=await json(path.resolve(root,process.argv[2]||'.test-output/installed-sandbox/latest.json'));
 const read=name=>json(path.join(run.output,name+'.json'));
 const environment=await read('environment'),installed=await read('installed-new'),ready=await read('ready-new'),uninstalled=await read('uninstalled');
 assert.equal(environment.data.externalRuntimes.length,0);assert.equal(environment.data.network.length,0);
 assert.equal(environment.data.startedAt,run.preparedAt);assert.ok(Date.parse(installed.at)>Date.parse(run.preparedAt));
 assert.equal(installed.data.sha256,run.hashes[run.current]);assert.equal(installed.data.version,require('../electron-builder.cjs').buildVersion);
 assert.ok(ready.data.association.includes('C:\\MollyInstalled\\MollyStudio.exe'));assert.ok(ready.data.association.includes('"%1"'));
 assert.equal(uninstalled.data.exitCode,0);assert.equal(uninstalled.data.executableStillPresent,false);assert.equal(uninstalled.data.projectStillPresent,true);assert.equal(uninstalled.data.profileStillPresent,true);
 assert.ok(!uninstalled.data.association?.includes('C:\\MollyInstalled\\MollyStudio.exe'),'Uninstall left a broken file association');
 assert.equal(await fs.stat(path.join(run.output,'forced-guest-close.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}),false,'The guest application required forced termination');
 const processes=await read('processes');assert.ok(processes.data.some(process=>process.Responding&&process.MainWindowTitle.includes('Clean Windows')),'The associated project never opened a responsive window');
 if(!run.currentOnly){const old=await read('installed-old');assert.equal(old.data.sha256,run.hashes[run.old]);assert.equal(old.data.version,'1.4.1.0');}
 const project=await json(path.join(run.output,'fixture.mlst'));assert.equal(project.layers.length,1);assert.equal(project.name,'Clean Windows');
 const expected=PNG.sync.read(Buffer.from(project.layers[0].dataUrl.split(',')[1],'base64')),actual=PNG.sync.read(await fs.readFile(path.join(run.output,'Clean Windows.png')));
 assert.equal(actual.width,project.config.width);assert.equal(actual.height,project.config.height);assert.ok(expected.data.equals(actual.data),'PNG pixels changed across installation/upgrade');
 const hash=createHash('sha256').update(await fs.readFile(path.join(run.output,'fixture.mlst'))).digest('hex').toUpperCase();assert.equal(hash,ready.data.projectSha256);
 const result={passed:true,checkedAt:new Date().toISOString(),sha256:installed.data.sha256,currentOnly:run.currentOnly,version:installed.data.version,offline:true,externalRuntimes:0,associationOpened:true,projectPreserved:true,pngMatchesSavedPixels:true,uninstalledWithDataPreserved:true,output:run.output};
 await fs.writeFile(path.join(run.directory,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
