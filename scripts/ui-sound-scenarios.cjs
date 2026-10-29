const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{
    const windows=[],checks=[];const timer=setTimeout(()=>app.exit(1),60000);
    try{
        await ready();const settings=makeWindow(960,760,{label:'settings'});windows.push(settings);
        await settings.loadFile(path.join(root,'src/renderer/settings.html'));await settings.showInactive();await settle(settings);
        await settings.page.click('#settings-tab-effects');
        await settings.page.mouse.click(900,70);
        checks.push(...await settings.page.evaluate(async()=>{
            const {UISoundPlayer,uiSounds}=await import(new URL('js/ui/UISounds.js',location.href));
            const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
            expect(!uiSounds.enabled&&!uiSounds.context,'Default is silent and allocates no audio context');
            const toggle=document.querySelector('#setting-ui-sounds'),volume=document.querySelector('#setting-ui-sound-volume'),preview=document.querySelector('[data-ui-sound-preview]');
            expect(toggle&&!toggle.checked&&volume.disabled&&preview.disabled,'Optional sound controls start disabled');
            toggle.click();expect(uiSounds.enabled&&!volume.disabled&&!preview.disabled,'Switch enables sound controls');
            volume.value='50';volume.dispatchEvent(new Event('input',{bubbles:true}));preview.click();
            if(uiSounds.context)await Promise.race([uiSounds.context.resume(),new Promise(resolve=>setTimeout(resolve,100))]);
            await new Promise(resolve=>setTimeout(resolve,50));
            expect(uiSounds.volume===50&&uiSounds.context&&uiSounds.voices.size<=8,'Volume and preview control a bounded audio graph');
            const render=async(kind,volume,profile='soft')=>{
                const player=new UISoundPlayer(),audio=new OfflineAudioContext(1,14400,48000);
                player.context=audio;player.master=audio.createGain();player.master.connect(audio.destination);player.configure({uiSoundsEnabled:true,uiSoundVolume:volume,uiSoundProfile:profile});
                if(profile==='pixel')await player.loadSample(kind);
                player.play(kind);
                while(player.pendingSamples)await new Promise(resolve=>setTimeout(resolve,0));
                const buffer=await audio.startRendering();return Math.max(...buffer.getChannelData(0).map(Math.abs));
            };
            for(const kind of ['click','tab','save'])expect(await render(kind,100)>.001,kind+': synthesis produces non-silent PCM');
            const full=await render('save',100),half=await render('save',50);expect(Math.abs(half/full-.25)<.001,'Volume changes rendered waveform amplitude');
            for(const kind of ['click','tab','save'])expect(await render(kind,100,'pixel')>.001,kind+': bundled Minecraft OGG decodes and produces non-silent PCM');
            const sampleFull=await render('save',100,'pixel'),sampleHalf=await render('save',50,'pixel');
            expect(Math.abs(sampleHalf/sampleFull-.25)<.001,'Minecraft samples respect the shared volume control');
            const pending=new UISoundPlayer();pending.configure({uiSoundsEnabled:true,uiSoundVolume:100,uiSoundProfile:'pixel'});
            expect(!pending.samples.size&&!pending.context,'Choosing Minecraft sounds does not load audio or create a context');
            pending.context=new OfflineAudioContext(1,14400,48000);pending.master=pending.context.createGain();pending.master.connect(pending.context.destination);
            let finishLoading;pending.loadSample=()=>new Promise(resolve=>{finishLoading=resolve;});
            pending.play('click');pending.configure({uiSoundsEnabled:false,uiSoundVolume:100,uiSoundProfile:'pixel'});
            finishLoading(pending.context.createBuffer(1,4800,48000));await new Promise(resolve=>setTimeout(resolve,0));
            expect(!pending.voices.size&&!pending.pendingSamples,'Disabling sounds cancels a sample still being loaded');
            for(const theme of ['dark','minecraft','light-minecraft']){
                document.documentElement.dataset.theme=theme;
                pending.configure({uiSoundsEnabled:false,uiSoundVolume:100,uiSoundProfile:'auto'});
                expect(Boolean(pending.usesMinecraftSounds())===theme.includes('minecraft'),theme+': automatic profile selects the correct sound family');
            }
            document.documentElement.dataset.theme='dark';
            volume.value='0';volume.dispatchEvent(new Event('input',{bubbles:true}));expect(!uiSounds.play('save')&&!uiSounds.voices.size,'Zero volume stops active voices and remains silent');
            toggle.click();expect(!uiSounds.enabled&&!uiSounds.voices.size&&!uiSounds.play('save'),'Disabling stops cues including save notifications');
            return checks;
        }));
        const editor=makeWindow(1100,800);windows.push(editor);await editor.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Sounds'}});await settle(editor);
        for(const value of [true,false]){
            await settings.page.locator('#setting-ui-sounds').evaluate((input,value)=>{input.checked=value;input.dispatchEvent(new Event('change',{bubbles:true}));},value);
            await editor.page.waitForFunction(async value=>{const {uiSounds}=await import(new URL('js/ui/UISounds.js',location.href));return uiSounds.enabled===value;},value);
            checks.push('Preference synchronizes across windows: '+value);
        }
        await fs.writeFile(path.join(root,'.test-output/ui-sounds-report.json'),JSON.stringify({passed:checks.length,checks},null,2));
        if(windows.some(w=>w.__testErrors.length))throw Error(windows.flatMap(w=>w.__testErrors).join('\n'));console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);windows.forEach(w=>w.destroy());app.exit(process.exitCode||0);}
})();
