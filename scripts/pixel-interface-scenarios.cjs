const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{PNG}=require('pngjs');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[],output=path.join(root,'.test-output/pixel-interface'),timer=setTimeout(()=>app.exit(1),180000);try{
    await ready();await fs.mkdir(output,{recursive:true});win=makeWindow(1280,900);
    await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'20',height:'12'}});
    await win.showInactive();await settle(win);
    await win.page.evaluate(()=>{
        const a=mollyEditor;a.settingsManager.set('animationsEnabled',false);
        const layer=a.layerManager.addLayer('Pixel fixture');layer.ctx.fillStyle='#FF0000';layer.ctx.fillRect(0,0,20,12);layer.ctx.fillStyle='#0000FF';layer.ctx.fillRect(10,0,10,12);layer.invalidateSource();a.bus.emit('CANVAS_UPDATED');
    });
    for(const zoom of [1,1.25,1.5,1.75,2]){
        win.webContents.setZoomFactor(zoom);await settle(win);
        await win.page.evaluate(async()=>{await mollyEditor.exportPanel.open();});await settle(win);
        await win.page.locator('[data-export="canvas"]').scrollIntoViewIfNeeded();await settle(win);
        const result=await win.page.evaluate(()=>{
            const c=mollyEditor.exportPanel.get('canvas'),r=c.getBoundingClientRect(),ratio=devicePixelRatio;
            if(Math.abs(r.width*ratio-c.width)>.05||Math.abs(r.height*ratio-c.height)>.05)throw Error('Export preview is resampled again by CSS');
            if(Math.abs(r.left*ratio-Math.round(r.left*ratio))>.05||Math.abs(r.top*ratio-Math.round(r.top*ratio))>.05)throw Error('Export preview is off the physical pixel grid');
            if(c.width%20||c.height%12)throw Error('An enlarged bitmap has inconsistent pixel widths');
            return {x:r.left,y:r.top,width:r.width,height:r.height};
        });
        const shot=await win.page.screenshot({clip:result,timeout:10000}),png=PNG.sync.read(shot);let foreign=0;
        for(let y=1;y<png.height-1;y++)for(let x=1;x<png.width-1;x++){
            const i=(y*png.width+x)*4;if(png.data[i+3]!==255||!((png.data[i]===255&&png.data[i+1]===0&&png.data[i+2]===0)||(png.data[i]===0&&png.data[i+1]===0&&png.data[i+2]===255)))foreign++;
        }
        if(foreign){await fs.writeFile(path.join(output,'failure-'+zoom+'.png'),shot);throw Error('Compositor introduced '+foreign+' blended pixels at '+zoom+' '+JSON.stringify(result));}
        await fs.writeFile(path.join(output,'export-'+zoom+'.png'),shot);checks.push('Export has only source colors at '+zoom*100+'%');
        console.log('Pixel colors checked at '+zoom);
        await win.page.evaluate(()=>{mollyEditor.exportPanel.close();mollyEditor.texturePanel.open();});await settle(win);
        await win.page.evaluate(()=>{
            const c=document.querySelector('[data-texture-preview]'),r=c.getBoundingClientRect();
            if(Math.abs(r.width*devicePixelRatio-c.width)>.05||Math.abs(r.height*devicePixelRatio-c.height)>.05)throw Error('Texture preview has a second CSS resize');
            if(c.width%20||c.height%12)throw Error('Texture preview has uneven pixel sizes');mollyEditor.texturePanel.dialog.close();
        });checks.push('Texture preview uses an exact physical buffer at '+zoom*100+'%');
    }
    await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'20',height:'600'}});await settle(win);
    win.webContents.setZoomFactor(2);
    for(const theme of ['dark','minecraft']){
        await win.page.evaluate(async theme=>{mollyEditor.settingsManager.set('theme',theme);await mollyEditor.exportPanel.open();},theme);await settle(win);
        await win.page.evaluate(()=>{
            const c=mollyEditor.exportPanel.get('canvas').getBoundingClientRect(),box=document.querySelector('.export-image-box'),b=box.getBoundingClientRect(),s=getComputedStyle(box),tolerance=.6/devicePixelRatio;
            if(c.top<b.top+parseFloat(s.borderTopWidth)+parseFloat(s.paddingTop)-tolerance||c.bottom>b.bottom-parseFloat(s.borderBottomWidth)-parseFloat(s.paddingBottom)+tolerance)throw Error('Tall export preview is clipped by its frame');
            mollyEditor.exportPanel.close();
        });checks.push('Tall export retains all pixels in the compact '+theme+' frame');
    }
    win.webContents.setZoomFactor(1);await win.page.evaluate(()=>{
        const a=mollyEditor,l=a.layerManager.addTextLayer('Fonts',{text:'ABC',fontId:'minecraft',x:1,y:1});a.tools.tools.text.renderTextLayer(l);a.tools.setTool('text');a.syncPropertiesPanel();
    });
    for(const zoom of [1,1.25,1.5,1.75,2]){
        win.webContents.setZoomFactor(zoom);await settle(win);
        await win.page.waitForFunction(()=>document.querySelectorAll('#prop-group-text .bitmap-font-sample').length===4);
        await win.page.locator('#prop-group-text .bitmap-font-choices').scrollIntoViewIfNeeded();
        await win.page.evaluate(()=>{
            for(let p=document.querySelector('#prop-group-text .bitmap-font-choices').parentElement;p;p=p.parentElement){
                if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight){p.scrollTop+=1.6;break;}
            }
        });await settle(win);
        await win.page.evaluate(()=>{
            for(const c of document.querySelectorAll('#prop-group-text .bitmap-font-sample')){
                const r=c.getBoundingClientRect();if(Math.abs(r.width*devicePixelRatio-c.width)>.05||Math.abs(r.height*devicePixelRatio-c.height)>.05)throw Error('Font sample is rescaled by CSS');
                if(Math.abs(r.left*devicePixelRatio-Math.round(r.left*devicePixelRatio))>.05||Math.abs(r.top*devicePixelRatio-Math.round(r.top*devicePixelRatio))>.05)throw Error('Scrolling moved a font sample off the physical pixel grid');
                const button=c.closest('button').getBoundingClientRect();if(r.left<button.left||r.right>button.right+.1)throw Error('Font sample exceeds its button');
            }
        });checks.push('All font samples fit without CSS resampling at '+zoom*100+'%');
    }
    await win.loadFile(path.join(root,'src/renderer/buttons.html'));await settle(win);
    for(const [width,height,zoom] of [[1280,900,1],[1000,700,1.25],[800,600,1.5],[1280,900,2]]){
        win.setContentSize(width,height);win.webContents.setZoomFactor(zoom);await settle(win);
        await win.page.evaluate(()=>{
            const c=buttonGenApp.canvas,r=c.getBoundingClientRect(),s=document.querySelector('.canvas-stage').getBoundingClientRect();
            if(r.left<s.left-1||r.top<s.top-1||r.right>s.right+1||r.bottom>s.bottom+1)throw Error('Fitted generator preview is clipped');
            if(Math.abs(r.width*devicePixelRatio-c.width)>.05||Math.abs(r.height*devicePixelRatio-c.height)>.05)throw Error('Generator preview has a second CSS resize');
            if(buttonGenApp.mcGuiLoaded){
                const reference=document.createElement('canvas');reference.width=176;reference.height=222;const ctx=reference.getContext('2d');ctx.drawImage(buttonGenApp.mcGuiImg,0,0,176,222,0,0,176,222);
                const original=ctx.getImageData(0,0,176,222).data,result=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                // The PNG is a 256px atlas. Its unused margins must not be scaled into the GUI.
                for(let y=Math.floor(c.height*.6);y<c.height;y+=7)for(let x=0;x<c.width;x+=7){
                    const source=(Math.min(221,Math.floor((y+.5)*222/c.height))*176+Math.min(175,Math.floor((x+.5)*176/c.width)))*4,target=(y*c.width+x)*4;
                    for(let channel=0;channel<4;channel++)if(original[source+channel]!==result[target+channel])throw Error('The GUI atlas was stretched instead of cropped');
                }
            }
        });checks.push('Generator preview stays crisp and fully visible at '+zoom*100+'%');
    }
    await fs.writeFile(path.join(output,'buttons-compact.png'),(await win.webContents.capturePage()).toPNG());
    assert.deepEqual(win.__testErrors,[]);await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
