const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

async function exerciseProperties(){
    const app=window.mollyEditor,manager=app.layerManager,p=app.propertiesInspector,history=app.history,checks=[];
    const get=id=>document.getElementById(id),expect=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
    const shown=id=>{const node=get(id);return !node.hidden&&node.style.display!=='none';};
    const change=(id,value)=>{const input=get(id);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));app.syncPropertiesPanel();};
    const pick=layer=>{manager.setActive(layer.id);app.syncPropertiesPanel();};
    app.settingsManager.set('animationsEnabled',false);
    let layer=manager.addLayer('Прямоугольник — arbitrary name');layer.ctx.fillStyle='#336699';layer.ctx.fillRect(4,4,20,18);layer.invalidateSource();pick(layer);
    expect(!shown('prop-group-shape')&&shown('prop-group-coords'),'A bitmap named after a shape exposes raster geometry, not nonexistent radius controls');
    expect(get('prop-transform-target').closest('label').hidden&&get('btn-prop-distribute-x').hidden,'Single objects hide multi-object controls');
    expect(get('btn-prop-original-size').hidden&&get('btn-prop-apply-transform').hidden,'Unused source-master actions stay hidden');
    history.clear();change('prop-opacity','50');expect(layer.opacity===.5&&history.undoStack.length===1,'Opacity creates one undoable layer change');
    history.undo();expect(layer.opacity===1,'Undo restores object opacity');history.redo();change('prop-opacity','0');
    expect(!get('prop-opacity').disabled&&get('prop-pos-x').disabled,'A fully transparent object keeps opacity editable while pixel editing is disabled');
    change('prop-opacity','100');expect(layer.opacity===1&&!get('prop-pos-x').disabled,'Restoring opacity re-enables geometry controls');
    change('prop-blend','multiply');expect(layer.blendMode==='multiply','Blend mode updates the actual selected layer');
    get('prop-locked').click();expect(layer.locked&&get('prop-opacity').disabled&&get('prop-pos-x').disabled,'Locking disables edits without disabling its unlock control');
    get('prop-locked').click();expect(!layer.locked&&!get('prop-opacity').disabled,'Unlocking restores editing');
    get('prop-visible').click();expect(!layer.visible&&!get('prop-opacity').disabled,'Hidden objects retain usable appearance controls');get('prop-visible').click();
    const snapshots=[];
    for(const type of ['rect-filled','rect-empty','circle-filled','circle-empty','line']){
        layer=manager.addLayer(type);layer.shapeData={type,x0:8,y0:8,x1:30,y1:26,color:'#CC6633',stroke:2,radius:3,filled:type.endsWith('-filled')};
        app.redrawShapeLayer(layer);pick(layer);const isRect=type.startsWith('rect'),filled=type.endsWith('-filled');
        expect(shown('prop-group-shape')&&shown('prop-shape-radius-row')===isRect,type+': radius appears only for rectangles');
        expect(shown('prop-shape-fill-row')===(type!=='line')&&shown('prop-shape-stroke-row')===!filled,type+': fill and line width match the rendered kind');
        history.clear();change('prop-shape-hex','12AB34');expect(layer.shapeData.color==='#12AB34'&&history.undoStack.length===1,type+': direct HEX recoloring stays editable and undoable');
        history.undo();expect(layer.shapeData.color==='#CC6633',type+': undo restores the original shape color');history.redo();
        if(!filled){change('prop-shape-stroke','4');expect(layer.shapeData.stroke===4,type+': line width updates shape metadata');}
        if(type==='rect-filled'){change('prop-shape-fill','outline');expect(layer.shapeData.type==='rect-empty'&&shown('prop-shape-stroke-row'),'Switching a rectangle to outline reveals working thickness');history.undo();expect(layer.shapeData.type==='rect-filled','Undo restores fill mode and metadata');}
        if(type==='line'){change('prop-shape-stroke','999');expect(layer.shapeData.stroke===4&&get('prop-shape-stroke').value==='4','Invalid thickness restores the last valid value');}
        snapshots.push({id:layer.id,type});
    }
    layer=manager.addLayer('Legacy filled rectangle');layer.shapeData={type:'rect-filled',x0:1,y0:1,x1:12,y1:12,color:'#FF0000',stroke:1,radius:0};app.redrawShapeLayer(layer);pick(layer);
    expect(!shown('prop-shape-stroke-row')&&layer.ctx.getImageData(5,5,1,1).data[3]===255,'Legacy filled shapes retain fill even without an explicit filled flag');
    layer.shapeData=null;layer.objectType='rect-filled';app.syncPropertiesPanel();expect(!shown('prop-group-shape'),'Rasterized shapes no longer advertise unavailable editable geometry');
    const group=manager.addLayer('Empty group',null,false,'group');pick(group);
    expect(!shown('prop-group-coords')&&!shown('prop-group-transform')&&shown('prop-group-appearance'),'An empty group shows appearance settings without fake dimensions');
    layer=manager.addLayer('Child');layer.groupId=group.id;layer.ctx.fillStyle='#FFFFFF';layer.ctx.fillRect(3,3,6,8);layer.invalidateSource();pick(group);
    expect(shown('prop-group-coords')&&!get('prop-field-w').hidden&&get('btn-prop-original-size').hidden,'A populated group exposes actual dimensions without single-image master actions');
    group.locked=true;pick(layer);expect(get('prop-pos-x').disabled&&get('prop-opacity').disabled,'Inherited group locks protect child properties');group.locked=false;pick(layer);
    const second=manager.addLayer('Second');second.ctx.fillRect(40,40,3,3);second.invalidateSource();manager.activeLayerId=layer.id;manager.selectedLayerIds=new Set([layer.id,second.id]);app.syncPropertiesPanel();
    expect(!get('prop-transform-target').closest('label').hidden&&get('btn-prop-distribute-x').hidden,'Multiple objects expose the target selector but distribution still needs three');
    app.tools.setTool('marquee');app.tools.tools.marquee.selection={x:2,y:2,width:8,height:8};app.syncPropertiesPanel();
    expect(shown('prop-group-selection')&&!shown('prop-group-appearance')&&!shown('prop-group-shape'),'Selection properties expose selection actions instead of layer appearance');
    app.tools.tools.marquee.clipboard=null;app.syncPropertiesPanel();get('btn-prop-sel-copy').click();
    expect(!get('btn-prop-sel-paste').disabled,'Copy immediately enables Paste without a document edit or unrelated redraw');
    pick(group);app.tools.tools.marquee.selection={x:2,y:2,width:8,height:8};app.syncPropertiesPanel();expect(get('btn-prop-sel-copy').disabled&&get('btn-prop-sel-content').disabled,'Group selections hide unsupported raw-canvas copy and alpha-selection actions');
    app.tools.tools.marquee.clearSelection();app.tools.setTool('move');
    const text=manager.addTextLayer('Text',{text:'AB',fontId:'minecraft',x:2,y:2});app.tools.tools.text.renderTextLayer(text);pick(text);
    expect(shown('prop-group-text')&&!shown('prop-group-shape')&&!shown('prop-group-color')&&!shown('prop-group-transform'),'Text has editable typography and layout without raster-only commands');
    text.locked=true;app.syncPropertiesPanel();expect(get('text-input').disabled,'Locked text fields cannot change the object');text.locked=false;app.syncPropertiesPanel();expect(!get('text-input').disabled,'Unlocked text restores its inputs');
    const serialized=app.projectManager.serializeProject();await app.projectManager.deserializeProject(serialized);
    expect(app.layerManager.getLayers().some(item=>item.shapeData?.color==='#12AB34'),'Edited shape metadata survives save and reopen');
    window.propertyFixtures=snapshots;
    return checks;
}

