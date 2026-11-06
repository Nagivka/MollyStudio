const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
const pages=[['launcher','index.html'],['canvas','editor.html','canvas'],['gui','editor.html','gui'],['prefix','editor.html','prefix'],['title','editor.html','title'],['settings','settings.html'],['create','new-project.html'],['buttons','buttons.html'],['utilities','editor.html','canvas']];
const themes=['dark','light','minecraft','light-minecraft'];
const minimum={launcher:[900,600],canvas:[900,600],gui:[900,600],prefix:[900,600],title:[1000,700],utilities:[900,600],settings:[760,560],create:[480,440],buttons:[880,580]};
(async()=>{
    let win;const results=[],timer=setTimeout(()=>app.exit(1),240000),output=path.join(root,'.test-output/responsive');
    try{
        const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');await ready();await fs.mkdir(output,{recursive:true});win=makeWindow();
        for(const [name,file,type]of pages){
            win.setContentSize(1440,900);win.webContents.setZoomFactor(1);
            await win.loadFile(path.join(root,'src/renderer',file),{query:type?{new:'true',type,width:'64',height:'64',size:'54',name:'Layout QA'}:{}});await settle(win);
            await win.page.evaluate(async name=>{
                if(name==='title')await mollyEditor.getActiveProject().prefixLoadPromise;
                const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));
                window.layoutSettings=window.mollyEditor?.settingsManager||new Settings();layoutSettings.set('animationsEnabled',false);layoutSettings.set('language','en');
                if(name==='canvas'){
                    const layer=mollyEditor.layerManager.addTextLayer('QA',{text:'Text layout',x:2,y:2,fontId:'minecraft'});mollyEditor.tools.setTool('text');mollyEditor.tools.tools.text.renderTextLayer(layer);
                }
                if(name==='utilities')mollyEditor.menuBar.handleAction('utility-gradient');
            },name);
            const sizes=[[1440,900,1],[1000,700,1.25],[800,600,1.5],[...minimum[name],1],[1920,1080,1],[1600,1000,2]];
            for(const theme of themes)for(const [width,height,zoom]of sizes){
                win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await win.page.evaluate(theme=>layoutSettings.set('theme',theme),theme);await settle(win);
                const report=await win.page.evaluate(inspectInterfaceGeometry),errors=[];
                const structure=await win.page.evaluate(()=>{
                    const shown=element=>element.getClientRects().length>0;
                    const tools=[...document.querySelectorAll('#main-toolbar .tools-group>.tool-btn')].filter(shown).map(element=>element.getBoundingClientRect().left);
                    const panels=[...document.querySelectorAll('#main-right-panel>.md-panel')].filter(shown).map(element=>element.getBoundingClientRect().left);
                    const workspace=document.querySelector('#workspace'),box=workspace?.getBoundingClientRect();
                    const prefix=document.querySelector(':is(#prefix-editor,#title-editor):not([hidden])'),prefixBox=prefix?.getBoundingClientRect();
                    const prefixPlaced=!prefix||!shown(prefix)||!box||(innerWidth<=600?box.bottom<=prefixBox.top+2&&Math.abs(box.left-prefixBox.left)<2:box.right<=prefixBox.left+2&&Math.abs(box.top-prefixBox.top)<2);
                    const title=document.querySelector('#title-editor:not([hidden])'),body=title?.querySelector('.title-inspector-body'),titleUsable=!title||body.clientHeight>=64||(/auto|scroll/.test(getComputedStyle(title).overflowY)&&title.scrollHeight>title.clientHeight);
                    return {singleToolColumn:!tools.length||Math.max(...tools)-Math.min(...tools)<2,singleInspectorColumn:!panels.length||Math.max(...panels)-Math.min(...panels)<2,canvasUsable:!box||!shown(workspace)||box.width>=Math.min(innerWidth*.25,200),prefixPlaced,titleUsable,navNamed:[...document.querySelectorAll('.settings-win-sidebar .settings-tab-btn')].every(button=>button.textContent.trim()&&button.title)};
                });
                if(report.rootOverflow>2)errors.push('root overflow');if(report.overlaps.length)errors.push('overlapping controls');if(report.overflow.length)errors.push('horizontal overflow');if(report.clipped.length)errors.push('clipped labels');if(report.dialogsOutside.length)errors.push('dialog outside window');
                if(!structure.singleToolColumn)errors.push('tool strip formed multiple columns');if(!structure.singleInspectorColumn)errors.push('inspector formed multiple columns');if(!structure.canvasUsable)errors.push('canvas width was crushed');if(!structure.navNamed)errors.push('compact navigation lost its labels');
                if(!structure.prefixPlaced)errors.push('prefix inspector did not follow the window layout');
                if(!structure.titleUsable)errors.push('title settings cannot be reached');
                results.push({name,theme,width,height,zoom,errors,report});
                if(errors.length||theme==='minecraft'&&zoom===1.5||width===1920&&theme==='dark')await fs.writeFile(path.join(output,`${name}-${theme}-${width}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
            }
            if(name==='title'){
                // Exercise both sides of the stacked-layout breakpoint, including
                // the long Russian/English appearance tab in the pixel font.
                for(const theme of themes)for(const language of ['ru','en'])for(const width of [600,601,640,700]){
                    win.setContentSize(width,800);win.webContents.setZoomFactor(1);
                    await win.page.evaluate(({theme,language})=>{layoutSettings.set('theme',theme);layoutSettings.set('language',language);},{theme,language});await settle(win);
                    const report=await win.page.evaluate(inspectInterfaceGeometry),errors=[];
                    if(report.rootOverflow>2)errors.push('root overflow');if(report.overlaps.length)errors.push('overlapping controls');if(report.clipped.length)errors.push('clipped labels');if(report.overflow.length)errors.push('horizontal overflow');
                    results.push({name,theme,language,width,height:800,zoom:1,errors,report});
                    if(errors.length)await fs.writeFile(path.join(output,`${name}-${theme}-${language}-${width}.png`),(await win.webContents.capturePage()).toPNG());
                }
            }
            if(name==='settings'){
                await win.page.getByRole('tab',{name:'Tools',exact:true}).click();
                await win.page.getByRole('tab',{name:'Appearance',exact:true}).click();
                if(await win.page.getByRole('tab',{name:'Appearance',exact:true}).getAttribute('aria-selected')!=='true')throw Error('Compact settings navigation is not operable');
            }
            if(name==='canvas'){
                win.setContentSize(1280,800);win.webContents.setZoomFactor(1);await win.page.evaluate(()=>layoutSettings.set('theme','dark'));await settle(win);
                const handle=await win.page.locator('#right-panel-resizer').boundingBox(),before=await win.page.locator('#main-right-panel').boundingBox();
                await win.page.mouse.move(handle.x+handle.width/2,handle.y+40);await win.page.mouse.down();await win.page.mouse.move(handle.x-80,handle.y+40,{steps:8});await win.page.mouse.up();await settle(win);
                const after=await win.page.locator('#main-right-panel').boundingBox();
                if(after.width<=before.width+30||await win.page.locator('#workspace').evaluate(node=>node.clientWidth<200))throw Error('Grid layout broke inspector resizing');
                const persisted=await win.page.evaluate(()=>Number(localStorage.getItem('molly_panel_width')));
                if(Math.abs(persisted-after.width)>2)throw Error('Inspector width was not persisted');
                const tab = win.page.locator('.doc-tab').first();
                const tabWidth = (await tab.boundingBox()).width;
                await win.page.locator('.tabs-resizer').press('ArrowRight');
                await settle(win);
                if ((await tab.boundingBox()).width <= tabWidth ||
                    !await win.page.evaluate(() => Number(localStorage.getItem('molly_tab_width')))) {
                    throw Error('Keyboard resize did not change and persist tab width');
                }
            }
            console.log('Checked responsive '+name);
        }
        const failed=results.filter(result=>result.errors.length);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:!failed.length,cases:results.length,results},null,2));
        if(failed.length)throw Error(JSON.stringify(failed.map(({name,theme,zoom,errors,report})=>({name,theme,zoom,errors,overlaps:report.overlaps.slice(0,2),overflow:report.overflow.slice(0,3),clipped:report.clipped.slice(0,2)}))).slice(0,7000));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log(JSON.stringify({passed:true,cases:results.length}));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
