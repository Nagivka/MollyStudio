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
    document.getElementById('move-autosel').checked=false;
    select(layer, [layer]); tools.onPointerDown(15,14,{}); tools.onPointerMove(19,17,{}); editor.renderer.render();
    expect(editor.renderer.ctx.getImageData(20,15,1,1).data[1] === 255, 'Live transform preview keeps the actual stacking order');
    const live = bytes(layer); tools.onPointerUp(19,17,{});
    expect(same(layer, live), 'Live move preview equals committed pixels');
    document.getElementById('move-autosel').checked=true;

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
    const committedStroke=bytes(layer);
    tools.onPointerDown(7,7,{});tools.onPointerMove(9,7,{});
    expect(history.undo() && !tools.pointerSession && same(layer,committedStroke), 'Undo during a stroke cancels only the unfinished gesture');
    tools.onPointerUp(9,7,{});
    expect(same(layer,committedStroke), 'Release after cancelled history gesture does not redraw it');
    expect(history.undo()&&same(layer,original), 'The next undo restores the preceding committed stroke');
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
    const recoveryTextTool=tools.tools.text,recoveryTextInput=recoveryTextTool.canvasEditor.input;
    recoveryTextInput.value='Text';recoveryTextInput.dispatchEvent(new Event('input',{bubbles:true}));
    createdText.textData.maxWidth=20;createdText.textData.frameHeight=16;recoveryTextTool.renderTextLayer(createdText);recoveryTextTool.canvasEditor.finish(true);
    const textPixels=bytes(createdText),textRevision=createdText.contentRevision;
    tools.onPointerDown(40,28,{});tools.onPointerMove(45,28,{});tools.cancelPointer();
    expect(createdText.textData.maxWidth===20&&same(createdText,textPixels)&&createdText.contentRevision===textRevision,'Cancelling text frame resize restores geometry, pixels and content revision');

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
    const savedDocument=JSON.parse(await window.desktopAPI.readFile(savedPath));
    expect(savedDocument.layers.some(item=>item.name==='Recoverable master'&&item.sourceDataUrl&&item.sourceRect.x===-90),'Saved file retains the off-canvas master and its position');
    await editor.projectManager.deserializeProject(savedDocument,savedPath);tools.setTool('move');
    layer=manager.getLayers().find(item=>item.name==='Recoverable master');manager.setActive(layer.id);move.syncBoxWithActiveLayer();move.nudge(100,0);
    expect(same(layer,original),'Reopened transformed project can recover pixels from outside the canvas');
    for(const toolId of ['brush','pencil','eraser','bucket','gradient']){
        reset('Paint inside selection '+toolId);layer=bitmap('Selected raster',0,0,64,64);original=bytes(layer);
        tools.setTool('marquee');drag(10,10,20,20);const selection={...tools.tools.marquee.selection};
        tools.setTool(toolId);tools.setSize(12);tools.color='#00FF00';
        if(toolId==='bucket')drag(15,15,15,15);else drag(8,8,23,23);
        const after=bytes(layer);let changedInside=false,changedOutside=false;
        for(let y=0;y<64;y++)for(let x=0;x<64;x++){
            const offset=(y*64+x)*4,changed=after.slice(offset,offset+4).some((value,index)=>value!==original[offset+index]);
            if(x>=10&&x<=20&&y>=10&&y<=20)changedInside||=changed;else changedOutside||=changed;
        }
        expect(changedInside&&!changedOutside,toolId+': painting changes only the selected region');
        expect(JSON.stringify(tools.tools.marquee.selection)===JSON.stringify(selection)&&editor.workspace.selectionOverlay.callback,toolId+': selection remains visible after changing tools');
        history.undo();expect(same(layer,original),toolId+': one undo restores the clipped raster edit');
    }
    reset('Selection boundary movement');layer=bitmap();original=bytes(layer);tools.setTool('marquee');drag(10,10,24,24);
    const selectionTool=tools.tools.marquee;drag(17,17,20,19);
    expect(selectionTool.selection.x===13&&selectionTool.selection.y===12&&!selectionTool.hasFloating()&&same(layer,original),'Moving the selection boundary leaves pixels unchanged');
    selectionTool.clearSelection();drag(2,2,2,2);
    expect(selectionTool.selection.width===1&&selectionTool.selection.height===1,'A single-pixel selection is usable');
    tools.setTool('brush');editor.workspace.zoom=8;editor.workspace.currentMousePos={x:12.4,y:11.2,isInside:true};tools.setSize(9);
    expect(editor.workspace.brushOverlay.callback&&editor.workspace.brushOverlay.canvas.width===editor.workspace.workspace.clientWidth,'Brush footprint uses a separate screen-resolution overlay');
    const cursor=editor.workspace.brushOverlay.canvas.getContext('2d');
    expect(cursor.getImageData(0,0,cursor.canvas.width,cursor.canvas.height).data.some((value,index)=>index%4===3&&value>0),'Brush size preview renders without painting document pixels');
    tools.setTool('hand');expect(!editor.workspace.brushOverlay.callback,'Brush preview hides when switching to navigation');
    selectionTool.clearSelection();tools.setTool('marquee');drag(10,10,21,17);selectionTool.liftSelectionToFloating(layer);
    tools.setTool('brush');expect(!selectionTool.hasFloating()&&selectionTool.selection,'Switching to painting commits floating pixels and retains the selection');
    selectionTool.clearSelection();
    for(const toolId of ['line','rect-empty','rect-filled','circle-empty','circle-filled']){
        reset('Clipped shape '+toolId);layer=bitmap();tools.setTool('marquee');drag(10,10,20,20);tools.setTool(toolId);tools.setSize(2);drag(8,8,15,15);
        const shape=manager.getActiveLayer(),bounds=shape.getBounds();
        expect(shape!==layer&&bounds&&bounds.x>=10&&bounds.y>=10&&bounds.x+bounds.w<=21&&bounds.y+bounds.h<=21&&!shape.shapeData,toolId+': a cropped shape cannot regenerate pixels outside the selection');
        const count=manager.layers.length;drag(1,1,4,4);
        expect(manager.layers.length===count&&manager.getActiveLayer()===shape,toolId+': a shape outside the selection does not leave an empty layer');
    }
    const savedSelection={...tools.tools.marquee.selection};
    expect(await editor.projectManager.saveProjectAs()&&JSON.stringify(tools.tools.marquee.selection)===JSON.stringify(savedSelection),'Saving a drawing keeps its selection available for the next stroke');
    tools.tools.marquee.clearSelection();
    editor.addProject('Bedrock replacement','container/default/container_27.png',256,256,false,'gui');
    const gui=editor.getActiveProject();await gui.templateLoadPromise;
    const artwork=manager.addLayer('Keep artwork');artwork.ctx.fillStyle='#FA0380';artwork.ctx.fillRect(20,20,4,4);artwork.invalidateSource();const artworkPixels=bytes(artwork);
    editor.prepareTemplateModal();document.getElementById('proj-style').value='bedrock';document.getElementById('btn-apply-template').click();await gui.templateLoadPromise;
    expect(gui.templatePath==='container/bedrock/container_27.png'&&manager.layers.includes(artwork)&&same(artwork,artworkPixels),'Applying Bedrock to an existing GUI replaces its base and preserves artwork');
    editor.prepareTemplateModal();expect(document.getElementById('proj-style').value==='bedrock','Template dialog restores the active Bedrock style');
    history.undo();expect(gui.templatePath==='container/default/container_27.png'&&same(artwork,artworkPixels),'Undo restores the previous GUI template without changing artwork');
    history.redo();expect(gui.templatePath==='container/bedrock/container_27.png','Redo reapplies the Bedrock template');
    reset('Pristine selection');layer=bitmap('Master',10,10,13,9);original=bytes(layer);
    tools.setTool('marquee');marquee.selection={x:10,y:10,width:13,height:9};marquee.liftSelectionToFloating(layer);
    for(let cycle=0;cycle<5;cycle++){marquee.setSelectionDimensions(3,2);marquee.setSelectionDimensions(13,9);}
    marquee.commitFloating(layer);
    expect(same(layer,original)&&layer.sourceCanvas?.width===13,'Repeated numeric selection shrink/grow retains every original pixel after commit');
    history.undo();expect(same(layer,original),'Undo a latent source change retains the exact original pixels');history.redo();
    marquee.selection={x:10,y:10,width:13,height:9};marquee.liftSelectionToFloating(layer);marquee.setSelectionDimensions(3,2);marquee.commitFloating(layer);
    tools.setTool('move');move.setBoxDimensions(13,9);
    expect(same(layer,original),'A committed small floating selection can grow from its pristine source in Move');
    tools.setTool('marquee');marquee.selection={x:10,y:10,width:13,height:9};marquee.liftSelectionToFloating(layer);marquee.setSelectionDimensions(3,2);
    marquee.flipFloating(true,false);marquee.flipFloating(true,false);marquee.rotateFloating(90);marquee.rotateFloating(-90);marquee.setSelectionPosition(10,10);marquee.setSelectionDimensions(13,9);marquee.commitFloating(layer);
    expect(same(layer,original),'Flips and quarter turns while shrunk retain the full floating master');
    const savedMaster=editor.projectManager.serializeProject();await editor.projectManager.deserializeProject(savedMaster);layer=manager.getActiveLayer();tools.setTool('move');move.setBoxDimensions(2,2);move.setBoxDimensions(13,9);
    expect(same(layer,original),'Save and reopen retain the full master for later resizing');
    reset('Canvas scale master');layer=bitmap('Canvas original',10,10,13,9);original=bytes(layer);layer.scale(31,29);layer.scale(64,64);
    expect(same(layer,original),'Whole-canvas shrinking also preserves a pristine master from the first resize');
    reset('Semitransparent pristine source');layer=manager.addLayer('Alpha original');
    const alphaFixture=layer.ctx.createImageData(17,11);
    for(let index=0;index<17*11;index++)alphaFixture.data.set([(index*41)%256,(index*67)%256,(index*97)%256,index%5===0?0:32+(index*29)%224],index*4);
    layer.ctx.putImageData(alphaFixture,10,10);layer.invalidateSource();original=bytes(layer);move.syncBoxWithActiveLayer();
    for(const mode of ['pixel','smooth']){
        document.getElementById('move-resample-mode').value=mode;move.setBoxDimensions(2,2);move.setBoxDimensions(17,11);
        const changed=bytes(layer).map((value,index)=>value!==original[index]?[index,original[index],value]:null).filter(Boolean);
        expect(!changed.length,'Semitransparent original returns byte-for-byte after shrinking in '+mode+' mode'+(changed.length?' '+JSON.stringify({rect:layer.sourceRect,diff:changed.slice(0,8)}):''));
    }
    document.getElementById('move-resample-mode').value='auto';
    move.flip(true,false);move.flip(true,false);move.rotateFixed(90);move.rotateFixed(-90);
    expect(same(layer,original),'Lossless flips and quarter turns preserve semitransparent original channels');
    const semitransparent=editor.projectManager.serializeProject();await editor.projectManager.deserializeProject(semitransparent);layer=manager.getActiveLayer();tools.setTool('move');move.setBoxDimensions(2,2);move.setBoxDimensions(17,11);
    expect(same(layer,original),'PNG serialization retains the full semitransparent master for later resizing');
    tools.setTool('marquee');marquee.selection={x:10,y:10,width:17,height:11};marquee.liftSelectionToFloating(layer);marquee.setSelectionDimensions(3,2);marquee.copy();marquee.cancelFloating();
    const pasted=manager.addLayer('Pasted master');marquee.paste();marquee.setSelectionPosition(10,10);marquee.setSelectionDimensions(17,11);marquee.commitFloating(pasted);
    expect(same(pasted,original),'Internal copy/paste retains a shrunk object’s pristine semitransparent source');
    const source=pasted.sourceCanvas,encode=source.toDataURL.bind(source);let encodes=0;source.toDataURL=(...args)=>{encodes++;return encode(...args);};
    editor.projectManager.serializeProject();const initialEncodes=encodes;tools.setTool('move');move.nudge(1,0);editor.projectManager.serializeProject();move.nudge(-1,0);editor.projectManager.serializeProject();
    expect(encodes===initialEncodes,'Moving an object does not re-encode its unchanged original PNG');
    const prefixModule=await import(new URL('./js/graphics/PrefixRenderer.js',location.href).href);const prefixRenderer=new prefixModule.default();await prefixRenderer.load();
    const glyphA=prefixRenderer.glyph('a','smallcaps'),glyphCyrA=prefixRenderer.glyph('а','smallcaps'),glyphM=prefixRenderer.glyph('м','smallcaps');
    expect(glyphA.bottom===glyphM.bottom&&glyphCyrA.bottom===glyphM.bottom,'Latin and Cyrillic small-cap a share the Cyrillic baseline');
    for(const letter of 'abcdefghijklmnopqrstuvwxyz0123456789')expect(prefixRenderer.glyph(letter,'smallcaps').bottom===6,'Small-cap baseline: '+letter);
    const textTool=tools.tools.text;
    const base={text:'aамм',fontId:'smallcaps',color:'#FFFFFF',shadow:false,x:0,y:0};
    // Exercise the same public layer renderer used by ordinary text objects.
    const solidLayer=manager.addTextLayer('Solid caps', {...base});textTool.renderTextLayer(solidLayer);
    const gradientLayer=manager.addTextLayer('Gradient caps',{...base,colorMode:'gradient',gradientColors:['#FFFFFF','#FFFFFF'],gradientAngle:0});textTool.renderTextLayer(gradientLayer);
    const rowBounds=canvas=>{const ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let top=canvas.height,bottom=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4+3]){top=Math.min(top,y);bottom=Math.max(bottom,y);}return[top,bottom];};
    expect(rowBounds(solidLayer.canvas)[1]>=0&&JSON.stringify(rowBounds(solidLayer.canvas))===JSON.stringify(rowBounds(gradientLayer.canvas)),'Solid and gradient text share one baseline correction');
    const search=document.getElementById('layer-search');search.value='Gradient caps';editor.layerPanel.render();
    expect(document.querySelectorAll('#layer-list .layer-item').length===1&&document.querySelector('#layer-list .layer-item').dataset.id===gradientLayer.id,'Layer search finds the correct object without altering the document');
    expect(document.querySelector('#layer-list .layer-item').tabIndex===0,'A filtered layer list retains one keyboard entry point');
    search.value='';document.getElementById('layer-type-filter').value='text';editor.layerPanel.render();
    expect(document.querySelectorAll('#layer-list .layer-item').length===2,'Layer type filter separates editable text from bitmaps');
    document.getElementById('layer-type-filter').value='all';editor.layerPanel.render();
    document.getElementById('btn-history').click();expect(editor.historyPanel.dialog.open&&editor.historyPanel.dialog.querySelector('[aria-current="step"]'),'History opens with an accessible current state');
    editor.historyPanel.dialog.querySelector('[data-history-index="0"]').click();expect(history.undoStack.length===0,'History can return to the earliest retained state');
    await new Promise(resolve=>{editor.historyPanel.dialog.addEventListener('close',resolve,{once:true});editor.historyPanel.dialog.close();});
    expect(document.activeElement.id==='btn-history','Closing history restores keyboard focus to its toolbar button');
    reset('Precise transform controls');layer=bitmap();original=bytes(layer);
    expect(!!document.getElementById('prop-pos-x')&&!!document.getElementById('prop-size-w'),'Position and size controls exist in the actual inspector');
    document.getElementById('prop-resize-anchor').value='0.5,0.5';move.setBoxDimensions(6,4);
    expect(layer.sourceRect.x===13&&layer.sourceRect.y===12&&layer.sourceRect.w===6,'Numeric resize preserves the selected center anchor');
    history.undo();expect(same(layer,original),'Anchored resize undo restores exact pixels');
    document.getElementById('prop-resize-anchor').value='0,0';
    const pxInput=document.getElementById('prop-pos-x');pxInput.value='20';pxInput.dispatchEvent(new Event('change',{bubbles:true}));
    expect(layer.sourceRect.x===20,'Inspector X input moves the actual object');history.undo();
    move.setBoxDimensions(6,4);const master=layer.sourceCanvas;document.getElementById('btn-prop-apply-transform').click();
    expect(!layer.sourceCanvas,'Applying transforms explicitly releases the old master');
    history.undo();expect(layer.sourceCanvas===master,'Undo restores the master after applying transforms');
    reset('Object layout');const layoutA=bitmap('A',0,2,4,3),layoutB=bitmap('B',6,12,6,4),layoutC=bitmap('C',30,22,10,5);
    select(layoutA,[layoutA,layoutB,layoutC]);const layoutPixels=[layoutA,layoutB,layoutC].map(bytes);
    document.getElementById('btn-prop-distribute-x').click();
    expect(layoutB.sourceRect.x===14&&(!layoutC.sourceRect||layoutC.sourceRect.x===30),'Distribution creates equal gaps and keeps endpoint objects');
    expect(history.undo()&&[layoutA,layoutB,layoutC].every((item,index)=>same(item,layoutPixels[index])),'Distribution is one exact undoable action');
    document.getElementById('prop-align-reference').value='selection';document.getElementById('btn-prop-align-top').click();
    expect([layoutA,layoutB,layoutC].every(item=>(item.sourceRect||move.getLayerBoundingBox(item)).y===2),'Alignment uses all selected objects and their combined bounds');history.undo();
    document.getElementById('prop-align-reference').value='canvas';
    reset('Screen space snapping');layer=bitmap();document.getElementById('move-snap').checked=true;editor.workspace.zoom=16;
    expect(move.computeSnapping(1,10,12,8).x===1,'Magnetic snapping threshold stays in screen pixels at high zoom');
    editor.workspace.zoom=1;expect(move.computeSnapping(1,10,12,8).x===0,'Magnetic snapping still reaches nearby canvas edges at 100 percent');
    document.getElementById('move-snap').checked=false;editor.workspace.zoom=16;
    tools.onPointerDown(15,14,{});tools.onPointerMove(20,16,{shiftKey:true});tools.onPointerUp(20,16,{shiftKey:true});
    expect(layer.sourceRect.x===15&&layer.sourceRect.y===10,'Shift constrains object movement to the dominant axis');
    const {combineSelection,containsPixel}=await import(new URL('./js/tools/SelectionGeometry.mjs',location.href).href);
    const ring=()=>combineSelection({x:5,y:5,width:20,height:20},{x:10,y:10,width:10,height:10},'subtract');
    for(const toolId of ['brush','pencil','eraser','bucket','gradient','line','rect-filled','circle-filled']){
        reset('Composite selection '+toolId);layer=manager.addLayer('Mask pixels');
        if(toolId==='eraser'){layer.ctx.fillStyle='#FFFFFF';layer.ctx.fillRect(0,0,64,64);}
        layer.invalidateSource();const beforeMask=bytes(layer);tools.tools.marquee.selection=ring();const selectedArea=tools.tools.marquee.selection;
        tools.setTool(toolId);tools.setSize(3);drag(6,6,24,24);const resultLayer=manager.getActiveLayer(),afterMask=bytes(resultLayer);let changed=0,inside=true;
        for(let i=0;i<afterMask.length;i+=4)if(afterMask.slice(i,i+4).some((v,k)=>v!==beforeMask[i+k])){
            changed++;inside&&=containsPixel(selectedArea,(i/4)%64,Math.floor(i/256));
        }
        expect(changed>0,toolId+': composite selection accepts drawing');
        expect(inside,toolId+': all changed pixels belong to the composite mask');
        expect(history.undo()&&same(layer,beforeMask)&&(resultLayer===layer||!manager.layers.includes(resultLayer)),toolId+': masked drawing remains exactly undoable');
    }
    reset('Composite selection actions');layer=manager.addLayer('Opaque source');layer.ctx.fillStyle='#FFFFFF';layer.ctx.fillRect(0,0,64,64);layer.invalidateSource();original=bytes(layer);
    tools.setTool('marquee');marquee.selection=ring();marquee.invertSelection();
    expect(same(layer,original)&&!marquee.pointInSelection(6,6)&&marquee.pointInSelection(12,12)&&marquee.pointInSelection(0,0),'Invert selection changes the area without changing any pixel colors');
    marquee.selection=ring();marquee.copy();
    expect(marquee.clipboard.canvas.getContext('2d').getImageData(8,8,1,1).data[3]===0,'Copy excludes pixels inside the mask hole');
    marquee.liftSelectionToFloating(layer);
    expect(alpha(layer,6,6)===0&&alpha(layer,12,12)===255,'Lifting a composite area preserves unselected pixels inside its bounds');
    const originalMask=Array.from({length:400},(_,i)=>marquee.pointInSelection(5+i%20,5+Math.floor(i/20)));
    for(let cycle=0;cycle<3;cycle++){marquee.setSelectionDimensions(3,3);marquee.setSelectionDimensions(20,20);}
    expect(originalMask.every((value,i)=>value===marquee.pointInSelection(5+i%20,5+Math.floor(i/20))),'Repeated shrinking and growing restores the original floating mask without geometric drift');
    marquee.fillSelection('#FF0000');expect(marquee.getFloatingCanvas().getContext('2d').getImageData(8,8,1,1).data[3]===0,'Filling floating pixels keeps unselected holes transparent');
    marquee.flipFloating(true,false);marquee.rotateFloating(90);marquee.rotateFloating(-90);marquee.flipFloating(true,false);
    expect(!marquee.pointInSelection(12,12)&&marquee.pointInSelection(6,6),'Floating flips and rotations preserve the selection mask');
    marquee.cancelAction();expect(same(layer,original),'Cancelling a composite lift restores the whole source exactly');
    marquee.selection={x:10,y:10,width:4,height:4};marquee.changeBoundary(1);
    expect(marquee.selection.x===9&&marquee.selection.width===6,'Expanding selection includes one pixel on every side');marquee.changeBoundary(-1);
    expect(marquee.selection.x===10&&marquee.selection.width===4,'Shrinking selection restores the original rectangular boundary');
    marquee.selection=null;document.getElementById('marquee-combine-mode').value='replace';drag(10,10,14,14);
    document.getElementById('marquee-combine-mode').value='add';drag(12,12,18,18);
    expect(marquee.pointInSelection(10,10)&&marquee.pointInSelection(18,18)&&!marquee.pointInSelection(10,18),'Add mode creates a true combined area instead of a bounding rectangle');
    document.getElementById('marquee-combine-mode').value='replace';
    marquee.clearSelection();layer=manager.addLayer('Alpha shape');layer.ctx.fillStyle='#FFFFFF';layer.ctx.fillRect(4,4,10,10);layer.ctx.clearRect(7,7,2,2);layer.invalidateSource();
    marquee.selectContent();expect(marquee.pointInSelection(4,4)&&!marquee.pointInSelection(7,7),'Select content follows actual opacity rather than only its bounding box');
    reset('Numeric batch transforms');const batchA=bitmap('Batch A',10,10,13,9),batchB=bitmap('Batch B',34,22,5,7);
    select(batchA,[batchA,batchB]);const batchPixels=[batchA,batchB].map(bytes),batchBounds=move.getAlignmentUnits().map(item=>item.box);
    document.getElementById('prop-transform-target').value='selection';const numeric=move.getNumericBox();
    move.setBoxDimensions(numeric.w*2,numeric.h*2);
    expect(batchA.sourceRect.w===26&&batchB.sourceRect.w===10&&history.undoStack.length===1,'Numeric batch resize transforms both objects as one history action');
    expect(history.undo()&&[batchA,batchB].every((item,i)=>same(item,batchPixels[i])),'Batch resize undo restores every original pixel');
    history.redo();move.setBoxDimensions(numeric.w,numeric.h);
    expect([batchA,batchB].every((item,i)=>same(item,batchPixels[i])),'Batch shrink and growth retain the pristine source of each object');
    for(let n=0;n<4;n++)move.rotateFixed(90);
    expect([batchA,batchB].every((item,i)=>same(item,batchPixels[i])),'Four batch quarter turns do not drift or lose pixels');
    move.flip(true,false);move.flip(true,false);
    expect([batchA,batchB].every((item,i)=>same(item,batchPixels[i])),'Double batch reflection restores both objects exactly');
    document.getElementById('prop-transform-target').value='active';
    reset('Mixed group transforms');layer=bitmap('Group image',10,10,12,8);const mixedText=manager.addTextLayer('Group text',{text:'AB',fontId:'minecraft',x:30,y:10,shadow:false});tools.tools.text.renderTextLayer(mixedText);
    const mixedGroup=manager.addLayer('Mixed group',null,false,'group');layer.groupId=mixedGroup.id;mixedText.groupId=mixedGroup.id;select(mixedGroup,[mixedGroup]);
    const mixedPixels=[layer,mixedText].map(bytes);move.scaleUniform(2);
    expect(mixedText.type==='text'&&mixedText.textData.scaleX===2&&layer.sourceRect.w===24,'Group scaling preserves editable text together with image masters');
    expect(history.undo()&&[layer,mixedText].every((item,i)=>same(item,mixedPixels[i])),'Mixed text and image group scaling undoes as one action');
    for(let n=0;n<4;n++)move.rotateFixed(90);
    expect([layer,mixedText].every((item,i)=>same(item,mixedPixels[i])),'Four mixed group quarter turns restore editable text and image pixels');
    move.flip(true,false);move.flip(true,false);
    expect([layer,mixedText].every((item,i)=>same(item,mixedPixels[i])),'Mixed group reflections restore text and image pixels');
    reset('Selection property routing');layer=bitmap('Selection source',8,8,8,6);original=bytes(layer);tools.setTool('marquee');
    marquee.selection={x:8,y:8,width:8,height:6};editor.syncPropertiesPanel();
    document.getElementById('btn-prop-align-right').click();
    expect(marquee.selection.x===56&&same(layer,original),'Selection alignment moves its frame without moving the whole layer');
    marquee.selection={x:8,y:8,width:8,height:6};document.getElementById('prop-resize-anchor').value='0.5,0.5';
    document.getElementById('btn-prop-scale2x').click();
    expect(marquee.selection.width===16&&marquee.selection.x===4&&same(layer,original),'Selection scale controls use the chosen anchor and preserve underlying pixels in area mode');
    document.getElementById('prop-resize-anchor').value='0,0';marquee.selection={x:8,y:8,width:8,height:6};
    document.getElementById('btn-prop-rotcw').click();
    expect(marquee.hasFloating()&&marquee.selection.width===6&&marquee.selection.height===8,'Selection rotate controls operate on floating pixels rather than the complete layer');
    marquee.cancelAction();expect(same(layer,original),'Cancelling a property transform restores the selection source');
    marquee.selection=combineSelection({x:8,y:8,width:8,height:6},{x:9,y:9,width:2,height:2},'subtract');marquee.liftSelectionToFloating(layer);
    marquee.boxStart={...marquee.selection};marquee.transformSourceCanvas=marquee.getFloatingMaster();marquee.isTransformingHandle=true;
    marquee.scaleSelectionFromHandle('e',-16,0,false,false);marquee.onPointerUp(NaN,NaN);
    expect(!marquee.pointInSelection(5,9)&&marquee.pointInSelection(1,9),'Dragging a selection handle through the opposite edge reflects its mask');
    const reflected=marquee.getFloatingCanvas().getContext('2d').getImageData(7,0,1,1).data;
    expect(reflected[2]>reflected[0],'Crossing a selection handle reflects the actual pixels together with the mask');
    marquee.setSelectionDimensions(4,3);marquee.setSelectionDimensions(8,6);
    expect(!marquee.pointInSelection(5,9)&&marquee.getFloatingCanvas().getContext('2d').getImageData(7,0,1,1).data[2]>200,'Later resizing preserves the reflected pristine source and its mask');
    marquee.cancelAction();
    marquee.selection={x:8,y:8,width:8,height:6};document.getElementById('marquee-transform-mode').value='pixels';
    marquee.setSelectionPosition(12,14);
    expect(marquee.hasFloating()&&alpha(layer,8,8)===0&&marquee.selection.x===12,'Numeric selection coordinates lift and move pixels in pixel mode');marquee.cancelAction();
    marquee.selection={x:8,y:8,width:8,height:6};marquee.setSelectionDimensions(16,12);
    expect(marquee.hasFloating()&&marquee.getFloatingCanvas().width===16,'Numeric selection dimensions transform pixels in pixel mode');marquee.cancelAction();document.getElementById('marquee-transform-mode').value='area';
    reset('Numeric active target');const positionA=bitmap('A',4,4,4,4),positionB=bitmap('B',20,20,4,4);select(positionA,[positionA,positionB]);
    document.getElementById('prop-transform-target').value='active';move.setBoxPosition(10,12);
    expect(positionA.sourceRect.x===10&&!positionB.sourceRect&&alpha(positionB,20,20)>0,'Numeric active-object coordinates leave other selected objects unchanged');
    return checks;
}

(async () => {
    let window;
    const watchdog=setTimeout(()=>{console.error('Tool scenarios timed out');app.exit(1);},120000);
    try {
        await ready(); window=makeWindow();
        await window.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'canvas',width:'64',height:'64',name:'Tool tests'}});
        const checks=await window.webContents.executeJavaScript(`(${exerciseTools.toString()})()`);
        await settle(window);
        if(window.__testErrors.length) throw new Error(window.__testErrors.join('\n'));
        await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
        await fs.writeFile(path.join(root,'.test-output/tools.json'),JSON.stringify({passed:checks.length,checks},null,2));
        console.log(JSON.stringify({passed:checks.length,checks},null,2));
    } catch(error){console.error(error);process.exitCode=1;}
    finally{clearTimeout(watchdog);window?.destroy();app.exit(process.exitCode||0);}
})();
