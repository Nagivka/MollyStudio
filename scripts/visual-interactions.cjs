const fs = require('node:fs/promises');
const path = require('node:path');
const {app, root, ready, makeWindow, settle} = require('./lib/electron-harness.cjs');
const themes = ['dark','oled','midnight','forest','amethyst','light','light-nord','light-warm','light-rose','light-mint','minecraft','light-minecraft'];

(async () => {
    let win;
    const results = [], timeout = setTimeout(() => app.exit(1), 600000);
    try {
        const {inspectInterfaceGeometry} = await import('./lib/interface-geometry.mjs');
        await ready(); win = makeWindow(1280,800);
        await win.loadFile(path.join(root,'src/renderer/editor.html'), {query:{new:'true',type:'canvas',width:'64',height:'64',name:'Visual interaction QA'}});
        await win.page.evaluate(() => {
            const app=window.mollyEditor;app.settingsManager.set('animationsEnabled',false);
            const layer=app.layerManager.addLayer('Long layer name for dialog layout checks');
            layer.ctx.fillStyle='#4682b4';layer.ctx.fillRect(2,2,48,48);layer.invalidateSource();
        });
        const output=path.join(root,'.test-output/visual-interactions');await fs.mkdir(output,{recursive:true});
        for(const state of ['menu','export-error','texture-error']) {
            for(const language of ['ru','en']) for(const theme of themes) {
                await win.page.evaluate(async ({state,language,theme})=>{
                    const app=window.mollyEditor;app.menuBar.closeAll();
                    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
                    app.settingsManager.set('language',language);app.settingsManager.set('theme',theme);
                    if(state==='menu')document.querySelector('.menu-btn').click();
                    if(state==='export-error'){
                        await app.exportPanel.open();app.exportPanel.get('format').value='sheet';app.exportPanel.get('columns').value='';await app.exportPanel.preview();
                        if(!app.exportPanel.get('save').disabled||app.exportPanel.get('error').hidden||app.exportPanel.get('sheet-fields').hidden)throw Error('Invalid export parameters were accepted or hidden from correction');
                    }
                    if(state==='texture-error'){
                        app.texturePanel.open();const dialog=app.texturePanel.dialog;
                        const type=dialog.querySelector('[data-texture=type]');type.value=[...type.options].find(option=>option.value!=='none').value;dialog.querySelector('[data-texture=amount]').value='101';app.texturePanel.preview();
                        if(!dialog.querySelector('[data-texture-apply]').disabled||dialog.querySelector('[data-texture=amount]').getAttribute('aria-invalid')!=='true')throw Error('Invalid texture parameters were accepted');
                    }
                },{state,language,theme});
                for(const [width,height,zoom] of [[1280,800,1],[1000,700,1],[1280,800,1.5]]) {
                    win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await settle(win);
                    const report=await win.page.evaluate(inspectInterfaceGeometry),errors=[];
                    for(const key of ['overlaps','clipped','overflow','pixelFallbacks','dialogsOutside'])if(report[key].length)errors.push(key);
                    if(report.rootOverflow>2)errors.push('rootOverflow');
                    results.push({state,language,theme,width,height,zoom,errors,report});
                    if(width===1000&&language==='en'&&['dark','minecraft','light-minecraft'].includes(theme))await fs.writeFile(path.join(output,`${state}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
                }
            }
            console.log('Checked '+state+' in 12 themes, two languages and three window/scale combinations.');
        }
        const failed=results.filter(r=>r.errors.length);
        await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:!failed.length,cases:results.length,results},null,2));
        if(failed.length)throw Error(JSON.stringify(failed.slice(0,5)).slice(0,6500));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        console.log(JSON.stringify({passed:true,cases:results.length}));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);}
})();
