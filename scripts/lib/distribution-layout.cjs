const path=require('node:path');
function distributionLayout(directory,platform=process.platform){
    if(platform==='darwin'){
        const bundle=directory.endsWith('.app')?directory:path.join(directory,'MollyStudio.app');
        return {archive:path.join(bundle,'Contents/Resources/app.asar'),runtimeRoot:bundle,executable:path.join(bundle,'Contents/MacOS/MollyStudio'),files:['Contents/MacOS/MollyStudio','Contents/Frameworks/Electron Framework.framework/Electron Framework']};
    }
    const files=platform==='win32'?['MollyStudio.exe','icudtl.dat','resources.pak','chrome_100_percent.pak','v8_context_snapshot.bin','d3dcompiler_47.dll','ffmpeg.dll']
        :['mollystudio','icudtl.dat','resources.pak','chrome_100_percent.pak','v8_context_snapshot.bin','libffmpeg.so','libvulkan.so.1','libvk_swiftshader.so','chrome-sandbox'];
    return {archive:path.join(directory,'resources/app.asar'),runtimeRoot:directory,executable:path.join(directory,files[0]),files};
}
module.exports={distributionLayout};
