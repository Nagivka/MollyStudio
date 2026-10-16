const fs = require('node:fs/promises');
const path = require('node:path');
const { app, root, profile, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

async function exercise() {
    const editor=window.mollyEditor,menu=editor.deluxeMenusEditor,checks=[];
    const expect=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
    const input=(scope,key,value)=>{const control=menu.control(scope,key);control.value=value;control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));return control;};
    let project=editor.getActiveProject();
    expect(project.menuPlugin==='zmenu'&&project.deluxeData.name==='&8Главное меню'&&!('menu_title' in project.deluxeData),'zMenu starts from the editor URL with a native configuration');
    expect(document.getElementById('new-menu-plugin').querySelector('option[value="zmenu"]'),'All menu projects expose the plugin selector');
    input('menu','update_interval','500');
    expect(project.deluxeData['update-interval']===500&&menu.control('menu','open_command').closest('label').hidden,'zMenu uses milliseconds and hides DeluxeMenus-only commands');
    menu.selectSlot(13);menu.addMaterial('DIAMOND');
    const id=menu.itemId;
    expect(project.deluxeData.items[id].item.material==='DIAMOND'&&menu.inspectorTab==='button','Adding a material creates a zMenu button and opens its inspector');
    input('item','display_name','&bТелепорт');
    input('item','model_data','7');
    input('ui','action_value','spawn');
    menu.control('ui','action').value='player-command';menu.root.querySelector('[data-dm-action="add-action"]').click();
    expect(project.deluxeData.items[id].actions[0].commands[0]==='spawn','zMenu action builder writes native action objects');
    expect(editor.history.undo()&&!project.deluxeData.items[id].actions,'Undo restores native zMenu actions');
    expect(editor.history.redo()&&project.deluxeData.items[id].actions.length===1,'Redo restores native zMenu actions');
    const actions=menu.control('item','actions');
    actions.value='- type: message\n  messages: [hello]';actions.dispatchEvent(new Event('input',{bubbles:true}));actions.dispatchEvent(new Event('change',{bubbles:true}));
    expect(project.deluxeData.items[id].actions[0].messages[0]==='hello','The action YAML editor updates the actual exported object');
    const amount=input('item','amount','0');
    expect(amount.getAttribute('aria-invalid')==='true'&&menu.commitPendingEdit()===false,'Invalid item quantities cannot overwrite a valid menu');
    const projectsBefore=editor.projects.length,nativeBefore=JSON.stringify(project.deluxeData);
    editor.addProjectData({type:'deluxemenu',menuPlugin:'deluxemenus',name:'Blocked new menu'});
    expect(editor.projects.length===projectsBefore&&editor.getActiveProject()===project&&project.menuPlugin==='zmenu'&&JSON.stringify(project.deluxeData)===nativeBefore,'A blocked project creation never overwrites the active menu');
    menu.root.querySelector('[data-dm-action="discard-invalid"]').click();
    expect(!menu.invalidFields.size&&menu.commitPendingEdit()===true&&amount.value==='1','Invalid input has a visible recovery action and does not trap the editor');
    input('item','slots','13, 14');
    menu.selectSlot(13);menu.addMaterial('EMERALD');
    const splitId=menu.itemId;
    expect(project.deluxeData.items[id].slot===14&&project.deluxeData.items[splitId].slot===13&&project.deluxeData.items[splitId].item.material==='EMERALD','Changing one shared slot splits its button without changing the other slot');
    expect(project.deluxeData.items[splitId].actions[0].messages[0]==='hello','Splitting a shared button preserves its actions');
    menu.openCode(splitId);
    const dialog=menu.codeDialog,code=dialog.querySelector('textarea');
    code.value+='\nview-requirement:\n  requirements:\n    - type: permission\n      permission: test.menu\n';
    dialog.querySelector('[data-dm-action="apply-code"]').click();
    expect(!dialog.open&&project.deluxeData.items[splitId]['view-requirement'].requirements[0].permission==='test.menu','Advanced native YAML survives visual editing');
    input('item','display_name','&aОбновлено');
    expect(project.deluxeData.items[splitId]['view-requirement'].requirements.length===1,'Changing a visual property keeps advanced requirements intact');
    input('item','button_type','JUMP');input('item','button_page','3');
    expect(project.deluxeData.items[splitId]['to-page']===3&&project.deluxeData.items[splitId].page===1,'Page navigation edits to-page without changing the button display page');
    input('menu','fill_material','BLACK_STAINED_GLASS');
    expect(project.deluxeData['fill-item'].material==='BLACK_STAINED_GLASS'&&menu.get('grid').children[0].querySelector('img'),'Fill items appear in otherwise empty inventory slots');
    const page=menu.get('preview-page');page.value='2';page.dispatchEvent(new Event('change',{bubbles:true}));
    menu.selectSlot(13);menu.addMaterial('GOLD_INGOT');
    const secondId=menu.itemId;
    expect(project.deluxeData.items[secondId].page===2&&project.deluxeData.items[splitId].slot===13,'Different zMenu pages can use the same slot independently');
    menu.root.querySelector('[data-dm-action="remove"]').click();
    expect(!project.deluxeData.items[secondId]&&project.deluxeData.items[splitId],'Clearing one page does not remove buttons from another page');
    const doc=editor.projectManager.serializeProject();
    expect(doc.menuPlugin==='zmenu'&&doc.deluxeData.items[splitId].item['model-id']===7,'MLST serialization retains the plugin and native model data');
    expect(await editor.projectManager.saveProjectAs(),'zMenu saves through the normal project file flow');
    const saved=JSON.parse(await window.electronAPI.readFile(project.filePath));
    await editor.projectManager.deserializeProject(saved,project.filePath);project=editor.getActiveProject();
    expect(project.menuPlugin==='zmenu'&&project.deluxeData.items[splitId].actions[0].type==='message','Reopening the saved MLST restores editable zMenu buttons');
    expect(await editor.exportPNG(),'The regular export command writes native zMenu YAML');
    const before=structuredClone(project.deluxeData);
    menu.replaceNative({menu_title:'Imported DM',size:9,items:{}},'deluxemenus');
    expect(project.menuPlugin==='deluxemenus'&&menu.get('plugin').textContent==='DeluxeMenus','Import can switch the active menu format');
    expect(editor.history.undo()&&project.menuPlugin==='zmenu'&&JSON.stringify(project.deluxeData)===JSON.stringify(before),'Undo of an import restores both the plugin and every native field');
    await editor.projectManager.flushAutosaves();
    expect(editor.projectManager.serializeProject().menuPlugin==='zmenu','Autosave serializes the current plugin');
    menu.selectSlot(13);menu.setInspector('button');
    return checks;
}

