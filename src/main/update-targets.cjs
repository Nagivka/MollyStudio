function updateTarget(platform,arch){
    if(!['x64','arm64'].includes(arch)||!['win32','darwin','linux'].includes(platform)||platform==='win32'&&arch!=='x64')return null;
    const channel=platform==='darwin'?`latest-${arch}`:'latest';
    return {platform,arch,channel,format:platform==='win32'?'nsis':platform==='darwin'?'zip':'AppImage',
        metadata:platform==='win32'?'latest.yml':platform==='darwin'?`${channel}-mac.yml`:`latest-linux${arch==='x64'?'':'-'+arch}.yml`,
        manifest:platform==='win32'?'release-manifest.json':`release-manifest-${platform}-${arch}.json`};
}
function targetReleaseNames(version,target=updateTarget('win32','x64')){
    if(!/^\d+\.\d+\.\d+$/.test(version)||!target)throw Error('UPDATE_INVALID_VERSION');
    const filename=target.platform==='win32'?`MollyStudio-${version}.0-x64-setup.exe`:
        `MollyStudio-${version}.0-${target.arch}-${target.platform==='darwin'?'mac.zip':'linux.AppImage'}`;
    return [filename,...(target.platform==='win32'?[filename+'.blockmap']:[]),target.metadata];
}
module.exports={updateTarget,targetReleaseNames};
