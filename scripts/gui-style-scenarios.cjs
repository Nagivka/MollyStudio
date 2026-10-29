const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

async function exerciseGui(){
    const app=window.mollyEditor,checks=[];
    const expect=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
    const pixels=layer=>String(layer.ctx.getImageData(0,0,layer.width,layer.height).data);
    await app.getActiveProject().templateLoadPromise;
    for(const id of ['new-proj-style','proj-style'])expect(Array.from(document.getElementById(id).options).map(option=>option.value).join(',')==='default,bedrock','GUI style chooser offers only Vanilla and Bedrock: '+id);
    const extra=app.layerManager.addLayer('Content');extra.ctx.fillStyle='#F12345';extra.ctx.fillRect(12,25,6,6);extra.invalidateSource();
    const before=pixels(extra);app.history.clear();
    expect(await app.loadTemplate('container/bedrock/container_54_frame.png'),'Bedrock replaces an existing GUI template');
    expect(pixels(extra)===before,'Template replacement preserves content layers');
    app.prepareTemplateModal();expect(document.getElementById('proj-style').value==='bedrock','Template dialog restores the saved Bedrock style');
    expect(app.history.undo()&&app.getActiveProject().templatePath.includes('/default/'),'Undo restores the original GUI template');
    expect(app.history.redo()&&app.getActiveProject().templatePath.includes('/bedrock/'),'Redo restores Bedrock and its metadata');
    const saved=app.projectManager.serializeProject();await app.projectManager.deserializeProject(saved);
    expect(app.getActiveProject().templatePath==='container/bedrock/container_54_frame.png','MLST round trip retains Bedrock');
    const legacy=app.projectManager.serializeProject(),legacyPixels=pixels(app.layerManager.getLayers().find(layer=>layer.isBase));legacy.templatePath='container/flat/container_54_frame.png';
    await app.projectManager.deserializeProject(legacy);
    expect(app.getActiveProject().templatePath==='container/default/container_54_frame.png','A saved retired template falls back to Vanilla metadata');
    expect(pixels(app.layerManager.getLayers().find(layer=>layer.isBase))===legacyPixels,'Opening a retired template preserves its saved base image');
    const base=app.layerManager.getLayers().find(layer=>layer.isBase);base.fx.texture={type:'checker',amount:50,scale:2,seed:1};base.releaseRenderCache();
    app.history.clear();const original=pixels(base),other=app.layerManager.getLayers().find(layer=>layer.name==='Content'),otherPixels=pixels(other);
    await app.designGallery.open();
    expect(document.querySelectorAll('.design-gallery-card').length===76,'Gallery offers all 76 GUI designs');
    expect(document.querySelector('[data-design-category]').options.length===10,'GUI gallery exposes every palette category');
    const search=document.querySelector('[data-design-search]');search.value='Сапфир';search.dispatchEvent(new Event('input',{bubbles:true}));
    expect(document.querySelectorAll('.design-gallery-card').length===1,'GUI design search filters the library');
    document.querySelector('.design-gallery-card').click();
    const image=app.designGallery.fullImage((await import(new URL('./js/core/GuiDesignPresets.mjs',location.href).href)).GUI_DESIGNS.find(item=>item.id==='sapphire'));
    const expected=String(image.getContext('2d').getImageData(0,0,image.width,image.height).data);image.width=image.height=1;
    app.designGallery.apply();
    expect(!base.fx.texture&&pixels(base)===expected,'Applying a GUI design removes old texture and matches its preview pixels');
    expect(pixels(other)===otherPixels,'A design does not modify other layers');
    expect(app.history.undo()&&base.fx.texture.type==='checker'&&pixels(base)===original,'Undo restores both the old texture and the old pixels');
    expect(app.history.redo()&&!base.fx.texture&&pixels(base)===expected,'Redo restores the clean design');
    // A close event is asynchronous: let its cleanup finish before reopening.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    await app.designGallery.open();
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    return checks;
}

