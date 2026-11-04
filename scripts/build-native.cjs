const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {run}=require('./lib/portable-tools.cjs');
const {updateTarget,targetReleaseNames}=require('../src/main/update-targets.cjs');
const root=path.resolve(__dirname,'..');
async function buildNative(platform=process.platform,arch=process.arch){
    // GitHub resolves absent optional secrets to empty strings. The signer
    // interprets an empty CSC_LINK as the current directory, not "no certificate".
    for(const name of ['CSC_LINK','CSC_NAME','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','APPLE_API_KEY'])if(process.env[name]==='')delete process.env[name];
    if(platform==='win32')return run(process.execPath,[path.join(__dirname,'build-installer.cjs')],{cwd:root});
    if(!['darwin','linux'].includes(platform)||process.platform!==platform)throw Error('Build macOS on macOS and Linux on Linux.');
    const target=updateTarget(platform,arch);if(!target)throw Error('Supported architectures: x64, arm64.');
    const {build,Platform,Arch}=require('electron-builder'),pkg=require('../package.json');
    const signed=platform==='darwin'&&Boolean(process.env.CSC_LINK||process.env.CSC_NAME&&process.env.CSC_NAME!=='-');
    const config={extraMetadata:{mollyMacUpdates:signed}};
    if(platform==='darwin')config.mac={artifactName:`MollyStudio-${pkg.version}.0-${arch}-mac.\${ext}`,...(!signed?{identity:'-',hardenedRuntime:false}:{}),notarize:signed&&Boolean(process.env.APPLE_API_KEY||process.env.APPLE_ID&&process.env.APPLE_APP_SPECIFIC_PASSWORD&&process.env.APPLE_TEAM_ID)};
    else config.linux={artifactName:`MollyStudio-${pkg.version}.0-${arch}-linux.\${ext}`};
    const artifacts=await build({targets:(platform==='darwin'?Platform.MAC:Platform.LINUX).createTarget(platform==='darwin'?['dmg','zip']:['AppImage','deb','tar.gz'],Arch[arch]),config,publish:'never'});
    const output=path.join(root,'dist'),checksums=[];
    for(const file of artifacts){if(!/\.(?:dmg|zip|AppImage|deb|tar\.gz)$/.test(file))continue;
        const bytes=await fs.readFile(file),name=path.basename(file),sha256=createHash('sha256').update(bytes).digest('hex');
        await fs.writeFile(file+'.sha256',`${sha256}  ${name}\n`);checksums.push({name,sha256,size:bytes.length});
    }
    const filename=targetReleaseNames(pkg.version,target)[0],bytes=await fs.readFile(path.join(output,filename)),sha512=createHash('sha512').update(bytes).digest('base64');
    await fs.writeFile(path.join(output,target.metadata),`version: ${pkg.version}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
    const unpacked=platform==='darwin'?`dist/${arch==='arm64'?'mac-arm64':'mac'}/MollyStudio.app`:`dist/linux${arch==='arm64'?'-arm64':''}-unpacked`;
    await run(process.execPath,[path.join(__dirname,'check-distribution.cjs'),unpacked,platform],{cwd:root});
    const report={platform,arch,signed,version:pkg.version,files:checksums,unpacked,checkedAt:new Date().toISOString()};
    await fs.writeFile(path.join(output,`build-${platform}-${arch}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return report;
}
if(require.main===module)buildNative(process.argv[2]||process.platform,process.argv[3]||process.arch).catch(error=>{console.error(error);process.exit(1);});
module.exports={buildNative};
