const fs = require('node:fs/promises');
const path = require('node:path');
const { app, root, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

async function exerciseLauncher() {
    const checks = [];
    const expect = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    const get = id => document.getElementById('utility-' + id);
    const fill = (id, value) => { if(!get(id)) throw new Error('Missing utility control: '+id); get(id).value = value; get(id).dispatchEvent(new Event('input', {bubbles:true})); };
    document.querySelector('[data-open-utility="smallcaps"]').click();
    const dialog = document.getElementById('utilities-dialog');
    expect(dialog.open && !get('panel-smallcaps').hidden, 'Small Caps opens from the launcher without creating a project');
    fill('small-text', 'Hello Привет 🚀');
    expect(get('output').value === 'ʜᴇʟʟᴏ пᴘиʙᴇт 🚀', 'Small Caps converts Russian and English while preserving emoji');
    await document.fonts.load('24px "Molly SmallCaps UI"','ᴀʙᴄ Привет');
    expect(!getComputedStyle(get('small-text')).fontFamily.includes('Molly'),'Input keeps the normal interface font');
    expect(getComputedStyle(dialog.querySelector('.utility-smallcaps-run')).fontFamily.includes('Molly SmallCaps UI'),'Small Caps letters use the bitmap-derived font');
    expect(!get('reverse'),'Reverse conversion has been removed');
    for(const language of ['ru','en','all']){
        fill('language',language);fill('small-text','Abc Привет 123 !');
        const selected=[...dialog.querySelectorAll('.utility-smallcaps-run')].map(n=>n.textContent).join('');
        const regular=[...dialog.querySelectorAll('.utility-regular-run')].map(n=>n.textContent).join('');
        expect(regular.includes('123 !')&&!/[\d!]/.test(selected),'Digits and signs stay regular for '+language);
        expect(language==='ru'?regular.includes('Abc'):language==='en'?regular.includes('Привет'):!/[A-Za-zА-Яа-я]/.test(regular),'Only the chosen alphabet uses Small Caps: '+language);
        expect(get('output-view').textContent===get('output').value,'Visual result equals copied result: '+language);
    }
    fill('language','all');
    expect(dialog.querySelector('.utility-footer [data-utility-action="copy"]'),'Small Caps copy button stays in the footer');
    const write=navigator.clipboard.writeText;
    try{
        let copied='';navigator.clipboard.writeText=async text=>{copied=text;};dialog.querySelector('[data-utility-action="copy"]').click();await Promise.resolve();
        expect(copied===get('output').value,'Result copy uses the exact Unicode text');
        navigator.clipboard.writeText=async()=>{throw Error('test');};dialog.querySelector('[data-utility-action="copy"]').click();await new Promise(resolve=>setTimeout(resolve,0));
        expect(window.getSelection().toString()===get('output').value,'Clipboard failure selects the visible result');
    }finally{navigator.clipboard.writeText=write;}
    fill('small-text','АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ');
    expect(get('output').value==='ᴀбʙгдᴇᴇжзийᴋлᴍʜᴏпᴘᴄтуȹxцчшщъыьэюя','All 33 Russian letters follow the reference mapping in the utility');
    fill('small-text','Привет');
    get('transliterate').click(); expect(get('output').value.includes('ᴘʀɪᴠᴇᴛ'), 'Explicit transliteration updates the result');
    get('tab-gradient').click(); fill('gradient-text', '<bold>"🚀'); fill('format','json');
    const json = JSON.parse(get('output').value);
    expect(getComputedStyle(get('preview')).fontFamily.includes('Minecraft'),'Gradient preview uses Minecraft font');
    expect(getComputedStyle(get('preview').firstElementChild).fontFamily.includes('Molly Minecraft Bitmap'),'Gradient characters themselves use the bitmap font');
    expect(json.extra.map(item=>item.text).join('')==='<bold>"🚀','JSON preserves markup-looking text literally');
    expect(!dialog.querySelector('bold'), 'Utility results never insert user text as HTML');
    const hex=dialog.querySelector('input.md-input[data-color-index="0"]');
    hex.value='#123456';hex.dispatchEvent(new Event('input',{bubbles:true}));
    expect(JSON.parse(get('output').value).extra[0].color==='#123456','HEX input synchronizes the actual gradient and swatch');
    hex.value='#bad';hex.dispatchEvent(new Event('input',{bubbles:true}));
    expect(hex.getAttribute('aria-invalid')==='true','Invalid HEX is marked without corrupting colors');
    expect(dialog.querySelector('[data-utility-action="copy"]').disabled,'Invalid HEX cannot silently copy an outdated gradient');
    hex.value='#123456';hex.dispatchEvent(new Event('input',{bubbles:true}));
    for(let i=0;i<8;i++)dialog.querySelector('[data-utility-action="add-color"]').click();
    expect(dialog.querySelectorAll('input[type="color"]').length===8&&dialog.querySelector('[data-utility-action="add-color"]').disabled,'Color stop count is bounded to eight');
    dialog.querySelector('[data-utility-action="close"]').click(); expect(!dialog.open,'Close hides the native modal');
    document.querySelector('[data-open-utility="gradient"]').click();expect(get('gradient-text').value==='<bold>"🚀','Utility drafts survive closing and reopening');
    get('tab-gradient').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    expect(!get('panel-smallcaps').hidden,'Arrow keys switch utility tabs');
    fill('small-text','Добро пожаловать!');
    get('remember').click();dialog.close();await new Promise(resolve=>setTimeout(resolve,0));
    expect(JSON.parse(localStorage.getItem('molly-utilities-v1')).fields.some(([id,value])=>id==='utility-small-text'&&value==='Добро пожаловать!'),'Remembering utilities explicitly stores their draft across application sessions');
    document.querySelector('[data-open-utility="smallcaps"]').click();get('remember').click();dialog.close();await new Promise(resolve=>setTimeout(resolve,0));
    expect(localStorage.getItem('molly-utilities-v1')===null,'Turning remembering off removes the persistent utility draft');
    document.querySelector('[data-open-utility="smallcaps"]').click();
    return checks;
}

async function exerciseEditor() {
    const editor=window.mollyEditor, checks=[];
    const expect=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    const id=editor.activeProjectId, count=editor.projects.length, history=editor.history.undoStack.length;
    document.querySelector('[data-action="utility-gradient"]').click();
    const dialog=document.getElementById('utilities-dialog');
    expect(dialog.open,'Utilities open from the editor Tools menu');
    expect(editor.activeProjectId===id&&editor.projects.length===count&&editor.history.undoStack.length===history,'Opening utilities leaves project tabs and history intact');
    dialog.querySelector('[data-utility-action="copy"]').focus();
    const tool=editor.tools.currentToolId;
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',bubbles:true}));
    expect(editor.tools.currentToolId===tool,'Editor tool shortcuts cannot leak through utility buttons');
    dialog.close();
    const panel=editor.itemsPanel;
    expect(panel && panel.items.filter(item=>item.category==='block_renders').length>=800,'Block catalog is available in the editor');
    const stone=panel.items.find(item=>item.minecraftId==='stone');
    panel.activeCategory='block_renders';panel.searchQuery='камень';panel.renderItems();
    expect(panel.getFilteredItems().some(item=>item.id===stone.id),'New blocks can be searched by Russian name');
    const before=editor.layerManager.layers.length;
    panel.addItemToCanvas(stone);
    await new Promise((resolve,reject)=>{const started=performance.now();const poll=()=>{if(editor.layerManager.layers.length>before)resolve();else if(performance.now()-started>5000)reject(new Error('Block insertion timed out'));else setTimeout(poll,20);};poll();});
    const layer=editor.layerManager.getActiveLayer();
    expect(layer.sourceCanvas?.width===64&&layer.sourceCanvas?.height===64,'Inserted block retains a pristine transparent sixty-four-pixel master');
    expect(editor.history.undo()&&editor.layerManager.layers.length===before,'Block insertion is one undoable action');
    expect(editor.history.redo()&&editor.layerManager.layers.length===before+1,'Redo restores the inserted block');
    const saved=editor.projectManager.serializeProject();
    expect(saved.layers.some(item=>item.name===stone.name),'Block insertion participates in normal project serialization');
    panel.toggleFavorite(stone.id);panel.activeCategory='favorites';panel.searchQuery='';panel.renderItems();
    expect(panel.getFilteredItems().some(item=>item.id===stone.id),'Favorite resources can be found without changing the resource catalog');
    expect(panel.recent[0]===stone.id,'Inserted resources appear in the recent list');
    panel.activeCategory='all';panel.renderItems();await new Promise(resolve=>requestAnimationFrame(resolve));
    expect(panel.gridElement.children.length<panel.items.length,'Resource cards are loaded on demand rather than building the whole catalog at startup');
    panel.panelElement.classList.add('expanded');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const first=panel.gridElement.firstElementChild;first.focus();first.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    expect(document.activeElement===panel.gridElement.children[1]&&panel.gridElement.querySelectorAll('[tabindex="0"]').length===1,'Resource arrow navigation keeps one keyboard entry point');
    return checks;
}

(async()=>{
    const windows=[], checks=[];const watchdog=setTimeout(()=>app.exit(1),90000);
    try {
        await ready();const launcher=makeWindow();windows.push(launcher);await launcher.loadFile(path.join(root,'src/renderer/index.html'));
        checks.push(...await launcher.webContents.executeJavaScript(`(${exerciseLauncher.toString()})().catch(error=>{throw new Error(error.stack)})`));
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        for(const theme of ['dark','light']){
            await launcher.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.getElementById('utility-tab-gradient').click()`);
            await settle(launcher);await fs.writeFile(path.join(root,`.test-output/utilities-${theme}.png`),(await launcher.webContents.capturePage()).toPNG());
        }
        const preview=await launcher.webContents.executeJavaScript(`(()=>{const section=document.getElementById('utility-preview-section'),preview=document.getElementById('utility-preview');const visible=!section.hidden&&preview.textContent===document.getElementById('utility-gradient-text').value&&preview.firstElementChild.style.color;document.getElementById('utility-tab-smallcaps').click();const hidden=section.hidden;document.getElementById('utility-tab-gradient').click();return visible&&hidden;})()`);
        if(!preview)throw new Error('Gradient preview is missing or visible in Small Caps');checks.push('Only the gradient utility shows a live colored preview');
        launcher.setContentSize(800,600);await settle(launcher);
        const layout=await launcher.webContents.executeJavaScript(`(()=>{const d=document.getElementById('utilities-dialog'),b=d.getBoundingClientRect();return {fits:b.width<=innerWidth&&b.height<=innerHeight,overflow:d.scrollWidth>d.clientWidth+1};})()`);
        if(!layout.fits||layout.overflow)throw new Error('Utility modal overflows a small window');checks.push('Utility modal fits an eight-hundred by six-hundred window');
        await fs.writeFile(path.join(root,'.test-output/utilities-small.png'),(await launcher.webContents.capturePage()).toPNG());
        const editor=makeWindow();windows.push(editor);await editor.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'256',height:'256',name:'Utilities QA'}});
        checks.push(...await editor.webContents.executeJavaScript(`(${exerciseEditor.toString()})()`));
        for(const win of windows)if(win.__testErrors.length)throw new Error(win.__testErrors.join('\n'));
        await settle(editor);await fs.writeFile(path.join(root,'.test-output/block-library.png'),(await editor.webContents.capturePage()).toPNG());
        await fs.writeFile(path.join(root,'.test-output/utility-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length,checks},null,2));
    } catch(error){console.error(error);process.exitCode=1;}
    finally {clearTimeout(watchdog);windows.forEach(win=>win.destroy());app.exit(process.exitCode||0);}
})();