async function exerciseButtons(embedded){
    const app=embedded?window.mollyEditor.buttonGeneratorModal:window.buttonGenApp,checks=[];
    const expect=(value,message)=>{if(!value)throw Error(message);checks.push(message);};
    if(embedded){app.open();await new Promise(resolve=>requestAnimationFrame(resolve));}
    const root=embedded?app.modalEl:document,prefix=embedded?'modalSegStyle':'segStyle';
    expect(root.querySelectorAll('.button-style-selector button').length===5,'Five button styles in '+(embedded?'embedded':'standalone')+' generator');
    expect(root.querySelector('#'+prefix+'Ten').textContent==='Bedrock','Bedrock replaces the former TEN label');
    expect(app.currentChin===1&&!root.querySelector('[data-chin="0"]'),'Bedrock defaults to one pixel and has no zero option');
    expect(getComputedStyle(root.querySelector(embedded?'#modalChinInput':'#chinInput').closest('.control-group')).display==='none','Default style starts without a chin control');
    for(const style of ['outline','double','ten','flat','default']){
        root.querySelector('#'+prefix+style[0].toUpperCase()+style.slice(1)).click();
        expect(app.currentStyle===style&&root.querySelectorAll('.button-style-selector [aria-pressed="true"]').length===1,'Style selection and pressed state: '+style);
        const chin=root.querySelector(embedded?'#modalChinInput':'#chinInput'),thickness=root.querySelector(embedded?'#modalShadowInput':'#shadowInput');
        if(style==='ten'){
            expect(chin.min==='1'&&chin.value==='1','Bedrock slider starts at its one-pixel minimum');
            app.setChin(0);expect(app.currentChin===1,'A legacy zero value clamps to one pixel');
            app.setChin(5);expect(app.currentChin===5&&chin.value==='5','Bedrock can increase its chin to five pixels');app.setChin(1);
        }
        expect((getComputedStyle(chin.closest('.control-group')).display==='none')===(style!=='ten'),'Only Bedrock shows the chin control: '+style);
        expect(thickness.getAttribute('aria-label').includes(['outline','double'].includes(style)?'контура':'фаски'),'Thickness control describes the current style: '+style);
        for(const mode of ['solid','gradient']){
            app.setColorMode(mode);const data=app.createButtonData();
            expect(data.style===style&&data.normalDataUrl.startsWith('data:image/png;base64,')&&data.w>0&&data.h>0,'PNG import data: '+style+' '+mode);
        }
    }
    app.setStyle('double');return checks;
}

async function inspectPixels(kind){
    const app=window.mollyEditor,checks=[],expect=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
    const {getExportRegion}=await import(new URL('./js/graphics/ExportImage.js',location.href).href);
    const {drawLayers}=await import(new URL('./js/graphics/LayerCompositing.js',location.href).href);
    const source=document.createElement('canvas');source.width=app.config.width;source.height=app.config.height;
    if(kind==='gallery')source.getContext('2d').drawImage(app.designGallery.source,0,0);
    else drawLayers(source.getContext('2d'),app.layerManager.getLayers());
    const canvas=document.querySelector(kind==='gallery'?'.design-gallery-card canvas':'.gui-preview-dialog canvas'),rect=canvas.getBoundingClientRect(),region=getExportRegion(source,true),ratio=devicePixelRatio,scale=kind==='gallery'?1:1.5;
    expect(canvas.width===Math.round(region.width*ratio*scale)&&canvas.height===Math.round(region.height*ratio*scale),kind+': physical backing dimensions, DPR '+ratio+' source '+region.width+'x'+region.height+' canvas '+canvas.width+'x'+canvas.height);
    expect(Math.abs(rect.width*ratio-canvas.width)<.06&&Math.abs(rect.height*ratio-canvas.height)<.06,kind+': no CSS shrink or stretch, DPR '+ratio);
    expect(Math.abs(rect.left*ratio-Math.round(rect.left*ratio))<.06&&Math.abs(rect.top*ratio-Math.round(rect.top*ratio))<.06,kind+': physical pixel alignment, DPR '+ratio);
    const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,original=source.getContext('2d').getImageData(region.x,region.y,region.width,region.height).data;
    let equal=true;
    for(let y=0;y<canvas.height&&equal;y++)for(let x=0;x<canvas.width&&equal;x++){
        const sy=Math.min(region.height-1,Math.floor((y+.5)*region.height/canvas.height)),sx=Math.min(region.width-1,Math.floor((x+.5)*region.width/canvas.width));
        for(let c=0;c<4;c++)if(pixels[(y*canvas.width+x)*4+c]!==original[(sy*region.width+sx)*4+c]){equal=false;break;}
    }
    expect(equal,kind+': every displayed pixel matches nearest original RGBA, DPR '+ratio);source.width=source.height=1;
    return checks;
}

