const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

(async()=>{
    const editorOnly=process.argv.includes('--editor-only');
    let win;const results=[],timer=setTimeout(()=>app.exit(1),300000),output=path.join(root,'.test-output/minecraft-theme-audit'+(editorOnly?'-editor':''));
    try{
        const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');
        await ready();win=makeWindow(1440,900);await fs.mkdir(output,{recursive:true});
        async function inspect(context){
            await settle(win);
            const report=await win.page.evaluate(inspectInterfaceGeometry);
            const details=await win.page.evaluate(()=>{
                const visible=el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&r.bottom>0&&r.top<innerHeight&&!el.closest('[hidden]')&&getComputedStyle(el).visibility!=='hidden';};
                const top=document.querySelector('dialog[open],.modal-overlay.show')||document;
                const rounded=[...top.querySelectorAll('button,select,textarea,input:not([type=range],[type=hidden],[type=file],[type=color]),dialog[open]')].filter(visible).filter(el=>!el.closest('.settings-theme-card')&&parseFloat(getComputedStyle(el).borderTopLeftRadius)>0).map(el=>({id:el.id||el.className,label:el.textContent.trim().slice(0,40),radius:getComputedStyle(el).borderTopLeftRadius}));
                const levers=[...top.querySelectorAll('.md-switch-track,.m3-switch-track')].filter(visible).map(track=>{
                    const thumb=track.querySelector('.md-switch-thumb,.m3-switch-thumb'),r=track.getBoundingClientRect(),t=thumb.getBoundingClientRect();
                    return {label:track.parentElement.textContent.trim(),dy:t.y+t.height/2-r.y-r.height/2};
                });
                const brokenGroupEdges=[];
                for(const group of top.querySelectorAll('.m3-segmented-button')){
                    let previousY=null;
                    for(const button of [...group.children].filter(el=>el.matches('.m3-segment-item')&&visible(el))){
                        const y=button.getBoundingClientRect().top;
                        if(y!==previousY&&parseFloat(getComputedStyle(button).borderLeftWidth)<1)brokenGroupEdges.push(button.textContent.trim());
                        previousY=y;
                    }
                }
                const scrim=document.querySelector('dialog[open],.modal-overlay.show');
                const scrimFilter=scrim?getComputedStyle(scrim,scrim.matches('dialog')?'::backdrop':null).backdropFilter:'none';
                return {rounded,levers,brokenGroupEdges,scrimFilter};
            });
            const errors=['overlaps','clipped','overflow','pixelFallbacks','dialogsOutside'].filter(key=>report[key].length);
            if(report.rootOverflow>2)errors.push('rootOverflow');
            if(details.rounded.length)errors.push('rounded');
            if(details.levers.some(lever=>Math.abs(lever.dy+2)>.15))errors.push('lever offset');
            if(details.brokenGroupEdges.length)errors.push('missing row border');
            if(details.scrimFilter!=='none')errors.push('blurred scrim');
            results.push({context,errors,report,details});
            if(errors.length||context.capture)await fs.writeFile(path.join(output,`${results.length}-${context.screen}-${context.theme}.png`),(await win.webContents.capturePage()).toPNG());
        }
        for(const theme of editorOnly?[]:['minecraft','light-minecraft']) {
            for(const [width,height,zoom,language] of [[1440,900,1,'ru'],[1000,760,1.25,'en']]) {
                for(const tab of ['appearance','effects','canvas','tools','export','discord','backup','hotkeys','about']) {
                    await win.loadFile(path.join(root,'src/renderer/settings.html'),{query:{tab}});
                    win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
                    await win.page.evaluate(async ({theme,language})=>{
                        const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));
                        window.auditSettings=new Settings();auditSettings.set('language',language);auditSettings.set('theme',theme);auditSettings.set('animationsEnabled',false);
                    },{theme,language});
                    const positions=await win.page.locator('#settings-content-area').evaluate(el=>Math.max(1,Math.ceil(el.scrollHeight/el.clientHeight)));
                    for(let scroll=0;scroll<positions;scroll++){
                        await win.page.locator('#settings-content-area').evaluate((el,scroll)=>el.scrollTop=scroll*Math.max(1,el.clientHeight-48),scroll);
                        await inspect({screen:`settings-${tab}`,theme,width,height,zoom,language,scroll,capture:width===1440&&scroll===0});
                    }
                }
            }
            console.log('Checked all settings sections and scroll positions: '+theme);
        }
        for(const type of ['gui','prefix']){
            await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type,width:'64',height:'64',size:'54',name:'Minecraft theme audit'}});
            await win.page.evaluate(()=>mollyEditor.settingsManager.set('animationsEnabled',false));
            for(const theme of ['minecraft','light-minecraft'])for(const [width,height,zoom,language]of [[1440,900,1,'ru'],[1000,760,1.25,'en']]){
                win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
                await win.page.evaluate(({theme,language})=>{mollyEditor.settingsManager.set('theme',theme);mollyEditor.settingsManager.set('language',language);},{theme,language});
                const states=type==='gui'?['button-generator','gallery','gui-preview','export','texture','history','gradient','smallcaps','confirm','resize','template','recolor','new-project']:['gallery','gradient','confirm'];
                for(const state of states){
                    await win.page.evaluate(async state=>{
                        const a=mollyEditor;
                        switch(state){
                            case 'button-generator':a.buttonGeneratorModal.open();break;
                            case 'gallery':await a.designGallery.open();break;
                            case 'gui-preview':await a.guiPreviewPanel.open();break;
                            case 'export':await a.exportPanel.open();break;
                            case 'texture':a.texturePanel.open();break;
                            case 'history':a.historyPanel.open();break;
                            case 'resize':a.openCanvasSizeModal();break;
                            case 'template':a.menuBar.handleAction('file-template');break;
                            case 'recolor':a.openQuickRecolor();break;
                            case 'new-project':document.querySelector('#new-project-modal').classList.add('show');break;
                            case 'gradient':case 'smallcaps':a.menuBar.handleAction('utility-'+state);break;
                            case 'confirm':{
                                const {confirmDialog}=await import(new URL('js/ui/ConfirmDialog.js',location.href));
                                void confirmDialog({title:'Удалить выбранный объект?',message:'Проверка размещения текста и кнопок в теме Minecraft. Изменения можно будет отменить.',confirmLabel:'Удалить',danger:true});break;
                            }
                        }
                    },state);
                    if(!await win.page.locator('dialog[open],.modal-overlay.show').count())throw Error('Audit state did not open: '+state);
                    await inspect({screen:`${type}-${state}`,theme,width,height,zoom,language,capture:width===1440});
                    await win.page.evaluate(()=>{
                        document.querySelector('.m3-confirm-dialog .outlined')?.click();
                        document.querySelectorAll('dialog[open]').forEach(el=>el.close());
                        if(mollyEditor.buttonGeneratorModal.modalEl?.classList.contains('show'))mollyEditor.buttonGeneratorModal.close();
                        document.querySelectorAll('.modal-overlay.show').forEach(el=>el.classList.remove('show'));
                    });
                    await settle(win);
                }
                const sections=type==='prefix'?['text','background']:['text-properties','shape-properties','button-properties'];
                for(const section of sections){
                    await win.page.evaluate(async section=>{
                        const a=mollyEditor;
                        if(section==='text'||section==='background'){
                            a.prefixEditor.tabs.select(section);
                            if(section==='text'){
                                const checkbox=document.querySelector('[data-prefix-field="textShadow"]');
                                if(!checkbox.checked)checkbox.click();
                                document.querySelector('[data-prefix-mode="textShadowMode:gradient"]')?.click();
                                document.querySelector('[data-prefix-mode="textMode:gradient"]')?.click();
                            }else{
                                document.querySelector('[data-prefix-mode="background:gradient"]')?.click();
                                const texture=document.querySelector('[data-prefix-field="texture.type"]');
                                texture.value='grain';texture.dispatchEvent(new Event('input',{bubbles:true}));texture.dispatchEvent(new Event('change',{bubbles:true}));
                            }
                        }else{
                            let layer;
                            if(section==='text-properties'){
                                layer=a.layerManager.addTextLayer('Audit text',{text:'Minecraft',fontId:'minecraft',x:2,y:2});
                                a.tools.setTool('text');a.tools.tools.text.renderTextLayer(layer);
                            }else if(section==='shape-properties'){
                                layer=a.layerManager.addLayer('Audit rectangle');
                                layer.shapeData={type:'rect-empty',x0:2,y0:2,x1:25,y1:25,color:'#336699',stroke:2,radius:3};a.redrawShapeLayer(layer);
                            }else{
                                a.buttonGeneratorModal.open();await a.buttonGeneratorModal.importToProject();
                                layer=a.layerManager.getActiveLayer();
                            }
                            a.layerManager.setActive(layer.id);a.syncPropertiesPanel();
                            document.querySelector('#main-right-panel .md-panel-props:not(.expanded) > .md-panel-header')?.click();
                        }
                    },section);
                    await settle(win);
                    const selector=type==='prefix'?'.prefix-scroll':'#main-right-panel';
                    const positions=await win.page.locator(selector).evaluate(el=>Math.max(1,Math.ceil(el.scrollHeight/Math.max(1,el.clientHeight-48))));
                    for(let scroll=0;scroll<positions;scroll++){
                        await win.page.locator(selector).evaluate((el,scroll)=>el.scrollTop=scroll*Math.max(1,el.clientHeight-48),scroll);
                        await inspect({screen:`${type}-${section}`,theme,width,height,zoom,language,scroll,capture:width===1440&&scroll===0});
                    }
                }
            }
            console.log('Checked editor dialogs: '+type);
        }
        await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:results.every(r=>!r.errors.length),cases:results.length,results},null,2));
        const failed=results.filter(r=>r.errors.length);
        if(failed.length)throw Error(JSON.stringify(failed.map(({context,errors,report,details})=>({context,errors,overlaps:report.overlaps,clipped:report.clipped,overflow:report.overflow,rounded:details.rounded,offsets:details.levers.filter(l=>Math.abs(l.dy+2)>.15)}))).slice(0,18000));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        console.log(JSON.stringify({passed:true,cases:results.length}));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
