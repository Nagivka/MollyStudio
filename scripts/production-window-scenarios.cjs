const path=require('node:path');
const fs=require('node:fs/promises');
const {app,root,ready,makeWindow,evaluateMain}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[];try{
    await ready();win=makeWindow();await win.loadFile(path.join(root,'src/renderer/index.html'));
    await evaluateMain(()=>{const r=globalThis.__mollyTestRuntime;r.windows.testMode=false;r.windows.showOnReady=true;r.windows.get('main').showInactive();});
    await win.page.click('#btn-hero-create');
    for(let round=0;round<3;round++){
        const state=await evaluateMain(async()=>{const r=globalThis.__mollyTestRuntime;for(let i=0;i<100;i++){const w=r.windows.get('new-project');if(w?.isVisible()&&!w.webContents.isLoadingMainFrame())return {visible:true,loading:false,modal:w.isModal(),dom:await Promise.race([w.webContents.executeJavaScript("({ready:document.readyState,types:[...document.querySelectorAll('#new-proj-type-selector [data-type]')].map(b=>b.dataset.type).sort().join(',')})"),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),5000))])};await new Promise(resolve=>setTimeout(resolve,100));}const w=r.windows.get('new-project');return {visible:w?.isVisible(),modal:w?.isModal(),loading:w?.webContents.isLoadingMainFrame(),url:w?.webContents.getURL()};});
        console.log(JSON.stringify({round,...state}));if(!state.visible||state.loading||state.dom?.types!=='canvas,gui,prefix')throw Error('Production modal did not finish loading');
        checks.push({round,...state});
        await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.get('new-project')?.destroy());
        if(round===0)await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'gui',size:'54',name:'Production modal'}});
        if(round<2)await evaluateMain(()=>globalThis.__mollyTestRuntime.windows.create('new-project'));
    }
    await fs.writeFile(path.join(root,'.test-output/production-window-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
