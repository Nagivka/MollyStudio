const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
const themes=['dark','oled','midnight','forest','amethyst','light','light-nord','light-warm','light-rose','light-mint','minecraft','light-minecraft'];
(async()=>{let win;const results=[],timer=setTimeout(()=>app.exit(1),600000);try{
    const {inspectInterfaceGeometry}=await import('./lib/interface-geometry.mjs');await ready();win=makeWindow(1440,900);
    const output=path.join(root,'.test-output/visual-components');await fs.mkdir(output,{recursive:true});
    for(const page of ['canvas','gui','shape','button','prefix','prefix-background','title','title-material','title-scene','buttons-size','buttons-style','buttons-color','utilities','diagnostics']){
        const standalone=page.startsWith('buttons-'),type=page.startsWith('title')?'title':page.startsWith('prefix')?'prefix':['gui','canvas'].includes(page)?page:'canvas';
        await win.loadFile(path.join(root,'src/renderer',standalone?'buttons.html':'editor.html'),{query:standalone?{}:{new:'true',type,width:'64',height:'64',name:'QA'}});
        await win.page.evaluate(async page=>{
            const app=window.mollyEditor;
            const {default:Settings}=await import(new URL('js/core/SettingsManager.js',location.href));
            window.visualSettings=app?.settingsManager||new Settings();visualSettings.set('animationsEnabled',false);
            if(page.startsWith('buttons-')){buttonGenApp.inspectorTabs.select(page.slice(8));if(page==='buttons-color')buttonGenApp.setColorMode('gradient');return;}
            if(page==='canvas'){const layer=app.layerManager.addTextLayer('QA',{text:'QA',fontId:'minecraft',color:'#FFFFFF',x:2,y:2});app.tools.setTool('text');app.tools.tools.text.renderTextLayer(layer);}
            if(page==='gui')await app.getActiveProject().templateLoadPromise;
            if(page==='shape'){const layer=app.layerManager.addLayer('Rectangle');layer.shapeData={type:'rect-empty',x0:4,y0:4,x1:28,y1:24,color:'#CC6633',stroke:2,radius:3,filled:false};app.redrawShapeLayer(layer);app.layerManager.setActive(layer.id);app.syncPropertiesPanel();}
            if(page==='button'){
                const {default:Model}=await import(new URL('js/ui/ButtonGeneratorModel.js',location.href));const {importGeneratedButton}=await import(new URL('js/core/GeneratedButtonImport.js',location.href));
                const model=new Model();Object.assign(model,{currentCols:2,currentRows:1,currentSlotMode:'full',currentSlotSize:18,currentStyle:'ten',currentChin:1,currentShadow:1,currentOpacity:100});
                await importGeneratedButton(app,model.createButtonData());app.propertiesInspector.buttonProperties.edit({autoShade:false,colorMode:'gradient'});
            }
            if(page==='prefix-background'){await app.getActiveProject().prefixLoadPromise;app.prefixEditor.tabs.select('background');}
            if(page==='utilities')app.menuBar.handleAction('utility-gradient');
            if(page.startsWith('title')){await app.getActiveProject().prefixLoadPromise;const e=app.titleEditor,id=e.renderer.mesh.nodes.find(node=>node.type==='glyph').id;if(page==='title-scene')e.viewport.select(id);else e.setTab(page==='title-material'?'material':'settings');}
            if(page==='diagnostics'){const {openDiagnostics}=await import(new URL('js/ui/DiagnosticsDialog.js',location.href));await openDiagnostics();}
        },page);
        for(const theme of themes){
            await win.page.evaluate(theme=>visualSettings.set('theme',theme),theme);
            for(const zoom of [1,1.25,1.5]){
                win.setContentSize(1440,900);win.webContents.setZoomFactor(zoom);await settle(win);
                const report=await win.page.evaluate(inspectInterfaceGeometry);
                const errors=[];if(report.rootOverflow>2)errors.push('rootOverflow');if(report.overlaps.length)errors.push('overlaps');if(report.dialogsOutside.length)errors.push('dialogsOutside');if(report.overflow.length)errors.push('overflow');if(report.pixelFallbacks.length)errors.push('pixelFallbacks');
                // Scrollable content is audited only inside its visible clipping region.
                if(report.clipped.length)errors.push('clipped');
                results.push({page,theme,zoom,errors,report});
                if(zoom===1)await fs.writeFile(path.join(output,page+'-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
            }
        }
        console.log('Checked '+page+' in all 12 themes at 100%, 125% and 150%.');
    }
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:results.every(r=>!r.errors.length),cases:results.length,results},null,2));
    const failures=results.filter(r=>r.errors.length);if(failures.length)throw Error('Visual component failures: '+JSON.stringify(failures.map(({page,theme,zoom,errors,report})=>({page,theme,zoom,errors,overlaps:report.overlaps.slice(0,2),clipped:report.clipped.slice(0,2),fallback:report.pixelFallbacks}))).slice(0,4500));
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log(JSON.stringify({passed:true,cases:results.length}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
