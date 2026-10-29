const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
const {collectUntranslated}=require('./lib/locale-audit.cjs');
(async()=>{
    let win;const checks=[],timer=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'128',height:'96',name:'Button properties'}});await win.showInactive();await settle(win);
        checks.push(...await win.page.evaluate(async()=>{
            const app=mollyEditor,checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
            const {default:Model}=await import(new URL('js/ui/ButtonGeneratorModel.js',location.href));
            const {importGeneratedButton}=await import(new URL('js/core/GeneratedButtonImport.js',location.href));
            const {renderButtonData}=await import(new URL('js/core/ButtonDocument.mjs',location.href));
            const model=new Model();Object.assign(model,{currentCols:2,currentRows:1,currentSlotMode:'full',currentSlotSize:18,currentStyle:'ten',currentChin:1,currentShadow:1,currentOpacity:100});
            expect(await importGeneratedButton(app,model.createButtonData()),'Generated button inserts with an editable recipe');
            let layer=app.layerManager.getActiveLayer(),properties=app.propertiesInspector.buttonProperties;
            properties.sync(layer);expect(layer.objectType==='button'&&layer.buttonData&&!properties.element.hidden,'The selected button exposes its own properties');
            const before=layer.canvas.toDataURL(),rect={...layer.sourceRect};app.history.clear();
            expect(properties.edit({baseColor:'#CC6644',style:'double'}),'Style and fill can be changed directly in properties');
            expect(layer.canvas.toDataURL()!==before&&layer.sourceRect.x===rect.x&&layer.sourceRect.y===rect.y,'Editing preserves the button position and updates its pixels');
            app.history.undo();expect(layer.canvas.toDataURL()===before&&layer.buttonData.style==='ten','Undo restores both the pixels and the editable recipe');app.history.redo();
            properties.sync(layer);properties.edit({colorMode:'gradient',gradientColors:['#22CC66','#3355FF','#FFCC44'],gradientAngle:45});
            expect(layer.buttonData.gradientColors.length===3&&properties.element.querySelectorAll('.grad-stop-row').length===3,'Gradient properties render editable color stops');
            properties.edit({width:54,chin:3,bevel:2});expect(layer.buttonData.width===54&&layer.sourceRect.w===54,'Button size changes keep the original slot position');
            app.tools.tools.move.rotateFixed(90);app.tools.tools.move.flip(true,false);
            const master=layer.sourceCanvas.toDataURL(),recreated=renderButtonData(layer.buttonData);
            expect(recreated.toDataURL()===master,'The saved recipe reproduces a rotated and mirrored button exactly');
            properties.sync(layer);properties.edit({gradientAngle:135});
            expect(layer.sourceCanvas.width===recreated.width&&layer.sourceCanvas.height===recreated.height,'Editing a transformed button preserves its orientation');
            recreated.width=recreated.height=1;
            const serialized=app.projectManager.serializeProject();expect(serialized.layers.some(item=>item.buttonData?.width===54),'MLST serialization includes the button recipe');
            const saved=layer.canvas.toDataURL();await app.projectManager.deserializeProject(serialized);
            layer=app.layerManager.layers.find(item=>item.buttonData);app.layerManager.setActive(layer.id);properties.sync(layer);
            expect(layer.canvas.toDataURL()===saved&&layer.buttonData.width===54&&!properties.element.hidden,'Reopening MLST preserves editable buttons and exact pixels');
            const copy=app.layerManager.duplicateLayer(layer.id);expect(JSON.stringify(copy.buttonData)===JSON.stringify(layer.buttonData),'Duplicated buttons retain independent editable recipes');
            copy.buttonData.gradientColors[0]='#FFFFFF';expect(copy.buttonData.gradientColors[0]!==layer.buttonData.gradientColors[0],'Duplicated recipes do not share mutable colors');
            const snapshot=copy.getImageData();copy.ctx.fillStyle='#123456';copy.ctx.fillRect(0,0,1,1);copy.invalidateSource();
            expect(!copy.buttonData,'A destructive pixel edit detaches the generator recipe');copy.putImageData(snapshot);
            expect(copy.buttonData?.width===54,'Restoring a pixel snapshot also restores the generator recipe');
            return checks;
        }));
        await win.page.screenshot({path:path.join(root,'.test-output/button-properties.png')});
        for(const theme of ['dark','minecraft','light-minecraft']){
            await win.page.evaluate(theme=>mollyEditor.settingsManager.set('theme',theme),theme);await settle(win);
            const fits=await win.page.evaluate(()=>{
                const section=document.querySelector('#prop-group-button'),bounds=section.getBoundingClientRect();
                return section.scrollWidth<=section.clientWidth+1&&[...section.querySelectorAll('input,select,button')].filter(input=>input.getClientRects().length).every(input=>input.getBoundingClientRect().right<=bounds.right+1);
            });
            if(!fits)throw Error('Button properties overflow in '+theme);checks.push('Button properties fit the narrow inspector in '+theme);
        }
        await win.page.evaluate(()=>mollyEditor.settingsManager.set('language','en'));await settle(win);
        const missing=await win.webContents.executeJavaScript(`(${collectUntranslated.toString()})()`);
        if(missing.length)throw Error('Untranslated button controls: '+JSON.stringify(missing));checks.push('Button properties translate into English');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/button-properties-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
