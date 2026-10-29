const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

async function exerciseText(){
    const editor=window.mollyEditor,tool=editor.tools.tools.text,manager=editor.layerManager,history=editor.history,checks=[];
    const expect=(value,message)=>{if(!value)throw new Error(message);checks.push(message);};
    editor.settingsManager.set('animationsEnabled',false);
    await new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const poll=()=>['minecraft','minecraft-ten','smallcaps','square','other'].every(id=>tool.fontImages[id])?resolve():Date.now()>deadline?reject(Error('Font timeout')):setTimeout(poll,20);poll();});
    const pixels=layer=>Array.from(layer.ctx.getImageData(0,0,layer.width,layer.height).data);
    const same=(layer,expected)=>pixels(layer).every((v,i)=>v===expected[i]);
    const create=data=>{const layer=manager.addTextLayer('Text test',{text:'AB\nCD',fontId:'minecraft',x:10,y:10,color:'#FFFFFF',shadow:false,...data});tool.renderTextLayer(layer);return layer;};
    expect(!tool.fontImages.symbols,'The retired emoji atlas is not loaded');
    let layer=create({lineHeight:14}),layout=tool.getTextLayout(layer);
    expect(layout.lines.length===2&&layout.lines[1].y===14,'Hard line breaks produce separate lines with the requested leading');
    expect(layer.getBounds().h>14,'Multiline rendering produces real pixels on the second line');
    layer=create({text:'AA BB CCCCC',maxWidth:18,align:'right',lineHeight:11});layout=tool.getTextLayout(layer);
    expect(layout.lines.length>=3&&layout.lines.every(row=>row.width<=18),'Word wrapping and long words obey the selected width');
    expect(layout.lines.every(row=>row.x===layout.width-row.width),'Every wrapped line follows right alignment');
    const beforeLayout=layout;layer.textData.color='#22CC88';layer.textData.x+=3;tool.renderTextLayer(layer);
    expect(tool.getTextLayout(layer)===beforeLayout,'Changing color or position reuses the immutable text layout');
    layer=create({text:'A\nA',lineHeight:12,colorMode:'gradient',gradientColors:['#FFFFFF','#FFFFFF'],gradientAngle:90});
    const gradientPixels=pixels(layer);layer.textData.colorMode='solid';tool.renderTextLayer(layer);
    expect(same(layer,gradientPixels),'Solid and constant-gradient multiline text have identical RGBA pixels');
    layer=create({text:'&#FF0000A\n&x&0&0&F&F&0&0B'});const colored=pixels(layer);
    expect(colored.some((v,i)=>i%4===0&&v===255&&colored[i+1]===0&&colored[i+2]===0&&colored[i+3]===255),'Hex formatting renders its actual red glyph');
    expect(colored.some((v,i)=>i%4===0&&v===0&&colored[i+1]===255&&colored[i+2]===0&&colored[i+3]===255),'Expanded RGB formatting renders its actual green glyph');
    layer=create({text:'A🙂',fontId:'smallcaps'});
    expect(document.getElementById('text-glyph-warning').textContent.includes('🙂'),'The inspector identifies unsupported Unicode characters');
    layer=create({text:'AB',maxWidth:32,lineHeight:13,align:'center'});editor.syncPropertiesPanel();tool.syncUIWithLayer(layer);history.clear();
    document.getElementById('text-line-height').focus();document.getElementById('text-line-height').value='17';document.getElementById('text-line-height').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('text-line-height').dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('text-line-height').blur();
    expect(layer.textData.lineHeight===17&&history.undoStack.length===1,'Editing line spacing creates one undoable text action');
    history.undo();expect(layer.textData.lineHeight===13,'Undo restores the prior line spacing');history.redo();
    const beforeText=layer.textData.text;history.clear();document.getElementById('btn-text-inline').click();
    expect(tool.canvasEditor.active&&tool.inlineLayer===layer,'The inspector opens the real text editor anchored on the canvas');
    const input=tool.canvasEditor.input;input.value='First\nSecond';input.dispatchEvent(new Event('input',{bubbles:true}));
    expect(layer.textData.text==='First\nSecond'&&tool.getTextLayout(layer).lines.length>=2,'Canvas text editing updates multiline preview live');
    tool.canvasEditor.finish(false);
    expect(layer.textData.text===beforeText&&!tool.canvasEditor.active&&history.undoStack.length===0,'Cancelling canvas text editing restores the original without creating history');
    tool.openInlineEditor(layer);input.value='Applied\nText';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
    expect(layer.textData.text==='Applied\nText'&&!tool.canvasEditor.active&&history.undoStack.length===1,'Ctrl+Enter applies canvas text editing as a single action');
    history.undo();expect(layer.textData.text===beforeText,'Canvas text edits remain editable after undo');history.redo();
    const fontSelect=document.getElementById('font-select');fontSelect.value='square';fontSelect.dispatchEvent(new Event('change',{bubbles:true}));
    expect(layer.textData.fontId==='square'&&layer.textData.text==='Applied\nText'&&!tool.getTextLayout(layer).missing.length,'Square can be selected without replacing the original mixed-case text');
    expect(tool.getGlyph('Ё','square').image===tool.fontImages.square&&tool.getGlyph('Й','square').image===tool.fontImages.square,'Square uses its own Cyrillic glyphs including Yo and short I');
    for(const font of ['square','smallcaps']){
        const source=font==='square'?'square':'minecraft';
        expect([... '!@#?«»'].every(char=>tool.getGlyph(char,font).image===tool.fontImages[source]),font+' signs use '+source+' atlas');
        expect([... '0123456789'].every(char=>tool.getGlyph(char,font).image===tool.fontImages[font]),font+' digits retain their original atlas');
    }
    layer.textData.scaleX=2;layer.textData.scaleY=2;layer.textData.rotation=90;tool.renderTextLayer(layer);const transformed=pixels(layer);
    const serialized=editor.projectManager.serializeProject();await editor.projectManager.deserializeProject(serialized);layer=manager.getActiveLayer();tool.renderTextLayer(layer);
    expect(layer.textData.fontId==='square'&&layer.textData.maxWidth===32&&layer.textData.lineHeight===17&&layer.textData.align==='center'&&layer.textData.rotation===90&&same(layer,transformed),'Saving and reopening preserve Square font, multiline layout, scale, rotation and all rendered pixels');
    layer.textData.rotation=0;layer.textData.scaleX=1;layer.textData.scaleY=1;layer.textData.text='Многострочный\nтекст редактора';layer.textData.fontId='minecraft';layer.textData.maxWidth=90;tool.renderTextLayer(layer);editor.tools.setTool('text');tool.syncUIWithLayer(layer);
    manager.layers.forEach(item=>{item.visible=item===layer;});editor.bus.emit('CANVAS_UPDATED');editor.workspace.fitToScreen();return checks;
}

(async()=>{
    let win;const watchdog=setTimeout(()=>app.exit(1),120000);
    try{
        await ready();win=makeWindow(1280,900,{offscreen:false});win.showInactive();
        await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'128',height:'128',name:'Text scenarios'}});
        const checks=await win.webContents.executeJavaScript(`(${exerciseText.toString()})()`);await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        for(const [theme,width,height,zoom] of [['dark',1280,900,1],['light',850,760,1],['dark',760,780,1.5]]){
            win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await win.webContents.executeJavaScript(`window.mollyEditor.settingsManager.set('theme','${theme}')`);await settle(win);
            await fs.writeFile(path.join(root,`.test-output/text-${theme}-${width}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript(`window.mollyEditor.tools.tools.text.openInlineEditor(window.mollyEditor.layerManager.getActiveLayer())`);await settle(win);
        const fits=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#canvas-text-input').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`);
        if(!fits)throw Error('Canvas text editor overflows the viewport');checks.push('Native canvas input stays in the viewport at 150 percent');
        await fs.writeFile(path.join(root,'.test-output/text-inline.png'),(await win.webContents.capturePage()).toPNG());
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/text-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
})();
