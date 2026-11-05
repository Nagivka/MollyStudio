const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

(async()=>{let win;const checks=[],timer=setTimeout(()=>app.exit(1),180000),output=path.join(root,'.test-output/editor-usability');
try{
    await ready();await fs.mkdir(output,{recursive:true});win=makeWindow(1280,900);
    const load=async(type)=>{await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type,size:'54',width:'128',height:'128'}});await win.page.evaluate(()=>mollyEditor.settingsManager.set('animationsEnabled',false));await settle(win);};
    const capture=async(name)=>fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
    await load('canvas');
    await win.page.evaluate(()=>{
        const a=mollyEditor,layer=a.layerManager.addTextLayer('Sample',{text:'Abc Абв',fontId:'minecraft',x:4,y:4});
        a.tools.tools.text.renderTextLayer(layer);a.layerManager.setActive(layer.id);a.tools.setTool('text');a.syncPropertiesPanel();
        const p=a.propertiesInspector,object=p.tabs.tabs[0];
        if(!(object.panel.querySelector('#prop-group-text').compareDocumentPosition(p.common)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('Text settings must precede shared appearance');
        const expected=['Minecraft Default','SmallCaps','Square','Minecraft Ten'];
        if(JSON.stringify([...document.querySelectorAll('.bitmap-font-choices button > span')].map(span=>span.textContent))!==JSON.stringify(expected))throw Error('Canvas uses inconsistent font names');
        if(!document.getElementById('font-select').hidden)throw Error('A duplicate font dropdown remains');
    });
    for(const font of ['smallcaps','square','minecraft-ten','minecraft']){
        await win.page.evaluate(()=>mollyEditor.history.clear());
        await win.page.locator(`[data-font-choice="${font}"]`).click();
        await win.page.evaluate(font=>{
            const a=mollyEditor,layer=a.layerManager.getActiveLayer();
            if(layer.textData.fontId!==font||document.querySelector('#font-select').value!==font)throw Error('Font preview failed to apply to canvas text: '+font);
            if(document.querySelectorAll('.bitmap-font-choices [aria-pressed="true"]').length!==1||document.querySelector('.bitmap-font-choices [aria-pressed="true"]').dataset.fontChoice!==font)throw Error('The chosen font sample is not highlighted');
            if(a.history.undoStack.length!==1)throw Error('Font preview must produce one undoable text edit');
            a.history.undo();if(layer.textData.fontId===font)throw Error('Text font undo failed');a.history.redo();
            if(layer.textData.fontId!==font)throw Error('Text font redo failed');
        },font);
    }
    checks.push('Canvas font samples apply each font and preserve undo/redo');await capture('canvas-text');
    await win.page.evaluate(()=>{const a=mollyEditor,layer=a.layerManager.getActiveLayer();layer.locked=true;a.syncPropertiesPanel();if(a.propertiesInspector.tabs.tabs[0].panel.firstElementChild!==a.propertiesInspector.common)throw Error('Unlock controls are buried below disabled settings');});
    assert.equal(await win.page.locator('[data-font-choice="square"]').isDisabled(),true);
    await win.page.evaluate(()=>{const a=mollyEditor,layer=a.layerManager.getActiveLayer();layer.locked=false;a.syncPropertiesPanel();a.buttonGeneratorModal.open();});await settle(win);
    for(const key of ['color','style','size']){
        await win.page.locator('#button-generator-modal-tab-'+key).click();
        if(key==='color')await win.page.locator('#modalSegColorGradient').click();
        if(key==='style')await win.page.locator('#modalSegStyleDouble').click();
    }
    await win.page.evaluate(()=>{
        const generator=mollyEditor.buttonGeneratorModal;
        if(generator.currentStyle!=='double'||generator.colorMode!=='gradient')throw Error('Switching generator sections lost button settings');
        generator.close();generator.open();
        if(generator.inspectorTabs.active!=='size')throw Error('Reopening generator lost the active section');
    });await settle(win);await capture('button-generator');
    checks.push('Embedded button sections preserve style and colors across navigation and reopening');
    await load('gui');
    await win.page.evaluate(()=>{const a=mollyEditor;if(!document.querySelector('#prop-group-template #prop-change-template'))throw Error('GUI template controls unavailable');a.designGallery.open();});await settle(win);await capture('gui-designs');
    checks.push('GUI template replacement and design gallery remain accessible');
    await load('prefix');await win.page.evaluate(()=>mollyEditor.getActiveProject().prefixLoadPromise);
    await win.page.evaluate(()=>{
        const names=[...document.querySelectorAll('.bitmap-font-choices button > span')].map(span=>span.textContent);
        if(JSON.stringify(names)!==JSON.stringify(['Minecraft Default','SmallCaps','Square','Minecraft Ten']))throw Error('Prefix and canvas font names differ');
        if(!document.querySelector('[data-prefix-field="font"]').hidden)throw Error('Prefix has duplicate font controls');
    });
    for(const font of ['minecraft','square','minecraft-ten','smallcaps']){
        await win.page.evaluate(()=>mollyEditor.history.clear());
        await win.page.locator(`[data-font-choice="${font}"]`).click();
        await win.page.evaluate(font=>{
            const a=mollyEditor,p=a.getActiveProject(),e=a.prefixEditor;
            if(p.prefixData.blocks[e.selected].font!==font||a.history.undoStack.length!==1)throw Error('Font sample did not create one prefix edit: '+font);
            if(document.querySelector('.bitmap-font-choices [aria-pressed="true"]').dataset.fontChoice!==font)throw Error('The prefix font sample highlight is stale');
            a.history.undo();if(p.prefixData.blocks[e.selected].font===font)throw Error('Prefix font undo failed');a.history.redo();
            if(p.prefixData.blocks[e.selected].font!==font)throw Error('Prefix font redo failed');
        },font);
    }
    checks.push('Prefix font samples update the document, selected choice and undo/redo');await capture('prefix-text');
    await win.page.locator('[data-prefix-colors="textColors"] .ui-disclosure-trigger').click();
    assert.equal(await win.page.locator('[data-prefix-palette-select="textColors"]').isVisible(),true);
    await win.page.evaluate(()=>{
        const e=mollyEditor.prefixEditor;e.change(data=>data.blocks.push({...structuredClone(data.blocks[0]),id:'second-block',text:'TWO'}));e.tabs.select('background');
    });
    await win.page.locator('[data-prefix-existing-block]').selectOption('1');
    await win.page.locator('[data-prefix-field="paddingX"]').fill('7');await win.page.locator('[data-prefix-field="paddingX"]').press('Tab');
    await win.page.evaluate(()=>{
        const a=mollyEditor,e=a.prefixEditor,blocks=a.getActiveProject().prefixData.blocks;
        if(e.selected!==1||blocks[1].paddingX!==7||blocks[0].paddingX===7)throw Error('Background controls edited the wrong prefix block');
    });
    assert.equal(await win.page.locator('[data-prefix-designs]').isVisible(),true);await capture('prefix-background');
    await win.page.locator('[data-prefix-field="paddingX"]').fill('');
    await win.page.locator('[data-prefix-existing-block]').selectOption('0');
    await win.page.evaluate(()=>{const e=mollyEditor.prefixEditor;if(e.selected!==1||e.panel.querySelector('[data-prefix-existing-block]').value!=='1')throw Error('Invalid drafts leave the block selector out of sync');});
    await win.page.locator('[data-prefix-action="discard-invalid"]').click();
    checks.push('Prefix block and design controls stay accessible on the background tab');
    await win.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(win);
    for(const key of ['color','style','size']){
        await win.page.locator('#button-generator-tab-'+key).click();
        if(key==='color')await win.page.locator('#segColorGradient').click();
        if(key==='style')await win.page.locator('#segStyleTen').click();
    }
    await win.page.evaluate(()=>{if(buttonGenApp.currentStyle!=='ten'||buttonGenApp.colorMode!=='gradient')throw Error('Standalone generator sections lost state');});
    for(const theme of ['dark','light','minecraft','light-minecraft']){
        win.setContentSize(880,580);await win.page.evaluate(async theme=>{const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));new Settings().set('theme',theme);},theme);await settle(win);
        for(const key of ['size','style','color']){
            await win.page.locator('#button-generator-tab-'+key).click();
            await win.page.evaluate(()=>{
                const scroll=document.querySelector('.buttons-sidebar-scroll-area'),tabs=scroll.querySelector('[role="tablist"]');
                if(document.documentElement.scrollWidth>innerWidth||scroll.scrollWidth>scroll.clientWidth+1)throw Error('Button section overflow');
                if(tabs.getBoundingClientRect().top<scroll.getBoundingClientRect().top-1)throw Error('Section tabs scroll out of reach');
                const stage=document.querySelector('.canvas-stage').getBoundingClientRect(),canvas=buttonGenApp.canvas.getBoundingClientRect();
                if(canvas.left<stage.left||canvas.top<stage.top||canvas.right>stage.right||canvas.bottom>stage.bottom)throw Error('Automatic preview fit clips the GUI');
            });
        }
    }
    await win.page.locator('.viewport-toolbar [data-z="3"]').click();await settle(win);
    await win.page.evaluate(()=>{if(buttonGenApp.autoFitPreview||buttonGenApp.currentZoom!==3)throw Error('Manual zoom was overridden by fit');});
    await win.page.locator('[data-generator-fit]').click();await settle(win);
    await win.page.evaluate(()=>{if(!buttonGenApp.autoFitPreview||buttonGenApp.currentZoom>1)throw Error('Returning to automatic fit failed');});
    await capture('buttons-minecraft-minimum');checks.push('Standalone button sections fit the minimum window in all four main themes');
    assert.deepEqual(win.__testErrors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
