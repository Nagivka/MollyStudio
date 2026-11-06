const fs=require('node:fs/promises'),path=require('node:path');
const {PNG}=require('pngjs');
const {app,root,profile,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

async function workflow(){
    const app=window.mollyEditor,checks=[],expect=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
    app.settingsManager.set('confirmClose',false);app.settingsManager.set('animationsEnabled',false);
    const pixels=layer=>layer.ctx.getImageData(0,0,layer.width,layer.height).data.slice();
    const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
    const composite=async()=>{
        const {drawLayers}=await import(new URL('js/graphics/LayerCompositing.js',location.href));
        const canvas=document.createElement('canvas');canvas.width=app.config.width;canvas.height=app.config.height;
        drawLayers(canvas.getContext('2d'),app.layerManager.layers);const data=canvas.toDataURL();canvas.width=canvas.height=1;return data;
    };
    const exportPNG=async()=>{
        await app.exportPanel.open();app.exportPanel.get('scale').value='1';app.exportPanel.get('trim').checked=false;
        app.exportPanel.get('source').value='project';app.exportPanel.get('format').value='png';await app.exportPanel.preview();
        const result=await app.exportPanel.run();expect(!!result,'Native PNG export completes');app.exportPanel.close();return result.file;
    };
    const anchor=app.activeProjectId;
    app.addProjectData({type:'gui',name:'Server menu workflow',template:'container/default/container_54_frame.png',width:256,height:256,hasFrame:true});
    await app.getActiveProject().templateLoadPromise;
    const image=document.createElement('canvas');image.width=64;image.height=32;const ctx=image.getContext('2d');
    for(let x=0;x<64;x++)for(let y=0;y<32;y++){ctx.fillStyle=(x+y)%3?'#ff8833':'#236cb7';ctx.fillRect(x,y,1,1);}
    const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));image.width=image.height=1;
    expect(await app.importImage(new File([blob],'Emblem.png',{type:'image/png'})),'GUI imports an actual PNG file');
    const emblem=app.layerManager.getActiveLayer(),original=pixels(emblem);
    app.tools.setTool('move');app.tools.tools.move.syncBoxWithActiveLayer();app.tools.tools.move.setBoxDimensions(32,16);
    app.tools.tools.move.setBoxDimensions(64,32);expect(same(original,pixels(emblem)),'Shrinking and restoring an imported emblem preserves every pixel');
    expect(!!emblem.sourceCanvas,'Imported image retains its master');const master=emblem.sourceCanvas.toDataURL();
    app.buttonGeneratorModal.open();app.buttonGeneratorModal.setStyle('double');
    expect(await app.insertGeneratedButton(app.buttonGeneratorModal.createButtonData()),'A generated DOUBLE button imports into the GUI');app.buttonGeneratorModal.close();
    const text=app.layerManager.addTextLayer('Menu heading',{text:'SERVER MENU',fontId:'minecraft',color:'#FFF6CC',x:28,y:10,shadow:true,shadowOffsetX:1,shadowOffsetY:1});
    app.tools.setTool('text');app.tools.tools.text.renderTextLayer(text);app.tools.setTool('move');
    const content=pixels(emblem);expect(await app.loadTemplate('container/bedrock/container_54_frame.png'),'Existing GUI changes to the Bedrock template');
    expect(same(content,pixels(emblem)),'Changing the template preserves imported content');
    const guiProject=app.getActiveProject(),guiExpected=await composite();
    expect(await app.projectManager.saveProjectAs(),'GUI saves as MLST');const guiFile=guiProject.filePath;
    expect(await app.closeProject(guiProject.id),'Saved GUI closes');expect(app.activeProjectId===anchor,'Closing GUI retains the other open tab');
    expect(await app.projectManager.openRecentProject(guiFile),'GUI reopens through the normal file loader');
    expect(guiExpected===await composite(),'Reopened GUI composite matches the saved image');
    expect(app.layerManager.layers.some(layer=>layer.type==='text'&&layer.textData.text==='SERVER MENU'),'Reopened heading remains editable text');
    expect(app.layerManager.layers.find(layer=>layer.id===emblem.id)?.sourceCanvas?.toDataURL()===master,'Reopened GUI retains the exact original image source');
    const guiPNG=await exportPNG();
    app.addProjectData({type:'prefix',name:'Rank workflow'});await app.getActiveProject().prefixLoadPromise;
    const prefix=app.prefixEditor;prefix.change(data=>{
        const b=data.blocks[0];b.text='АДМИН';b.font='smallcaps';b.textMode='gradient';b.textColors=['#FFF6CC','#FFAA00'];
        b.background='gradient';b.backgroundColors=['#284A7A','#16233B'];b.paddingX=4;b.paddingY=3;b.textShadow=true;
    });
    const field=document.querySelector('[data-prefix-field=text]');field.value='ADMIN';field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));
    expect(app.getActiveProject().prefixData.blocks[0].text==='ADMIN','Prefix text changes through its inspector');
    const prefixExpected=await composite(),data=structuredClone(app.getActiveProject().prefixData);
    expect(await app.projectManager.saveProjectAs(),'Prefix saves as MLST');const prefixFile=app.getActiveProject().filePath,id=app.activeProjectId;
    expect(await app.closeProject(id),'Saved prefix closes');expect(await app.projectManager.openRecentProject(prefixFile),'Prefix reopens through the normal file loader');
    expect(JSON.stringify(app.getActiveProject().prefixData)===JSON.stringify(data),'All editable prefix settings survive reopening');
    expect(prefixExpected===await composite(),'Reopened prefix matches the saved pixels');const prefixPNG=await exportPNG();
    await app.exportPanel.open('prefixes');
    expect(app.exportPanel.get('source').value==='project','Legacy batch request exports the whole prefix project');
    expect(app.exportPanel.get('format').value==='png','Export remains a single PNG');app.exportPanel.close();
    return {checks,gui:{project:guiFile,png:guiPNG,expected:guiExpected},prefix:{project:prefixFile,png:prefixPNG,expected:prefixExpected}};
}

(async()=>{let win;const timer=setTimeout(()=>app.exit(1),150000);try{
    await ready();win=makeWindow(1440,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Workflow anchor'}});
    const result=await win.page.evaluate(workflow);await settle(win);
    const output=path.join(root,'.test-output/complete-workflows');await fs.mkdir(output,{recursive:true});
    for(const [name,item] of [['gui',result.gui],['prefix',result.prefix]]){
        const pngFile=(await fs.readdir(profile)).find(file=>file===item.png||file.endsWith('-'+item.png));if(!pngFile)throw Error('Missing native export '+item.png);
        const bytes=await fs.readFile(path.join(profile,pngFile)),actual=PNG.sync.read(bytes),expected=PNG.sync.read(Buffer.from(item.expected.split(',')[1],'base64'));
        if(actual.width!==expected.width||actual.height!==expected.height||!actual.data.equals(expected.data))throw Error(name+' exported pixels differ from its saved document');
        result.checks.push(name+': exported PNG matches every composite pixel');await fs.writeFile(path.join(output,name+'.png'),bytes);await fs.copyFile(item.project,path.join(output,name+'.mlst'));delete item.expected;
    }
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:result.checks.length,...result},null,2));console.log(JSON.stringify({passed:result.checks.length,checks:result.checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
