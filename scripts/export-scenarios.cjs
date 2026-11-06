const fs=require('node:fs/promises');
const path=require('node:path');
const nativeImage=require('./lib/png-image.cjs');
const {app,root,profile,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

function unzipStored(bytes){
    const files=new Map();let offset=0;
    while(bytes.readUInt32LE(offset)===0x04034b50){
        const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra;
        const name=bytes.toString('utf8',offset+30,offset+30+length);files.set(name,bytes.subarray(start,start+size));offset=start+size;
    }
    return files;
}

async function exerciseExport(){
    const app=window.mollyEditor,panel=app.exportPanel,manager=app.layerManager,checks=[],expect=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
    app.settingsManager.set('animationsEnabled',false);
    const first=manager.addLayer('VIP'),second=manager.addLayer('vip');
    first.ctx.fillStyle='#FF0000';first.ctx.fillRect(2,3,4,5);first.invalidateSource();
    second.ctx.fillStyle='#00FF00';second.ctx.fillRect(12,13,6,7);second.invalidateSource();
    manager.selectedLayerIds=new Set([first.id,second.id]);app.renderer.render();

    const projectManager=app.projectManager;
    const prepareLayerImages=projectManager.prepareLayerImages;
    projectManager.prepareLayerImages=()=>{throw Error('Export requested MLST layer encoding');};
    try {
        expect(await panel.open('project'), 'Export opens without pre-encoding layers for project storage');
        panel.close();
    } finally {
        projectManager.prepareLayerImages=prepareLayerImages;
    }
    await panel.open('selected');panel.get('trim').checked=true;panel.get('scale').value='2';await panel.preview();
    expect(panel.get('source').value==='project','Legacy selected-layer request uses the entire project');
    expect(panel.get('dimensions').textContent.startsWith('32 × 34 px'),'Preview crops and scales the complete visible composition');
    const result=await panel.run();expect(result?.count===1,'Whole project exports as one PNG');
    const pngFile=result.file;panel.close();await panel.open('project',true);
    expect(panel.get('source').value==='project'&&panel.get('scale').value==='2'&&panel.get('trim').checked,'Repeat restores useful PNG options');
    panel.get('format').value='sheet';panel.get('names').value='VIP\nADMIN';await panel.preview();
    expect(panel.get('format').value==='png','Legacy format cannot restore removed batch exports');
    const originalSaver=panel.saveBytes;
    panel.saveBytes=async()=>{throw Error('Disk fixture unavailable');};
    expect(await panel.run()===false&&panel.get('error').textContent==='Disk fixture unavailable'&&!panel.get('save').disabled,'Write failure is reported and controls recover');
    panel.saveBytes=async()=>false;
    expect(await panel.run()===false&&panel.get('status').textContent.includes('отменено'),'Save dialog cancellation permits another attempt');panel.saveBytes=originalSaver;
    app.projectManager.projectRevisions.set(app.activeProjectId,app.projectManager.getRevision(app.activeProjectId)+1);
    expect(await panel.run()===false&&panel.get('error').textContent.includes('Проект изменился'),'Changed document cannot export a stale revision');
    panel.close();
    app.addProject('Prefix project','none',32,32,false,'prefix');await app.prefixEditor.renderer.load();
    const before=JSON.stringify(app.getActiveProject().prefixData);await panel.open('prefixes');
    expect(panel.get('source').value==='project','Prefix export uses the entire prefix project');
    expect(JSON.stringify(app.getActiveProject().prefixData)===before,'Preparing export leaves prefix data unchanged');
    return {checks,pngFile};
}

(async()=>{
    let win;const watchdog=setTimeout(()=>app.exit(1),120000);
    try{
        await ready();
        win=makeWindow(1280,900,{offscreen:false});win.showInactive();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Export fixture'}});
        const result=await win.webContents.executeJavaScript(`(${exerciseExport.toString()})()`);
        const image=nativeImage.createFromBuffer(await fs.readFile(path.join(profile,result.pngFile)));
        if(image.getSize().width!==32||image.getSize().height!==34)throw Error('Written PNG dimensions differ from preview');
        result.checks.push('Written PNG matches preview dimensions');
        for(const [theme,width,height,zoom] of [['dark',1280,900,1],['light',850,760,1],['dark',760,780,1.5]]){
            win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await win.webContents.executeJavaScript(`window.mollyEditor.settingsManager.set('theme','${theme}')`);await settle(win);
            const fits=await win.webContents.executeJavaScript(`(()=>{const d=document.querySelector('.export-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1;})()`);
            if(!fits)throw Error('Export dialog overflow');result.checks.push(`Export fits ${theme} ${width} at ${zoom}`);
            const actionVisible=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('[data-export="save"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`);
            if(!actionVisible)throw Error('Export save action is hidden below the viewport');
            await fs.writeFile(path.join(root,`.test-output/export-${theme}-${width}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
        }
        for(let step=0;step<18;step++){
            win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
        }
        await settle(win);
        if(!await win.webContents.executeJavaScript(`document.querySelector('.export-dialog').contains(document.activeElement)`))throw Error('Tab escaped the export dialog');result.checks.push('Native Tab navigation stays inside the export dialog');
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle(win);
        if(await win.webContents.executeJavaScript(`document.querySelector('.export-dialog').open`))throw Error('Escape failed to close the export dialog');result.checks.push('Native Escape closes the idle export dialog');
        await win.webContents.executeJavaScript(`(async()=>{document.getElementById('btn-export-png').focus();await window.mollyEditor.exportPanel.open();})()`);
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle(win);
        if(!await win.webContents.executeJavaScript(`document.activeElement===document.getElementById('btn-export-png')`))throw Error('Export failed to restore keyboard focus');result.checks.push('Closing export returns keyboard focus to its original control');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/export-scenarios.json'),JSON.stringify({passed:result.checks.length,checks:result.checks},null,2));console.log(JSON.stringify({passed:result.checks.length,checks:result.checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
})();
