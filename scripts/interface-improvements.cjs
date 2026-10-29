const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{const windows=[],checks=[],timer=setTimeout(()=>app.exit(1),90000);
try{
    await ready();const settings=makeWindow(960,760,{label:'settings'});windows.push(settings);await settings.loadFile(path.join(root,'src/renderer/settings.html'),{query:{tab:'effects'}});await settings.showInactive();await settle(settings);
    checks.push(...await settings.page.evaluate(()=>{
        const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
        check(document.querySelectorAll('[data-ui-effect]').length===5,'Effects has five independent switches');
        check(!!document.querySelector('[data-weather-range]')&&!!document.querySelector('#setting-ui-sounds')&&!document.querySelector('.settings-theme-card'),'Weather, sounds and effects share their own settings section');
        for(const input of document.querySelectorAll('[data-ui-effect]')){input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));}
        check(['no-click-effects','no-animated-accents','no-card-motion','no-theme-transition','no-save-feedback'].every(c=>document.documentElement.classList.contains(c)),'Individual switches immediately apply each effect preference');
        document.querySelector('#setting-ui-sound-profile').value='pixel';document.querySelector('#setting-ui-sound-profile').dispatchEvent(new Event('change',{bubbles:true}));return checks;
    }));
    const editor=makeWindow(1280,900);windows.push(editor);await editor.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'128',height:'128',name:'Improvements'}});await settle(editor);
    checks.push(...await editor.page.evaluate(async()=>{
        const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},e=mollyEditor;
        check(e.settingsManager.get('uiSoundProfile')==='pixel'&&!e.settingsManager.get('cardMotionEnabled'),'Sound profile and independent preferences persist in new windows');
        e.settingsManager.set('animationsEnabled',true);
        const testButton=document.querySelector('button');testButton.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:20,clientY:20}));
        check(!document.querySelector('.ui-click-response'),'Disabling click feedback prevents the actual effect');
        check(!document.querySelector('.doc-tab.active').getAnimations().some(a=>a.animationName==='ui-accent-breathe'),'Disabling animated accents stops their actual CSS animation');
        const {revealTheme}=await import(new URL('js/ui/VisualEffects.js',location.href));let switched=false;revealTheme(()=>{switched=true;},testButton);check(switched,'Disabling theme transitions applies changes synchronously');
        document.dispatchEvent(new CustomEvent('molly-project-saved',{detail:{id:e.activeProjectId}}));check(!document.querySelector('[data-saved-feedback]'),'Save feedback can be independently suppressed');
        const l=e.layerManager.addTextLayer('Sample',{text:'Hello Привет 123',fontId:'minecraft',x:4,y:4});e.tools.setTool('text');e.tools.tools.text.renderTextLayer(l);e.tools.tools.text.syncUIWithLayer(l);
        await new Promise(resolve=>setTimeout(resolve,300));
        check(document.querySelectorAll('.bitmap-font-sample').length===4,'All four font choices have real bitmap previews');
        document.querySelector('[data-font-choice="square"]').click();check(l.textData.fontId==='square'&&l.textData.text==='Hello Привет 123','A visual font choice preserves the original editable text');
        e.layerPanel.render();let row=e.layerPanel.layerElements.get(l.id);row.querySelector('[data-layer-quick-action="rename"]').click();const input=document.querySelector('.layer-rename-input');input.value='Renamed';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));check(l.name==='Renamed','Layer quick rename commits the new name');e.history.undo();check(l.name==='Sample','Quick rename is undoable');
        e.layerPanel.render();row=e.layerPanel.layerElements.get(l.id);const before=e.layerManager.layers.length;row.querySelector('[data-layer-quick-action="duplicate"]').click();check(e.layerManager.layers.length===before+1,'Layer quick duplicate creates a copy');e.history.undo();check(e.layerManager.layers.length===before,'Quick duplicate is undoable');
        const {UISoundPlayer}=await import(new URL('js/ui/UISounds.js',location.href));
        const render=async profile=>{const p=new UISoundPlayer(),audio=new OfflineAudioContext(1,9600,48000);p.context=audio;p.master=audio.createGain();p.master.connect(audio.destination);p.configure({uiSoundsEnabled:true,uiSoundVolume:100,uiSoundProfile:profile});p.play('save');return (await audio.startRendering()).getChannelData(0);};
        const a=await render('soft'),b=await render('pixel');check(a.some((v,i)=>Math.abs(v-b[i])>.01),'Soft and pixel profiles produce distinct actual audio waveforms');
        document.documentElement.dataset.theme='minecraft';const automatic=await render('auto');check(automatic.every((v,i)=>v===b[i]),'Automatic sound profile matches the pixel profile in Minecraft themes');
        return checks;
    }));
    await fs.writeFile(path.join(root,'.test-output/interface-improvements.png'),(await editor.webContents.capturePage()).toPNG());
    if(windows.some(w=>w.__testErrors.length))throw Error(windows.flatMap(w=>w.__testErrors).join('\n'));
    await fs.writeFile(path.join(root,'.test-output/interface-improvements.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);windows.forEach(w=>w.destroy());app.exit(process.exitCode||0);}})();
