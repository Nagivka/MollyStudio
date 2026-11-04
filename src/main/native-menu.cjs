const edits={'edit-undo':'undo','edit-redo':'redo','select-cut':'cut','select-copy':'copy','select-paste':'paste','select-all':'selectAll'};
function nativeAccelerator(chord){
    if(typeof chord!=='string'||chord.length>70)return;
    const parts=chord.split('+'),code=parts.pop(),modifiers={Ctrl:'Command',Meta:'Control',Alt:'Option',Shift:'Shift'};
    // Plain character shortcuts belong to the canvas, never to focused text inputs.
    if(!parts.some(part=>part==='Ctrl'||part==='Meta')||parts.some(part=>!Object.hasOwn(modifiers,part)))return;
    const punctuation={Comma:',',Period:'.',Quote:"'",Semicolon:';',BracketLeft:'[',BracketRight:']',Backslash:'\\',Slash:'/',Minus:'-',Equal:'=',Backquote:'`'};
    const key=/^Key[A-Z]$/.test(code)?code.slice(3):/^Digit[0-9]$/.test(code)?code.slice(5):/^(?:F(?:[1-9]|1[0-9]|2[0-4])|Home|End|PageUp|PageDown|Insert)$/.test(code)?code:Object.hasOwn(punctuation,code)?punctuation[code]:undefined;
    return key?[...parts.map(part=>modifiers[part]),key].join('+'):undefined;
}
function installNativeMenu(electron,runtime,platform=process.platform) {
    if(platform!=='darwin')return ()=>{};
    const {app,Menu,BrowserWindow,dialog}=electron,{windows}=runtime;
    const send=action=>{
        const focused=BrowserWindow.getFocusedWindow(),label=windows.label(focused)||'main';
        if(!windows.get(label))windows.create('main');
        windows.send(label,'native-menu-action',action);
    };
    const refresh=()=>{
        const en=windows.language==='en',label=(ru,english)=>en?english:ru;
        const shortcut=(action,fallback)=>{const bindings=windows.shortcutBindings||{},accelerator=Object.hasOwn(bindings,action)?nativeAccelerator(bindings[action]):fallback;return accelerator?{accelerator}:{};};
        const command=(action,ru,english,accelerator)=>({id:action,label:label(ru,english),...shortcut(action,accelerator),click:()=>send(action)});
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {label:app.name||'MollyStudio',submenu:[{role:'about'},{type:'separator'},{label:label('Настройки…','Settings…'),...shortcut('settings-open','Command+,'),click:()=>windows.create('settings')},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},
            {label:label('Файл','File'),submenu:[{label:label('Новый проект…','New project…'),...shortcut('file-new','Command+N'),click:()=>{if(!windows.get('main'))windows.create('main');windows.create('new-project');}},
                {label:label('Открыть…','Open…'),...shortcut('file-open','Command+O'),click:async()=>{try{const main=windows.get('main')||windows.create('main'),result=await dialog.showOpenDialog(main,{properties:['openFile','multiSelections'],filters:[{name:'MollyStudio',extensions:['mlst']}]});if(!result.canceled)runtime.enqueue(result.filePaths);}catch(error){console.error('Native open:',error);}}},
                command('file-save','Сохранить','Save','Command+S'),command('file-save-as','Сохранить как…','Save as…','Command+Shift+S'),command('file-export-png','Экспорт…','Export…','Command+Shift+E'),{type:'separator'},{role:'close'}]},
            {label:label('Правка','Edit'),submenu:[command('edit-undo','Отменить','Undo','Command+Z'),command('edit-redo','Повторить','Redo','Command+Shift+Z'),{type:'separator'},command('select-cut','Вырезать','Cut','Command+X'),command('select-copy','Копировать','Copy','Command+C'),command('select-paste','Вставить','Paste','Command+V'),command('select-all','Выделить всё','Select all','Command+A')]},
            {label:label('Вид','View'),submenu:[{role:'togglefullscreen'}]},
            {role:'windowMenu'}
        ]));
    };
    refresh();return refresh;
}
module.exports={installNativeMenu,nativeEdits:edits,nativeAccelerator};
