const fs = require('node:fs/promises');
const path = require('node:path');
const { app, root, ready, makeWindow, settle } = require('./lib/electron-harness.cjs');

async function exerciseTools() {
    const editor = window.mollyEditor, manager = editor.layerManager, tools = editor.tools, history = editor.history;
    const checks = [], expect = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
    const bytes = layer => Array.from(layer.ctx.getImageData(0, 0, layer.width, layer.height).data);
    const same = (layer, data) => bytes(layer).every((value, index) => value === data[index]);
    const alpha = (layer, x, y) => layer.ctx.getImageData(x, y, 1, 1).data[3];
    const move = tools.tools.move;
    editor.settingsManager.set('animationsEnabled', false);
    editor.workspace.zoom = 16;
    document.getElementById('move-snap').checked = false;
    const reset = name => {
        tools.cancelPointer(); tools.tools.marquee.cancelAction();
        editor.addProject(name, 'none', 64, 64, false, 'canvas');
        tools.setTool('move'); tools.setSize(1); history.clear();
    };
    const bitmap = (name = 'Bitmap', x = 10, y = 10, w = 12, h = 8) => {
        const layer = manager.addLayer(name);
        layer.ctx.fillStyle = '#EE4411'; layer.ctx.fillRect(x, y, w, h);
        layer.ctx.fillStyle = '#1166EE'; layer.ctx.fillRect(x, y, 1, 1);
        layer.invalidateSource(); move.syncBoxWithActiveLayer();
        return layer;
    };
    const select = (active, layers) => {
        manager.activeLayerId = active.id;
        manager.selectedLayerIds = new Set(layers.map(layer => layer.id));
        editor.bus.emit('LAYER_ACTIVE_CHANGED', active);
        move.syncBoxWithActiveLayer();
    };
    const drag = (x, y, endX, endY, modifiers = {}) => {
        tools.onPointerDown(x, y, modifiers);
        tools.onPointerMove((x + endX) / 2, (y + endY) / 2, modifiers);
        tools.onPointerUp(endX, endY, modifiers);
    };
    await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const poll = () => tools.tools.text.fontImages.minecraft ? resolve() : Date.now() > deadline ? reject(new Error('Font atlas timeout')) : setTimeout(poll, 20);
        poll();
    });

    reset('Move click');
    let layer = bitmap(), original = bytes(layer);
    editor.projectManager.markClean();
    editor.projectManager.markSaved(editor.activeProjectId);
    const revision = editor.projectManager.getRevision(editor.activeProjectId), layerRevision = layer.contentRevision;
    drag(15, 14, 15, 14);
    expect(!layer.sourceCanvas && layer.contentRevision === layerRevision && history.undoStack.length === 0 && editor.projectManager.getRevision(editor.activeProjectId) === revision, 'Move click changes neither pixels, master, history nor document revision');
    tools.onPointerDown(15, 14, {}); tools.onPointerMove(18, 14, {}); tools.onPointerUp(25, 14, {});
    expect(layer.sourceRect.x === 20 && alpha(layer, 20, 10) > 0, 'Move commits the final pointerup coordinate');
    expect(history.undo() && same(layer, original), 'Move undo restores every pixel');
    expect(history.redo() && layer.sourceRect.x === 20, 'Move redo restores the placed master');

    reset('Clipped keyboard move'); layer = bitmap('Edge', 0, 10); original = bytes(layer);
    move.nudge(-100, 0); move.nudge(100, 0);
    expect(same(layer, original), 'Keyboard move out of canvas and back preserves all pixels');

    reset('Text and bitmap move'); layer = bitmap(); original = bytes(layer);
    const text = manager.addTextLayer('Text', { text: 'A', fontId: 'minecraft', x: 30, y: 20, shadow: false });
    tools.tools.text.renderTextLayer(text);
    select(text, [text, layer]);
    const textBefore = structuredClone(text.textData);
    const box = move.currentBox;
    drag(box.x + box.w / 2, box.y + box.h / 2, box.x + box.w / 2 + 4, box.y + box.h / 2 + 5);
    expect(text.textData.x === textBefore.x + 4 && layer.sourceRect.x === 14 && alpha(layer, 14, 15) > 0, 'Multi-move with active text preserves and moves bitmap companions');
    expect(history.undo() && same(layer, original) && text.textData.x === textBefore.x, 'Multi-move undo restores text and bitmap together');

    for (const handleId of ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se', 'rot']) {
        reset(`Handle ${handleId}`);
        layer = bitmap(); const companion = bitmap('Companion', 40, 35, 5, 4), saved = bytes(companion);
        select(layer, [layer, companion]);
        const handle = move.getHandles(move.currentBox).find(item => item.id === handleId);
        drag(handle.x, handle.y, handle.x + 3, handle.y + 2);
        expect(same(companion, saved), `${handleId}: transforming active layer preserves other selected pixels`);
        expect(history.undo() && same(companion, saved), `${handleId}: undo preserves the companion`);
    }

    reset('Ctrl anchor'); layer = bitmap('Square', 10, 10, 10, 10);
    tools.onPointerDown(10, 10, {}); tools.onPointerMove(13, 13, {ctrlKey:true});
    expect(move.currentBox.x + move.currentBox.w === 20 && move.currentBox.y + move.currentBox.h === 20, 'Ctrl resize preserves the opposite corner after quantization');
    tools.cancelPointer();

    reset('Group hierarchy'); layer = bitmap(); original = bytes(layer);
    const outer = manager.addLayer('Outer', null, false, 'group'), inner = manager.addLayer('Inner', null, false, 'group');
    inner.groupId = outer.id; layer.groupId = inner.id;
    select(outer, [outer]); drag(15, 14, 19, 17);
    expect(layer.sourceRect.x === 14 && layer.sourceRect.y === 13, 'Nested group drag reaches leaf descendants');
    expect(history.undo() && same(layer, original), 'Nested group undo restores descendants');
    inner.locked = true;
    const other = bitmap('Unlocked', 40, 40);
    select(other, [other, layer]); drag(45, 44, 48, 47);
    expect(same(layer, original), 'Multi-drag respects inherited group lock');

    reset('Ordered preview'); layer = bitmap('Lower', 10, 10, 12, 8);
    const upper = bitmap('Upper', 0, 0, 64, 64); upper.ctx.fillStyle='#00FF00'; upper.ctx.fillRect(0,0,64,64); upper.invalidateSource();
    select(layer, [layer]); tools.onPointerDown(15,14,{}); tools.onPointerMove(19,17,{}); editor.renderer.render();
    expect(editor.renderer.ctx.getImageData(20,15,1,1).data[1] === 255, 'Live transform preview keeps the actual stacking order');
    const live = bytes(layer); tools.onPointerUp(19,17,{});
    expect(same(layer, live), 'Live move preview equals committed pixels');

    reset('Flipped master'); layer=bitmap(); original=bytes(layer);
    move.flip(true,false); move.flip(true,false);
    expect(same(layer,original), 'Double flip restores exact pixels');
    for (let index=0;index<4;index++) move.rotateFixed(90);
    expect(same(layer,original), 'Four quarter turns restore exact pixels');
    move.scaleUniform(.5); move.scaleUniform(2);
    expect(same(layer,original), 'Scale down and up preserves the pristine master');
    for (const [width,height] of [[3,2],[1,2],[5,4]]) {
        reset(`Odd rotation ${width}x${height}`);layer=bitmap('Odd',10,10,width,height);original=bytes(layer);
        for(let index=0;index<4;index++) move.rotateFixed(90);
        expect(same(layer,original)&&layer.sourceRect.x===10&&layer.sourceRect.y===10, `${width}x${height}: four rotations do not drift`);
        move.rotateFixed(90);move.rotateFixed(-90);
        expect(same(layer,original),`${width}x${height}: inverse rotation restores exact placement`);
    }

    for (const toolId of ['brush','pencil','eraser']) {
        reset(`Stroke ${toolId}`); layer = bitmap(); layer.ctx.clearRect(0,0,64,64); layer.invalidateSource();
        if(toolId==='eraser'){ layer.ctx.fillStyle='#fff';layer.ctx.fillRect(0,0,64,64);layer.invalidateSource(); }
        original=bytes(layer); tools.setTool(toolId);
        tools.onPointerDown(3,3,{}); tools.onPointerUp(20,3,{});
        expect(toolId==='eraser'?alpha(layer,20,3)===0:alpha(layer,20,3)>0, `${toolId}: final stroke segment is not lost`);
        expect(history.undo() && same(layer,original), `${toolId}: one undo restores the entire stroke`);
        tools.onPointerDown(5,5,{});tools.onPointerMove(8,5,{});tools.cancelPointer();
        expect(same(layer,original) && !tools.pointerSession, `${toolId}: cancelling restores the snapshot`);
    }

    reset('No-op metadata'); layer=bitmap();
    layer.shapeData={type:'rect-filled',x0:10,y0:10,x1:21,y1:17,color:'#EE4411',stroke:1,radius:0,filled:true};
    move.ensureSourceCanvas(layer);
    const shape=JSON.stringify(layer.shapeData), savedRevision=layer.contentRevision;
    tools.setTool('eraser');drag(1,1,1,1);
    expect(JSON.stringify(layer.shapeData)===shape && layer.contentRevision===savedRevision && history.undoStack.length===0, 'No-op eraser preserves shape metadata and content revision');

    reset('Undo during stroke'); layer=bitmap(); original=bytes(layer); tools.setTool('brush');
    tools.onPointerDown(2,2,{});tools.onPointerUp(4,2,{});
    tools.onPointerDown(7,7,{});tools.onPointerMove(9,7,{});
    expect(history.undo() && !tools.pointerSession && same(layer,original), 'Undo during a stroke cancels that gesture before applying history');
    tools.onPointerUp(9,7,{});
    expect(same(layer,original), 'Release after cancelled history gesture does not redraw it');
    reset('Automatic raster layer');
    const textTarget=manager.addTextLayer('Raster parent',{text:'A',fontId:'minecraft',x:20,y:20});
    tools.tools.text.renderTextLayer(textTarget);const layerCount=manager.layers.length;history.clear();tools.setTool('brush');
    tools.onPointerDown(2,2,{});tools.onPointerMove(4,2,{});tools.cancelPointer();
    expect(manager.layers.length===layerCount&&history.undoStack.length===0,'Cancelled drawing on a text layer removes its temporary raster layer');
    tools.onPointerDown(2,2,{});tools.onPointerUp(4,2,{});
    expect(history.undoStack.length===1&&history.undo()&&manager.layers.length===layerCount,'Automatic raster layer and its stroke undo in one action');

    for (const toolId of ['line','rect-empty','rect-filled','circle-empty','circle-filled']) {
        reset(`Shape ${toolId}`); layer=bitmap(); tools.setTool(toolId); const count=manager.layers.length;
        drag(20,20,27,24,{shiftKey:true,altKey:toolId!=='line'});
        const shapeLayer=manager.getActiveLayer();
        expect(manager.layers.length===count+1 && shapeLayer.shapeData && shapeLayer.getBounds(), `${toolId}: creates a nonempty editable object`);
        if(toolId!=='line') expect(shapeLayer.shapeData.x0===13 && shapeLayer.shapeData.y0===13 && shapeLayer.shapeData.x1===27 && shapeLayer.shapeData.y1===27, `${toolId}: Shift+Alt draws a centered square/circle`);
        expect(history.undo() && manager.layers.length===count && history.redo(), `${toolId}: undo and redo restore the object`);
    }

    reset('Gradient'); layer=bitmap(); original=bytes(layer); tools.setTool('gradient'); drag(15,14,15,14);
    expect(same(layer,original) && history.undoStack.length===0, 'Zero-length gradient does not destroy pixels');
    drag(10,10,22,18); expect(!same(layer,original) && history.undo() && same(layer,original), 'Gradient overlay is undoable');
    layer.alphaLocked=true; document.getElementById('grad-mode').value='full'; drag(0,0,50,50);
    expect(alpha(layer,0,0)===0, 'Full gradient respects alpha lock');

    reset('Bucket');layer=bitmap();original=bytes(layer);tools.setTool('bucket');document.getElementById('bucket-tol').value='0';
    editor.projectManager.markClean();const bucketRevision=editor.projectManager.getRevision(editor.activeProjectId);
    drag(15,14,15,14);
    expect(editor.projectManager.getRevision(editor.activeProjectId)>bucketRevision&&editor.projectManager.autosaveDirtyIds.has(editor.activeProjectId),'Instant bucket edit is queued for recovery after release');
    expect(!same(layer,original)&&history.undo()&&same(layer,original),'Bucket fill preserves exact undo');

    reset('Marquee');layer=bitmap();original=bytes(layer);tools.setTool('marquee');drag(10,10,21,17);
    const marquee=tools.tools.marquee;marquee.liftSelectionToFloating(layer);marquee.nudge(4,3);marquee.cancelAction();
    expect(same(layer,original)&&!marquee.hasFloating(),'Marquee cancellation restores lifted pixels');
    tools.setTool('pipette');document.getElementById('pipette-source').value='layer';
    let picked=null;editor.bus.on('COLOR_SELECTED',color=>picked=color);tools.onPointerDown(10,10,{});tools.onPointerMove(15,14,{});tools.onPointerUp(15,14,{});
    expect(picked==='#EE4411','Pipette drag samples the active layer continuously');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',code:'AltLeft',bubbles:true,cancelable:true}));
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',code:'AltLeft',bubbles:true,cancelable:true}));
    tools.setTool('move');document.activeElement?.blur();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Alt',code:'AltLeft',bubbles:true,cancelable:true}));
    expect(tools.currentToolId==='move'&&move.isAltInspectorActive,'Alt inspector does not switch Move to the pipette');
    document.dispatchEvent(new KeyboardEvent('keyup',{key:'Alt',code:'AltLeft',bubbles:true,cancelable:true}));
    tools.setTool('brush');tools.setSize(40);tools.setTool('pencil');tools.setSize(50);
    expect(tools.size===16,'Pencil size honors its actual 16 px limit');
    tools.setTool('brush');expect(tools.size===40,'Brush and pencil retain independent sizes');
    tools.setSize(1);tools.setTool('pencil');tools.setSize(1);

    reset('Screen overlay routing');layer=bitmap('Odd handles',10,10,3,2);
    const canvas=editor.workspace.canvas, ws=editor.workspace;
    for (const zoom of [16,64]) {
        ws.autoFitOnResize=false;ws.zoom=zoom;ws.panX=160-10*zoom;ws.panY=170-10*zoom;ws.updateTransform();
        for(const id of ['n','s','rot']) {
            move.syncBoxWithActiveLayer();const h=move.getHandles(move.currentBox).find(item=>item.id===id),rect=canvas.getBoundingClientRect();
            const options={bubbles:true,cancelable:true,button:0,buttons:1,pointerId:512,isPrimary:true,clientX:rect.left+h.x*zoom,clientY:rect.top+h.y*zoom};
            canvas.dispatchEvent(new PointerEvent('pointerdown',options));
            expect(move.activeHandle?.id===id,`${zoom}x ${id}: Workspace routes subpixel handle coordinates`);
            document.activeElement?.blur();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
            window.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0}));
            expect(!tools.pointerSession&&!ws.isPointerDown,`${zoom}x ${id}: Escape releases the gesture`);
        }
    }
    const overlay=document.getElementById('transform-overlay-canvas');
    expect(overlay.width===Math.round(ws.workspace.clientWidth*devicePixelRatio)&&overlay.width>64,'Transform overlay has viewport resolution rather than document resolution');
    layer.ctx.clearRect(0,0,64,64);layer.ctx.fillRect(10,0,3,2);layer.invalidateSource();move.syncBoxWithActiveLayer();ws.panY=230;ws.updateTransform();
    const edgeHandle=move.getHandles(move.currentBox).find(item=>item.id==='rot'),edgeRect=canvas.getBoundingClientRect();
    const edgePointer={bubbles:true,cancelable:true,button:0,buttons:1,pointerId:513,isPrimary:true,clientX:edgeRect.left+edgeHandle.x*ws.zoom,clientY:edgeRect.top+edgeHandle.y*ws.zoom};
    ws.workspace.dispatchEvent(new PointerEvent('pointerdown',edgePointer));
    expect(move.activeHandle?.id==='rot'&&!ws.isPanning,'Rotation handle outside document claims the gesture instead of panning');
    tools.cancelPointer();
    const oldPan=ws.panX;tools.setTool('hand');const rect=canvas.getBoundingClientRect();
    const pan={bubbles:true,button:0,buttons:1,pointerId:600,isPrimary:true,clientX:300,clientY:300};
    canvas.dispatchEvent(new PointerEvent('pointerdown',pan));
    window.dispatchEvent(new PointerEvent('pointermove',{...pan,pointerId:601,clientX:700}));
    expect(ws.panX===oldPan,'Hand ignores a second pointer during panning');
    window.dispatchEvent(new PointerEvent('pointermove',{...pan,clientX:320}));
    window.dispatchEvent(new PointerEvent('pointerup',{...pan,clientX:320,buttons:0}));
    expect(ws.panX===oldPan+20&&!ws.isPanning&&ws.activePointerId===null,'Hand pans and releases its owning pointer');
    reset('Instant text recovery');tools.setTool('text');
    const beforeTextRevision=editor.projectManager.getRevision(editor.activeProjectId);
    drag(20,20,20,20);const createdText=manager.getActiveLayer();
    expect(createdText.type==='text'&&editor.projectManager.getRevision(editor.activeProjectId)>beforeTextRevision&&editor.projectManager.autosaveDirtyIds.has(editor.activeProjectId),'New text is queued for recovery after pointer release');
    const textPixels=bytes(createdText),textRevision=createdText.contentRevision;
    const bounds=createdText.getBounds();
    tools.onPointerDown(bounds.x+1,bounds.y+1,{});tools.onPointerMove(bounds.x+5,bounds.y+4,{});tools.cancelPointer();
    expect(same(createdText,textPixels)&&createdText.contentRevision===textRevision,'Text drag cancellation restores pixels and content revision');

    reset('Property inputs outside Move');layer=bitmap();tools.setTool('brush');
    move.setBoxPosition(24,25);move.setBoxDimensions(9,6);
    expect(layer.sourceRect.x===24&&layer.sourceRect.y===25&&layer.sourceRect.w===9&&layer.sourceRect.h===6,'Numeric position and dimensions work when a different tool is active');
    reset('Gradient preview order');layer=bitmap('Gradient lower');const covered=bitmap('Cover',0,0,64,64);
    covered.ctx.fillStyle='#00FF00';covered.ctx.fillRect(0,0,64,64);covered.invalidateSource();select(layer,[layer]);tools.setTool('gradient');
    tools.onPointerDown(10,10,{});tools.onPointerMove(20,20,{});editor.renderer.render();
    expect(editor.renderer.ctx.getImageData(15,15,1,1).data[1]===255,'Gradient preview respects upper layers');
    original=bytes(layer);tools.onPointerUp(20,20,{});expect(same(layer,original),'Gradient preview equals committed pixels');
    reset('Master file roundtrip');layer=bitmap('Recoverable master');original=bytes(layer);move.nudge(-100,0);
    expect(await editor.projectManager.saveProjectAs(),'Transformed master saves to a real project file');
    const savedPath=editor.projects.find(item=>item.id===editor.activeProjectId).filePath;
    const savedDocument=JSON.parse(await window.electronAPI.readFile(savedPath));
    expect(savedDocument.layers.some(item=>item.name==='Recoverable master'&&item.sourceDataUrl&&item.sourceRect.x===-90),'Saved file retains the off-canvas master and its position');
    await editor.projectManager.deserializeProject(savedDocument,savedPath);tools.setTool('move');
    layer=manager.getLayers().find(item=>item.name==='Recoverable master');manager.setActive(layer.id);move.syncBoxWithActiveLayer();move.nudge(100,0);
    expect(same(layer,original),'Reopened transformed project can recover pixels from outside the canvas');
    return checks;
}

(async () => {
    let window;
    const watchdog=setTimeout(()=>{console.error('Tool scenarios timed out');app.exit(1);},120000);
    try {
        await ready(); window=makeWindow();
        await window.loadFile(path.join(root,'www/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Tool tests'}});
        const checks=await window.webContents.executeJavaScript(`(${exerciseTools.toString()})()`);
        await settle(window);
        if(window.__testErrors.length) throw new Error(window.__testErrors.join('\n'));
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        await fs.writeFile(path.join(root,'.test-output/tools.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length,checks},null,2));
    } catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);window?.destroy();app.exit(process.exitCode||0);}
})();
