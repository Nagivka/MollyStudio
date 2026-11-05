const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {prepareRelease}=require('./sign.cjs');
const {PUBLIC_KEY}=require('../../src/main/update-security.cjs');
const {updateTarget,targetReleaseNames}=require('../../src/main/update-targets.cjs');
async function prepareReleaseBundle(root,info,key,publicKey=PUBLIC_KEY){
    const files=await prepareRelease(root,info,key,publicKey),directory=path.join(root,'dist');
    for(const platform of ['darwin','linux'])for(const arch of ['x64','arm64']){
        const target=updateTarget(platform,arch),filename=targetReleaseNames(info.version,target)[0];
        if(!await fs.stat(path.join(directory,filename)).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))continue;
        const report=JSON.parse(await fs.readFile(path.join(directory,`build-${platform}-${arch}.json`),'utf8'));
        if(report.platform!==platform||report.arch!==arch||report.version!==info.version||typeof report.signed!=='boolean'||!Array.isArray(report.files))throw Error('Native build report does not match the release.');
        const verified=new Map();
        for(const record of report.files){
            if(typeof record.name!=='string'||path.basename(record.name)!==record.name)throw Error('Invalid native artifact name.');
            verified.set(record.name,record);
        }
        const verify=async name=>{
            const bytes=await fs.readFile(path.join(directory,name)),record=verified.get(name),sha=createHash('sha256').update(bytes).digest('hex');
            if(bytes.length<1_000_000||bytes.length>1_000_000_000||record?.size!==bytes.length||record.sha256!==sha)throw Error('Native artifact does not match its checked build.');
            const checksum=await fs.readFile(path.join(directory,name+'.sha256'));
            if(checksum.toString('utf8').trim()!==`${sha}  ${name}`)throw Error('Native checksum mismatch.');
            return [{name,bytes,type:'application/octet-stream'},{name:name+'.sha256',bytes:checksum,type:'text/plain'}];
        };
        const primary=await verify(filename);
        if(platform==='linux'||report.signed)files.push(...await prepareRelease(root,info,key,publicKey,target));
        else files.push(...primary); // Ad-hoc Mac apps are downloadable, not automatic updates.
        const extras=platform==='darwin'?[filename.replace(/\.zip$/,'.dmg')]:[filename.replace(/\.AppImage$/,'.deb'),filename.replace(/\.AppImage$/,'.rpm'),filename.replace(/\.AppImage$/,'.tar.gz')];
        for(const name of extras)if(await fs.stat(path.join(directory,name)).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))files.push(...await verify(name));
    }
    if(new Set(files.map(file=>file.name)).size!==files.length)throw Error('Duplicate release artifact.');
    return files;
}
module.exports={prepareReleaseBundle};
