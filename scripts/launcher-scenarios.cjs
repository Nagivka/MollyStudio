const fs=require('node:fs/promises');
const path=require('node:path');
const {app,root,profile,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

async function exercise(files){
    const checks=[],expect=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
    const context=canvas.getContext('2d');context.fillStyle='#3b82f6';context.fillRect(3,3,26,26);context.fillStyle='#b9e9ff';context.fillRect(10,9,12,14);
    const project={mollyVersion:2,type:'canvas',name:'Алмаз',config:{width:32,height:32},layers:[{id:'fixture',name:'Алмаз',width:32,height:32,visible:true,opacity:1,dataUrl:canvas.toDataURL()}]};
    const menu={mollyVersion:2,type:'deluxemenu',menuPlugin:'zmenu',name:'Магазин',config:{width:256,height:256},layers:[],deluxeData:{name:'&8Магазин',size:27,items:{diamond:{slot:13,item:{material:'DIAMOND',name:'&bАлмаз'}}}}};
    await window.electronAPI.writeFile(files[0],JSON.stringify(project));
    await window.electronAPI.writeFile(files[1],JSON.stringify(menu));
    await window.electronAPI.writeFile(files[2],JSON.stringify({...project,name:'Ферма'}));
    localStorage.setItem('molly_recent',JSON.stringify(files.map((file,index)=>({path:file,name:['Алмаз','Магазин','Ферма'][index],type:index===1?'deluxemenu':'canvas',modifiedAt:300-index,updatedAt:'Сегодня',previewRevision:'fixture-'+index}))));
    window.dispatchEvent(new StorageEvent('storage',{key:'molly_recent'}));
    const wait=async predicate=>{const start=performance.now();while(!predicate()){if(performance.now()-start>10000)throw new Error('Launcher did not finish rendering');await new Promise(resolve=>setTimeout(resolve,30));}};
    await wait(()=>document.querySelectorAll('.m3-recent-card[data-preview="ready"]').length===3);
    expect(document.querySelectorAll('.launcher-project-image').length===3,'Recent cards render actual saved canvas and zMenu contents');
    expect(!document.querySelector('.mock-window'),'The launcher contains no demonstration project artwork');
    const search=document.getElementById('recent-search');
    search.value='магаз';search.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>document.querySelectorAll('.m3-recent-card').length===1);
    expect(document.querySelector('.m3-recent-name').textContent==='Магазин','Project search matches Russian names');
    search.value='не существует';search.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>Boolean(document.querySelector('.m3-empty-recent')));
    expect(document.querySelector('.m3-empty-recent').textContent.includes('не найдены'),'An unmatched search displays an honest empty state');
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>document.querySelectorAll('.m3-recent-card').length===3);
    const sort=document.getElementById('recent-sort');sort.value='name';sort.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>document.querySelectorAll('.m3-recent-name')[0]?.textContent==='Алмаз');
    expect([...document.querySelectorAll('.m3-recent-name')].map(element=>element.textContent).join(',')==='Алмаз,Магазин,Ферма','Name sorting orders the actual project cards');
    document.querySelector('.m3-recent-card .delete-proj').click();
    await wait(()=>document.querySelectorAll('.m3-recent-card').length===2);
    expect(JSON.parse(await window.electronAPI.readFile(files[0])).name==='Алмаз','Removing a recent entry leaves the project file intact');
    localStorage.setItem('molly_recent',JSON.stringify(files.map((file,index)=>({path:file,name:['Алмаз','Магазин','Ферма'][index],type:index===1?'deluxemenu':'canvas',modifiedAt:300-index,updatedAt:'Сегодня',previewRevision:'fixture-'+index}))));window.dispatchEvent(new StorageEvent('storage',{key:'molly_recent'}));
    await wait(()=>document.querySelectorAll('.m3-recent-card[data-preview="ready"]').length===3);
    expect(document.getElementById('btn-hero-create')&&document.getElementById('btn-hero-open')&&document.getElementById('btn-open-settings'),'The approved menu exposes create, open and settings actions');
    return checks;
}

(async()=>{
    let win;const timer=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow();await win.loadFile(path.join(root,'www/index.html'));
        const files=['diamond.mlst','shop.mlst','farm.mlst'].map(file=>path.join(profile,file));
        const checks=await win.webContents.executeJavaScript(`(${exercise.toString()})(${JSON.stringify(files)})`);
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        for(const [name,width,height,theme]of[['launcher-home',1280,800,'dark'],['launcher-home-light',1280,800,'light'],['launcher-home-narrow',800,650,'dark']]){
            win.setContentSize(width,height);await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await settle(win);
            const fits=await win.webContents.executeJavaScript(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.launcher-home').scrollWidth<=innerWidth`);
            if(!fits)throw new Error('Launcher overflows '+name);
            await fs.writeFile(path.join(root,`.test-output/${name}.png`),(await win.webContents.capturePage()).toPNG());
        }
        checks.push('The live menu fits dark, light and narrow source windows');
        await win.webContents.executeJavaScript(`document.querySelector('[data-name="Магазин"] .m3-recent-open').click()`);
        await new Promise((resolve,reject)=>{const start=Date.now();const check=async()=>{try{const active=await win.webContents.executeJavaScript(`window.mollyEditor?.getActiveProject()?.menuPlugin==='zmenu'`);if(active)return resolve();}catch(_){}if(Date.now()-start>10000)return reject(new Error('Recent menu did not open'));setTimeout(check,40);};check();});
        checks.push('Opening a recent zMenu card restores the actual saved editor project');
        if(win.__testErrors.length)throw new Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/launcher-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
