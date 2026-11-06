const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {prepareRelease}=require('./sign.cjs');
const {PUBLIC_KEY}=require('../../src/main/update-security.cjs');
const {updateTarget,targetReleaseNames}=require('../../src/main/update-targets.cjs');
async function prepareReleaseBundle(root,info,key,publicKey=PUBLIC_KEY){
    const files = [
        ...await prepareRelease(root, info, key, publicKey),
        ...await prepareNativeReleaseBundle(root, info, key, publicKey)
    ];
    const checksums = files.filter(file => file.name.endsWith('.sha256'))
        .map(file => file.bytes.toString('utf8').trim());
    return [
        ...files.filter(file => !file.name.endsWith('.sha256')),
        {name: 'SHA256SUMS.txt', bytes: Buffer.from(checksums.join('\n') + '\n'), type: 'text/plain'}
    ];
}
async function prepareNativeReleaseBundle(root,info,key,publicKey=PUBLIC_KEY){
    const files=[],directory=path.join(root,'dist');
    for(const platform of ['darwin','linux'])for(const arch of ['x64','arm64']){
        const target=updateTarget(platform,arch),filename=targetReleaseNames(info.version,target)[0];
        const primaryName = platform === 'darwin' ? filename.replace(/\.zip$/, '.dmg') : filename;
        const reportPath = path.join(directory, `build-${platform}-${arch}.json`);
        let report;
        try {
            report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            for (const name of new Set([filename, primaryName])) {
                if (await fs.stat(path.join(directory, name)).catch(missing => {
                    if (missing.code === 'ENOENT') return null;
                    throw missing;
                })) throw Error('Native build report is missing: ' + name);
            }
            continue;
        }
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
        if (platform === 'darwin') files.push(...await verify(primaryName));
        if (platform === 'linux' || report.signed) {
            await verify(filename);
            files.push(...await prepareRelease(root, info, key, publicKey, target));
        }
        if (platform === 'linux') {
            for (const extension of ['deb', 'rpm']) {
                const name = filename.replace(/\.AppImage$/, '.' + extension);
                if (verified.has(name)) files.push(...await verify(name));
            }
        }
    }
    if(new Set(files.map(file=>file.name)).size!==files.length)throw Error('Duplicate release artifact.');
    return files;
}
module.exports={prepareReleaseBundle,prepareNativeReleaseBundle};
