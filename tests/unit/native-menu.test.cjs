const test=require('node:test'),assert=require('node:assert/strict');
const {installNativeMenu,nativeAccelerator}=require('../../src/main/native-menu.cjs');
test('native Mac shortcuts translate logical modifiers and never intercept plain typing',()=>{
    assert.equal(nativeAccelerator('Ctrl+Alt+KeyS'),'Command+Option+S');
    assert.equal(nativeAccelerator('Meta+Shift+KeyZ'),'Control+Shift+Z');
    assert.equal(nativeAccelerator('Ctrl+Comma'),'Command+,');
    for(const chord of ['','KeyS','Shift+KeyS','Alt+KeyS','Ctrl+Numpad0','Ctrl+toString','Ctrl+__proto__','Unknown+KeyS'])assert.equal(nativeAccelerator(chord),undefined);
});
test('native Mac menus apply reassigned and disabled shortcuts without changing their click actions',()=>{
    let menu;const sent=[],main={},windows={shortcutBindings:{},get:()=>main,label:()=> 'main',send:(...args)=>sent.push(args)};
    const refresh=installNativeMenu({app:{name:'MollyStudio'},Menu:{buildFromTemplate:template=>template,setApplicationMenu:value=>menu=value},BrowserWindow:{getFocusedWindow:()=>main}}, {windows},'darwin');
    const save=()=>menu[1].submenu.find(item=>item.label==='Сохранить');assert.equal(save().accelerator,'Command+S');
    windows.shortcutBindings={'file-save':'Ctrl+Alt+KeyS','file-new':'','file-open':'KeyO','settings-open':'Ctrl+Alt+Comma'};refresh();assert.equal(save().accelerator,'Command+Option+S');assert.equal(menu[1].submenu[0].accelerator,undefined);assert.equal(menu[1].submenu[1].accelerator,undefined);assert.equal(menu[0].submenu.find(item=>item.label==='Настройки…').accelerator,'Command+Option+,');
    save().click();assert.deepEqual(sent,[['main','native-menu-action','file-save']]);windows.shortcutBindings['file-save']='';refresh();assert.equal(save().accelerator,undefined);save().click();assert.equal(sent.length,2);
});
