const assert=require('node:assert/strict'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
    await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64'}});
    let cases=0;
    for(const theme of ['dark','light','minecraft','light-minecraft'])for(const [width,height,zoom] of [[1280,900,1],[900,600,1],[1000,700,1.5]]){
        win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);
        await win.page.evaluate(theme=>{mollyEditor.settingsManager.set('theme',theme);mollyEditor.settingsManager.set('animationsEnabled',false);},theme);await settle(win);
        cases+=await win.page.evaluate(async()=>{
            const tools=mollyEditor.tools,bar=document.querySelector('.options-bar'),workspace=document.querySelector('.workspace-layout');let top;
            const ids=['brush','pencil','eraser','move','transform','marquee','lasso','wand','bucket','gradient','text','line','rect-empty','rect-filled','circle-empty','circle-filled','hand','pipette'];
            for(const id of ids){
                tools.setTool(id);
                const rect=bar.getBoundingClientRect(),current=workspace.getBoundingClientRect().top;
                if(Math.abs(rect.height-48)>.1||!bar.getClientRects().length)throw Error('Missing or resized options bar for '+id+': '+rect.height);
                if(top!==undefined&&Math.abs(top-current)>.1)throw Error('Switching to '+id+' shifted the workspace');top=current;
                if(!bar.querySelector('.opt-group.visible'))throw Error('Missing tool options or hint for '+id);
            }
            return ids.length;
        });
    }
    assert.deepEqual(win.__testErrors,[]);console.log(JSON.stringify({passed:true,cases}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
