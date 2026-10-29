const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{
    let win;const checks=[];const timer=setTimeout(()=>app.exit(1),60000);
    try{
        await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Resource QA'}});await settle(win);
        checks.push(...await win.page.evaluate(async()=>{
            const app=mollyEditor,panel=app.itemsPanel,checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
            expect(!panel.items.some(item=>item.pack||/^(boxpix|pixelemojis):/.test(item.id)),'Retired emoji and icon packs are absent from the library');
            expect(!panel.categories.some(item=>['emojis','symbols'].includes(item.id)),'Retired emoji and icon categories are absent');
            expect(!document.querySelector('.resource-design-control'),'Retired icon appearance controls are absent');
            expect(panel.items.length>1000&&panel.items.some(item=>item.category==='block_renders'),'Minecraft items and perspective blocks remain available');
            const resource=panel.items.find(item=>!item.pack);await panel.addItemToCanvas(resource,5,6);
            expect(app.layerManager.getActiveLayer().getBounds(),'A regular Minecraft resource can still be inserted');
            expect(!app.tools.tools.text.fontImages.symbols,'Text no longer loads an extra emoji font atlas');
            return checks;
        }));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/resource-assets-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
