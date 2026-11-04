const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let main,create;const checks=[];try{
    await ready();main=makeWindow();await main.loadFile(path.join(root,'src/renderer/index.html'));await settle(main);
    const types=()=>[...document.querySelectorAll('#new-proj-type-selector [data-type]')].map(b=>b.dataset.type).sort().join(',');
    if(await main.page.evaluate(types)!=='canvas,gui,prefix,title')throw Error('Launcher offers unsupported project types');checks.push('Launcher offers GUI, canvas, prefixes and 3D titles');
    await main.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Preserved project'}});
    const result=await main.page.evaluate(async()=>{
        const app=window.mollyEditor;const before=JSON.stringify(app.projectManager.serializeProject()),id=app.activeProjectId;
        try{await app.projectManager.deserializeProject({mollyVersion:2,type:'skin',name:'old',config:{width:64,height:64},layers:[]});throw Error('Unsupported document was accepted');}
        catch(error){if(!error.message.includes('больше не поддерживается'))throw error;}
        const {normalizeProjectData}=await import(new URL('js/core/ProjectFactory.mjs',location.href));
        try{normalizeProjectData({type:'skin'});throw Error('Unsupported creation was accepted');}catch(error){if(!error.message.includes('больше не поддерживается'))throw error;}
        if(id!==app.activeProjectId||before!==JSON.stringify(app.projectManager.serializeProject()))throw Error('Unsupported file modified the open document');
        if(document.querySelector('#skin-inspector,#skin-viewport,[data-type=skin]'))throw Error('Removed editor UI is still present');
        return [...document.querySelectorAll('#new-proj-type-selector [data-type]')].map(b=>b.dataset.type).sort().join(',');
    });
    if(result!=='canvas,gui,prefix,title')throw Error('Editor creation dialog offers unsupported types');checks.push('Editor creation dialog offers the same four project types');checks.push('Unsupported documents and creation requests leave the active project unchanged');
    await main.page.evaluate(async()=>{
        const app=window.mollyEditor;
        app.addProject('Prefix before empty canvas',null,32,16,false,'prefix');
        await app.getActiveProject().prefixLoadPromise;
        app.layerPanel.render();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(!document.querySelector('#layer-list .layer-item'))throw Error('Prefix layer fixture did not render');
        app.addProject('Empty canvas',null,32,32,false,'canvas','transparent');
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(app.layerManager.layers.length||document.querySelector('#layer-list .layer-item'))throw Error('Empty canvas retained the previous project layer panel');
    });checks.push('Creating an empty canvas clears the previous project layer panel');
    create=makeWindow(800,650,{label:'new-project'});await create.loadFile(path.join(root,'src/renderer/new-project.html'));await settle(create);
    if(await create.page.evaluate(types)!=='canvas,gui,prefix,title')throw Error('Native creation window offers unsupported types');checks.push('The separate creation window offers the same four project types');
    for(const window of [main,create])if(window.__testErrors.length)throw Error(window.__testErrors.join('\n'));
    await fs.writeFile(path.join(root,'.test-output/project-types-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{main?.destroy();create?.destroy();app.exit(process.exitCode||0);}})();
