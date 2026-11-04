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
            const addedIds=['effect_freezing',...['black','blue','brown','cyan','gray','green','light_blue','light_gray','lime','magenta','orange','pink','purple','red','white','yellow'].map(color=>color+'_cushion'),...['brittle_ice','chiseled_packed_ice','packed_ice_brick_slab','packed_ice_brick_stairs','packed_ice_brick_wall','packed_ice_bricks','snow_brick_slab','snow_brick_stairs','snow_brick_wall','snow_bricks'].map(id=>'block_render:'+id)];
            const added=addedIds.map(id=>panel.items.find(item=>item.id===id));
            expect(added.every(Boolean),'All 27 new snapshot resources are in the library');
            expect(new Set(panel.items.map(item=>item.id)).size===panel.items.length,'Resource IDs remain unique');
            await Promise.all(added.map(item=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>image.naturalWidth>0&&image.naturalHeight>0?resolve():reject(Error(item.id));image.onerror=()=>reject(Error('Missing image '+item.id));image.src=new URL('assets/'+item.folder+'/'+item.file,location.href).href;})));
            expect(true,'All new resource images decode successfully');
            const resource=panel.items.find(item=>!item.pack);await panel.addItemToCanvas(resource,5,6);
            expect(app.layerManager.getActiveLayer().getBounds(),'A regular Minecraft resource can still be inserted');
            expect(!app.tools.tools.text.fontImages.symbols,'Text no longer loads an extra emoji font atlas');
            document.querySelector('[data-category="entity_renders"]').click();
            const entities=panel.getFilteredItems();
            expect(entities.length===18&&entities.every(item=>item.category==='entity_renders'),'Entities category filters all 18 models');
            await Promise.all(entities.map(item=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data;const alphas=rgba.filter((_,index)=>index%4===3);if(!alphas.some(value=>value>0)||alphas[0]!==0)reject(Error('Invalid transparent entity '+item.id));else resolve();};image.onerror=()=>reject(Error('Missing entity '+item.id));image.src=new URL('assets/'+item.folder+'/'+item.file,location.href).href;})));
            expect(true,'Every entity decodes with visible pixels and a transparent background');
            panel.searchQuery='creeper';expect(panel.getFilteredItems().length===1,'Entities can be found by English name');
            panel.searchQuery='голем';expect(panel.getFilteredItems().length===1,'Entities can be found by Russian name');
            panel.searchQuery='';
            const creeper=entities.find(item=>item.minecraftId==='creeper');
            await panel.addItemToCanvas(creeper,2,3);
            expect(!!app.layerManager.getActiveLayer().getBounds()&&panel.recent[0]===creeper.id,'Entity insertion creates a nonempty layer and updates recents');
            panel.toggleFavorite(creeper.id);panel.activeCategory='favorites';
            expect(panel.getFilteredItems().some(item=>item.id===creeper.id),'Entity favorites use the shared resource library');
            return checks;
        }));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/resource-assets-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
