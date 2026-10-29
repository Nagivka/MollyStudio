// Real application screenshots, using the isolated Electron fixture profile.
const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle,evaluateMain}=require('./lib/electron-harness.cjs');
const destination=path.join(root,'forum-media');

async function createDemo(){
    const app=window.mollyEditor;
    await app.getActiveProject().templateLoadPromise;
    app.settingsManager.set('animationsEnabled',false);
    app.settingsManager.set('theme','dark');
    app.settingsManager.set('accentColor','auto');
    app.settingsManager.set('seasonalDetailsEnabled',false);
    app.settingsManager.set('showPixelGrid',false);
    app.resizeCanvas(176,238,'left','top');
    const {recolorGuiPixels}=await import(new URL('./js/core/GuiDesignPresets.mjs',location.href).href);
    const base=app.layerManager.getLayers().find(layer=>layer.isBase);
    base.ctx.putImageData(recolorGuiPixels(base.ctx.getImageData(0,0,176,238),'night-cyan'),0,0);base.invalidateSource();
    const textTool=app.tools.tools.text;
    const text=(value,x,y,color='#F2F7FF',name=value,font='minecraft',size=8)=>{
        const layer=app.layerManager.addTextLayer(name,{text:value,x,y,color,fontId:font,fontSize:size,shadow:true,shadowMode:'auto',shadowOffsetX:1,shadowOffsetY:1});
        textTool.renderTextLayer(layer);return layer;
    };
    const centered=(value,y,color='#F2F7FF',size=8)=>{
        const layer=text(value,0,y,color,value,'smallcaps',size),layout=textTool.getTextLayout(layer);
        layer.textData.x=Math.round((176-layout.width)/2);textTool.renderTextLayer(layer);return layer;
    };
    centered('МЕНЮ СЕРВЕРА',4,'#D2F4FF');
    const generator=app.buttonGeneratorModal;
    generator.colorMode='gradient';generator.autoShadeEnabled=true;generator.tintedBorderEnabled=true;generator.gradientAngle=90;
    const image=async id=>{
        const item=app.itemsPanel.itemsById.get(id);if(!item)throw Error('Missing demo item '+id);
        const img=new Image();img.src=`assets/${item.folder||'items_minecraft'}/${item.file}`;await img.decode();return img;
    };
    const cards=[
        ['compass','ВАРПЫ',['#214E82','#3A83AF']],['emerald','МАГАЗИН',['#22694F','#439C6A']],['diamond','НАГРАДЫ',['#126A83','#33A3B4']],
        ['book','ПРАВИЛА',['#564685','#8A6DB2']],['ender_pearl','ПРОФИЛЬ',['#205B61','#4D9694']],['gold_ingot','БОНУСЫ',['#825322','#B78E43']]
    ];
    for(let i=0;i<cards.length;i++){
        const [id,label,colors]=cards[i],x=8+(i%3)*54,y=35+Math.floor(i/3)*36;
        const layer=app.layerManager.addLayer(label);generator.gradientColors=colors;
        const button=generator.renderButton(52,34,generator.colors,'ten',100,false,1,1);
        layer.ctx.drawImage(button,x,y);button.width=button.height=1;
        const img=await image(id);layer.ctx.drawImage(img,x+18,y+4,16,16);layer.invalidateSource();
        const caption=text(label,0,y+23,'#FFFFFF',label+' — текст','minecraft',8);
        const width=textTool.getTextLayout(caption).width;caption.textData.x=x+Math.round((52-width)/2);textTool.renderTextLayer(caption);
    }
    const footer=app.layerManager.addLayer('Кнопка выхода');generator.gradientColors=['#3C5266','#657D93'];
    const close=generator.renderButton(52,16,generator.colors,'outline',100,false,1,1);footer.ctx.drawImage(close,62,116);close.width=close.height=1;footer.invalidateSource();
    const caption=centered('ЗАКРЫТЬ',120,'#ECF4FF',8);
    text('Инвентарь',8,144,'#B2CCD8','Подпись инвентаря','minecraft',8);
    app.tools.setTool('move');app.layerManager.setActive(caption.id);
    for(const id of ['layers','items'])document.getElementById(id+'-panel-section').classList.add('expanded');
    document.getElementById('properties-panel-section').classList.remove('expanded');
    document.getElementById('color-panel-section').classList.remove('expanded');
    app.renderer.render();app.layerPanel.render();app.bus.emit('CANVAS_UPDATED');app.workspace.fitToScreen();
    app.history.clear();app.saveProjectState();
    window.forumGuiId=app.activeProjectId;
    return {resourceCount:app.itemsPanel.items.length};
}

async function createPrefix(){
    const app=window.mollyEditor;app.addProject('Префикс • PREMIUM','none',64,16,false,'prefix');
    await app.prefixEditor.renderer.load();
    app.prefixEditor.change(data=>{
        Object.assign(data.blocks[0],{text:'PREMIUM',font:'smallcaps',background:'gradient',backgroundColors:['#773A11','#F8C95A'],backgroundAngle:90,
            textMode:'solid',textColors:['#FFF8DE'],textShadow:true,textShadowMode:'auto',autoShade:true,bevel:true,borderWidth:1,paddingX:7,paddingY:4,
            radiusTopLeft:2,radiusTopRight:2,radiusBottomRight:2,radiusBottomLeft:2,texture:{type:'none'}});
    });
    app.workspace.fitToScreen();app.history.clear();app.saveProjectState();
    window.forumPrefixId=app.activeProjectId;
}

