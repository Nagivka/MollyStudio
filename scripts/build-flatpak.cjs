const path=require('node:path'),fs=require('node:fs/promises'),{createHash}=require('node:crypto');
const {run}=require('./lib/portable-tools.cjs');
async function buildFlatpak(arch=process.arch){
    if(process.platform!=='linux'||!['x64','arm64'].includes(arch))throw Error('Build Flatpak on Linux x64 or arm64.');
    const root=path.resolve(__dirname,'..');
    await run('flatpak',['--version'],{cwd:root});await run('flatpak-builder',['--version'],{cwd:root});
    const {build,Platform,Arch}=require('electron-builder');
    const files=await build({targets:Platform.LINUX.createTarget(['flatpak'],Arch[arch]),publish:'never'});
    for(const file of files.filter(file=>file.endsWith('.flatpak'))){const bytes=await fs.readFile(file);await fs.writeFile(file+'.sha256',`${createHash('sha256').update(bytes).digest('hex')}  ${path.basename(file)}\n`);}
    return files;
}
if(require.main===module)buildFlatpak(process.argv[2]).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={buildFlatpak};
