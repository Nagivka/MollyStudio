const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const results=[],timer=setTimeout(()=>app.exit(1),180000);try{
    await ready();win=makeWindow(1280,900);
    for(const type of ['prefix','gui']){
        await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type,size:'54'}});await settle(win);
        await win.page.evaluate(async()=>{const a=mollyEditor;a.settingsManager.set('animationsEnabled',false);await a.getActiveProject().prefixLoadPromise;await a.getActiveProject().templateLoadPromise;await a.designGallery.open();});
        for(const theme of ['dark','light','minecraft','light-minecraft'])for(const zoom of [1,1.25,1.5,2]){
            win.webContents.setZoomFactor(zoom);await win.page.evaluate(theme=>mollyEditor.settingsManager.set('theme',theme),theme);await settle(win);
            const size=await win.page.evaluate(type=>{
                const card=document.querySelector('.design-gallery-card'),stage=card.querySelector('.design-preview-stage'),c=stage.querySelector('canvas');
                if(!c)throw Error('Gallery preview did not load');
                if(type==='prefix'&&(stage.clientHeight>90||card.clientHeight>180))throw Error('Prefix cards have excess empty space');
                if(type==='prefix'&&Number(c.dataset.previewScale)<=1)throw Error('Small prefix preview was not enlarged');
                const r=c.getBoundingClientRect();if(Math.abs(r.width*devicePixelRatio-c.width)>.1)throw Error('Gallery introduced CSS pixel resampling');
                if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Gallery overflows the window');
                return {card:card.clientHeight,stage:stage.clientHeight};
            },type);results.push({type,theme,zoom,...size});
            if(theme==='dark'&&zoom===1){await fs.mkdir(path.join(root,'.test-output/gallery-sizing'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/gallery-sizing',type+'.png'),(await win.webContents.capturePage()).toPNG());}
        }
        await win.page.evaluate(()=>{const s=document.querySelector('[data-design-search]');s.value='Сакура';s.dispatchEvent(new Event('input'));});await settle(win);
        if(await win.page.locator('.design-gallery-card').count()!==1)throw Error('Filtering changed the matching card count');
    }
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
    await fs.writeFile(path.join(root,'.test-output/gallery-sizing/report.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,cases:results.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
