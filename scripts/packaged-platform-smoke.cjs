const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core'),{PNG}=require('pngjs'),{distributionLayout}=require('./lib/distribution-layout.cjs');
const {run}=require('./lib/portable-tools.cjs');
const root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForProject(context, file) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        const page = context.pages().find(candidate => /\/editor\.html(?:[?#]|$)/.test(candidate.url()));
        if (page) {
            await page.waitForFunction(expected => window.mollyEditor?.getActiveProject()?.filePath === expected, file, {timeout: 30000});
            return page;
        }
        await delay(200);
    }
    throw Error('The requested MLST project did not open');
}

async function checkProjectAssociation(executable, fixture) {
    if (process.platform === 'darwin') {
        const contents = path.resolve(path.dirname(executable), '..');
        const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')], {encoding: 'utf8'}));
        const project = plist.CFBundleDocumentTypes?.find(type => type.CFBundleTypeExtensions?.includes('mlst'));
        if (project?.CFBundleTypeRole !== 'Editor' || !project.CFBundleTypeIconFile) throw Error('The Mac bundle does not register MLST documents');
        await fs.access(path.join(contents, 'Resources', project.CFBundleTypeIconFile));
    } else if (process.platform === 'linux') {
        const mime = execFileSync('gio', ['info', '-a', 'standard::content-type', fixture], {encoding: 'utf8'});
        const entry = await fs.readFile('/usr/share/applications/mollystudio.desktop', 'utf8');
        const projectMime = 'application/x-mollystudio-project';
        const registered = /^MimeType=(.+)$/m.exec(entry)?.[1].split(';').filter(type => type === projectMime);
        if (!/^\s*standard::content-type: application\/x-mollystudio-project\s*$/m.test(mime) || registered?.length !== 1 || !/^Exec=.*\s%[fFuU]\s*$/m.test(entry)) {
            throw Error('The installed DEB does not register MLST documents');
        }
    }
}

(async()=>{
    if(!process.env.CI)throw Error('Run packaged smoke checks on a disposable CI runner.');
    const report=JSON.parse(await fs.readFile(path.join(root,`dist/build-${process.platform}-${process.arch}.json`),'utf8'));
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'molly-packaged-smoke-'));
    const wayland=process.argv[3]==='wayland',appImage=process.argv[3]==='appimage';
    const profile=wayland?path.join(directory,'config','MollyStudio'):path.join(directory,'profile');
    const fixture=path.join(await fs.realpath(directory),'Проект проверки.mlst');
    const installed=wayland||process.argv[3]==='installed';
    const suffix=wayland?'-wayland':appImage?'-appimage':installed?'-installed':'';
    await fs.mkdir(profile,{recursive:true});await fs.writeFile(path.join(profile,'update-preferences.json'),JSON.stringify({autoCheck:false,autoDownload:false}));
    await fs.writeFile(fixture,JSON.stringify({mollyVersion:2,type:'canvas',name:'Native smoke',config:{width:64,height:64},layers:[]}));
    const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));
    const executable=process.argv[2]||distributionLayout(path.join(root,report.unpacked),process.platform).executable;
    const env={...process.env};for(const key of ['MOLLY_TEST_PROFILE','MOLLY_MANUAL_CHECK','ELECTRON_RUN_AS_NODE','NODE_OPTIONS'])delete env[key];
    if(wayland){delete env.DISPLAY;env.XDG_CONFIG_HOME=path.dirname(profile);env.WAYLAND_DEBUG='client';}
    if(appImage)env.APPIMAGE_EXTRACT_AND_RUN='1';
    let child,browser,log='';
    try{
        if(installed)await checkProjectAssociation(executable,fixture);
        const openArgument=process.platform==='linux'&&installed?pathToFileURL(fixture).href:fixture;
        const displaySwitches=wayland?['--ozone-platform=wayland','--force-device-scale-factor=1.25']:[];
        child=spawn(executable,[...displaySwitches,`--user-data-dir=${profile}`,`--remote-debugging-address=127.0.0.1`,`--remote-debugging-port=${port}`,openArgument],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
        let waylandSurface=false;
        child.on('error',error=>{log+=error.message;});child.stdout.on('data',bytes=>{log=(log+bytes).slice(-16000);});child.stderr.on('data',bytes=>{log=(log+bytes).slice(-16000);waylandSurface ||= /xdg_surface[@#]\d+\.get_toplevel/.test(log);});
        let endpoint;
        for(let i=0;i<150;i++){
            if(child.exitCode!==null)throw Error('Packaged application exited before opening: '+log);
            try{const info=await(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)})).json();endpoint=info.webSocketDebuggerUrl;if(endpoint)break;}catch{}
            await delay(200);
        }
        if(!endpoint)throw Error('Packaged Chromium did not become ready: '+log);
        browser=await chromium.connectOverCDP(endpoint);const context=browser.contexts()[0];
        const page=await waitForProject(context, fixture);
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
        if(appImage){
            if(!await page.evaluate(async()=>Boolean((await desktopAPI.getUpdateStatus()).supported)))throw Error('AppImage update channel is unavailable');
            const session=await browser.newBrowserCDPSession();
            const {processInfo}=await session.send('SystemInfo.getProcessInfo');
            await session.detach();
            const renderer=processInfo.find(process=>process.type==='renderer');
            const status=renderer&&await fs.readFile(`/proc/${renderer.id}/status`,'utf8');
            if(!status||!/^Seccomp:\s+2$/m.test(status)||!/^NoNewPrivs:\s+1$/m.test(status))throw Error('AppImage renderer does not have the Chromium sandbox');
        }
        if(wayland){
            const scale=await page.evaluate(()=>devicePixelRatio);
            if(!waylandSurface||Math.abs(scale-1.25)>.01)throw Error(`Expected a native Wayland surface at 125% scale (native=${waylandSurface}, devicePixelRatio=${scale})`);
            await page.bringToFront();
            // A DevTools event has no Wayland seat serial. Deliver a key to
            // the nested compositor before exercising the system clipboard.
            await page.evaluate(()=>window.addEventListener('keydown',event=>{
                if(event.key==='Shift')document.documentElement.dataset.ciWaylandKey='true';
            },{once:true}));
            const westonLog=await fs.readFile(path.join(root,'.test-output','weston.log'),'utf8');
            const westonWindow=/x11 output .*window id (\d+)/.exec(westonLog)?.[1];
            if(!westonWindow)throw Error('Weston X11 window ID is missing');
            execFileSync('xdotool',['windowfocus','--sync',westonWindow,'key','Shift_L'],{timeout:5000});
            await page.waitForFunction(()=>document.documentElement.dataset.ciWaylandKey==='true',null,{timeout:5000});
            const clipboard='MollyStudio — проверка Wayland';
            await page.evaluate(text=>navigator.clipboard.writeText(text),clipboard);
            const copied=execFileSync('wl-paste',['--no-newline'],{encoding:'utf8',env:{...env,WAYLAND_DEBUG:''},timeout:8000});
            if(copied!==clipboard)throw Error('Wayland clipboard differs from the copied text');

            const pngFile=path.join(directory,'Wayland drop.png');
            await fs.writeFile(pngFile,PNG.sync.write(pixels));
            const layerCount=await page.evaluate(()=>mollyEditor.layerManager.layers.length);
            const box=await page.locator('#workspace').boundingBox();
            const session=await context.newCDPSession(page);
            const drop={x:box.x+box.width/2,y:box.y+box.height/2,data:{items:[],files:[pngFile],dragOperationsMask:1}};
            for(const type of ['dragEnter','dragOver','drop'])await session.send('Input.dispatchDragEvent',{...drop,type});
            await page.waitForFunction(count=>mollyEditor.layerManager.layers.length===count+1,layerCount,{timeout:10000});
            await page.evaluate(()=>mollyEditor.settingsManager.set('confirmClose',false));

            const fromDesktop=path.join(path.dirname(fixture),'Проект из файлового менеджера.mlst');
            await fs.copyFile(fixture,fromDesktop);
            await run('gio',['launch','/usr/share/applications/mollystudio.desktop',pathToFileURL(fromDesktop).href],{env});
            await waitForProject(context,fromDesktop);
        }
        const closeWindow=async target=>{
            const closed=target.waitForEvent('close',{timeout:30000});
            await target.evaluate(()=>{setTimeout(()=>desktopAPI.close(),50);});
            await closed;
        };
        await closeWindow(page);
        let launchServicesOpened=false;
        if(process.platform==='darwin'&&installed){
            const bundle=path.resolve(path.dirname(executable),'../..');
            const secondFixture=path.join(path.dirname(fixture),'Проект из Finder.mlst');
            await fs.copyFile(fixture,secondFixture);
            await run('/usr/bin/open',['-a',bundle,secondFixture]);
            const reopened=await waitForProject(context,secondFixture);
            launchServicesOpened=true;
            await closeWindow(reopened);
        }
        const output={passed:true,platform:process.platform,arch:process.arch,packaged:true,installed,wayland,appImage,productionFuses:true,associationRegistered:installed,associationArgumentOpened:true,launchServicesOpened,mlstSaved:true,pngPixelsEqual:true,cleanClose:true,checkedAt:new Date().toISOString()};
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,`.test-output/packaged-platform-smoke${suffix}.json`),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
    }catch(error){
        if(wayland)console.error(log.slice(-5000));
        throw error;
    }finally{
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});await fs.writeFile(path.join(root,`.test-output/packaged-process${suffix}.log`),log);
        await browser?.close().catch(()=>{});
        if(child&&child.exitCode===null){const stopped=once(child,'exit');child.kill();await Promise.race([stopped,delay(10000)]);}
        if(path.dirname(directory)!==os.tmpdir()||!path.basename(directory).startsWith('molly-packaged-smoke-'))throw Error('Invalid smoke cleanup path');
        await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
