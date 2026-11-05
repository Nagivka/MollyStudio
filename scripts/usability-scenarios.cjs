const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

(async()=>{
    let win,buttonsWin;const checks=[];const timer=setTimeout(()=>app.exit(1),60000);
    const expect=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    try{
        await ready();win=makeWindow(1280,800,{offscreen:false});win.showInactive();
        await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Проверка интерфейса'}});await settle(win);
        const states=await win.webContents.executeJavaScript(`(async()=>{
            const app=window.mollyEditor;app.settingsManager.set('animationsEnabled',false);
            const {DrawCommand}=await import(new URL('./js/core/Commands.js',location.href).href);
            const layer=app.layerManager.addLayer('Полупрозрачный объект');const before=layer.getImageData();layer.ctx.fillStyle='#32A6DCAA';layer.ctx.fillRect(8,8,12,10);layer.invalidateSource();app.history.push(new DrawCommand(layer,before,layer.getImageData(),'Рисование объекта'));app.bus.emit('CANVAS_UPDATED');
            const initial=app.projectManager.getSaveState(app.activeProjectId);await app.projectManager.saveProjectAs();const saved=app.projectManager.getSaveState(app.activeProjectId);
            layer.ctx.fillRect(8,8,1,1);layer.invalidateSource();app.bus.emit('CANVAS_UPDATED');const modified=app.projectManager.getSaveState(app.activeProjectId);
            document.getElementById('btn-history').click();return{initial,saved,modified,history:app.historyPanel.dialog.open};})()`);
        expect(states.initial==='new'&&states.saved==='saved'&&states.modified==='modified','Document status distinguishes a new, saved and modified file');
        expect(states.history,'The history toolbar opens its real native dialog');
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        for(const [theme,width,height] of [['dark',1280,800],['light',850,760],['dark',480,640]]){
            win.setContentSize(width,height);await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='${theme}'`);await settle(win);
            expect(await win.webContents.executeJavaScript(`(()=>{const d=document.querySelector('.history-dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1&&Math.abs(r.left+r.width/2-innerWidth/2)<=1&&Math.abs(r.top+r.height/2-innerHeight/2)<=1;})()`),`History fits and is centered in ${theme} ${width} × ${height}`);
            await fs.writeFile(path.join(root,`.test-output/history-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
        }
        expect(await win.webContents.executeJavaScript(`(()=>{const app=window.mollyEditor,d=app.historyPanel.dialog;d.querySelector('[data-history-index="0"]').click();const undone=app.history.undoStack.length===0&&app.history.canRedo();d.querySelector('[data-history-index="1"]').click();return undone&&app.history.undoStack.length===1&&!app.history.canRedo();})()`),'History entry buttons undo and restore the document');
        await win.webContents.executeJavaScript(`window.mollyEditor.historyPanel.dialog.close()`);
        expect(await win.webContents.executeJavaScript(`document.activeElement===document.getElementById('btn-history')`),'Closing history restores focus to its toolbar button');
        await win.webContents.executeJavaScript(`window.mollyEditor.addProject('Вкладки префикса','none',32,32,false,'prefix')`);await settle(win);
        win.setContentSize(1280,900);await settle(win);
        await fs.writeFile(path.join(root,'.test-output/prefix-tabs.png'),(await win.webContents.capturePage()).toPNG());
        const newChecks=await win.webContents.executeJavaScript(`(async()=>{
            const app=window.mollyEditor,p=app.prefixEditor,checks=[],expect=(v,m)=>{if(!v)throw Error(m);checks.push(m);};
            const drop=(target,color)=>{const transfer=new DataTransfer();transfer.setData('text/plain',color);target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));};
            p.tabs.select('text');p.change(data=>{data.blocks[0].textMode='gradient';});app.history.clear();
            const before=p.project().prefixData.blocks[0].textColors[1];drop(p.panel.querySelector('[data-prefix-color-row="textColors:1"]'),'#12AB34');
            expect(p.project().prefixData.blocks[0].textColors[1]==='#12AB34'&&app.history.undoStack.length===1,'Dropping a palette color changes exactly the chosen prefix stop as one action');app.history.undo();
            expect(p.project().prefixData.blocks[0].textColors[1]===before,'Undo restores a dragged prefix color');app.history.redo();
            const hex=p.panel.querySelector('[data-prefix-stop="textColors:1"][type="text"]');hex.value='invalid';hex.dispatchEvent(new Event('input',{bubbles:true}));
            p.tabs.select('background');expect(p.tabs.active==='text','Invalid color input cannot be hidden by changing the prefix tab');
            drop(p.panel.querySelector('[data-prefix-color-row="textColors:1"]'),'#334455');
            expect(!p.invalidFields.size&&p.project().prefixData.blocks[0].textColors[1]==='#334455','Dropping a valid color repairs an invalid HEX draft');
            const tab=p.tabs.tabs[0].button;tab.focus();tab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
            expect(p.tabs.active==='background'&&document.activeElement.id==='prefix-tab-background','Prefix tabs support arrow navigation with correct focus');
            p.change(data=>{const b=data.blocks[0];b.borderWidth=0;b.bevel=false;});
            expect(p.panel.querySelector('[data-prefix-edge-colors]').hidden,'No edge-color settings appear when both border and bevel are off');
            p.change(data=>{data.blocks[0].borderWidth=1;});p.panel.querySelector('[data-prefix-shade-mode="manual"]').click();
            expect(!p.panel.querySelector('[data-prefix-manual-border]').hidden&&p.panel.querySelector('[data-prefix-manual-bevel]').hidden,'Manual border colors work independently of disabled bevels');
            p.change(data=>{data.blocks[0].bevel=true;});
            expect(!p.panel.querySelector('[data-prefix-manual-bevel]').hidden,'Enabling bevels reveals only their active manual colors');
            p.panel.querySelector('[data-prefix-shade-mode="auto"]').click();
            expect(p.panel.querySelector('[data-prefix-manual-border]').hidden&&!p.panel.querySelector('[data-prefix-auto-edges]').hidden,'Automatic edge colors replace manual fields with the derived preview');
            const firstProject=p.project(),scroll=p.panel.querySelector('.prefix-scroll');p.tabs.select('text');scroll.scrollTop=120;const textScroll=scroll.scrollTop;p.tabs.select('background');scroll.scrollTop=80;const backgroundScroll=scroll.scrollTop;
            app.addProject('Other prefix tab','none',32,32,false,'prefix');p.tabs.select('text');scroll.scrollTop=250;app.switchProject(firstProject.id);await new Promise(resolve=>requestAnimationFrame(resolve));
            expect(p.tabs.active==='background'&&Math.abs(scroll.scrollTop-backgroundScroll)<=1,'Each prefix project restores its active tab and scroll position');p.tabs.select('text');
            expect(Math.abs(scroll.scrollTop-textScroll)<=1,'Inactive tab scroll positions never leak between prefix projects');
            app.menuBar.handleAction('utility-gradient');const u=app.menuBar.utilities;
            const source=u.get('palette-colors').querySelector('button'),dragData=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dragData}));
            expect(source.draggable&&/^#[0-9A-F]{6}$/.test(dragData.getData('text/plain')),'Utility palette exposes actual draggable HEX colors');
            drop(u.get('colors').querySelector('.utility-color'),'#1256AB');
            expect(u.colors[0]==='#1256AB'&&u.get('output').value.includes('1256'),'Dropping a color updates utility gradient output');
            const old=u.colors[0];drop(u.get('colors').querySelector('.utility-color'),'not a color');expect(u.colors[0]===old,'Invalid drag payloads cannot alter gradient colors');u.dialog.close();
            p.tabs.select('text');p.change(data=>{data.blocks[0].textShadow=true;data.blocks[0].textShadowMode='gradient';});
            drop(p.panel.querySelector('[data-prefix-color-row="textShadowColors:1"]'),'#567ABC');
            expect(p.project().prefixData.blocks[0].textShadowColors[1]==='#567ABC','Shadow gradient stops accept dragged colors independently');
            app.addProject('Text drag test','none',32,32,false,'canvas');
            document.getElementById('properties-panel-section').classList.add('expanded');
            const layer=app.layerManager.addTextLayer('Drag text',{text:'AB',fontId:'minecraft',x:2,y:2,colorMode:'gradient',gradientColors:['#FF0000','#0000FF']});
            app.tools.setTool('text');app.tools.tools.text.renderTextLayer(layer);app.tools.tools.text.syncUIWithLayer(layer);app.history.clear();
            await new Promise(resolve=>requestAnimationFrame(resolve));app.propertiesInspector.tabs.select('object');
            expect(document.querySelector('#prop-group-text .bitmap-font-choices').getClientRects().length&&!document.getElementById('font-select').getClientRects().length&&!document.getElementById('text-wrap-width').getClientRects().length,'Main properties expose direct font samples without a duplicate dropdown while detailed layout stays in its own tab');
            app.propertiesInspector.tabs.tabs[0].button.focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
            expect(app.propertiesInspector.tabs.active==='geometry'&&document.getElementById('text-wrap-width').getClientRects().length,'Main property tabs reveal layout and preserve native arrow-key navigation');app.propertiesInspector.tabs.select('object');
            const beforePanels=JSON.stringify(app.projectManager.serializeProject());
            for(const key of ['layers','color','items','properties']){
                const panel=document.getElementById(key+'-panel-section'),header=panel.querySelector('.md-panel-header.collapsable');
                const expanded=panel.classList.contains('expanded');header.click();
                expect(panel.classList.contains('expanded')!==expanded&&header.getAttribute('aria-expanded')===String(!expanded),'Accordion toggles its section: '+key);
                header.click();
            }
            expect(JSON.stringify(app.projectManager.serializeProject())===beforePanels,'Toggling inspector sections preserves pixels, objects and editable settings');
            const fg=app.colorPicker.fgColor,bg=app.colorPicker.bgColor;
            document.getElementById('swatch-bg').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
            expect(app.colorPicker.activeTarget==='bg','Keyboard activation of the background swatch selects the background color target');
            const beforeBackgroundPick=JSON.stringify(app.projectManager.serializeProject());
            document.querySelector('#palette-color-list button').click();
            expect(app.colorPicker.fgColor===fg&&app.colorPicker.bgColor!==bg,'The palette changes the selected background without changing the foreground');
            expect(JSON.stringify(app.projectManager.serializeProject())===beforeBackgroundPick,'Choosing a background color does not recolor the selected text or object');
            document.getElementById('swatch-fg').click();
            document.getElementById('picker-sb-canvas').focus();
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
            expect(app.colorPicker.activeTarget==='fg','The color canvas remains keyboard accessible after moving between inspector views');
            document.getElementById('properties-panel-section').classList.add('expanded');
            app.history.clear();
            drop(document.querySelectorAll('#textGradientStopsList .grad-stop-row')[1],'#AABBCC');
            expect(layer.textData.gradientColors[1]==='#AABBCC'&&app.history.undoStack.length===1,'Text gradient drops remain a single undoable action');app.history.undo();expect(layer.textData.gradientColors[1]==='#0000FF','Undo restores the text color before a palette drop');
            drop(document.getElementById('grad-color-2'),'#C0FFEE');expect(document.getElementById('grad-color-2').value==='#c0ffee','The gradient drawing tool also accepts dragged endpoint colors');
            app.buttonGeneratorModal.open();await new Promise(resolve=>requestAnimationFrame(resolve));app.buttonGeneratorModal.setColorMode('gradient');drop(document.querySelectorAll('#modalGradientStopsList .grad-stop-row')[1],'#ABC123');
            expect(app.buttonGeneratorModal.gradientColors[1]==='#ABC123','Embedded button generator accepts dragged gradient colors');app.buttonGeneratorModal.close();
            app.buttonGeneratorModal.open();app.buttonGeneratorModal.close();await new Promise(resolve=>requestAnimationFrame(resolve));
            expect(!app.buttonGeneratorModal.modalEl.classList.contains('show'),'Closing a generator before its first frame prevents it reopening unexpectedly');
            return checks;
        })()`);checks.push(...newChecks);
        await settle(win);await fs.writeFile(path.join(root,'.test-output/properties-object.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`window.mollyEditor.propertiesInspector.tabs.select('geometry')`);await settle(win);
        await fs.writeFile(path.join(root,'.test-output/properties-geometry.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript(`document.querySelector('.utility-dialog')?.close()`);
        await win.webContents.executeJavaScript(`(async()=>{const app=window.mollyEditor;app.addProject('GUI preview','container/default/container_54.png',256,256,false,'gui');const deadline=Date.now()+4000;while(!app.layerManager.getLayers().some(l=>l.isBase&&l.ctx.getImageData(0,0,l.width,l.height).data.some((n,i)=>i%4===3&&n))){if(Date.now()>deadline)throw Error('GUI template timeout');await new Promise(r=>setTimeout(r,20));}window.beforeGamePreview=JSON.stringify(app.projectManager.serializeProject());if(!await app.guiPreviewPanel.open())throw Error('Preview failed');})()`);await settle(win);
        expect(await win.webContents.executeJavaScript(`!document.getElementById('btn-preview-gui').hidden&&document.querySelector('.gui-preview-dialog img').naturalWidth===1920`),'GUI toolbar opens the local Minecraft screenshot');
        for(const [theme,width,height,zoom] of [['dark',1280,900,1],['light',850,760,1],['dark',480,640,1],['dark',760,780,1.5]]){
            win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await win.webContents.executeJavaScript(`window.mollyEditor.settingsManager.set('theme','${theme}')`);await settle(win);
            expect(await win.webContents.executeJavaScript(`(()=>{const d=document.querySelector('.gui-preview-dialog'),r=d.getBoundingClientRect(),canvas=d.querySelector('canvas'),c=canvas.getBoundingClientRect(),viewport=d.querySelector('.gui-preview-viewport');return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&Math.abs(c.width-Number(canvas.dataset.sourceWidth)*1.5)<=.5/devicePixelRatio+.02&&Math.abs(c.height-Number(canvas.dataset.sourceHeight)*1.5)<=.5/devicePixelRatio+.02&&Math.abs(canvas.width-c.width*devicePixelRatio)<.05&&Math.abs(canvas.height-c.height*devicePixelRatio)<.05&&viewport.scrollWidth>=c.width&&viewport.scrollHeight>=c.height&&!d.querySelector('select,input[type="range"]');})()`),`Minecraft GUI preview stays at 1.5x in ${width} at browser zoom ${zoom}`);
            await fs.writeFile(path.join(root,'.test-output',`gui-preview-${width}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
        }
        expect(await win.webContents.executeJavaScript(`window.beforeGamePreview===JSON.stringify(window.mollyEditor.projectManager.serializeProject())`),'Game preview changes no document pixels or editable settings');
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle(win);
        expect(await win.webContents.executeJavaScript(`!document.querySelector('.gui-preview-dialog').open`),'Escape closes the Minecraft GUI preview');
        buttonsWin=makeWindow(1000,800);await buttonsWin.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(buttonsWin);
        expect(await buttonsWin.webContents.executeJavaScript(`(()=>{const app=window.buttonGenApp;app.setColorMode('gradient');const transfer=new DataTransfer();transfer.setData('text/plain','#CDEF12');document.querySelectorAll('.grad-stop-row')[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));return app.gradientColors[1]==='#CDEF12';})()`),'Standalone button generator accepts the same palette drop format');
        if(buttonsWin.__testErrors.length)throw new Error(buttonsWin.__testErrors.join('\n'));
        if(win.__testErrors.length)throw new Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/usability.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timer);buttonsWin?.destroy();win?.destroy();app.exit(process.exitCode||0);}
})();
