const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const timer=setTimeout(()=>app.exit(1),60000);try{
    await ready();win=makeWindow(1440,1000);await win.loadFile(path.join(root,'src/renderer/index.html'));await win.showInactive();
    const checks=await win.page.evaluate(async()=>{
        const {naturalLeaf,naturalSnow,naturalRain,creeperSnowflake,isCreeperSnowflake}=await import(new URL('js/ui/WeatherArtwork.js',location.href));
        const {WeatherSurface}=await import(new URL('js/ui/AmbientWeather.js',location.href));
        const {WeatherParticles}=await import(new URL('js/core/WeatherParticles.mjs',location.href));
        const {drawWeatherBitmap}=await import(new URL('js/core/WeatherBitmap.mjs',location.href));
        const checks=[],expect=(ok,s)=>{if(!ok)throw Error(s);checks.push(s);};
        const source=document.createElement('canvas');source.width=4;source.height=8;
        const pen=source.getContext('2d');pen.fillStyle='#ff0000';pen.fillRect(0,0,2,8);pen.fillStyle='#00ff00';pen.fillRect(2,0,2,8);
        for(const scale of [.5,1,1.25,2])for(const rotation of [0,Math.PI/2]){
            const target=document.createElement('canvas');target.width=target.height=128;
            const ctx=target.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);
            drawWeatherBitmap(ctx,source,40.3,40.7,24,{scale,rotation});
            const data=ctx.getImageData(0,0,128,128).data;
            let pixels=0;for(let i=0;i<data.length;i+=4){
                if(!data[i+3])continue;pixels++;
                if(data[i+3]!==255||data[i+2]!==0||!((data[i]===255&&data[i+1]===0)||(data[i]===0&&data[i+1]===255)))throw Error('Blurred bitmap edge or interpolated color');
            }
            const unit=Math.max(1,Math.round(24*scale/8));
            expect(pixels===32*unit*unit,'Bitmap preserves pixels and proportions at scale '+scale+' rotation '+rotation);
        }
        expect(naturalLeaf(1,2)===naturalLeaf(1,2),'Leaf artwork is cached');
        expect(naturalLeaf(1,2,'summer')===naturalLeaf(1,2,'summer'),'Summer artwork is cached separately');
        expect(naturalLeaf(1,2,'summer').toDataURL()!==naturalLeaf(1,2).toDataURL(),'Summer leaf palette differs from autumn');
        const images=[];
        for(let v=0;v<6;v++)images.push(`snow/freezing_${v}.png`);
        for(const color of ['orange','red','yellow'])for(let v=1;v<=4;v++)images.push(`leaves/Fall/${color}_poplar_${v}.png`);
        await Promise.all(images.map(file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('Missing weather texture: '+file));image.src=new URL('assets/weather/'+file,location.href).href;})));
        expect(true,'All 18 uploaded weather textures load');
        expect(naturalLeaf(1,2,'spring').toDataURL()!==naturalLeaf(1,2).toDataURL(),'Pink leaves retain autumn shapes with a separate palette');
        for(const season of ['autumn','spring','summer','all'])for(const effect of ['snow','leaves']){
            const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
            const ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx),sources=[];
            ctx.drawImage=(image,...args)=>{sources.push(image);draw(image,...args);};
            const field=new WeatherParticles(effect,'dense',128,128,()=>.5);
            WeatherSurface.prototype.paintField.call({ctx,pixelated:false,opacity:1,particleScale:2,light:false,settings:{weatherLeaves:season}},field,1);
            expect(sources.length>0&&sources.every(image=>image instanceof HTMLCanvasElement&&image.width===96&&image.height===96),'Standard '+effect+' uses only natural artwork: '+season);
        }
        expect(naturalSnow(1,false)===naturalSnow(1,false),'Snow artwork is cached');
        const rare={variant:63,color:3,phase:0};
        expect(isCreeperSnowflake(rare)&&!isCreeperSnowflake({...rare,variant:62})&&!isCreeperSnowflake({...rare,color:2})&&!isCreeperSnowflake({...rare,phase:Math.PI}),'Rare snowflake requires all three independent conditions');
        expect(creeperSnowflake()===creeperSnowflake(),'Secret snow artwork is cached');
        const secret=creeperSnowflake().getContext('2d');
        expect(secret.getImageData(5,6,1,1).data[3]===0&&secret.getImageData(4,4,1,1).data[3]===255,'Secret snow has a transparent creeper face cut into the ice');
        for(const pixelated of [false,true]){
            const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
            const ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx),sources=[];
            ctx.drawImage=(image,...args)=>{sources.push(image);draw(image,...args);};
            const field=new WeatherParticles('snow','light',128,128,()=>.5);
            field.particles=[{...field.particles[0],...rare,x:64,y:64}];
            WeatherSurface.prototype.paintField.call({ctx,pixelated,opacity:1,particleScale:2,scale:1,light:false},field,1);
            expect(sources.includes(creeperSnowflake())===pixelated,'Secret snow is drawn only in Minecraft themes: '+pixelated);
        }
        for(const light of [false,true]){
            const variants=new Set();
            for(let v=0;v<6;v++){
                const sprite=naturalSnow(v,light),ctx=sprite.getContext('2d');variants.add(sprite.toDataURL());
                const alpha=(x,y)=>ctx.getImageData(x,y,1,1).data[3];
                expect(alpha(48,48)>0&&alpha(v%2?82:77,v%2?48:65)===0,'Snow crystal has a visible centre and open space between its rays: '+v+' / '+light);
            }
            expect(variants.size===6,'Six distinct snow crystal shapes: '+light);
        }
        expect(naturalRain(true)===naturalRain(true),'Rain artwork is cached');
        for(const sprite of [naturalLeaf(0,0),naturalSnow(0,false),naturalSnow(0,true),naturalRain(true)]){
            const pixels=sprite.getContext('2d').getImageData(0,0,sprite.width,sprite.height).data;
            let visible=0,transparent=0,soft=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i])visible++;else transparent++;if(pixels[i]>0&&pixels[i]<240)soft++;}
            expect(visible>0&&transparent>0,'Sprite has silhouette and transparent surroundings');
            expect(soft>0,'Sprite has natural soft detail');
        }
        const hashes=new Set();for(let v=0;v<8;v++){const c=naturalLeaf(v,0);hashes.add(String(c.getContext('2d').getImageData(0,0,96,96).data));}
        expect(hashes.size===8,'Eight distinct leaf silhouettes / pigment variants');
        const panel=document.createElement('div');panel.style.cssText='position:fixed;inset:0;z-index:999999;background:#25272b;padding:24px;overflow:auto;color:white;display:grid;grid-template-columns:1fr 1fr;gap:20px';
        for(const light of [false,true])for(const effect of ['leaves','snow','rain']){
            const box=document.createElement('section');box.style.cssText=`background:${light?'#e8e5df':'#1b222a'};color:${light?'#303030':'#ffffff'};padding:16px;`;
            const label=document.createElement('h2');label.textContent=effect+(light?' · light':' · dark');label.style.font='18px sans-serif';box.append(label);
            const canvas=document.createElement('canvas');canvas.width=620;canvas.height=220;canvas.style.width='100%';box.append(canvas);panel.append(box);
            let seed=42;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
            const field=new WeatherParticles(effect,'dense',620,220,random);
            WeatherSurface.prototype.paintField.call({ctx:canvas.getContext('2d'),pixelated:false,opacity:1,particleScale:2,light},field,1);
            expect(canvas.getContext('2d').getImageData(0,0,620,220).data.some((n,i)=>i%4===3&&n>0),effect+' renders in '+(light?'light':'dark'));
        }
        document.body.append(panel);return checks;
    });
    await settle(win);const out=path.join(root,'.test-output/weather-artwork');await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'effects.png'),(await win.webContents.capturePage()).toPNG());
    const iconCount=await win.page.evaluate(async()=>{
        const {pixelDrawings,pixelAliases}=await import(new URL('js/ui/PixelIconData.mjs',location.href));
        document.body.innerHTML='';document.body.style.cssText='margin:0;padding:20px;background:#313233;color:white;font:12px sans-serif;display:grid;grid-template-columns:repeat(10,1fr);gap:12px;';
        for(const [name,drawing] of Object.entries(pixelDrawings)){
            const card=document.createElement('div');card.style.cssText='height:72px;text-align:center;';
            card.innerHTML=`<svg width="48" height="48" viewBox="0 0 24 24" shape-rendering="crispEdges" style="display:block;margin:auto"><g fill="white">${drawing}</g></svg><span>${name}</span>`;card.title=Object.keys(pixelAliases).filter(k=>pixelAliases[k]===name).join(', ');document.body.append(card);
        }
        return Object.keys(pixelDrawings).length;
    });
    win.setContentSize(1440,1400);await settle(win);await fs.writeFile(path.join(out,'icons.png'),(await win.webContents.capturePage()).toPNG());
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:checks.length,checks,iconCount},null,2));console.log(JSON.stringify({passed:checks.length,iconCount}));
}catch(e){console.error(e);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
