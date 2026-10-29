const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {app,root,ready,makeWindow,settle}=require('./lib/electron-harness.cjs');

(async()=>{
    let win;const checks=[],watchdog=setTimeout(()=>app.exit(1),120000);
    const check=(value,message)=>{assert.ok(value,message);checks.push(message);console.log('PASS '+message);};
    try{
        await ready();win=makeWindow(1280,900);
        await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'256',height:'192',name:'Overlapping objects'}});
        await win.showInactive();const page=win.page;
        const fixture=async(tool='move',zoom=3)=>{
            await page.evaluate(({tool,zoom})=>{
                const e=mollyEditor;e.tools.cancelPointer();e.tools.finishDocument();
                e.addProject('Overlap '+tool+' '+zoom,'none',256,192,false,'canvas');
                e.settingsManager.set('animationsEnabled',false);e.tools.setTool(tool);
                document.getElementById('move-autosel').checked=true;document.getElementById('move-snap').checked=false;
                const paint=(name,x,y,w,h,color)=>{const l=e.layerManager.addLayer(name);l.ctx.fillStyle=color;l.ctx.fillRect(x,y,w,h);l.invalidateSource();return l;};
                const back=paint('Background',20,20,160,110,'#335577'),front=paint('Foreground',70,60,20,18,'#ff8822');
                window.pickFixture={back:back.id,front:front.id};
                e.layerManager.setActive(back.id);e.history.clear();
                const w=e.workspace;w.autoFitOnResize=false;w.zoom=zoom;
                w.panX=w.workspace.clientWidth/2-80*zoom;w.panY=w.workspace.clientHeight/2-69*zoom;w.updateTransform();
                window.backPixels=back.canvas.toDataURL();window.frontPixels=front.canvas.toDataURL();
            },{tool,zoom});await settle(win);
        };
        const position=(x,y)=>page.evaluate(({x,y})=>{const r=document.getElementById('main-canvas').getBoundingClientRect();return {x:r.left+x*r.width/mollyEditor.config.width,y:r.top+y*r.height/mollyEditor.config.height};},{x,y});
        const click=async(x,y)=>{const p=await position(x,y);await page.mouse.click(p.x,p.y);};
        const drag=async(x,y,dx,dy)=>{const a=await position(x,y),b=await position(x+dx,y+dy);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();};
        const active=()=>page.evaluate(()=>mollyEditor.layerManager.activeLayerId);
        await fixture();
        checks.push(...await page.evaluate(()=>{
            const e=mollyEditor,m=e.tools.tools.move,manager=e.layerManager,checks=[],expect=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
            const back=manager.layers.find(l=>l.id===pickFixture.back),front=manager.layers.find(l=>l.id===pickFixture.front),id=manager.activeLayerId;
            const before=JSON.stringify(e.projectManager.serializeProject());m.onHoverMove(80,69,{});
            expect(m.hoverTarget===front&&!!e.workspace.hoverOverlay.callback,'Hover highlights the foreground object that a click will select');
            expect(manager.activeLayerId===id&&!e.history.undoStack.length&&before===JSON.stringify(e.projectManager.serializeProject()),'Hover changes no active layer, history or project pixels');
            manager.setActive(front.id);m.onHoverMove(80,69,{altKey:true});expect(m.hoverTarget===back,'Alt hover previews the next covered object');
            front.ctx.clearRect(75,65,5,5);front.invalidateSource();m.onHoverMove(77,67,{});expect(m.hoverTarget===back,'Hover through transparent pixels reaches the object underneath');
            front.locked=true;m.onHoverMove(80,69,{});expect(m.hoverTarget===back,'Locked foreground objects do not capture hover');front.locked=false;
            document.getElementById('move-autosel').checked=false;manager.setActive(back.id);m.onHoverMove(80,69,{});expect(m.hoverTarget===back,'Hover respects disabled auto-selection');
            e.tools.setTool('brush');expect(!m.hoverTarget&&!e.workspace.hoverOverlay.callback,'Changing tools clears the hover overlay');
            for(const filled of [false,true])for(const radius of [1,4,12]){
                const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');
                e.tools.tools['rect-filled'].drawRect(ctx,10,10,48,40,'#123456',3,filled,radius);
                const pixels=ctx.getImageData(10,10,39,31).data;
                expect(pixels.every((v,i)=>i%4!==3||v===0||v===255),`${filled?'Filled':'Outline'} rounded rectangle radius ${radius} has no antialiased pixels`);
                expect(ctx.getImageData(29,25,1,1).data[3]===(filled?255:0),'Rounded rectangle preserves the requested fill or hollow centre');
            }
            return checks;
        }));
        for(const tool of ['move','transform'])for(const zoom of [.5,1,3,8]){
            await fixture(tool,zoom);await click(80,69);
            check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.front),`${tool} ${zoom}x: clicking inside the selected background chooses the foreground object`);
            check(await page.evaluate(()=>{
                const e=mollyEditor,b=e.layerManager.layers.find(l=>l.id===pickFixture.back),f=e.layerManager.getActiveLayer();
                return !e.history.undoStack.length&&!b.sourceCanvas&&!f.sourceCanvas&&b.canvas.toDataURL()===backPixels&&f.canvas.toDataURL()===frontPixels;
            }),`${tool} ${zoom}x: selection alone changes no pixels, master source or undo history`);
            await page.evaluate(()=>mollyEditor.layerManager.setActive(pickFixture.back));await drag(80,69,6,4);
            check(await page.evaluate(()=>{
                const e=mollyEditor,f=e.layerManager.layers.find(l=>l.id===pickFixture.front),b=e.layerManager.layers.find(l=>l.id===pickFixture.back);
                return e.layerManager.activeLayerId===f.id&&f.sourceRect?.x===76&&f.sourceRect?.y===64&&f.sourceRect.w===20&&f.sourceRect.h===18&&b.canvas.toDataURL()===backPixels;
            }),`${tool} ${zoom}x: the first drag moves only the picked foreground object`);
            await page.locator('#btn-undo').click();
            check(await page.evaluate(()=>mollyEditor.layerManager.layers.find(l=>l.id===pickFixture.front).canvas.toDataURL()===frontPixels),`${tool} ${zoom}x: one undo restores the foreground pixels`);
        }
        await fixture();
        await page.evaluate(()=>{
            const e=mollyEditor,f=e.layerManager.layers.find(l=>l.id===pickFixture.front);f.ctx.clearRect(0,0,256,192);f.ctx.fillRect(94,89,3,3);f.invalidateSource();e.bus.emit('CANVAS_UPDATED');
        });await drag(94.2,89.2,5,2);
        check(await page.evaluate(()=>{
            const f=mollyEditor.layerManager.getActiveLayer();return f.id===pickFixture.front&&f.sourceRect.x===99&&f.sourceRect.y===91&&f.sourceRect.w===3&&f.sourceRect.h===3;
        }),'Selecting a tiny object near its new corner starts moving, without an accidental resize');

        await fixture();
        await page.evaluate(()=>{
            const e=mollyEditor,f=e.layerManager.layers.find(l=>l.id===pickFixture.front);f.ctx.clearRect(72,63,12,12);f.invalidateSource();e.layerManager.setActive(f.id);
        });await click(75,68);
        check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.back),'Clicking a transparent hole selects the object underneath');
        await fixture();await page.evaluate(()=>document.getElementById('move-autosel').checked=false);await drag(80,69,6,4);
        check(await page.evaluate(()=>{
            const e=mollyEditor,b=e.layerManager.layers.find(l=>l.id===pickFixture.back),f=e.layerManager.layers.find(l=>l.id===pickFixture.front);
            return e.layerManager.activeLayerId===b.id&&b.sourceRect?.x===26&&f.canvas.toDataURL()===frontPixels;
        }),'Turning auto-select off preserves deliberate editing of a covered background');

        for(const flag of ['locked','visible','opacity']){
            await fixture();await page.evaluate(flag=>{
                const e=mollyEditor,f=e.layerManager.layers.find(l=>l.id===pickFixture.front);f[flag]=flag==='locked'?true:flag==='visible'?false:0;
                const other=e.layerManager.addLayer('Other');other.ctx.fillRect(200,150,10,10);other.invalidateSource();
            },flag);await click(80,69);
            check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.back),`A foreground layer excluded by ${flag} cannot steal the pick`);
        }
        await fixture();await page.evaluate(()=>{
            const e=mollyEditor,m=e.layerManager,group=m.addGroup('Lower group'),upper=m.addLayer('Upper root');
            upper.ctx.fillStyle='#22ff66';upper.ctx.fillRect(70,60,20,18);upper.invalidateSource();
            const inner=m.addGroup('Nested group');inner.groupId=group.id;const child=m.addLayer('Late child');child.groupId=inner.id;
            child.ctx.fillStyle='#ff22aa';child.ctx.fillRect(70,60,20,18);child.invalidateSource();
            window.pickFixture.upper=upper.id;m.setActive(pickFixture.back);e.renderer.render();
        });await click(80,69);
        check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.upper),'Nested group picking follows visible stacking even when its children occur later in the array');

        await fixture();await page.evaluate(()=>{
            const e=mollyEditor,m=e.layerManager,group=m.addGroup('Selected group'),child=m.layers.find(l=>l.id===pickFixture.front);
            child.groupId=group.id;window.pickFixture.group=group.id;m.setActive(group.id);
        });await drag(80,69,6,4);
        check(await page.evaluate(()=>{
            const e=mollyEditor,f=e.layerManager.layers.find(l=>l.id===pickFixture.front);return e.layerManager.activeLayerId===pickFixture.group&&f.sourceRect?.x===76;
        }),'Dragging a selected group through one of its children preserves the group selection');

        await fixture();await page.evaluate(()=>{
            const m=mollyEditor.layerManager;m.selectedLayerIds=new Set([pickFixture.back,pickFixture.front]);m.activeLayerId=pickFixture.back;m.bus.emit('LAYER_ACTIVE_CHANGED',m.getActiveLayer());
        });await drag(80,69,6,4);
        check(await page.evaluate(()=>{
            const m=mollyEditor.layerManager,b=m.layers.find(l=>l.id===pickFixture.back),f=m.layers.find(l=>l.id===pickFixture.front);
            return m.selectedLayerIds.size===2&&b.sourceRect?.x===26&&f.sourceRect?.x===76;
        }),'Overlapping members of a multi-selection still move together');

        await fixture();const handle=await page.evaluate(()=>mollyEditor.tools.tools.move.getHandles(mollyEditor.tools.tools.move.currentBox).find(h=>h.id==='se'));
        await drag(handle.x,handle.y,6,4);
        check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.back&&mollyEditor.layerManager.getActiveLayer().sourceRect.w>160),'An existing visible transform handle still resizes the selected object');
        await fixture();await page.evaluate(()=>{
            const m=mollyEditor.layerManager,front=m.layers.find(layer=>layer.id===pickFixture.front);
            front.ctx.clearRect(0,0,256,192);front.ctx.fillRect(175,125,15,15);front.invalidateSource();m.bus.emit('CANVAS_UPDATED');
        });await click(180,130);
        check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.front),'A foreground object over a background transform handle receives the click');
        for(const tool of ['move','transform']){
            await fixture(tool);await click(80,69);await page.keyboard.down('Alt');await click(80,69);await page.keyboard.up('Alt');
            check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.back),`${tool}: Alt-click reaches an object fully covered by the foreground`);
            await page.keyboard.down('Alt');await click(80,69);await page.keyboard.up('Alt');
            check(await page.evaluate(()=>mollyEditor.layerManager.activeLayerId===pickFixture.front),`${tool}: repeated Alt-click cycles back through the painted stack`);
            await page.keyboard.press('Delete');
            check(await page.evaluate(()=>!mollyEditor.layerManager.layers.some(layer=>layer.id===pickFixture.front)&&!mollyEditor.layerPanel.layerElements.has(pickFixture.front)),`${tool}: Delete removes the object and its layer row`);
            await page.locator('#btn-undo').click();
            check(await page.evaluate(()=>mollyEditor.layerManager.layers.some(layer=>layer.id===pickFixture.front)&&mollyEditor.layerPanel.layerElements.has(pickFixture.front)),`${tool}: undo restores the deleted object and layer row`);
        }
        await fixture();await page.evaluate(()=>{
            const m=mollyEditor.layerManager;m.selectedLayerIds=new Set([pickFixture.back,pickFixture.front]);m.activeLayerId=pickFixture.front;m.bus.emit('LAYER_ACTIVE_CHANGED',m.getActiveLayer());
        });await page.keyboard.press('Delete');
        check(await page.evaluate(()=>!mollyEditor.layerManager.layers.some(layer=>[pickFixture.back,pickFixture.front].includes(layer.id))),'Delete removes every selected editable object');
        await page.locator('#btn-undo').click();
        check(await page.evaluate(()=>[pickFixture.back,pickFixture.front].every(id=>mollyEditor.layerManager.layers.some(layer=>layer.id===id))),'A single undo restores a multiple-object deletion');
        for(const [tool,zoom] of [['move',.5],['move',3],['transform',3],['transform',8]])for(const direction of ['right','left','top','bottom']){
            await fixture(tool,zoom);
            const points=await page.evaluate(direction=>{
                const w=mollyEditor.workspace,c=w.canvas.getBoundingClientRect(),r=w.getDragViewport();
                return {start:{x:c.left+80*w.zoom,y:c.top+69*w.zoom},edge:{x:direction==='left'?r.left+3:direction==='right'?r.right-3:(r.left+r.right)/2,y:direction==='top'?r.top+3:direction==='bottom'?r.bottom-3:(r.top+r.bottom)/2}};
            },direction);
            await page.mouse.move(points.start.x,points.start.y);await page.keyboard.down('Control');await page.mouse.down();
            await page.mouse.move(points.edge.x,points.edge.y,{steps:4});
            const before=await page.evaluate(()=>({x:mollyEditor.workspace.panX,y:mollyEditor.workspace.panY}));
            await new Promise(resolve=>setTimeout(resolve,220));
            check(await page.evaluate(({before,direction})=>{
                const w=mollyEditor.workspace,m=mollyEditor.tools.getActiveTool(),p=w.getExactCoordinates(w.edgePanPointer,true);
                const delta=direction==='left'?w.panX-before.x:direction==='right'?before.x-w.panX:direction==='top'?w.panY-before.y:before.y-w.panY;
                return delta>10&&Math.abs(m.currentBox.x+m.dragStart.x-m.boxStart.x-p.x)<1.1&&Math.abs(m.currentBox.y+m.dragStart.y-m.boxStart.y-p.y)<1.1;
            },{before,direction}),`${tool} ${zoom}x: holding at the ${direction} edge pans continuously and keeps the object anchored to the cursor`);
            await page.mouse.up();await page.keyboard.up('Control');
            const released=await page.evaluate(()=>({x:mollyEditor.workspace.panX,y:mollyEditor.workspace.panY}));
            await new Promise(resolve=>setTimeout(resolve,70));
            check(await page.evaluate(released=>{const e=mollyEditor,w=e.workspace;return !w.edgePanFrame&&w.panX===released.x&&w.panY===released.y&&e.history.undoStack.length===1;},released),`${tool}: release stops edge pan and commits a single undo action`);
            await page.locator('#btn-undo').click();
            check(await page.evaluate(()=>mollyEditor.layerManager.layers.find(l=>l.id===pickFixture.front).canvas.toDataURL()===frontPixels),`${tool}: undo restores pixels after edge pan`);
        }
        for(const tool of ['move','transform']){
            await fixture(tool,3);
            const points=await page.evaluate(()=>{const w=mollyEditor.workspace,c=w.canvas.getBoundingClientRect(),r=w.getDragViewport();return {start:{x:c.left+80*w.zoom,y:c.top+69*w.zoom},edge:{x:r.right-3,y:(r.top+r.bottom)/2},centre:{x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}};});
            await page.mouse.move(points.start.x,points.start.y);await page.mouse.down();await page.mouse.move(points.edge.x,points.edge.y,{steps:3});
            await new Promise(resolve=>setTimeout(resolve,80));await page.mouse.move(points.centre.x,points.centre.y);
            await new Promise(resolve=>setTimeout(resolve,40));
            const centre=await page.evaluate(()=>({x:mollyEditor.workspace.panX,y:mollyEditor.workspace.panY}));
            await new Promise(resolve=>setTimeout(resolve,80));
            check(await page.evaluate(p=>{const w=mollyEditor.workspace;return !w.edgePanFrame&&w.panX===p.x&&w.panY===p.y;},centre),`${tool}: returning the pointer to the centre stops auto pan while still dragging`);
            await page.mouse.move(points.edge.x,points.edge.y);await new Promise(resolve=>setTimeout(resolve,80));await page.keyboard.press('Escape');
            check(await page.evaluate(()=>{const e=mollyEditor;return !e.workspace.edgePanFrame&&!e.workspace.isPointerDown&&e.history.undoStack.length===0&&e.layerManager.layers.find(l=>l.id===pickFixture.front).canvas.toDataURL()===frontPixels;}),`${tool}: Escape stops edge pan and restores the drag without history`);
            await page.mouse.up();
        }
        check(!win.__testErrors.length,'No renderer errors in overlapping-object picking scenarios');
        await fs.writeFile(path.join(root,'.test-output/move-picking-scenarios.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length},null,2));
    }catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);win?.destroy();app.exit(process.exitCode||0);}
})();