(async()=>{
    let win,buttons;const checks=[],watchdog=setTimeout(()=>app.exit(1),150000);
    try{
        await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'gui',template:'container/default/container_54.png',width:'256',height:'256',name:'GUI styles QA'}});
        await win.showInactive();checks.push(...await win.page.evaluate(exerciseGui));await settle(win);
        // Original first card has unchanged source colors, allowing byte-exact preview assertions.
        for(const [style,template] of [['vanilla','container/default/container_27.png'],['bedrock','container/bedrock/container_54_frame.png'],['special','gui_container/villager.png']]){
            await win.page.evaluate(async template=>{const app=window.mollyEditor;app.designGallery.dialog.close();await new Promise(r=>requestAnimationFrame(r));await app.loadTemplate(template);await app.designGallery.open();const search=document.querySelector('[data-design-search]');search.value='';search.dispatchEvent(new Event('input'));},template);
            for(const ratio of [1,1.25,1.5,2]){
                win.setContentSize(1280,1000);win.webContents.setZoomFactor(ratio);await settle(win);
                await win.page.waitForSelector('.design-gallery-card canvas');await win.page.evaluate(async()=>{await Promise.allSettled(document.querySelector('.design-gallery-dialog').getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});checks.push(...await win.page.evaluate(inspectPixels,'gallery'));
                if(style==='vanilla'&&ratio===1)await fs.writeFile(path.join(root,'.test-output/gui-styles-gallery.png'),(await win.webContents.capturePage()).toPNG());
            }
        }
        await win.page.evaluate(async()=>{const app=window.mollyEditor;app.designGallery.dialog.close();await new Promise(r=>requestAnimationFrame(r));await app.loadTemplate('container/bedrock/container_54_frame.png');window.beforeStylePreview=JSON.stringify(app.projectManager.serializeProject());await app.guiPreviewPanel.open();});
        for(const ratio of [1,1.25,1.5,2]){
            win.setContentSize(1280,1000);win.webContents.setZoomFactor(ratio);await settle(win);await win.page.evaluate(async()=>{await Promise.allSettled(document.querySelector('.gui-preview-dialog').getAnimations().map(a=>a.finished));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});checks.push(...await win.page.evaluate(inspectPixels,'game'));
            if(ratio===1)await fs.writeFile(path.join(root,'.test-output/gui-styles-game.png'),(await win.webContents.capturePage()).toPNG());
        }
        if(!await win.page.evaluate(()=>window.beforeStylePreview===JSON.stringify(window.mollyEditor.projectManager.serializeProject())))throw Error('Preview changed document data');checks.push('Game preview leaves the document unchanged');
        await win.page.evaluate(()=>window.mollyEditor.guiPreviewPanel.dialog.close());win.setContentSize(1280,900);win.webContents.setZoomFactor(1);await settle(win);
        checks.push(...await win.page.evaluate(exerciseButtons,true));await settle(win);await win.page.evaluate(async()=>{await Promise.allSettled(document.querySelector('.btn-gen-modal').getAnimations().map(a=>a.finished));});await fs.writeFile(path.join(root,'.test-output/gui-styles-buttons-modal.png'),(await win.webContents.capturePage()).toPNG());
        buttons=makeWindow(1000,800,{label:'buttons'});await buttons.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(buttons);checks.push(...await buttons.page.evaluate(exerciseButtons,false));
        await fs.writeFile(path.join(root,'.test-output/gui-styles-buttons-window.png'),(await buttons.webContents.capturePage()).toPNG());
        for(const window of [win,buttons])if(window.__testErrors.length)throw Error(window.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/gui-styles.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);if(win?.page)await fs.writeFile(path.join(root,'.test-output/gui-styles-failed.png'),(await win.webContents.capturePage()).toPNG()).catch(()=>{});process.exitCode=1;}
    finally{clearTimeout(watchdog);buttons?.destroy();win?.destroy();app.exit(process.exitCode||0);}
})();
