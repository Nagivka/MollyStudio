const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,profile,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Native Cyrillic QA'}});await settle(win);
 const result=await win.page.evaluate(async()=>{
  const a=mollyEditor,e=a.titleEditor;await a.getActiveProject().prefixLoadPromise;
  const {TITLE_MATERIAL_CATALOG:M}=await import(new URL('js/core/TitleMaterialCatalog.mjs',location.href));
  const {titleRowSettings}=await import(new URL('js/core/TitleDocument.mjs',location.href));
  const {TITLE_TEXT_LANGUAGES,titleFontsForLanguage}=await import(new URL('js/core/TitleLanguages.mjs',location.href));
  const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=async()=>{for(let i=0;e.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));if(e.loading)throw Error('Material load timeout');};
  const field=async(selector,value)=>{const input=e.panel.querySelector(selector);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
  const text=value=>field('[data-title-field="text"]',value),data=()=>a.getActiveProject().titleData,fonts=()=>[...e.panel.querySelector('[data-title-field="font"]').options].map(option=>option.value);
  const closeLibrary=async()=>{const dialog=document.querySelector('.title-material-library');const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;};
  expect(fonts().length===11,'English lists only its 11 original fonts');
  await text('ПРИВЕТ');expect(data().font==='minecraft-ten-cyrillic'&&fonts().join()===titleFontsForLanguage('ru').join(),'Russian input selects the native Cyrillic font and offers only its two supported families');
  await field('[data-title-field="font"]','minecraft-five-bold-cyrillic');
  expect(data().font==='minecraft-five-bold-cyrillic','The second original Cyrillic family is selectable');
  await text('HELLO');expect(data().font==='minecraft-five-bold'&&fonts().length===11,'Changing the alphabet selects the actual paired English model');
  a.settingsManager.set('language','en');await field('[data-title-language="0"]','ru');
  expect(e.panel.querySelector('[data-title-field="text"]').getAttribute('aria-invalid')==='true'&&data().text==='HELLO','An incompatible explicit language preserves the draft and previous complete document');
  expect(e.panel.querySelector('.title-warning').textContent.includes('Russian'),'Language validation messages translate the language name with the interface');a.settingsManager.set('language','ru');
  expect(e.commitPendingEdit()===false&&await e.exportModel()===false,'Invalid row languages block saving and model export');
  await text('ПРИВЕТ');expect(data().rowLanguages[0]==='ru'&&data().font==='minecraft-five-bold-cyrillic'&&!e.panel.querySelector('[aria-invalid="true"]'),'Correcting the text commits its pending language choice');
  await field('[data-title-language="0"]','uk');
  expect(fonts().join()==='minecraft-ten-cyrillic'&&data().font==='minecraft-ten-cyrillic','Ukrainian offers only the source font with its complete alphabet');
  await text('ПРИВІТ');expect(!e.panel.querySelector('[aria-invalid="true"]'),'Native Ukrainian letters are accepted');
  await text('ПРИВІТ\nHELLO\nПРИВЕТ');
  await field('[data-title-language="1"]','en');await field('[data-title-language="2"]','ru');
  for(const [index,language] of ['uk','en','ru'].entries()){
   await field('[data-title-row]',index);
   expect(fonts().join()===titleFontsForLanguage(language).join(),'Row '+(index+1)+' independently filters its native fonts');
   const settings=titleRowSettings(data(),index),catalog=M.fonts[settings.font];
   expect(e.panel.querySelector('[data-title-field="texture"]').options.length===catalog.textures.length,'Row '+(index+1)+' lists exactly its native material catalog');
   e.openMaterialLibrary();expect(document.querySelectorAll('.title-material-card').length===catalog.textures.length,'Row '+(index+1)+' visual material gallery matches its native atlas');await closeLibrary();
  }
  await field('[data-title-row]',-1);
  expect(e.panel.querySelector('[data-title-field="subtitleTexture"]').closest('label').hidden,'Cross-language rows do not expose an incompatible shared subtitle atlas');
  await text('ПРИВІТ HELLO\nHELLO\nПРИВЕТ');
  expect(e.panel.querySelector('[data-title-field="text"]').value.startsWith('ПРИВІТ HELLO')&&e.commitPendingEdit()===false,'Mixed alphabets in one row remain editable and block commit');
  await text('ПРИВІТ\nHELLO\nПРИВЕТ');expect(e.commitPendingEdit()!==false,'Separate languages on separate rows commit normally');
  const textInput=e.panel.querySelector('[data-title-field="text"]');textInput.focus();await text('ПРИВІТ\nHELLO\nТЕСТ');
  a.history.undo();await wait();expect(textInput.value===data().text&&data().text==='ПРИВІТ\nHELLO\nПРИВЕТ','Undo refreshes the focused text field together with the native scene');
  a.history.redo();await wait();expect(textInput.value===data().text&&data().text==='ПРИВІТ\nHELLO\nТЕСТ','Redo refreshes the focused text field without stale text');await text('ПРИВІТ\nHELLO\nПРИВЕТ');
  e.change(value=>{value.text='СТАРЫЙ LEGACY';});
  expect(e.panel.querySelector('[data-title-field="text"]').value==='СТАРЫЙ LEGACY'&&e.commitPendingEdit()===false,'Legacy mixed-language text is retained for correction without silent deletion');
  await text('ПРИВІТ\nHELLO\nПРИВЕТ');
  let count=0,overlays=0,row=0;
  const sheet=document.createElement('canvas');sheet.width=1400;sheet.height=4*210;const ctx=sheet.getContext('2d');ctx.fillStyle='#191D23';ctx.fillRect(0,0,sheet.width,sheet.height);
  for(const font of titleFontsForLanguage('ru')){
   const args={font,text:TITLE_TEXT_LANGUAGES.ru.alphabet.toUpperCase(),creeperA:false,resolution:1024,texture:'none'};
   for(const role of ['top','bottom','small']){const value={...args,rows:[{font,role}]};await e.renderer.loadFor(value);const output=e.renderer.render(value);expect(!output.missing.length&&e.renderer.exportRenderer.mesh.nodes.filter(n=>n.type==='glyph').every(n=>n.font===font),font+'/'+role+': all 33 letters use original source models');output.canvas.width=output.canvas.height=1;}
   for(const record of M.fonts[font].textures){
    const value={...args,text:'СЪЕШЬ ЕЩЁ',texture:record.id};await e.renderer.loadFor(value);const output=e.renderer.render(value),pixels=output.canvas.getContext('2d').getImageData(0,0,output.canvas.width,output.canvas.height).data;
    if(output.missing.length||!pixels.some((v,i)=>i%4===3&&v>0))throw Error('Empty native material '+font+'/'+record.id);
    if(record.id==='none'||record.id==='gold'){
     const y=row++*210;ctx.fillStyle='#E4E9F3';ctx.font='18px Segoe UI';ctx.fillText(font+' / '+record.name,20,y+25);const scale=Math.min(1340/output.canvas.width,165/output.canvas.height);ctx.drawImage(output.canvas,(1400-output.canvas.width*scale)/2,y+38,output.canvas.width*scale,output.canvas.height*scale);
    }
    output.canvas.width=output.canvas.height=1;count++;
   }
   for(const record of M.fonts[font].overlays){const value={...args,text:'ЖЁЛТЫЙ',appearance:{overlay:record.id}};await e.renderer.loadFor(value);const output=e.renderer.render(value);if(output.missing.length)throw Error('Native overlay '+record.id);output.canvas.width=output.canvas.height=1;overlays++;}
  }
  expect(count===73&&overlays===8,'All 73 native Cyrillic material entries and 8 native overlays render successfully');
  await field('[data-title-row]',2);await field('[data-title-field="font"]','minecraft-five-bold-cyrillic');
  expect(e.panel.querySelector('[data-title-preset="1"]').hidden,'A family without an original gold atlas does not offer the gold preset');
  await field('[data-title-field="texture"]','acacia_planks');
  expect(titleRowSettings(data(),2).texture==='acacia_planks','A row retains its selected native material');await field('[data-title-row]',-1);
  expect(await a.projectManager.saveProjectAs(),'The multilingual native scene saves through the actual MLST flow');
  const project=a.getActiveProject(),beforeData=JSON.stringify(project.titleData),before=project.layers[0].canvas.toDataURL(),saved=JSON.parse(await desktopAPI.readFile(project.filePath));
  await a.projectManager.deserializeProject(saved,project.filePath);await a.getActiveProject().prefixLoadPromise;
  expect(JSON.stringify(data())===beforeData&&data().rowLanguages.join()==='uk,en,ru','MLST restores row languages and their independent native fonts/materials');
  const image=new Image();image.src=before;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const context=c.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
  const first=context.getImageData(0,0,c.width,c.height).data,second=a.getActiveProject().layers[0].ctx.getImageData(0,0,c.width,c.height).data;let maxRGB=0,maxAlpha=0;
  for(let i=0;i<first.length;i++)if(i%4===3)maxAlpha=Math.max(maxAlpha,Math.abs(first[i]-second[i]));else maxRGB=Math.max(maxRGB,Math.abs(first[i]-second[i]));
  expect(maxRGB<=1&&maxAlpha===0,'Native material pixels and exact alpha survive reopening');
  expect(await e.exportModel(),'The native model and embedded source atlases export to BBModel');
  await field('[data-title-row]',2);e.openMaterialLibrary('fonts');
  expect(document.querySelectorAll('.title-material-card').length===2&&[...document.querySelectorAll('.title-material-card img')].every(img=>!img.src.includes('/cyrillic/previews/')),'Russian font gallery uses two original previews without generated substitutes');
  return {checks,count,overlays,sheet:sheet.toDataURL(),maxRGB,maxAlpha};
 });
 const file=(await fs.readdir(profile)).find(name=>name.endsWith('-Native Cyrillic QA.bbmodel'));
 if(!file)throw Error('BBModel not saved');const model=JSON.parse(await fs.readFile(path.join(profile,file),'utf8'));
 if(!model.textures.every(t=>t.source.startsWith('data:image/png;base64,'))||!model.textures.some(t=>t.name.includes('cyrillic')))throw Error('Missing embedded native Cyrillic atlas');
 result.checks.push('BBModel embeds native atlases without external files');
 await fs.writeFile(path.join(root,'.test-output/title-native-cyrillic.png'),Buffer.from(result.sheet.split(',')[1],'base64'));delete result.sheet;
 await fs.writeFile(path.join(root,'.test-output/title-native-cyrillic-gallery.png'),(await win.webContents.capturePage()).toPNG());
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
 await fs.writeFile(path.join(root,'.test-output/title-cyrillic-report.json'),JSON.stringify({passed:true,...result},null,2));console.log(JSON.stringify({passed:result.checks.length,...result}));
 }catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
