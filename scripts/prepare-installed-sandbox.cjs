const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
(async()=>{
 const version=require('../electron-builder.cjs').buildVersion,current=`MollyStudio-${version}-x64-setup.exe`,old='MollyStudio-1.4.1.0-x64-setup.exe',hashes={};
 const currentOnly=process.argv.includes('--current-only');
 for(const name of currentOnly?[current]:[old,current])hashes[name]=createHash('sha256').update(await fs.readFile(path.join(root,'dist',name))).digest('hex');
 const directory=path.join(root,'.test-output','installed-sandbox',Date.now().toString()),harness=path.join(directory,'harness'),output=path.join(directory,'output');
 await fs.mkdir(harness,{recursive:true});await fs.mkdir(output,{recursive:true});
 const run={preparedAt:new Date().toISOString(),old,current,hashes,directory,output,currentOnly,configuration:path.join(directory,'MollyStudio-installed.wsb')};
 await fs.copyFile(path.join(__dirname,'installed-sandbox-smoke.ps1'),path.join(harness,'smoke.ps1'));
 await fs.writeFile(path.join(harness,'launch.json'),JSON.stringify(run));
 const fixtureIndex=process.argv.indexOf('--fixture');
 if(fixtureIndex>=0)await fs.copyFile(path.resolve(process.argv[fixtureIndex+1]),path.join(harness,'fixture.mlst'));
 else await fs.writeFile(path.join(harness,'fixture.mlst'),JSON.stringify({version:'1.4.1',type:'canvas',name:'Clean Windows',config:{width:64,height:64},layers:[],activeLayerId:null}));
 const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const map=(host,guest,readOnly)=>`<MappedFolder><HostFolder>${xml(host)}</HostFolder><SandboxFolder>${guest}</SandboxFolder><ReadOnly>${readOnly}</ReadOnly></MappedFolder>`;
 await fs.writeFile(run.configuration,`<Configuration><vGPU>Disable</vGPU><Networking>Disable</Networking><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection><ClipboardRedirection>Disable</ClipboardRedirection><MemoryInMB>4096</MemoryInMB><MappedFolders>${map(path.join(root,'dist'),'C:\\MollyStudio',true)}${map(harness,'C:\\MollySmoke',true)}${map(output,'C:\\MollyResults',false)}</MappedFolders><LogonCommand><Command>powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\\MollySmoke\\smoke.ps1</Command></LogonCommand></Configuration>`);
 await fs.writeFile(path.join(root,'.test-output','installed-sandbox','latest.json'),JSON.stringify(run,null,2));console.log(JSON.stringify(run,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
