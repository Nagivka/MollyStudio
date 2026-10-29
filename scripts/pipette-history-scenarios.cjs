const fs=require('node:fs/promises'),path=require('node:path');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');
(async()=>{let win;const checks=[],timer=setTimeout(()=>app.exit(1),60000);
try{
    await ready();win=makeWindow(1100,800);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Pipette'}});await win.showInactive();await settle(win);
    checks.push(...await win.page.evaluate(async()=>{
        const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);},e=mollyEditor,p=e.tools.tools.pipette,c=e.colorPicker;
        const layer=e.layerManager.addLayer('Colors');layer.ctx.fillStyle='#FF0000';layer.ctx.fillRect(0,0,1,1);layer.ctx.fillStyle='rgba(0,0,255,.5)';layer.ctx.fillRect(1,0,1,1);layer.invalidateSource();
        e.tools.setTool('pipette');document.querySelector('#pipette-source').value='layer';
        const event={clientX:innerWidth-2,clientY:innerHeight-2};p.onHoverMove(0,0,event);
        check(!p.loupe.hidden&&p.loupeLabel.textContent.includes('#FF0000')&&p.loupeLabel.textContent.includes('X: 0, Y: 0'),'Loupe shows the source color and exact pixel coordinates');
        let r=p.loupe.getBoundingClientRect();check(r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,'Loupe stays inside the window near its corner');
        const before=layer.canvas.toDataURL();p.onHoverMove(4,4,event);check(p.loupeLabel.textContent.includes('Прозрачный'),'Transparent pixels are identified without sampling an invisible color');
        document.querySelector('#pipette-sample').value='3x3';p.onHoverMove(0,0,event);check(p.loupeLabel.textContent.includes('#AA0055')&&p.loupeLabel.textContent.includes('3×3'),'Edge samples use the same alpha-weighted clipped average as the actual eyedropper');
        check(layer.canvas.toDataURL()===before,'Loupe never changes canvas or exported pixels');
        c.history=[];p.onPointerDown(0,0,null,null,null,event);p.onPointerMove(1,0,null,null,null,event);check(!c.history.length,'Dragging does not flood history with intermediate samples');p.onPointerUp(0,0);check(c.history[0]==='#AA0055','The final sampled color enters history once');
        document.querySelector('.history-color-pin').click();check(c.pinnedColors.includes('#AA0055'),'Color can be pinned using its visible button');
        for(let i=0;i<30;i++)c.addToHistory('#'+i.toString(16).padStart(6,'0'));check(c.history.length===24&&c.pinnedColors.includes('#AA0055'),'History stays bounded while retaining pinned colors');
        document.querySelector('#btn-clear-color-history').click();check(!c.history.length&&document.querySelectorAll('.history-slot').length===1,'Clearing recent colors preserves pinned colors');
        check(JSON.parse(localStorage.getItem('molly_color_history')).pinned.includes('#AA0055'),'Pinned colors are persisted for restart');
        for(const theme of ['dark','light','minecraft','light-minecraft']){e.settingsManager.set('theme',theme);p.onHoverMove(0,0,event);check(!p.loupe.hidden&&getComputedStyle(p.loupe).pointerEvents==='none',theme+': loupe is visible and never intercepts input');}
        e.tools.setTool('brush');check(p.loupe.hidden,'Switching tools hides the loupe');
        for(const size of [2,3,6,15,31]){
            layer.ctx.clearRect(0,0,32,32);e.tools.tools.pencil.drawStamp(layer.ctx,16,16,'#FFFFFF',size);
            const start=16-Math.floor(size/2),pixels=layer.ctx.getImageData(start,start,size,size).data;
            check(Array.from({length:size*size},(_,i)=>{const x=i%size,y=Math.floor(i/size),a=pixels[i*4+3];return (a===0||a===255)&&a===pixels[(y*size+size-1-x)*4+3]&&a===pixels[(x*size+y)*4+3];}).every(Boolean),'Pencil '+size+'px renders a symmetric hard-edged circle in native Canvas');
        }
        return checks;
    }));
    await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'32',height:'32',name:'Reload'}});await settle(win);
    if(!await win.page.evaluate(()=>mollyEditor.colorPicker.pinnedColors.includes('#AA0055')))throw Error('Pinned color lost after reopening');checks.push('Pinned colors survive a real renderer reload');
    if(win.__testErrors.length)throw Error(win.__testErrors.join('\n'));
    await fs.writeFile(path.join(root,'.test-output/pipette-history-report.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{clearTimeout(timer);win?.destroy();app.exit(process.exitCode||0);}})();
