const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,profile,ready,makeWindow,launchFiles}=require('./lib/electron-harness.cjs');
(async()=>{
    const checks=[];const timer=setTimeout(()=>app.exit(1),45000);
    try{
        const first=path.join(profile,'Первый проект с пробелами.mlst'),second=path.join(profile,'Второй проект.MLST');
        for(const [file,name]of[[first,'Первый'],[second,'Второй']])await fs.writeFile(file,JSON.stringify({mollyVersion:2,type:'canvas',name,config:{width:16,height:16},layers:[]}));
        await ready({args:[first]});const win=makeWindow();await win.ensure();
        await win.page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.name==='Первый');checks.push('A cold process launch with a Unicode .mlst argument opens that project');
        await launchFiles([second]);await win.page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.name==='Второй');
        checks.push('The actual single-instance plugin delivers a second process argument into the existing editor');
        await launchFiles([first]);await win.page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.name==='Первый');
        if(await win.webContents.executeJavaScript('window.mollyEditor.projects.length')!==2)throw Error('Repeated file association launch duplicated a document');
        checks.push('Repeated launches select an existing document without creating a second application or tab');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/file-open.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);app.exit(process.exitCode||0);}
})();