(async()=>{
    let win;const timer=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow(1280,900,{offscreen:false});win.showInactive();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Object properties'}});
        const checks=await win.webContents.executeJavaScript(`(${exerciseProperties.toString()})()`);await settle(win);
        for(const [type,theme] of [['rect-empty','dark'],['line','light'],['circle-filled','dark']]){
            await win.webContents.executeJavaScript(`(()=>{const app=window.mollyEditor,fixture=window.propertyFixtures.find(item=>item.type==='${type}');app.layerManager.getLayers().forEach(layer=>{layer.visible=layer.id===fixture.id;});app.layerManager.setActive(fixture.id);app.settingsManager.set('theme','${theme}');app.propertiesInspector.tabs.select('object');app.renderer.render();})()`);await settle(win);
            await fs.writeFile(path.join(root,'.test-output',`properties-${type}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript(`(()=>{const app=window.mollyEditor,fixture=window.propertyFixtures.find(item=>item.type==='line');app.layerManager.getLayers().find(layer=>layer.id===fixture.id).visible=true;app.layerManager.setActive(fixture.id);app.propertiesInspector.tabs.select('object');const field=document.getElementById('prop-shape-stroke');field.focus();field.select();})()`);
        await win.webContents.insertText('6');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle(win);
        if(!await win.webContents.executeJavaScript(`window.mollyEditor.layerManager.getActiveLayer().shapeData.stroke===6`))throw Error('Enter did not commit numeric property');checks.push('Native Enter commits the numeric property while keeping it ready for editing');
        await win.webContents.insertText('7');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle(win);
        if(!await win.webContents.executeJavaScript(`document.getElementById('prop-shape-stroke').value==='6'&&window.mollyEditor.layerManager.getActiveLayer().shapeData.stroke===6`))throw Error('Escape changed numeric property: '+JSON.stringify(await win.webContents.executeJavaScript(`({value:document.getElementById('prop-shape-stroke').value,focus:document.getElementById('prop-shape-stroke').dataset.focusValue,model:window.mollyEditor.layerManager.getActiveLayer().shapeData.stroke})`)));checks.push('Native Escape discards an uncommitted number');
        const base=await win.webContents.executeJavaScript(`(async()=>{const app=window.mollyEditor;app.addProject('GUI properties','container/default/container_54.png',256,256,false,'gui');await new Promise(resolve=>setTimeout(resolve,100));const layer=app.layerManager.getLayers().find(item=>item.isBase);app.layerManager.setActive(layer.id);app.syncPropertiesPanel();const shown=id=>{const node=document.getElementById(id);return !node.hidden&&node.style.display!=='none';};const settings=shown('prop-group-template')&&!shown('prop-group-color')&&!shown('prop-group-coords')&&!shown('prop-group-appearance');document.getElementById('prop-change-template').click();return {settings,opened:document.getElementById('template-modal').classList.contains('show')};})()`);
        if(!base.settings||!base.opened)throw Error('GUI background settings are inconsistent');checks.push('GUI background exposes template replacement without unusable raster actions');checks.push('The template replacement control opens the existing chooser');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/properties.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
