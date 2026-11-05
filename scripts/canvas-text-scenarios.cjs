const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

(async()=>{
    const checks=[];let win;
    const check=(value,message)=>{assert.ok(value,message);checks.push(message);console.log('PASS '+message);};
    const watchdog=setTimeout(()=>app.exit(1),120000);
    try{
        await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'256',height:'192',name:'Canvas text integration'}});
        await win.showInactive();const page=win.page;
        await page.waitForFunction(()=>['minecraft','minecraft-ten','smallcaps','other'].every(id=>mollyEditor.tools.tools.text.fontImages[id]));
        await page.evaluate(()=>{mollyEditor.settingsManager.set('animationsEnabled',false);mollyEditor.tools.setTool('text');mollyEditor.workspace.fitToScreen();});await settle(win);
        const state=()=>page.evaluate(()=>{const e=mollyEditor,t=e.tools.tools.text,c=t.canvasEditor,l=e.layerManager.getActiveLayer();return {active:c.active,data:l?.textData,id:l?.id,count:e.layerManager.layers.length,history:e.history.undoStack.length,local:c.history.undoStack.length,selection:c.active?c.selection():null};});
        const pos=(x,y)=>page.evaluate(({x,y})=>{const r=document.getElementById('main-canvas').getBoundingClientRect();return {x:r.left+x*r.width/mollyEditor.config.width,y:r.top+y*r.height/mollyEditor.config.height};},{x,y});
        const click=async(x,y,options)=>{const p=await pos(x,y);await page.mouse.click(p.x,p.y,options);};
        const drag=async(x0,y0,x1,y1)=>{const a=await pos(x0,y0),b=await pos(x1,y1);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:7});await page.mouse.up();};
        const focus=()=>page.evaluate(()=>mollyEditor.tools.tools.text.canvasEditor.focus());
        const layoutPoint=(index,inside=false)=>page.evaluate(({index,inside})=>{
            const tool=mollyEditor.tools.tools.text,c=tool.canvasEditor,l=c.layer||mollyEditor.layerManager.getActiveLayer(),layout=tool.getTextLayout(l);
            const row=layout.lines.find(row=>index>=row.start&&index<=row.end)||layout.lines.at(-1),g=row.glyphs.find(g=>index<g.end);
            return c.world(l.textData,{x:row.offset+(g?g.x+(inside?g.advance*.3:0):row.width),y:row.y+layout.lineBoxHeight/2});
        },{index,inside});
        const base=(await state()).count;
        await click(20,25);await page.keyboard.type('Alpha beta',{delay:10});
        check((await state()).active&&(await state()).data.text==='Alpha beta','A canvas click creates live point text and keeps keyboard focus on the canvas input');
        check(await page.locator('#text-edit-actions').isVisible()&&!await page.locator('dialog[open]').count(),'Apply and cancel are visible in the real option bar without a modal editor');
        await page.keyboard.press('Control+z');check((await state()).data.text==='Alpha ','Typing is grouped separately across word boundaries');
        await page.keyboard.press('Control+Shift+z');check((await state()).data.text==='Alpha beta','Text session redo restores native keyboard input');
        let p=await layoutPoint(7,true);await click(p.x,p.y,{clickCount:2});
        check((await state()).selection.start===6&&(await state()).selection.end===10,'Double-click on the actual bitmap text selects its word');
        await page.keyboard.insertText('world');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('Second');
        check((await state()).data.text==='Alpha world\nSecond','Selected text can be replaced and Enter inserts a real paragraph');
        await page.keyboard.press('Control+Enter');const point=await state();
        check(!point.active&&point.history===1,'Creating and typing a point object is one document undo action');
        await page.locator('#btn-undo').click();check((await state()).count===base,'Document undo removes the complete newly created text object');
        await page.locator('#btn-redo').click();check((await state()).data.text==='Alpha world\nSecond','Document redo restores the editable text object');
        await click(21,27);await page.keyboard.press('Control+a');await page.keyboard.type('Cancelled');await page.keyboard.press('Escape');
        check(!(await state()).active&&(await state()).data.text==='Alpha world\nSecond','Escape restores existing text and its raster without adding a document action');

        await drag(35,90,115,124);await page.keyboard.insertText('One two three four five six seven eight nine ten');
        let frame=await state();check(frame.data.maxWidth===80&&frame.data.frameHeight===34,'Dragging creates a text frame with its own width and height');
        const fontSize=frame.data.fontSize??8;
        await drag(115,107,75,107);frame=await state();
        check(frame.data.maxWidth===40&&(frame.data.fontSize??8)===fontSize,'Dragging the frame width reflows text without stretching the letters');
        await page.keyboard.press('Control+z');check((await state()).data.maxWidth===80,'Frame geometry has a separate step in the live editing history');
        await page.keyboard.press('Control+Shift+z');
        await page.locator('#properties-tab-geometry').click();
        check((await state()).active,'Switching property tabs preserves the live text editing session');
        check(await page.locator('#text-frame-overflow').isVisible(),'The real inspector reports text that does not fit in its frame');
        await page.locator('#text-fit-height').click();
        check(!await page.locator('#text-frame-overflow').isVisible(),'Fit height expands the frame to show every wrapped line');
        await page.locator('#properties-tab-object').click();
        await page.locator('#text-font-size').fill('16');await page.locator('#text-font-size').press('Tab');
        check((await state()).data.fontSize===16,'Font size controls the native bitmap glyph size');
        await page.locator('label').filter({has:page.locator('#text-auto-leading')}).locator('.md-switch-track').click();
        await page.waitForFunction(()=>document.getElementById('text-line-height').disabled);
        check(await page.locator('#text-line-height').isDisabled(),'Automatic line spacing disables manual input');
        await focus();await page.keyboard.press('Control+z');
        check((await state()).data.autoLeading!==true,'Style controls participate in the text session undo history');
        await page.locator('#text-font-size').fill('24');await page.locator('#text-font-size').press('Escape');
        check((await state()).data.fontSize===16,'Escape cancels a live property preview without discarding text');
        await page.locator('#text-edit-apply').click();
        check(!(await state()).active,'The option bar commits the live frame editing session');
        const frameData=(await state()).data;
        await page.evaluate(()=>{const e=mollyEditor;window.__textSaved=e.projectManager.serializeProject();window.__textPixels=e.layerManager.getActiveLayer().canvas.toDataURL();});
        await page.evaluate(async()=>{await mollyEditor.projectManager.deserializeProject(window.__textSaved);});
        check(JSON.stringify((await state()).data)===JSON.stringify(frameData),'Saving and reopening preserves every text frame parameter');
        check(await page.evaluate(()=>mollyEditor.layerManager.getActiveLayer().canvas.toDataURL()===window.__textPixels),'Reopening the project preserves the complete bitmap rendering');

        const countBeforeNew=(await state()).count;
        await page.evaluate(()=>mollyEditor.tools.setTool('text'));await click(180,145);await page.keyboard.insertText('A👩‍💻е́Z');await page.keyboard.press('Home');
        for(const end of [1,6,8,9]){await page.keyboard.press('Shift+ArrowRight');check((await state()).selection.end===end,'Native canvas selection respects Unicode grapheme boundary '+end);}
        await page.keyboard.press('Escape');check(!(await state()).active&&(await state()).count===countBeforeNew,'Cancelling a new object removes only the provisional layer');
        await page.evaluate(()=>{const e=mollyEditor;e.tools.setTool('move');});
        p=await layoutPoint(2,true);await click(p.x,p.y,{clickCount:2});
        check((await state()).active,'Double-click from the move tool starts on-canvas text editing');
        await page.keyboard.press('Escape');
        await page.locator('#properties-tab-geometry').click();
        await page.locator('#text-rotation').fill('35');await page.locator('#text-rotation').press('Tab');
        const rotated=(await state()).data;
        const handles=await page.evaluate(data=>{
            const c=mollyEditor.tools.tools.text.canvasEditor;
            return {a:c.world(data,{x:data.maxWidth,y:data.frameHeight/2}),b:c.world(data,{x:data.maxWidth+20,y:data.frameHeight/2})};
        },rotated);
        await drag(handles.a.x,handles.a.y,handles.b.x,handles.b.y);
        check((await state()).data.maxWidth===rotated.maxWidth+20&&(await state()).data.fontSize===rotated.fontSize&&(await state()).data.rotation===35,'A rotated frame resizes in its local axes without changing font size');
        await page.keyboard.press('Control+z');
        check((await state()).data.maxWidth===rotated.maxWidth,'Resize returns keyboard focus to the canvas for document undo');
        await page.evaluate(()=>mollyEditor.tools.tools.text.openInlineEditor(mollyEditor.layerManager.getActiveLayer()));
        const beforeComposition=(await state()).data.text;
        await page.evaluate(()=>{
            const c=mollyEditor.tools.tools.text.canvasEditor,input=c.input;
            input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
            input.value+='日本';input.setSelectionRange(input.value.length,input.value.length);
            input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'日本',isComposing:true}));
        });
        check(await page.locator('#text-edit-apply').isDisabled()&&await page.evaluate(()=>mollyEditor.tools.finishDocument()===false),'A live IME composition prevents premature apply or document switching');
        await page.evaluate(()=>document.getElementById('canvas-text-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本'})));
        await page.keyboard.press('Control+z');
        check((await state()).data.text===beforeComposition,'One undo removes the completed IME composition');
        const rasterBefore=await page.evaluate(()=>mollyEditor.layerManager.getActiveLayer().canvas.toDataURL());
        await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
        check(await page.evaluate(()=>mollyEditor.layerManager.getActiveLayer().canvas.toDataURL())===rasterBefore,'Live selection and caret never modify saved or exported layer pixels');
        await page.keyboard.press('Escape');await page.locator('#properties-tab-object').click();
        await page.evaluate(()=>{
            const e=mollyEditor;e.addProject('Text boundaries','none',256,192,false,'canvas');e.tools.setTool('text');e.history.clear();
            const l=e.layerManager.addTextLayer('Boundary frame',{text:'Boundary',fontId:'minecraft',x:230,y:55,maxWidth:35,frameHeight:30,shadow:false});
            e.tools.tools.text.renderTextLayer(l);e.workspace.fitToScreen();
        });await settle(win);
        const panBefore=await page.evaluate(()=>({x:mollyEditor.workspace.panX,y:mollyEditor.workspace.panY}));
        await drag(265,70,275,70);
        check((await state()).data.maxWidth===45&&await page.evaluate(p=>mollyEditor.workspace.panX===p.x&&mollyEditor.workspace.panY===p.y,panBefore),'A text frame handle outside the document resizes the frame instead of panning the canvas');
        await page.evaluate(()=>mollyEditor.tools.tools.text.openInlineEditor(mollyEditor.layerManager.getActiveLayer()));
        await page.keyboard.press('Control+a');await page.keyboard.insertText('A👩‍💻е́Z');
        await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Backspace');
        check((await state()).data.text==='A👩‍💻Z','Backspace removes a combining grapheme as one visible character');
        await page.keyboard.press('Control+z');await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');
        check((await state()).data.text==='Aе́Z','Delete removes a complete joined emoji without leaving a surrogate or joiner');
        await page.keyboard.press('Control+z');
        const textBeforeFont=(await state()).data.text;
        await page.evaluate(()=>{
            document.getElementById('text-input').value='Stale inspector value';
            const control=document.getElementById('font-select');control.value='minecraft-ten';control.dispatchEvent(new Event('change',{bubbles:true}));
        });
        check((await state()).data.text===textBeforeFont&&(await state()).data.fontId==='minecraft-ten','Changing a font never replaces canvas text with a stale inspector field');
        const sizeBeforeInvalid=(await state()).data.fontSize??8,historyBeforeInvalid=(await state()).local;
        await page.locator('#text-font-size').fill('24');await page.locator('#text-font-size').fill('0');await page.locator('#text-font-size').press('Tab');
        check(((await state()).data.fontSize??8)===sizeBeforeInvalid&&(await state()).local===historyBeforeInvalid,'An invalid final numeric value rolls back the whole property preview without creating history');
        await focus();await page.keyboard.press('Control+a');await page.keyboard.insertText('Saved from canvas');await page.keyboard.press('Control+s');
        await page.waitForFunction(()=>!mollyEditor.tools.tools.text.canvasEditor.active&&!!mollyEditor.getActiveProject().filePath);
        check((await state()).data.text==='Saved from canvas','Ctrl+S while typing commits and saves the actual project');
        const persisted=await page.evaluate(async()=>{
            const e=mollyEditor,document=JSON.parse(await window.desktopAPI.readFile(e.getActiveProject().filePath));
            return document.layers.find(l=>l.id===e.layerManager.activeLayerId)?.textData.text;
        });check(persisted==='Saved from canvas','The file on disk contains the latest canvas text');
        await click(25,35);await page.keyboard.type('First layer');
        const firstLayer=(await state()).id;
        const boundaryId=await page.evaluate(()=>mollyEditor.layerManager.layers.find(l=>l.name==='Boundary frame').id);
        await page.evaluate(id=>mollyEditor.layerManager.setActive(id),boundaryId);
        check(!(await state()).active&&await page.evaluate(id=>mollyEditor.layerManager.layers.find(l=>l.id===id).textData.text==='First layer',firstLayer),'Changing the active layer commits the old text session to the correct object');
        await page.evaluate(()=>mollyEditor.tools.tools.text.openInlineEditor(mollyEditor.layerManager.getActiveLayer()));
        await page.keyboard.press('Control+End');await page.keyboard.type('!');
        check(await page.evaluate(()=>{
            const e=mollyEditor,c=e.tools.tools.text.canvasEditor,tool=c.tool,before=JSON.stringify(c.layer.textData),undo=c.history.undoStack.length,redo=c.history.redoStack.length;
            const originalRender=tool.renderTextLayer,error=console.error,toast=e.showToast;console.error=()=>{};e.showToast=()=>{};
            tool.renderTextLayer=()=>{throw Error('Simulated text raster failure');};
            try{return c.undo()===false&&JSON.stringify(c.layer.textData)===before&&c.history.undoStack.length===undo&&c.history.redoStack.length===redo;}
            finally{tool.renderTextLayer=originalRender;console.error=error;e.showToast=toast;}
        }),'A failed text undo keeps the rendered state and its history step available for retry');
        await page.keyboard.press('Control+z');check((await state()).data.text==='Saved from canvas','Retrying undo after a renderer failure succeeds');
        await page.keyboard.press('Escape');
        await page.evaluate(()=>{
            const e=mollyEditor,l=e.layerManager.addTextLayer('Legacy CRLF',{text:'A\r\nB',fontId:'minecraft',x:15,y:130});
            e.tools.tools.text.renderTextLayer(l);e.tools.tools.text.openInlineEditor(l);
        });
        check((await state()).data.text==='A\nB','Opening legacy Windows line endings keeps native input and visual cursor indices in sync');
        await page.keyboard.press('Control+End');await page.keyboard.press('Backspace');
        check((await state()).data.text==='A\n','Native deletion after a legacy line break removes the intended character');
        await page.keyboard.press('Escape');
        check((await state()).data.text==='A\r\nB','Cancelling a legacy text session restores its exact original source');
        await page.evaluate(async()=>{await mollyEditor.projectManager.deserializeProject(window.__textSaved);mollyEditor.tools.setTool('text');});
        for(const [theme,width,height] of [['dark',1280,900],['light',960,760],['minecraft',1100,800],['light-minecraft',850,760]]){
            win.setContentSize(width,height);await page.evaluate(theme=>mollyEditor.settingsManager.set('theme',theme),theme);await settle(win);
            await page.evaluate(()=>mollyEditor.tools.tools.text.openInlineEditor(mollyEditor.layerManager.getActiveLayer()));
            await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+ArrowRight');await settle(win);
            await fs.writeFile(path.join(root,`.test-output/canvas-text-${theme}.png`),(await win.webContents.capturePage()).toPNG());
            check(await page.locator('#text-edit-actions').isVisible()&&await page.evaluate(()=>{
                const controls=document.getElementById('text-edit-actions').getBoundingClientRect();
                return controls.left>=0&&controls.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;
            }),'Live editing and its apply/cancel controls fit '+theme);
            await page.locator('#text-font-size').scrollIntoViewIfNeeded();
            check(await page.evaluate(()=>{
                const panel=document.querySelector('.md-panel-props'),r=panel.getBoundingClientRect();
                return panel.scrollWidth<=panel.clientWidth+1&&['text-font-size','text-line-height'].every(id=>{
                    const field=document.getElementById(id).getBoundingClientRect();return field.left>=r.left&&field.right<=r.right;
                });
            }),'Typography fields stay inside the inspector in '+theme);
            await fs.writeFile(path.join(root,`.test-output/canvas-text-properties-${theme}.png`),(await win.webContents.capturePage()).toPNG());
            await page.keyboard.press('Escape');
            check(await page.locator('#text-tool-hint').isVisible(),'Canvas text controls remain visible in '+theme);
        }
        check(!win.__testErrors.length,'No renderer script errors during the real Electron interactions');
        await fs.writeFile(path.join(root,'.test-output/canvas-text-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
        await fs.rm(path.join(root,'.test-output/canvas-text-failure.png'),{force:true});
        console.log(JSON.stringify({passed:checks.length},null,2));
    }catch(error){console.error(error);if(win?.page)await win.webContents.capturePage().then(image=>fs.writeFile(path.join(root,'.test-output/canvas-text-failure.png'),image.toPNG())).catch(()=>{});process.exitCode=1;}
    finally{clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
})();