(async()=>{
    let win,buttons,settings;const timer=setTimeout(()=>app.exit(1),180000);
    try{
        await fs.mkdir(destination,{recursive:true});await ready({durable:true});
        win=makeWindow(1920,1080);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'gui',template:'container/default/container_54_frame.png',width:'256',height:'256',name:'Меню сервера'}});
        await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('main').setFullScreen(true));
        await win.page.waitForFunction(()=>window.mollyEditor?.tools.tools.text.fontImages.smallcaps&&window.mollyEditor.tools.tools.text.fontImages.minecraft);
        const meta=await win.page.evaluate(createDemo);await win.page.waitForTimeout(3500);
        const snap=async(name,selector)=>{await settle(win);await win.showInactive();await win.page.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});await fs.writeFile(path.join(destination,name),selector?await win.page.locator(selector).screenshot(): (await win.webContents.capturePage()).toPNG());};
        await snap('03-editor.png');
        await win.page.evaluate(async()=>{await mollyEditor.projectManager.saveProjectAs();});
        await win.page.evaluate(async()=>{await window.mollyEditor.guiPreviewPanel.open();});await snap('07-minecraft-preview.png','.gui-preview-dialog');
        await win.page.evaluate(()=>window.mollyEditor.guiPreviewPanel.dialog.close());
        await win.page.evaluate(async()=>{await window.mollyEditor.designGallery.open();});await win.page.waitForSelector('.design-gallery-card canvas');await snap('06-designs.png','.design-gallery-dialog');
        await win.page.evaluate(()=>window.mollyEditor.designGallery.dialog.close());await settle(win);
        buttons=makeWindow(1920,1080,{label:'buttons'});await buttons.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(buttons);
        await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('buttons').setFullScreen(true));
        await buttons.page.evaluate(()=>{const g=window.buttonGenApp;g.setCols(3);g.setZoom(4);g.gradientColors=['#2355A7','#28B5C4'];g.autoShadeEnabled=true;g.tintedBorderEnabled=true;g.setStyle('ten');g.setColorMode('gradient');document.querySelector('.buttons-sidebar-scroll-area').scrollTop=360;});
        await settle(buttons);await fs.writeFile(path.join(destination,'04-buttons.png'),(await buttons.webContents.capturePage()).toPNG());buttons.destroy();buttons=null;
        await win.page.evaluate(createPrefix);await snap('05-prefix.png');
        await win.page.evaluate(()=>{mollyEditor.prefixEditor.tabs.select('background');document.querySelector('.prefix-scroll').scrollTop=0;});
        await snap('13-prefix-background.png');
        await win.page.evaluate(async()=>{await mollyEditor.exportPanel.open('prefixes');});
        await win.page.locator('[data-export="names"]').fill('VIP\nPREMIUM\nADMIN');
        await win.page.waitForTimeout(250);await snap('18-export.png','.export-dialog');
        await win.page.evaluate(()=>mollyEditor.exportPanel.close());
        await win.page.evaluate(()=>mollyEditor.menuBar.handleAction('utility-gradient'));
        await snap('08-utilities.png','#utilities-dialog');
        await win.page.evaluate(()=>document.getElementById('utilities-dialog').close());
        await win.page.evaluate(()=>mollyEditor.menuBar.handleAction('utility-smallcaps'));
        await snap('17-smallcaps.png','#utilities-dialog');
        await win.page.evaluate(()=>document.getElementById('utilities-dialog').close());
        settings=makeWindow(1920,1080,{label:'settings'});await settings.loadFile(path.join(root,'src/renderer/settings.html'));await settle(settings);
        await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('settings').setFullScreen(true));
        await settings.page.click('#settings-tab-effects');await settle(settings);
        await fs.writeFile(path.join(destination,'12-settings.png'),(await settings.webContents.capturePage()).toPNG());settings.destroy();settings=null;
        await win.loadFile(path.join(root,'src/renderer/index.html'));await settle(win);
        // Redact fixture paths in publication screenshots without changing the app.
        await win.page.addStyleTag({content:'.m3-recent-path{visibility:hidden}'});
        await snap('01-launcher.png');
        await win.showInactive();
        await win.page.evaluate(async()=>{const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));const s=new Settings();s.set('animationsEnabled',true);s.set('weatherEffect','snow');s.set('weatherDensity','dense');s.set('weatherOpacity',90);s.set('weatherSize',150);});
        await win.page.waitForTimeout(1800);await snap('19-weather.png');
        const create=makeWindow(1920,1080,{label:'new-project'});
        try{
            await create.loadFile(path.join(root,'src/renderer/new-project.html'));await settle(create);
            await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('new-project').setFullScreen(true));
            await settle(create);await fs.writeFile(path.join(destination,'02-new-project.png'),(await create.webContents.capturePage()).toPNG());
        }finally{create.destroy();}
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(destination,'capture-info.json'),JSON.stringify({version:require('../package.json').version,...meta,screenshots:13,fullscreen:true,theme:'dark',localPathsRedacted:true},null,2));console.log('Saved thirteen focused default-theme screenshots from the fullscreen application.');
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timer);buttons?.destroy();settings?.destroy();win?.destroy();app.exit(process.exitCode||0);}
})();
