const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{
    let win;const timer=setTimeout(()=>app.exit(1),60000),checks=[];
    try{
        await ready();win=makeWindow(1280,900);
        await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Effects'}});await win.showInactive();await settle(win);
        await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
        checks.push(...await win.page.evaluate(async()=>{
            const e=mollyEditor,checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},wait=ms=>new Promise(r=>setTimeout(r,ms));
            e.settingsManager.set('animationsEnabled',true);
            const button=document.createElement('button');button.style.cssText='position:fixed;left:400px;top:300px;width:100px;height:50px;z-index:500';button.textContent='Test';document.body.append(button);
            const click=()=>button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:450,clientY:325}));
            for(const theme of ['dark','light','minecraft','light-minecraft']){
                e.settingsManager.set('theme',theme);click();
                const response=document.querySelector('.ui-click-response');expect(response&&response.classList.contains('pixel')===theme.includes('minecraft'),theme+': click response matches the theme');
                await wait(600);expect(!document.querySelector('.ui-click-response'),theme+': response removes itself');
            }
            const card=document.createElement('article');card.className='m3-recent-card';card.style.cssText='position:fixed;left:400px;top:400px;width:200px;height:150px;z-index:500';document.body.append(card);
            for(const theme of ['dark','minecraft']){
                e.settingsManager.set('theme',theme);card.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:560,clientY:430}));
                expect(theme==='minecraft'?card.style.transform==='translateY(-2px)':card.style.transform.includes('rotateX'),theme+': live card uses crisp theme-appropriate movement');
                card.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));expect(!card.style.transform,'Card resets on pointer exit');
            }
            expect(document.querySelector('.doc-tab.active').getAnimations().some(a=>a.animationName==='ui-accent-breathe'),'Active accents have a running color animation');
            e.settingsManager.set('theme','dark');
            e.settingsManager.set('animatedAccentsEnabled',false);
            const tab=document.querySelector('.doc-tab.active');tab.classList.remove('active');void tab.offsetWidth;tab.classList.add('active');
            expect(tab.getAnimations().some(a=>a.animationName==='ui-tab-select')&&!tab.getAnimations().some(a=>a.animationName==='ui-accent-breathe'),'Turning accents off preserves tab-selection animation');
            e.settingsManager.set('animatedAccentsEnabled',true);
            const {animateUI}=await import(new URL('js/ui/Motion.mjs',location.href));
            const scripted=animateUI(button,[{opacity:.3},{opacity:1}],{duration:10000});
            e.settingsManager.set('animationsEnabled',false);await wait(30);
            expect(scripted.playState==='idle','Disabling motion cancels an already running scripted animation');
            e.settingsManager.set('animationsEnabled',true);
            // Ripple temporarily clips its own wave and must restore host layout afterwards.
            button.classList.add('md-btn');button.style.position='static';button.style.overflow='visible';click();await wait(750);
            expect(button.style.position==='static'&&button.style.overflow==='visible'&&!button.querySelector('.md-ripple-wave'),'Ripple cleanup restores the button original positioning and overflow');
            const {revealTheme}=await import(new URL('js/ui/VisualEffects.js',location.href));
            revealTheme(()=>e.settingsManager.set('theme','light'),button);await wait(170);
            expect(document.documentElement.dataset.theme==='light','Theme reveal applies the selected theme');
            expect(document.getAnimations().some(a=>a.effect?.pseudoElement==='::view-transition-new(root)'),'Theme switch renders a real radial reveal');await wait(550);
            const hiddenDescriptor=Object.getOwnPropertyDescriptor(document,'hidden');
            try{
                Object.defineProperty(document,'hidden',{configurable:true,value:true});
                revealTheme(()=>e.settingsManager.set('theme','dark'),button);
                expect(document.documentElement.dataset.theme==='dark','A hidden window commits a theme immediately without waiting for a snapshot');
            }finally{
                if(hiddenDescriptor)Object.defineProperty(document,'hidden',hiddenDescriptor);else delete document.hidden;
            }
            revealTheme(()=>e.settingsManager.set('theme','minecraft'),button);
            document.documentElement.classList.add('no-theme-transition');
            try{
                revealTheme(()=>e.settingsManager.set('theme','light'),button);
                expect(document.documentElement.dataset.theme==='light','A non-animated theme request applies immediately during a pending reveal');
                await wait(250);
                expect(document.documentElement.dataset.theme==='light','An older reveal cannot overwrite the latest theme request');
            }finally{document.documentElement.classList.remove('no-theme-transition');}
            expect(await e.projectManager.saveProjectAs(),'Project saves successfully before confirmation');
            expect(document.querySelector('[data-saved-feedback="true"] .doc-tab-icon')?.textContent==='check','A successful file write shows the animated check beside the project name');await wait(1700);
            expect(!document.querySelector('[data-saved-feedback]'),'Save feedback restores the normal project icon');
            e.settingsManager.set('animationsEnabled',false);click();expect(!document.querySelector('.ui-click-response'),'Disabled animations suppress click effects');
            expect(!document.querySelector('.doc-tab.active').getAnimations().some(a=>a.animationName==='ui-accent-breathe'),'Disabled animations stop animated accents');
            revealTheme(()=>e.settingsManager.set('theme','dark'),button);expect(document.documentElement.dataset.theme==='dark','Disabled animations switch the theme immediately');
            card.remove();button.remove();return checks;
        }));
        await win.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        const reduced=await win.page.evaluate(async()=>{
            mollyEditor.settingsManager.set('animationsEnabled',true);
            const button=document.querySelector('#btn-export');button?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:100,clientY:50}));
            const {revealTheme}=await import(new URL('js/ui/VisualEffects.js',location.href));revealTheme(()=>mollyEditor.settingsManager.set('theme','light'),button);
            return !document.querySelector('.ui-click-response')&&document.documentElement.dataset.theme==='light'&&!document.querySelector('.doc-tab.active').getAnimations().some(a=>a.animationName==='ui-accent-breathe');
        });
        if(!reduced)throw Error('System reduced motion did not stop visual effects');checks.push('System reduced motion suppresses click, accent and theme animations');
        if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
        await fs.writeFile(path.join(root,'.test-output/visual-effects-report.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}
})();
