const fs=require('node:fs/promises'),path=require('node:path'),{PNG}=require('pngjs');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{
    let win;const checks=[],timer=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow(1100,760);await win.loadFile(path.join(root,'src/renderer/index.html'));await win.showInactive();
        await win.page.evaluate(()=>{
            const fixture=document.createElement('div');fixture.id='range-fixture';fixture.style.cssText='position:fixed;left:80px;top:140px;padding:28px;width:500px;background:#48494b;z-index:10000;';
            for(const [id,width,min,max] of [['five',343,0,5],['seven',421,1,8]]){
                const row=document.createElement('div');row.style.cssText='height:70px;display:flex;align-items:center;';
                const input=document.createElement('input');input.type='range';input.id=id;input.min=min;input.max=max;input.step=1;input.value=min;input.style.cssText=`width:${width}px;margin:0;`;row.append(input);fixture.append(row);
            }
            document.body.append(fixture);
        });
        for(const theme of ['minecraft','light-minecraft'])for(const density of ['editor','settings'])for(const zoom of [1,1.25]){
            win.webContents.setZoomFactor(zoom);await win.page.evaluate(({theme,density})=>{
                document.documentElement.dataset.theme=theme;
                document.querySelector('#range-fixture').className=density==='settings'?'settings-win-shell':'';
            },{theme,density});await settle(win);
            for(const id of ['five','seven'])for(const end of ['min','max']){
                const geometry=await win.page.locator('#'+id).evaluate((input,end)=>{
                    input.value=input[end];input.dispatchEvent(new Event('input',{bubbles:true}));
                    const rect=input.getBoundingClientRect(),style=getComputedStyle(input),probe=document.createElement('span');probe.style.color='var(--mc-edge)';input.after(probe);const edge=getComputedStyle(probe).color.match(/\d+/g).slice(0,3).map(Number);probe.remove();
                    return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},border:parseFloat(style.borderLeftWidth),thumb:parseFloat(style.getPropertyValue('--mc-range-thumb-size')),edge,min:Number(input.min),max:Number(input.max),value:Number(input.value)};
                },end);
                await new Promise(resolve=>setTimeout(resolve,35));
                const image=PNG.sync.read(await win.page.screenshot({clip:geometry.rect})),scale=image.width/geometry.rect.width,y=Math.floor(image.height/2),count=geometry.max-geometry.min;
                const positions=Array.from({length:count-1},(_,index)=>(geometry.border+geometry.thumb/2+(geometry.rect.width-geometry.border*2-geometry.thumb)*(index+1)/count)*scale);
                const dark=x=>{if(x<0||x>=image.width)return false;const i=(y*image.width+x)*4;return geometry.edge.every((color,index)=>Math.abs(image.data[i+index]-color)<=4);};
                for(const point of positions)if(!Array.from({length:5},(_,index)=>Math.round(point)+index-2).some(dark))throw Error(`Tick missing or misplaced: ${theme}, ${zoom}, ${id}, ${end}, x=${point}`);
                const thumb=geometry.value===geometry.min?(geometry.border+geometry.thumb/2)*scale:(geometry.rect.width-geometry.border-geometry.thumb/2)*scale;
                for(let x=Math.ceil(geometry.border*scale)+1;x<image.width-geometry.border*scale-1;x++){
                    if(Math.abs(x-thumb)<=(geometry.thumb/2+2)*scale||!dark(x))continue;
                    if(!positions.some(point=>Math.abs(x-point)<=2.5*scale))throw Error(`Stray tick: ${theme}, ${zoom}, ${id}, ${end}, x=${x}`);
                }
                checks.push(`${theme}/${density} at ${zoom*100}%: ${id} ticks align with exact values at ${end}`);
            }
            await fs.writeFile(path.join(root,`.test-output/ranges-${theme}-${density}-${zoom}.png`),(await win.webContents.capturePage()).toPNG());
        }
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/minecraft-range-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
