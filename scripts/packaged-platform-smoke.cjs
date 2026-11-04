const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright-core'),{PNG}=require('pngjs'),{distributionLayout}=require('./lib/distribution-layout.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
    if(!process.env.CI)throw Error('Run packaged smoke checks on a disposable CI runner.');
    const report=JSON.parse(await fs.readFile(path.join(root,`dist/build-${process.platform}-${process.arch}.json`),'utf8'));
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'molly-packaged-smoke-')),profile=path.join(directory,'profile'),fixture=path.join(directory,'fixture.mlst');
    await fs.mkdir(profile);await fs.writeFile(path.join(profile,'update-preferences.json'),JSON.stringify({autoCheck:false,autoDownload:false}));
    await fs.writeFile(fixture,JSON.stringify({mollyVersion:2,type:'canvas',name:'Native smoke',config:{width:64,height:64},layers:[]}));
    const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));
    const executable=process.argv[2]||distributionLayout(path.join(root,report.unpacked),process.platform).executable;
    const env={...process.env};for(const key of ['MOLLY_TEST_PROFILE','MOLLY_MANUAL_CHECK','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'])delete env[key];
    let child,browser,log='';
    try{
        child=spawn(executable,[`--user-data-dir=${profile}`,`--remote-debugging-address=127.0.0.1`,`--remote-debugging-port=${port}`,fixture],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
        child.on('error',error=>{log+=error.message;});child.stdout.on('data',bytes=>{log=(log+bytes).slice(-16000);});child.stderr.on('data',bytes=>{log=(log+bytes).slice(-16000);});
        let endpoint;
        for(let i=0;i<150;i++){
            if(child.exitCode!==null)throw Error('Packaged application exited before opening: '+log);
            try{const info=await(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).json();endpoint=info.webSocketDebuggerUrl;if(endpoint)break;}catch{}
            await delay(200);
        }
        if(!endpoint)throw Error('Packaged Chromium did not become ready: '+log);
        browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];
        let page;for(let i=0;i<150;i++){page=context.pages().find(page=>/editor\.html/.test(page.url()));if(page)break;await delay(200);}
        if(!page)throw Error('Associated MLST project did not open');
        await page.waitForFunction(()=>window.mollyEditor?.getActiveProject()?.filePath,{timeout:30000});
        const result=await page.evaluate(async()=>{
            const app=mollyEditor,project=app.getActiveProject(),layer=app.layerManager.addLayer('Native pixels');
            layer.ctx.fillStyle='#3B82F6';layer.ctx.fillRect(4,4,12,10);layer.invalidateSource();app.renderer.render();
            if(!await app.projectManager.saveProject())throw Error('Native project save failed');
            await app.exportPanel.open();const options=app.exportPanel.read();
            const canvas=app.exportPanel.source(app.exportPanel.entries(options)[0],options),png=canvas.toDataURL();app.exportPanel.close();
            return {platform:desktopAPI.platform,arch:desktopAPI.arch,png,width:canvas.width,height:canvas.height,overflow:document.documentElement.scrollWidth-innerWidth};
        });
        if(result.platform!==process.platform||result.arch!==process.arch||result.width!==64||result.height!==64||result.overflow>2)throw Error('Packaged platform, canvas or geometry mismatch');
        const saved=JSON.parse(await fs.readFile(fixture,'utf8')),pixels=PNG.sync.read(Buffer.from(result.png.split(',')[1],'base64'));
        const expected=PNG.sync.read(Buffer.from(saved.layers.at(-1).dataUrl.split(',')[1],'base64'));
        if(!pixels.data.equals(expected.data))throw Error('Packaged export pixels differ from saved MLST');
        const closed=page.waitForEvent('close');await page.evaluate(()=>{setTimeout(()=>desktopAPI.close(),50);});await closed;
        const output={passed:true,platform:process.platform,arch:process.arch,packaged:true,installed:process.argv[3]==='installed',productionFuses:true,associationArgumentOpened:true,mlstSaved:true,pngPixelsEqual:true,cleanClose:true,checkedAt:new Date().toISOString()};
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,`.test-output/packaged-platform-smoke${output.installed?'-installed':''}.json`),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
    }finally{
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,'.test-output/packaged-process.log'),log);
        await browser?.close().catch(()=>{});
        if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await Promise.race([stopped,delay(10000)]);}
        if(path.dirname(directory)!==os.tmpdir()||!path.basename(directory).startsWith('molly-packaged-smoke-'))throw Error('Invalid smoke cleanup path');
        await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
