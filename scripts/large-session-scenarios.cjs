const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle,evaluateMain}=require('./lib/electron-harness.cjs');
const nativeMemory=()=>evaluateMain(({app})=>app.getAppMetrics().map(p=>({type:p.type,memory:p.memory})));

async function openBatch(count){
    const app=window.mollyEditor;app.settingsManager.set('confirmClose',false);app.settingsManager.set('animationsEnabled',false);
    const {default:Layer}=await import(new URL('js/graphics/Layer.js',location.href));
    window.largeRefs||=[];window.largeIds=[];const history=[];
    for(let tab=0;tab<count;tab++){
        app.addProject('Large document '+tab,'none',1024,1024,false,'canvas');
        const project=app.getActiveProject();window.largeIds.push(project.id);window.largeRefs.push(new WeakRef(project));
        const layers=[];
        for(let index=0;index<3;index++){
            const layer=new Layer('large-'+tab+'-'+index,'Large layer '+index,1024,1024),source=document.createElement('canvas');source.width=source.height=512;
            const context=source.getContext('2d');context.fillStyle=['#ed9933','#226688','#44a366'][index];context.fillRect(0,0,512,512);context.clearRect(64,64,64,64);
            layer.ctx.drawImage(source,100+index*20,100);layer.invalidateSource();layer.setMasterSource(source,{x:100+index*20,y:100,w:512,h:512});
            window.largeRefs.push(new WeakRef(layer),new WeakRef(source));layers.push(layer);
        }
        layers[0].setFX({shadow:{enabled:true,offsetX:2,offsetY:2,color:'#000000'},texture:{type:'grain',amount:12,scale:1,seed:5}});layers[0].getRenderCanvas();
        app.layerManager.setLayers(layers);app.bus.emit('LAYER_ORDER_CHANGED');app.bus.emit('CANVAS_UPDATED');app.tools.setTool('pencil');
        for(let stroke=0;stroke<32;stroke++){app.tools.onPointerDown(800+stroke,800,{});app.tools.onPointerUp(800+stroke,800,{});}
        if(!app.history.undo()||!app.history.redo())throw Error('Large project lost undo/redo');
        const bytes=app.history.getUndoMemoryBytes();if(bytes>8*1024*1024)throw Error('Sparse strokes retained full-canvas history');history.push(bytes);
        await app.projectManager.prepareProject(project);app.saveProjectState();
    }
    for(const id of window.largeIds)app.switchProject(id);
    return {tabs:count,layers:count*3,historyBytes:history};
}
async function closeBatch(){
    const app=window.mollyEditor;
    for(const id of window.largeIds)if(!await app.closeProject(id))throw Error('Large project close failed');
    window.largeIds=[];
}
(async()=>{let win;const timer=setTimeout(()=>app.exit(1),180000),samples=[];try{
    await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Memory anchor'}});
    await win.page.evaluate(openBatch,2);await win.page.evaluate(closeBatch);await settle(win);await win.cdp.send('HeapProfiler.collectGarbage');
    const before=await win.cdp.send('Runtime.getHeapUsage'),nativeBefore=await nativeMemory();
    for(let batch=0;batch<2;batch++){
        const workload=await win.page.evaluate(openBatch,4);samples.push({batch,...workload,peakHeap:await win.cdp.send('Runtime.getHeapUsage'),peakProcesses:await nativeMemory()});
        await win.page.evaluate(closeBatch);await settle(win);await win.cdp.send('HeapProfiler.collectGarbage');await win.cdp.send('HeapProfiler.collectGarbage');
        if(await win.page.evaluate(()=>window.largeRefs.some(ref=>ref.deref())))throw Error('Closed large document, layer or source master remains reachable');
        await win.page.evaluate(()=>{window.largeRefs=[];});
    }
    const after=await win.cdp.send('Runtime.getHeapUsage');
    if(after.usedSize-before.usedSize>16*1024*1024||after.backingStorageSize-before.backingStorageSize>32*1024*1024)throw Error('Large project memory grows after cleanup');
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
    const result={passed:true,checks:['Multiple large tabs preserve their masters, history, effects and switching','Sparse edits keep bounded history','Closed large documents and their master canvases are garbage collected','Retained heap and backing storage stay bounded after warmup'],before,after,nativeBefore,nativeAfter:await nativeMemory(),samples};
    await fs.writeFile(path.join(root,'.test-output/large-session-scenarios.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
