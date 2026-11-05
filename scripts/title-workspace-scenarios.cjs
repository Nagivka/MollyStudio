const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Title workspace QA'}});await settle(win);
 const checks=await win.page.evaluate(async()=>{
  const a=mollyEditor,e=a.titleEditor;await a.getActiveProject().prefixLoadPromise;
  const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},data=()=>a.getActiveProject().titleData;
  const wait=async()=>{for(let i=0;e.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));if(e.loading)throw Error('Load timeout');};
  const field=async(selector,value)=>{const input=e.panel.querySelector(selector);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait();};
  expect(e.panel.querySelector('.title-inspector-header').contains(e.panel.querySelector('[data-title-row]')),'The row scope stays with the inspector tabs');
  expect(e.panel.querySelector('[data-title-field="text"]').closest('.title-control-group').querySelector('.title-row-languages'),'Text and its row languages share one clearly labelled group');
  expect(e.panel.querySelector('[data-title-field="font"]').closest('.title-control-group').querySelector('[data-title-choice="font"]'),'The font choice has a real native visual preview');
  expect(!e.panel.querySelector('[data-title-row]').checkVisibility(),'A single row starts with the text controls and no redundant edit scope');
  expect(e.panel.querySelector('[data-title-field="depth"]').checkVisibility()&&e.panel.querySelector('[data-title-field="font"]').checkVisibility(),'Font and letter depth are available without opening advanced settings');
  expect([...e.panel.querySelectorAll('details')].every(details=>!details.open),'Advanced controls start collapsed');
  const header=e.panel.querySelector('.title-inspector-header'),body=e.panel.querySelector('.title-inspector-body'),top=header.getBoundingClientRect().top;body.scrollTop=body.scrollHeight;
  expect(header.getBoundingClientRect().top===top&&e.panel.scrollTop===0,'Only the settings content scrolls; tabs and row choice stay visible');body.scrollTop=0;
  expect(!document.querySelector('[data-title-shapes]')&&!Object.hasOwn(data(),'shapes'),'Decorative objects and their toolbar control are removed');
  e.change(value=>{value.text='MINECRAFT\nMOLLY';});await wait();
  expect(e.panel.querySelector('[data-title-row]').checkVisibility(),'Multiple rows expose their shared edit scope');
  await field('[data-title-row]',0);await field('[data-title-field="font"]','minecraft-five-bold');
  const firstSpacing=data().rows[0].spacing;
  await field('[data-title-row]',-1);
  expect(e.panel.querySelector('[data-title-field="font"]').value===data().font,'Whole-title mode displays shared defaults independently of the first-row override');
  await field('[data-title-field="spacing"]',3);
  expect(data().spacing===3&&data().rows[0].spacing===firstSpacing,'Editing shared spacing preserves a deliberately customized row');
  const depth=e.panel.querySelector('[data-title-field="depth"]'),savedDepth=data().depth;
  depth.focus();depth.value='999';depth.dispatchEvent(new Event('input',{bubbles:true}));
  depth.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  expect(depth.value===String(savedDepth)&&!e.panel.querySelector('[aria-invalid="true"]'),'Escape restores an invalid draft without trapping navigation');
  await field('[data-title-row]',1);await field('[data-title-field="font"]','minecraft-five-bold');
  expect(data().rows[1].font==='minecraft-five-bold'&&data().font==='minecraft-ten','The selected row retains its own native font');
  const letter=e.renderer.mesh.nodes.find(node=>node.type==='glyph'&&node.row===1);e.viewport.select(letter.id);
  expect(!e.panel.querySelector('.title-transform-fields').hidden,'A selected letter exposes position, rotation and scale');
  expect(!e.panel.querySelector('[data-title-row]').checkVisibility(),'Scene controls use the selected object instead of an unrelated text scope');
  e.panel.querySelector('[data-title-edit-selection]').click();expect(e.currentRow===1&&!e.panel.querySelector('.title-material-panel').hidden,'The scene action opens the appearance of the selected text row');
  expect(e.panel.querySelector('[data-title-preset]').getBoundingClientRect().top<e.panel.querySelector('[data-title-appearance="source"]').getBoundingClientRect().top,'Ready-made styles appear before detailed material controls');
  await field('[data-title-appearance="source"]','gradient');
  expect(e.panel.querySelector('.title-gradient-stops').checkVisibility(),'Choosing a gradient reveals its colors immediately');
  await field('[data-title-appearance="source"]','texture');
  await field('[data-title-field="texture"]','gold');expect(data().rows[1].texture==='gold','Row materials remain editable');
  expect(await a.projectManager.saveProjectAs(),'The text-only scene saves to MLST');
  const p=a.getActiveProject(),saved=JSON.parse(await desktopAPI.readFile(p.filePath)),before=JSON.stringify(p.titleData);
  await a.projectManager.deserializeProject(saved,p.filePath);await a.getActiveProject().prefixLoadPromise;
  expect(JSON.stringify(data())===before,'Reopening restores the complete editable text document');
  // Old project files remain readable, but removed objects cannot reappear.
  saved.titleData.shapes=[{id:'shape-old',kind:'heart'}];saved.titleData.transforms['shape-old']={position:[8,2,1]};
  await a.projectManager.deserializeProject(saved,p.filePath);await a.getActiveProject().prefixLoadPromise;
  expect(JSON.stringify(data())===before&&!Object.hasOwn(data(),'shapes'),'Opening a legacy file keeps text and drops removed decorative objects');
  expect(e.renderer.mesh.nodes.every(node=>node.id.startsWith('row-')),'The live scene contains only text models');
  expect([...e.panel.querySelector('[data-title-row]').options].every(option=>Number.isInteger(Number(option.value))),'The edit scope contains only the whole title and its rows');
  expect(await e.exportModel(),'The text scene exports into a self-contained BBModel');
  e.setTab('material');body.scrollTop=body.scrollHeight;e.setTab('settings');
  expect(body.scrollTop===0,'Changing inspector tabs starts at the top of the new section');
  return checks;
 });
 for(const theme of ['dark','light','minecraft','light-minecraft']){
  await win.page.evaluate(theme=>mollyEditor.settingsManager.set('theme',theme),theme);
  for(const size of [[1000,700],[1280,900],[1920,1080]])for(const tab of ['settings','material','scene']){
   win.setContentSize(...size);await win.page.evaluate(tab=>mollyEditor.titleEditor.setTab(tab),tab);await settle(win);
   const layout=await win.page.evaluate(()=>{const panel=document.querySelector('#title-editor'),header=panel.querySelector('.title-inspector-header'),body=panel.querySelector('.title-inspector-body'),p=panel.getBoundingClientRect(),h=header.getBoundingClientRect(),b=body.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,panel:p.width,content:b.height,header:h.bottom<=b.top+1,offscreen:p.right>innerWidth+1};});
   if(layout.overflow||layout.offscreen||layout.panel<272||layout.content<120||!layout.header)throw Error('Workspace layout '+theme+' '+size+' '+tab+': '+JSON.stringify(layout));
   checks.push(theme+' '+size.join('x')+' '+tab+': header and settings fit without page overflow');
   if(size[0]===1280)await fs.writeFile(path.join(root,'.test-output/title-workspace-'+theme+'-'+tab+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));await fs.writeFile(path.join(root,'.test-output/title-workspace-report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
