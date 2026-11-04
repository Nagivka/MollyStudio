// Read-only preflight. It cannot certify a clean Windows installation or build an app.
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {distributionLayout}=require('./lib/distribution-layout.cjs');
const root = path.resolve(__dirname,'..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

(async()=>{
    const asar = await import('@electron/asar');
    const platform=process.argv[3]||process.platform;
    const defaultDirectory=platform==='darwin'?'dist/mac/MollyStudio.app':platform==='linux'?'dist/linux-unpacked':'dist/win-unpacked';
    const directory=path.resolve(root,process.argv[2]||defaultDirectory),layout=distributionLayout(directory,platform),archive=layout.archive;
    const entries=asar.listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));
    const names=new Set(entries),expectedFiles=new Set(),differences=[],missingRuntime=[];
    for(const name of layout.files){
        if(!await fs.stat(path.join(layout.runtimeRoot,name)).catch(()=>null))missingRuntime.push(name);
    }
    async function inspect(relative){
        for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
            const name=relative+'/'+entry.name;
            if(entry.isDirectory()){await inspect(name);continue;}
            if(entry.name.startsWith('.')||entry.name==='Thumbs.db'||name==='src/main/test-mode.cjs')continue;
            expectedFiles.add(name);
            if(!names.has(name)){differences.push({file:name,reason:'missing'});continue;}
            if(digest(await fs.readFile(path.join(root,name)))!==digest(asar.extractFile(archive,name.split('/').join(path.sep))))differences.push({file:name,reason:'changed'});
        }
    }
    for(const directory of ['src/main','src/preload','src/renderer'])await inspect(directory);
    const expectedPackage=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    const packagedPackage=JSON.parse(asar.extractFile(archive,'package.json').toString());
    for(const field of ['version','main'])if(packagedPackage[field]!==expectedPackage[field])
        differences.push({file:'package.json',reason:'metadata',field,expected:expectedPackage[field],actual:packagedPackage[field]});
    for(const name of entries){
        if(!/^src\/(?:main|preload|renderer)\//.test(name)||expectedFiles.has(name))continue;
        const info=asar.statFile(archive,name.split('/').join(path.sep));
        if(!info.files)differences.push({file:name,reason:'obsolete'});
    }
    const unexpected=entries.filter(name=>/^(?:tests|scripts|docs|design|\.git|\.secrets)\//.test(name)||/\.(?:pfx|p12|pem|private-key)$/.test(name)||name==='src/main/test-mode.cjs');
    const report={passed:!differences.length&&!missingRuntime.length&&!unexpected.length,checkedAt:new Date().toISOString(),directory,platform,
        expectedVersion:expectedPackage.version,packagedVersion:packagedPackage.version,
        chromiumRuntimePresent:!missingRuntime.length,missingRuntime,unexpected,differences,
        requiresNewBuild:!!differences.length,cleanWindowsVerified:false};
    await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
    await fs.writeFile(path.join(root,'.test-output/distribution-preflight.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,chromiumRuntimePresent:report.chromiumRuntimePresent,differentFiles:differences.length,unexpectedFiles:unexpected.length,requiresNewBuild:report.requiresNewBuild,cleanWindowsVerified:false}));
    if(!report.passed)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
