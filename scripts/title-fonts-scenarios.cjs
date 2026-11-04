const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
 await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title',name:'Font geometry QA'}});await settle(win);
 const result=await win.page.evaluate(async()=>{
  const editor=mollyEditor.titleEditor,project=mollyEditor.getActiveProject();await project.prefixLoadPromise;
  const {TITLE_FONT_CATALOG}=await import(new URL('js/core/TitleFontCatalog.mjs',location.href));
  const checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const options=[...editor.panel.querySelector('[data-title-field="font"]').options];
  expect(options.length===11&&options.every(option=>TITLE_FONT_CATALOG[option.value]&&!option.value.endsWith('cyrillic')),'The English inspector lists only the 11 native English fonts');
  const gallery=document.createElement('canvas');gallery.width=1280;gallery.height=Object.keys(TITLE_FONT_CATALOG).length*190;
  const ctx=gallery.getContext('2d');ctx.fillStyle='#17191D';ctx.fillRect(0,0,gallery.width,gallery.height);
  let row=0;
  for(const [font,entry] of Object.entries(TITLE_FONT_CATALOG)){
   const text=font.endsWith('cyrillic')?'ПРИВЕТ МИР':'MINECRAFT',textInput=editor.panel.querySelector('[data-title-field="text"]');
   textInput.value=text;textInput.dispatchEvent(new Event('input',{bubbles:true}));textInput.dispatchEvent(new Event('change',{bubbles:true}));
   for(let i=0;editor.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));
   const input=editor.panel.querySelector('[data-title-field="font"]');
   input.value=font;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
   for(let i=0;editor.loading&&i<500;i++)await new Promise(resolve=>setTimeout(resolve,20));
   expect(project.titleData.font===font,'Inspector selects and retains '+font);
   const value={font,text,layout:'stacked',resolution:1024,texture:'none',pitch:-22,yaw:8};await editor.renderer.loadFor(value);const output=editor.renderer.render(value);
   const pixels=output.canvas.getContext('2d').getImageData(0,0,output.canvas.width,output.canvas.height).data;
   expect(!output.missing.length&&pixels.some((v,i)=>i%4===3&&v>0),'The actual '+font+' models render to transparent PNG');
   const y=row++*190;ctx.fillStyle='#DBDFE6';ctx.font='18px sans-serif';ctx.fillText(entry.name,24,y+26);
   const scale=Math.min(1200/output.canvas.width,145/output.canvas.height);ctx.drawImage(output.canvas,(gallery.width-output.canvas.width*scale)/2,y+35,output.canvas.width*scale,output.canvas.height*scale);
   output.canvas.width=output.canvas.height=1;
  }
  expect(mollyEditor.history.undo()&&mollyEditor.getActiveProject().titleData.font==='minecraft-sga','Undo restores the previous model font');
  expect(mollyEditor.history.redo()&&mollyEditor.getActiveProject().titleData.font==='block-serif','Redo restores Block Serif and its model parameters');
  expect(await mollyEditor.projectManager.saveProjectAs(),'The newly added model font saves through the native MLST flow');
  const active=mollyEditor.getActiveProject(),saved=JSON.parse(await desktopAPI.readFile(active.filePath)),before=active.layers[0].canvas.toDataURL();
  await mollyEditor.projectManager.deserializeProject(saved,active.filePath);await mollyEditor.getActiveProject().prefixLoadPromise;
  expect(mollyEditor.getActiveProject().titleData.font==='block-serif'&&mollyEditor.getActiveProject().layers[0].canvas.toDataURL()===before,'Reopening MLST preserves Block Serif and the exact rendered image');
  for(const [font,entry] of Object.entries(TITLE_FONT_CATALOG))if(entry.materials.length>1){
   const args={font,text:font.endsWith('cyrillic')?'БАР':'ARC',creeperA:false,texture:'none',resolution:1024,yaw:28,pitch:-26};
   await editor.renderer.loadFor(args);
   const first=editor.renderer.render(args),reference=first.canvas.getContext('2d').getImageData(0,0,first.canvas.width,first.canvas.height).data;first.canvas.width=first.canvas.height=1;
   for(const texture of entry.materials.filter(value=>value!=='none')){
    if(!['stone','gold'].includes(texture))continue;
    await editor.renderer.loadFor({...args,texture});
    const output=editor.renderer.render({...args,texture}),pixels=output.canvas.getContext('2d').getImageData(0,0,output.canvas.width,output.canvas.height).data;
    let intersection=0,union=0;
    for(let i=3;i<pixels.length;i+=4){const a=pixels[i]>32,b=reference[i]>32;if(a||b)union++;if(a&&b)intersection++;}
    expect(pixels.length===reference.length&&intersection/union>.99,font+'/'+texture+' retains the reference model silhouette ('+(intersection/union).toFixed(4)+')');
    output.canvas.width=output.canvas.height=1;
   }
  }
  const renderer=editor.renderer.exportRenderer,gl=renderer.gl;
  expect([...renderer.textures.values()].every(texture=>{gl.bindTexture(gl.TEXTURE_2D,texture);return gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER)===gl.NEAREST&&gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER)===gl.NEAREST;}),'Every atlas uses nearest texel sampling for both magnification and minification');
  expect(gl.getContextAttributes().antialias,'3D silhouettes keep hardware antialiasing');
  const views=[];
  for(const [yaw,pitch] of [[0,0],[25,-28],[-35,30],[110,-20],[180,0]]){
   const output=editor.renderer.render({text:'A R E C M',creeperA:false,texture:'stone',resolution:2048,yaw,pitch});
   views.push({yaw,pitch,png:output.canvas.toDataURL()});output.canvas.width=output.canvas.height=1;
  }
  editor.change(data=>Object.assign(data,{font:'minecraft-ten',text:'MINECRAFT',texture:'stone'}));
  return {checks,gallery:gallery.toDataURL(),views};
 });
 await fs.writeFile(path.join(root,'.test-output/title-all-fonts.png'),Buffer.from(result.gallery.split(',')[1],'base64'));
 for(const [i,view] of result.views.entries())await fs.writeFile(path.join(root,'.test-output/title-geometry-'+i+'.png'),Buffer.from(view.png.split(',')[1],'base64'));
 if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
 await fs.writeFile(path.join(root,'.test-output/title-fonts-report.json'),JSON.stringify({passed:true,checks:result.checks},null,2));
 console.log(JSON.stringify({passed:result.checks.length,checks:result.checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
