const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Reference parity QA'}});await settle(win);
 const checks=await win.page.evaluate(async()=>{
  const app=mollyEditor,editor=app.titleEditor;await app.getActiveProject().prefixLoadPromise;
  const {TITLE_MATERIAL_CATALOG}=await import(new URL('js/core/TitleMaterialCatalog.mjs',location.href));
  const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=async()=>{for(let i=0;editor.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));if(editor.loading)throw Error('Material load did not settle');};
  const field=async(selector,value)=>{const input=editor.panel.querySelector(selector);if(!input)throw Error('Missing '+selector);if(input.type==='checkbox')input.checked=!!value;else input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
  const closeLibrary=async()=>{const dialog=document.querySelector('.title-material-library');const closed=new Promise(resolve=>dialog.addEventListener('close',resolve,{once:true}));dialog.close();await closed;};
  const data=()=>app.getActiveProject().titleData,pixels=()=>app.getActiveProject().layers[0].canvas.toDataURL();
  expect(data().meshMode==='original','New documents use the original generator model geometry');
  for(const tab of ['settings','material','scene']){
   editor.panel.querySelector('[data-title-tab="'+tab+'"]').click();
   expect(!editor.panel.querySelector('.title-'+(tab==='settings'?'settings':tab)+'-panel').hidden&&editor.panel.querySelector('[data-title-row]').checkVisibility(),'The '+tab+' section opens with the shared row selector visible');
  }
  const lastTab=editor.panel.querySelector('[data-title-tab="scene"]');lastTab.focus();lastTab.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));expect(editor.panel.querySelector('[data-title-tab="settings"]').tabIndex===0&&!editor.panel.querySelector('.title-settings-panel').hidden,'Inspector tabs support keyboard navigation and a single tab stop');
  editor.setTab('settings');editor.panel.querySelector('[data-title-library="fonts"]').click();
  expect(document.querySelectorAll('.title-material-card').length===11,'The English font library contains only its 11 native fonts');await closeLibrary();
  expect(editor.panel.querySelector('[data-title-field="texture"]').options.length===TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].textures.length,'The material selector exposes every original Minecraft Ten texture and variant');
  editor.panel.querySelector('[data-title-material-library]').click();
  expect(document.querySelectorAll('.title-material-card').length>100&&document.querySelector('.title-material-library').open,'The material library opens as a visual gallery with over 100 choices');
  const search=document.querySelector('.title-material-library input[type="search"]');search.value='cracked';search.dispatchEvent(new Event('input',{bubbles:true}));
  expect(document.querySelectorAll('.title-material-card').length>1&&document.querySelectorAll('.title-material-card').length<20,'Material search finds the original texture variants');await closeLibrary();
  const choices=TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].textures.filter(item=>!['none','stone','gold'].includes(item.id));
  await field('[data-title-field="texture"]',choices[0].id);expect(data().texture===choices[0].id,'A material outside the original three choices loads and renders');
  const beforeRace=data().texture,input=editor.panel.querySelector('[data-title-field="texture"]');
  for(const item of choices.slice(2,4)){input.value=item.id;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}await wait();
  expect(data().texture===choices[3].id,'The latest texture choice wins when loads finish out of order');
  app.history.undo();await wait();expect(data().texture===beforeRace,'A rapid texture change is one undo action');app.history.redo();await wait();expect(data().texture===choices[3].id,'Redo restores a lazily loaded material');
  editor.change(value=>{value.text='MINECRAFT\nSTUDIO\nJAVA';value.texture='none';});
  await field('[data-title-row]',1);await field('[data-title-field="font"]','minecraft-five-bold');await field('[data-title-field="texture"]','gold');editor.changeSettings(value=>{value.scale=[1.25,1,1];});await field('[data-title-field="role"]','top');
  expect(data().font==='minecraft-ten'&&data().rows[1].font==='minecraft-five-bold'&&data().rows[1].texture==='gold'&&data().rows[1].scale[0]===1.25&&data().rows[1].role==='top','Each row retains its own font, material, scale and model role');
  await field('[data-title-row]',-1);await field('[data-title-appearance="source"]','gradient');
  editor.setTab('material');
  editor.panel.querySelector('[data-title-library="overlays"]').click();expect(document.querySelectorAll('.title-material-card').length===TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].overlays.length,'The overlay gallery exposes the original font overlays');await closeLibrary();
  const beforeGradient=pixels();await field('[data-title-stop="0"][data-stop-property="color"]','#FF2233');await field('[data-title-stop="1"][data-stop-property="color"]','#3355FF');
  expect(pixels()!==beforeGradient,'Gradient colors are baked into the real model atlas');
  editor.panel.querySelector('[data-title-add-stop]').click();expect(data().appearance.stops.length===3,'The gradient supports additional color stops');
  const swatch=editor.panel.querySelector('[data-title-stop="1"][data-stop-property="color"]'),transfer=new DataTransfer();transfer.setData('text/plain','#33DD77');swatch.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));await wait();
  expect(data().appearance.stops[1].color==='#33DD77','Dropping a palette color replaces the intended gradient stop');
  await field('[data-title-appearance="smooth"]',false);const stepped=pixels();await field('[data-title-appearance="smooth"]',true);expect(pixels()!==stepped,'Smooth and stepped gradients render differently');
  const overlay=TITLE_MATERIAL_CATALOG.fonts['minecraft-ten'].overlays[0];await field('[data-title-appearance="overlay"]',overlay.id);const overlaid=pixels();await field('[data-title-appearance="overlayOpacity"]',0);expect(pixels()!==overlaid,'Overlay opacity changes the generated material');
  await field('[data-title-appearance="overlay"]','none');await field('[data-title-appearance="hue"]',45);await field('[data-title-appearance="saturation"]',135);await field('[data-title-appearance="tintOpacity"]',40);await field('[data-title-appearance="tint"]','#55BBEE');
  expect(data().appearance.hue===45&&data().appearance.saturation===135&&data().appearance.tintOpacity===40,'Color correction and tint settings persist in the document');
  await field('[data-title-appearance="customBorder"]',true);await field('[data-title-appearance="borderColor"]','#7722EE');await field('[data-title-appearance="customEdge"]',true);await field('[data-title-appearance="edgeColor"]','#33BB66');await field('[data-title-appearance="fadeToBorder"]',true);
  expect(data().appearance.borderColor==='#7722EE'&&data().appearance.edgeColor==='#33BB66'&&data().appearance.fadeToBorder,'Border, edge colors and border fading are editable');
  await field('[data-title-appearance="source"]','tileable');await field('[data-title-appearance="randomRotation"]',true);await field('[data-title-appearance="randomMirror"]',true);await field('[data-title-appearance="tileScale"]',1.5);
  editor.panel.querySelector('[data-title-library="tileables"]').click();expect(document.querySelectorAll('.title-material-card').length===148,'The visual tileable library includes all 148 source textures');await closeLibrary();
  const tilePixels=pixels();expect(tilePixels!==beforeGradient&&data().appearance.tileScale===1.5,'Original Minecraft tileable textures render with adjustable scale and seeded variation');
  expect(await app.projectManager.saveProjectAs(),'An advanced title saves through the real MLST file dialog');
  const project=app.getActiveProject(),saved=JSON.parse(await desktopAPI.readFile(project.filePath));await app.projectManager.deserializeProject(saved,project.filePath);await app.getActiveProject().prefixLoadPromise;
  expect(pixels()===tilePixels&&data().rows[1].font==='minecraft-five-bold'&&data().appearance.randomRotation,'Reopening restores row settings and the exact randomized material pixels');
  const good=JSON.stringify(data());editor.changeSettings(value=>{value.appearance={...value.appearance,source:'file',fileMode:'atlas',image:'data:image/png;base64,AA=='};});await wait();expect(JSON.stringify(data())===good&&!editor.viewport.stage.inert,'A corrupt imported image leaves the previous document and interactive scene intact');
  await field('[data-title-appearance="source"]','file');await field('[data-title-appearance="fileMode"]','tileable');
  editor.setTab('material');
  return checks;
 });
 const fileChooser=win.page.waitForEvent('filechooser');await win.page.locator('[data-title-import="image"]').click();await(await fileChooser).setFiles(path.join(root,'src/renderer/assets/weather/snow.png'));
 await win.page.waitForFunction(()=>!mollyEditor.titleEditor.loading&&mollyEditor.getActiveProject().titleData.appearance.image?.startsWith('data:image/png;base64,'));checks.push('Importing a local image embeds it in the title without a network dependency');
 const overlayChooser=win.page.waitForEvent('filechooser');await win.page.locator('[data-title-import="overlayImage"]').click();await(await overlayChooser).setFiles(path.join(root,'src/renderer/assets/weather/snow.png'));
 await win.page.waitForFunction(()=>!mollyEditor.titleEditor.loading&&!!mollyEditor.getActiveProject().titleData.appearance.overlayImage);checks.push('A custom overlay is embedded independently of the base image');
 await win.page.locator('[data-title-clear-overlay]').click();await win.page.waitForFunction(()=>!mollyEditor.getActiveProject().titleData.appearance.overlayImage);checks.push('A custom overlay can be removed even when the preset selector is already set to None');
 const catalogResult=await win.page.evaluate(async()=>{
  const editor=mollyEditor.titleEditor,{TITLE_MATERIAL_CATALOG}=await import(new URL('js/core/TitleMaterialCatalog.mjs',location.href));let count=0;
  for(const [font,entry] of Object.entries(TITLE_MATERIAL_CATALOG.fonts))for(const item of entry.textures){
   const value={font,texture:item.id,text:font.endsWith('cyrillic')?'ТЕСТ':'TEST',creeperA:false,resolution:1024};await editor.renderer.loadFor(value);const output=editor.renderer.render(value);
   const pixels=output.canvas.getContext('2d').getImageData(0,0,output.canvas.width,output.canvas.height).data;
   if(!pixels.some((value,index)=>index%4===3&&value>0))throw Error('Empty material render: '+font+'/'+item.sourceId);output.canvas.width=output.canvas.height=1;count++;
  }
  return {count,decodedPixels:[...new Set(editor.renderer.images.values())].reduce((n,image)=>n+image.width*image.height,0)};
 });
 if(catalogResult.count!==309)throw Error('Incomplete material catalog');checks.push('All 309 registered source materials render successfully');
 if(catalogResult.decodedPixels>40*1024*1024)throw Error('Decoded material cache exceeded its budget');checks.push('Browsing the whole catalog keeps the decoded image cache bounded');
 for(const [width,height] of [[1000,700],[1280,900],[1920,1080]]){
  win.setContentSize(width,height);await settle(win);await win.page.evaluate(()=>{mollyEditor.titleEditor.currentRow=-1;mollyEditor.titleEditor.sync();mollyEditor.titleEditor.openMaterialLibrary();});await settle(win);
  const fit=await win.page.evaluate(()=>{const d=document.querySelector('.title-material-library').getBoundingClientRect();return d.left>=0&&d.top>=0&&d.right<=innerWidth+1&&d.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth;});if(!fit)throw Error('Gallery overflow at '+width+'x'+height);checks.push('The visual library fits '+width+'x'+height);
  if(width===1280)await fs.writeFile(path.join(root,'.test-output/title-material-library.png'),(await win.webContents.capturePage()).toPNG());
  await win.page.evaluate(()=>document.querySelector('.title-material-library').close());
 }
 for(const theme of ['dark','light','minecraft','light-minecraft']){
  win.setContentSize(1000,700);await win.page.evaluate(theme=>{mollyEditor.settingsManager.set('theme',theme);mollyEditor.titleEditor.setTab('material');mollyEditor.titleEditor.openMaterialLibrary();},theme);await settle(win);
  const fit=await win.page.evaluate(()=>{const dialog=document.querySelector('.title-material-library'),rect=dialog.getBoundingClientRect(),grid=dialog.querySelector('.title-material-grid');return rect.left>0&&rect.top>0&&Math.abs(rect.left-(innerWidth-rect.width)/2)<2&&rect.right<innerWidth&&rect.bottom<innerHeight&&grid.clientHeight>100&&grid.scrollHeight>grid.clientHeight&&dialog.scrollWidth<=dialog.clientWidth&&document.documentElement.scrollWidth<=innerWidth;});
  if(!fit)throw Error('Material gallery layout in '+theme);checks.push('The centered gallery scrolls correctly in '+theme+' at the minimum window size');
  await fs.writeFile(path.join(root,'.test-output/title-material-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
  await win.page.evaluate(()=>document.querySelector('.title-material-library').close());
 }
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
 await fs.writeFile(path.join(root,'.test-output/title-materials-report.json'),JSON.stringify({passed:true,checks,catalogResult},null,2));console.log(JSON.stringify({passed:checks.length,checks,catalogResult}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
