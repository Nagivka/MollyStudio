const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{
    let win;const checks=[],timer=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow(1000,760);await win.loadFile(path.join(root,'src/renderer/index.html'));await win.showInactive();
        await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
        await win.page.evaluate(async()=>{
            document.querySelector('.workspace-layout').style.visibility='hidden';
            const fixture=document.createElement('div');fixture.id='occlusion-fixture';fixture.style.cssText='position:fixed;inset:70px 40px 30px;background:var(--md-surface-container-low);z-index:2;';
            fixture.innerHTML='<button id="protected-pill" style="position:absolute;left:80px;top:120px;width:160px;height:64px;border-radius:9999px;">Protected button</button><div id="clipped-region" style="position:absolute;left:300px;top:80px;width:130px;height:100px;overflow:hidden;"><button id="clipped-button" style="position:absolute;left:0;top:60px;width:120px;height:64px;">Clipped button</button></div>';
            document.body.append(fixture);
            const canvas=document.createElement('canvas');canvas.className='ambient-weather';document.body.append(canvas);
            const {WeatherSurface}=await import(new URL('js/ui/AmbientWeather.js',location.href));window.occlusionSurface=new WeatherSurface(canvas);
            occlusionSurface.configure({weatherEffect:'leaves',weatherScope:'all',weatherSize:100,weatherOpacity:100,animationsEnabled:true});
        });await settle(win);
        for(const theme of ['dark','light','minecraft','light-minecraft']){
            await win.page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await settle(win);
            checks.push(...await win.page.evaluate(async theme=>{
                const checks=[],expect=(ok,label)=>{if(!ok)throw Error(theme+': '+label);checks.push(theme+': '+label);},surface=occlusionSurface,pill=document.querySelector('#protected-pill');
                surface.stop();surface.obstacles.invalidate();surface.obstacles.update();
                const rect=pill.getBoundingClientRect(),scene=surface.obstacles;
                const fillAndMask=()=>{
                    surface.ctx.save();surface.ctx.setTransform(1,0,0,1,0,0);surface.ctx.globalAlpha=1;surface.ctx.fillStyle='#FF00FF';surface.ctx.fillRect(0,0,surface.canvas.width,surface.canvas.height);surface.ctx.restore();
                    scene.apply(surface.ctx,{width:surface.canvas.width,height:surface.canvas.height,scale:surface.scale,origin:surface.canvasRect});
                };
                const alphaAt=(x,y)=>surface.ctx.getImageData(Math.floor((x-surface.canvasRect.left)*surface.scale),Math.floor((y-surface.canvasRect.top)*surface.scale),1,1).data[3];
                fillAndMask();
                expect(scene.visibility(rect.left+80,rect.top+32)===0&&alphaAt(rect.left+80,rect.top+32)===0,'particles are fully hidden inside a button');
                expect(theme.includes('minecraft')?alphaAt(rect.left+2,rect.top+2)===0:alphaAt(rect.left+2,rect.top+2)===255,'opacity follows square or rounded corners');
                expect(alphaAt(rect.right+2,rect.top+32)===255&&scene.visibility(rect.right+.01,rect.top+32)===1,'outside the actual boundary there is no approach zone');
                const clipped=document.querySelector('#clipped-button'),crop=clipped.getBoundingClientRect();
                expect(alphaAt(crop.left+20,crop.top+10)===0,'particles are fully hidden over the visible part of a clipped button');
                expect(alphaAt(crop.left+20,crop.bottom-2)===255,'hidden clipped controls do not alter nearby weather');
                const duplicate=pill.cloneNode(true);duplicate.removeAttribute('id');pill.after(duplicate);scene.invalidate();scene.update();fillAndMask();
                expect(alphaAt(rect.left+80,rect.top+32)===0,'overlapping controls keep particles fully hidden');duplicate.remove();scene.invalidate();scene.update();
                const original=surface.field.particles;
                const particle={...original[0],depth:.5,size:18,color:0,variant:0,rotation:0,phase:Math.PI/2};
                surface.blend=1;surface.previousField=null;surface.field.time=0;
                const x=Math.round(rect.right-3),y=Math.round(rect.top+rect.height/2),scale=surface.scale;
                surface.field.particles=[{...particle,x,y}];surface.paint();
                const sx=Math.round((x-30)*scale),sy=Math.round((y-30)*scale),size=Math.round(60*scale);
                const masked=surface.ctx.getImageData(sx,sy,size,size).data;
                surface.ctx.clearRect(0,0,surface.canvas.width/scale,surface.canvas.height/scale);surface.paintField(surface.field,1);
                const reference=surface.ctx.getImageData(sx,sy,size,size).data;
                const {roundedRectDistance}=await import(new URL('js/core/WeatherOcclusion.mjs',location.href));
                const shape=scene.index.shapes.find(shape=>Math.abs(shape.left-rect.left)<.01&&Math.abs(shape.right-rect.right)<.01);
                let inside=0,outside=0,valid=true;
                for(let row=0;row<size;row++)for(let col=0;col<size;col++){
                    const index=(row*size+col)*4+3;if(reference[index]<8)continue;
                    const distance=roundedRectDistance((sx+col+.5)/scale,(sy+row+.5)/scale,shape);if(Math.abs(distance)<2/scale)continue;
                    if(distance<0)inside++;else outside++;
                    if(Math.abs(masked[index]-reference[index]*(distance<0?0:1))>1.5)valid=false;
                }
                expect(valid&&inside>4&&outside>4,'a real sprite keeps full opacity outside and hides only its overlapping pixels');
                expect(masked.some((value,index)=>index%4===3&&value),'the part of a particle outside an element remains visible');
                surface.field.particles=original;
                return checks;
            },theme));
        }
        checks.push(...await win.page.evaluate(async()=>{
            const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},surface=occlusionSurface,pill=document.querySelector('#protected-pill');
            const animation=pill.animate([{transform:'translateX(0)'},{transform:'translateX(100px)'}],{duration:800,fill:'forwards'});
            surface.obstacles.update();await new Promise(resolve=>setTimeout(resolve,180));surface.obstacles.update();
            let rect=pill.getBoundingClientRect();expect(surface.obstacles.visibility(rect.left+80,rect.top+32)===0,'The opacity region follows a running Web Animation');
            animation.finish();surface.obstacles.update();rect=pill.getBoundingClientRect();expect(surface.obstacles.visibility(rect.left+80,rect.top+32)===0,'The opacity region reaches the final geometry after an animation finishes');animation.cancel();
            const scroller=document.querySelector('#clipped-region');scroller.scrollTop=40;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));surface.obstacles.update();
            rect=document.querySelector('#clipped-button').getBoundingClientRect();expect(surface.obstacles.visibility(rect.left+20,rect.bottom-4)===0,'Scrolling rebuilds the visible control boundaries');
            const box=surface.obstacles.index.shapes[0];surface.obstacles.update();expect(surface.obstacles.index.shapes[0]===box,'Static geometry is cached between particle frames');
            return checks;
        }));
        await fs.writeFile(path.join(root,'.test-output/weather/occlusion-report.json'),JSON.stringify({passed:checks.length,checks},null,2));
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
