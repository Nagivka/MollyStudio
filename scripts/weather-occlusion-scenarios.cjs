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
            for(const button of fixture.querySelectorAll('button'))button.style.backgroundColor='var(--md-surface-container)';
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
                const flat=document.createElement('button');flat.textContent='Transparent target';
                flat.style.cssText='position:fixed;left:500px;top:500px;width:240px;height:80px;background:none;border:0;padding:24px;';
                document.querySelector('#occlusion-fixture').append(flat);
                scene.invalidate();scene.update();fillAndMask();
                const flatRect=flat.getBoundingClientRect();
                expect(alphaAt(flatRect.left+3,flatRect.top+3)===255,'transparent button padding does not erase weather');
                const textRange=document.createRange();textRange.selectNodeContents(flat.firstChild);const textRect=textRange.getClientRects()[0];
                expect(scene.visibility(textRect.left+textRect.width/2,textRect.top+textRect.height/2)===0,'transparent button text remains protected');
                flat.remove();
                const overlay=document.createElement('div');overlay.className='modal-overlay show';
                overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);opacity:1;animation:none;transition:none;';
                const modal=document.createElement('div');modal.className='modal';modal.style.cssText='width:180px;height:100px;background:#222;opacity:1;animation:none;transition:none;transform:none;';overlay.append(modal);document.body.append(overlay);
                scene.invalidate();scene.update();fillAndMask();
                const modalRect=modal.getBoundingClientRect();
                expect(scene.visibility(modalRect.left+modalRect.width/2,modalRect.top+modalRect.height/2)===0,'the actual modal window remains protected');
                expect(alphaAt(5,600)===255,'a modal backdrop does not erase weather across the viewport');
                overlay.remove();scene.invalidate();scene.update();
                const label=document.createElement('div');label.setAttribute('aria-hidden','true');
                label.style.cssText='position:fixed;left:500px;top:580px;width:300px;white-space:pre;line-height:60px;font-size:16px;';
                label.textContent='AAAA     BBBB\nCCCC';document.querySelector('#occlusion-fixture').append(label);
                scene.invalidate();scene.update();fillAndMask();
                const wordRange=document.createRange();wordRange.setStart(label.firstChild,0);wordRange.setEnd(label.firstChild,4);
                const wordRect=wordRange.getBoundingClientRect();
                expect(scene.visibility(wordRect.left+wordRect.width/2,wordRect.top+wordRect.height/2)===0,'visible aria-hidden text is protected from particles');
                wordRange.setStart(label.firstChild,4);wordRange.setEnd(label.firstChild,9);const spaceRect=wordRange.getBoundingClientRect();
                expect(scene.visibility(spaceRect.left+spaceRect.width/2,spaceRect.top+spaceRect.height/2)===0,'spaces inside a text line remain clear for readability');
                expect(scene.visibility(label.getBoundingClientRect().left+2,label.getBoundingClientRect().top+2)===1,'extra line height does not hide weather above the glyphs');
                wordRange.setStart(label.firstChild,14);wordRange.setEnd(label.firstChild,18);const secondLine=wordRange.getBoundingClientRect();
                expect(scene.visibility(secondLine.left+secondLine.width/2,secondLine.top+secondLine.height/2)===0,'each visible text line is protected separately');
                label.style.opacity='0';scene.invalidate();scene.update();
                const reveal=label.animate([{opacity:0},{opacity:1}],{duration:400,fill:'forwards'});
                scene.update();reveal.finish();scene.update();
                expect(scene.visibility(secondLine.left+secondLine.width/2,secondLine.top+secondLine.height/2)===0,'text protection is rebuilt after an opacity-only reveal');
                reveal.cancel();label.remove();scene.invalidate();scene.update();
                const indicators=document.createElement('div');indicators.style.cssText='position:fixed;left:500px;top:580px;display:flex;gap:12px;';
                for(const tag of ['progress','meter','canvas']){
                    const indicator=document.createElement(tag);indicator.style.cssText='display:block;width:80px;height:20px;';
                    if(tag!=='canvas'){indicator.max=100;indicator.value=50;}else indicator.getContext('2d').fillRect(0,0,80,20);
                    indicators.append(indicator);
                }
                document.querySelector('#occlusion-fixture').append(indicators);scene.invalidate();scene.update();fillAndMask();
                for(const indicator of indicators.children){const r=indicator.getBoundingClientRect();expect(alphaAt(r.left+r.width/2,r.top+r.height/2)===0,indicator.tagName+' remains protected even with a transparent CSS background');}
                indicators.remove();scene.invalidate();scene.update();
                const card=document.createElement('section');card.className='md-panel';
                card.style.cssText='position:fixed;left:500px;top:580px;width:240px;height:100px;border-radius:12px;background:#222;';
                document.querySelector('#occlusion-fixture').append(card);scene.invalidate();scene.update();fillAndMask();
                const cr=card.getBoundingClientRect();
                expect(alphaAt(cr.left+30,cr.top+30)===0&&alphaAt(cr.right-30,cr.bottom-30)===0,'empty space inside a panel is fully protected, not just its text and buttons');
                expect(alphaAt(cr.right+2,cr.top+30)===255,'panel protection stops at its actual outer boundary');
                card.remove();scene.invalidate();scene.update();
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
