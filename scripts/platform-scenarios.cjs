const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle,evaluateMain}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[],expect=(value,label)=>{if(!value)throw Error(label);checks.push(label);},watchdog=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow(1280,800);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Platform interaction'}});await settle(win);
        const platform=await win.page.evaluate(()=>({native:desktopAPI.platform,root:document.documentElement.dataset.platform,arch:desktopAPI.arch,controls:getComputedStyle(document.querySelector('.titlebar-controls')).display}));
        expect(platform.native===process.platform&&platform.root===process.platform&&platform.arch===process.arch,'Preload and the interface agree on the native operating system and architecture');
        expect((platform.controls==='none')===(process.platform==='darwin'),'macOS uses native traffic lights and other desktops retain their window controls');
        await win.page.evaluate(()=>{const input=document.createElement('input');input.id='native-edit-fixture';document.body.append(input);input.focus();});
        const input=win.page.locator('#native-edit-fixture'),primary=process.platform==='darwin'?'Meta':'Control';
        await win.page.keyboard.insertText('Original');await win.page.keyboard.press(primary+'+a');await win.page.keyboard.insertText('Changed');await win.page.keyboard.press(primary+'+z');
        await win.page.waitForFunction(()=>document.querySelector('#native-edit-fixture').value==='Original');expect(true,'The platform undo shortcut edits a focused input without undoing the canvas');
        await win.page.keyboard.press(primary+'+a');expect(await input.evaluate(node=>node.selectionStart===0&&node.selectionEnd===node.value.length),'The platform Select All shortcut selects text in the focused input');
        await win.page.evaluate(()=>document.querySelector('#native-edit-fixture').remove());
        if(process.platform==='darwin'){
            const menu=await evaluateMain(({Menu})=>{const flatten=menu=>menu.items.flatMap(item=>[...(item.accelerator?[item.accelerator]:[]),...(item.submenu?flatten(item.submenu):[])]);return flatten(Menu.getApplicationMenu());});
            expect(['Command+O','Command+S','Command+Z','Command+,'].every(key=>menu.includes(key)),'The real macOS application menu exposes standard file, edit and settings accelerators');
            await win.page.evaluate(()=>{mollyEditor.layerManager.addLayer('Quit recovery');mollyEditor.settingsManager.set('confirmClose',true);});
            const canceled=await evaluateMain(({app})=>new Promise(resolve=>{const runtime=globalThis.__mollyTestRuntime,timer=setTimeout(()=>resolve(false),15000);runtime.windows.electron.dialog.showMessageBox=async()=>({response:0});runtime.windows.get('main').once('molly-close-cancelled',()=>{clearTimeout(timer);resolve(true);});app.quit();}));
            await win.page.waitForFunction(()=>!document.body.inert&&!mollyEditor.documentTasks.closing);expect(canceled&&!win.page.isClosed(),'Cancelling Cmd+Q keeps the real editor interactive');
            await win.page.evaluate(()=>mollyEditor.settingsManager.set('confirmClose',false));const closed=win.page.waitForEvent('close');await win.page.evaluate(()=>{setTimeout(()=>desktopAPI.close(),50);});await closed;
            expect(await evaluateMain(()=>!globalThis.__mollyTestRuntime.windows.get('main')),'Closing the final Mac window leaves the application process running');
            win.disposed=true;await evaluateMain(({app})=>app.emit('activate'));win=makeWindow(1280,800);await win.ensure();await win.page.waitForFunction(()=>!!window.desktopAPI);
            expect(await evaluateMain(()=>!!globalThis.__mollyTestRuntime.windows.get('main')),'A Dock activation recreates the main window after it was closed');
        }
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/platform-scenarios.json'),JSON.stringify({passed:checks.length,platform:process.platform,arch:process.arch,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(watchdog);app.exit(process.exitCode||0);}
})();
