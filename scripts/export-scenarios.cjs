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
    await panel.open('selected');panel.get('trim').checked=true;panel.get('scale').value='2';await panel.preview();
    expect(panel.get('dimensions').textContent.startsWith('8 × 10 px'),'Export preview shows the trimmed and scaled dimensions before writing');
    const result=await panel.run();expect(result?.count===2,'Selected layers export as one archive');
    const zipFile=result.file,manifest=result.manifest;
    expect(manifest.images[0].file==='VIP.png'&&manifest.images[1].file==='vip_2.png','Batch export resolves filename collisions on Windows');
    expect(manifest.images[1].width===12&&manifest.images[1].sourceX===12,'Every exported layer has its own crop and dimensions');
    panel.dialog.close();await panel.open('project',true);
    expect(panel.get('source').value==='selected'&&panel.get('scale').value==='2'&&panel.get('trim').checked,'Repeat export restores the last successful parameters');
    panel.get('format').value='sheet';panel.get('columns').value='2';panel.get('gap').value='3';await panel.preview();
    expect(panel.get('dimensions').textContent.startsWith('27 × 14 px'),'Sprite sheet preview reports the full output dimensions');const sheetResult=await panel.run();
    expect(sheetResult?.manifest?.sheet?.width===27&&sheetResult.manifest.sheet.height===14,'Sprite sheet uses the chosen columns and gaps: '+panel.get('error').textContent);
    expect(sheetResult.manifest.images[1].x===15,'Sprite sheet manifest records each image coordinate');
    const sheetFile=sheetResult.file;panel.dialog.close();
    const group=manager.addLayer('Export group',null,false,'group');first.groupId=second.groupId=group.id;group.opacity=.5;manager.activeLayerId=first.id;
    await panel.open('active');let groupSource=panel.source(panel.entries(panel.read())[0],panel.read()),groupPixels=groupSource.getContext('2d');
    expect(groupPixels.getImageData(2,3,1,1).data[3]===128&&groupPixels.getImageData(12,13,1,1).data[3]===0,'Exporting a child preserves its parent opacity while excluding sibling pixels');groupSource.width=groupSource.height=1;panel.dialog.close();
    manager.activeLayerId=group.id;await panel.open('active');groupSource=panel.source(panel.entries(panel.read())[0],panel.read());groupPixels=groupSource.getContext('2d');
    expect(groupPixels.getImageData(2,3,1,1).data[3]===128&&groupPixels.getImageData(12,13,1,1).data[3]===128,'Exporting a group includes its descendants and applies group opacity once');groupSource.width=groupSource.height=1;panel.dialog.close();
    app.addProject('Prefix batch','none',32,32,false,'prefix');await app.prefixEditor.renderer.load();
    await new Promise(resolve=>setTimeout(resolve,30));const before=JSON.stringify(app.getActiveProject().prefixData);
    await panel.open('prefixes');panel.get('names').value='VIP\nPREMIUM\nADMIN';panel.get('format').value='zip';await panel.preview();const prefixes=await panel.run();
    expect(prefixes?.count===3,'Prefix batch generates one complete image for each text entry');
    expect(JSON.stringify(app.getActiveProject().prefixData)===before,'Batch generation never changes the source prefix document');
    const prefixFile=prefixes.file;panel.dialog.close();await panel.open('prefixes');panel.get('names').value='x\n'.repeat(201);await panel.preview();
    expect(!panel.get('error').hidden&&panel.get('save').disabled,'An oversized batch is rejected before file creation');
    panel.get('names').value=Array.from({length:100},(_,i)=>'Prefix '+i).join('\n');await panel.preview();
    const originalSaver=panel.saveBytes;let writes=0;panel.saveBytes=async()=>{writes++;return 'unexpected.zip';};
    const operation=panel.run();setTimeout(()=>panel.close(),0);expect(await operation===false&&writes===0,'Cancelling an active export does not write a partial archive');panel.saveBytes=originalSaver;
    panel.get('names').value='VIP';panel.get('format').value='sheet';panel.get('columns').value='99';
    expect(await panel.run()===false&&!panel.get('error').hidden,'Invalid numeric sheet parameters remain rejected while controls are disabled');panel.get('columns').value='4';panel.get('format').value='zip';
    panel.saveBytes=async()=>{throw Error('Disk fixture unavailable');};
    expect(await panel.run()===false&&panel.get('error').textContent==='Disk fixture unavailable'&&!panel.get('save').disabled,'A failed write is reported and export controls recover');
    panel.saveBytes=async()=>false;expect(await panel.run()===false&&panel.get('status').textContent.includes('отменено'),'Cancelling the native save dialog leaves export ready for another attempt');panel.saveBytes=originalSaver;
    app.projectManager.projectRevisions.set(app.activeProjectId,app.projectManager.getRevision(app.activeProjectId)+1);
    expect(await panel.run()===false&&panel.get('error').textContent.includes('Проект изменился'),'Export refuses to mix images from different document revisions');
    panel.dialog.close();await panel.open('project',true);
    expect(!['active','selected'].includes(panel.get('source').value),'Repeating bitmap export in a prefix project chooses an available source');
    panel.dialog.close();await panel.open('prefixes');panel.get('names').value='VIP';await panel.preview();
    return {checks,zipFile,sheetFile,prefixFile};
}

(async()=>{
    let win;const watchdog=setTimeout(()=>app.exit(1),120000);
    try{
        await ready();
        win=makeWindow(1280,900,{offscreen:false});win.showInactive();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Export fixture'}});
        const result=await win.webContents.executeJavaScript(`(${exerciseExport.toString()})()`);
        const files=unzipStored(await fs.readFile(path.join(profile,result.zipFile))),manifest=JSON.parse(files.get('manifest.json'));
        if(files.size!==3||nativeImage.createFromBuffer(files.get('VIP.png')).getSize().width!==8)throw Error('Actual ZIP images disagree with their manifest');result.checks.push('The written ZIP contains independently decodable PNGs and valid JSON');
        const sheet=unzipStored(await fs.readFile(path.join(profile,result.sheetFile)));if(nativeImage.createFromBuffer(sheet.get('sprites.png')).getSize().width!==27)throw Error('Wrong sheet PNG dimensions');result.checks.push('The actual sprite sheet PNG matches its recorded dimensions');
        const prefixes=unzipStored(await fs.readFile(path.join(profile,result.prefixFile)));if(prefixes.size!==4||!prefixes.has('ADMIN.png'))throw Error('Incomplete prefix batch');result.checks.push('The real prefix archive contains every requested result');
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
