const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
    await ready();win=makeWindow(1280,800);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Private project'}});
    const result=await win.page.evaluate(async()=>{
        const {encodeProject,decodeProject,encodeCanvasPNG,codecStatus}=await import(new URL('js/core/ProjectCodec.mjs',location.href));
        const {performanceJournal}=await import(new URL('js/core/Performance.mjs',location.href));
        const fixture={type:'canvas',layers:[{dataUrl:'A'.repeat(8*1024*1024)}]},checks=[],samples=[];
        const gap=async operation=>{let last=performance.now(),maxGap=0,ticks=0;const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},1);await new Promise(resolve=>setTimeout(resolve,10));const start=performance.now();const value=await operation();await new Promise(resolve=>setTimeout(resolve,10));clearInterval(timer);return {durationMs:performance.now()-start,maxGapMs:maxGap,ticks,value};};
        await encodeProject({layers:[{dataUrl:'A'.repeat(300000)}]});
        const baseline=await gap(()=>JSON.stringify(fixture)),worker=await gap(()=>encodeProject(fixture));
        if(worker.value!==baseline.value||!codecStatus().worker||codecStatus().pending)throw Error('Worker codec is not active or produced different JSON');checks.push('Large projects use the real local worker and preserve exact JSON');
        const decoded=await decodeProject(worker.value);if(decoded.layers[0].dataUrl!==fixture.layers[0].dataUrl)throw Error('Worker decode changed data');checks.push('Background decoding preserves large pixel payloads');
        try{await decodeProject(' '.repeat(300000)+'{bad}');throw Error('Invalid JSON accepted');}catch(error){if(error.message==='Invalid JSON accepted')throw error;}
        await encodeProject(fixture);checks.push('A malformed document does not poison later worker operations');

        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
        const ctx=canvas.getContext('2d',{willReadFrequently:true}),pixels=ctx.createImageData(256,256);
        for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=i%251;pixels.data[i+1]=(i>>8)%255;pixels.data[i+2]=77;pixels.data[i+3]=[0,64,128,255][(i>>2)%4];}
        ctx.putImageData(pixels,0,0);
        const original=ctx.getImageData(0,0,256,256).data;
        const image=new Image();image.src=await encodeCanvasPNG(canvas);await image.decode();
        ctx.clearRect(0,0,256,256);ctx.drawImage(image,0,0);
        if(!ctx.getImageData(0,0,256,256).data.every((value,i)=>value===original[i]))throw Error('Worker PNG changed pixel colors or transparency');
        checks.push('PNG worker preserves every decoded RGBA pixel, including transparent edges');

        const editor=window.mollyEditor,manager=editor.projectManager;
        const {default:Layer}=await import(new URL('js/graphics/Layer.js',location.href));
        const layer=new Layer('worker-fixture','worker-fixture',256,256);layer.ctx.drawImage(canvas,0,0);layer.invalidateSource();
        layer.sourceCanvas=canvas;layer.sourceRect={x:0,y:0,w:256,h:256};
        const project={id:'worker-fixture',type:'canvas',config:{width:256,height:256},layers:[layer]};editor.projects.push(project);
        try{
            await manager.prepareLayerImages(project);
            const prepared=manager.serializeProject(project.id).layers[0];
            if(!prepared.dataUrl||!prepared.sourceDataUrl||!manager.layerImageCache.has(layer))throw Error('Missing worker PNG cache or master');
            checks.push('Prepared saves retain both the layer image and its full-quality master');

            const nativeBitmap=window.createImageBitmap;let release,started;
            const captured=new Promise(resolve=>{started=resolve;});
            window.createImageBitmap=async source=>{const bitmap=await nativeBitmap(source);started();await new Promise(resolve=>{release=resolve;});return bitmap;};
            manager.layerImageCache.delete(layer);
            try{
                const preparation=manager.prepareLayerImages(project);await captured;
                layer.ctx.fillStyle='#ff0000';layer.ctx.fillRect(0,0,1,1);layer.invalidateSource(false);release();await preparation;
                if(manager.layerImageCache.has(layer))throw Error('Stale worker image was cached after a concurrent edit');
                const saved=manager.serializeProject(project.id).layers[0];
                if(saved.dataUrl===prepared.dataUrl)throw Error('Concurrent edit was lost');
                checks.push('An edit during background encoding invalidates the stale snapshot');
            }finally{window.createImageBitmap=nativeBitmap;}

            manager.layerImageCache.delete(layer);manager.masterImageCache.delete(canvas);
            const workerDescriptor=Object.getOwnPropertyDescriptor(window,'Worker'),nativeWorker=window.Worker;let workerReads=0;
            Object.defineProperty(window,'Worker',{configurable:true,get:()=>++workerReads<=3?nativeWorker:undefined});
            try{
                await manager.prepareLayerImages(project);
                if(!manager.layerImageCache.get(layer)?.sourceDataUrl)throw Error('Fallback lost the source master');
                checks.push('A worker becoming unavailable between layer and master cannot discard the original');
            }finally{Object.defineProperty(window,'Worker',workerDescriptor);}

            layer.canvas.width=layer.canvas.height=layer.width=layer.height=32;
            layer.invalidateSource(false);manager.masterImageCache.delete(canvas);
            await manager.prepareLayerImages(project);
            if(!manager.layerImageCache.get(layer)?.sourceDataUrl)throw Error('A small transformed layer skipped its large original');
            checks.push('A small transformed layer still prepares its large original in the worker');
        }finally{editor.projects.splice(editor.projects.indexOf(project),1);}

        const start=performance.now();for(let i=0;i<20;i++){editor.renderer.render();manager.serializeProject();}
        samples.push({case:'8MiB JSON',baseline:{durationMs:baseline.durationMs,maxGapMs:baseline.maxGapMs,ticks:baseline.ticks},worker:{durationMs:worker.durationMs,maxGapMs:worker.maxGapMs,ticks:worker.ticks}},{case:'20 render + serialize',durationMs:performance.now()-start});
        return {checks,samples,metrics:performanceJournal.snapshot(),codec:codecStatus()};
    });
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));await fs.writeFile(path.join(root,'.test-output/performance-scenarios.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