(async()=>{
    let win;const watchdog=setTimeout(()=>app.exit(1),90000);
    try{
        await ready();win=makeWindow();
        await win.loadFile(path.join(root,'www/editor.html'),{query:{new:'true',type:'deluxemenu',menuPlugin:'zmenu',name:'zMenu QA'}});
        const checks=await win.webContents.executeJavaScript(`(${exercise.toString()})()`);
        const yaml=await fs.readFile(path.join(profile,'zMenu QA.yml'),'utf8');
        if(!yaml.includes('to-page: 3')||!yaml.includes('model-id: 7')||yaml.includes('_native:'))throw new Error('Export does not contain native zMenu fields');
        checks.push('The written YAML contains native zMenu navigation and model fields without editor metadata');
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        for(const [name,width,height,theme] of [['zmenu',1280,800,'dark'],['zmenu-light',1280,800,'light'],['zmenu-narrow',820,720,'dark']]){
            win.setContentSize(width,height);
            await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
            await settle(win);
            const fits=await win.webContents.executeJavaScript(`(()=>{const layout=document.querySelector('.dm-layout');return layout.scrollWidth<=layout.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth;})()`);
            if(!fits)throw new Error('Menu interface overflows '+name);
            await fs.writeFile(path.join(root,`.test-output/${name}.png`),(await win.webContents.capturePage()).toPNG());
        }
        if(win.__testErrors.length)throw new Error(win.__testErrors.join('\n'));
        checks.push('zMenu fits dark, light and narrow source windows without horizontal overflow');
        await fs.writeFile(path.join(root,'.test-output/menu-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length,checks},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
})();
