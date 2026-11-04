import test from 'node:test';
import assert from 'node:assert/strict';
import {layerBranch,planLayerDrop,topLevelSelected,normalizeLayerLabel} from '../../src/renderer/js/core/LayerOrganization.mjs';
import {equalGapSnap} from '../../src/renderer/js/tools/SmartGuides.mjs';
import {inspectExportLayers} from '../../src/renderer/js/graphics/ExportDiagnostics.mjs';
import {SHORTCUT_COMMANDS,normalizeShortcutBindings,shortcutKeys,shortcutConflict,eventChord,normalizeChord} from '../../src/renderer/js/core/Shortcuts.mjs';
import {fileErrorMessage} from '../../src/renderer/js/core/FileErrors.mjs';
import {drawLayers} from '../../src/renderer/js/graphics/LayerCompositing.js';
import LayerManager from '../../src/renderer/js/graphics/LayerManager.js';
import EventBus from '../../src/renderer/js/core/EventBus.js';
import {GroupLayersCommand} from '../../src/renderer/js/core/Commands.js';
import PropertiesInspector from '../../src/renderer/js/ui/PropertiesInspector.js';
import PrefixEditor from '../../src/renderer/js/ui/PrefixEditor.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import PrefixRenderer from '../../src/renderer/js/graphics/PrefixRenderer.js';
import ProjectManager from '../../src/renderer/js/core/ProjectManager.mjs';
import BrushTool from '../../src/renderer/js/tools/BrushTool.js';
import {combineSelection,containsPixel} from '../../src/renderer/js/tools/SelectionGeometry.mjs';
import {normalizePrefixDocument} from '../../src/renderer/js/core/PrefixDocument.mjs';

test('layer drops retain complete branches and reject cycles and locked parents',()=>{
    const base={id:'base',isBase:true},a={id:'a',groupId:'g'},g={id:'g',isGroup:true},b={id:'b'},h={id:'h',isGroup:true};
    const layers=[base,a,g,b,h];
    assert.deepEqual([...layerBranch(layers,'g')],['g','a']);
    assert.equal(planLayerDrop(layers,'g','a','inside'),null);
    assert.equal(planLayerDrop(layers,'base','h'),null);
    const plan=planLayerDrop(layers,'g','h','inside');
    assert.deepEqual(plan.order.map(layer=>layer.id),['base','b','a','g','h']);assert.equal(plan.groupId,'h');
    assert.equal(g.groupId,undefined);assert.deepEqual(layers.map(layer=>layer.id),['base','a','g','b','h']);
    h.locked=true;assert.equal(planLayerDrop(layers,'b','h','inside'),null);
    assert.deepEqual(topLevelSelected(layers,['a','g','b']).map(layer=>layer.id),['g','b']);
    assert.equal(normalizeLayerLabel('url(evil)'),'none');
});

test('isolation affects editability without changing visibility or document contents',()=>{
    const bus=new EventBus(),manager=new LayerManager(bus),child={id:'a',groupId:'g'},group={id:'g',isGroup:true},other={id:'b'};
    manager.setLayers([child,group,other]);manager.toggleIsolation('g');
    assert.equal(manager.isEditable(child),true);assert.equal(manager.isEditable(other),false);
    assert.equal(other.visible,undefined);manager.toggleIsolation('g');assert.equal(manager.isEditable(other),true);
    manager.toggleIsolation('a');manager.setLayers([other]);assert.equal(manager.getIsolationIds(),null);
});

test('equal spacing snaps in either axis only near aligned neighbours',()=>{
    const refs=[{x:0,y:0,w:10,h:10},{x:20,y:0,w:10,h:10}];
    const snap=equalGapSnap({x:41,y:0,w:10,h:10},refs,2);
    assert.equal(snap.x,40);assert.equal(snap.guides.length,2);assert.ok(snap.guides.every(g=>g.distance===10));
    assert.equal(equalGapSnap({x:45,y:0,w:10,h:10},refs,2).x,45);
    assert.equal(equalGapSnap({x:41,y:100,w:10,h:10},refs,2).guides.length,0);
    const vertical=equalGapSnap({x:0,y:41,w:10,h:10},refs.map(r=>({x:r.y,y:r.x,w:r.h,h:r.w})),2);
    assert.equal(vertical.y,40);
    assert.equal(equalGapSnap({x:20,y:0,w:10,h:10},[...refs,{x:40,y:0,w:10,h:10}],1).guides.length,0);
});

test('an exact edge snap takes priority over a nearby equal-gap suggestion',()=>{
    const oldDocument=globalThis.document,oldWindow=globalThis.window;
    globalThis.document={getElementById:()=>null};globalThis.window={};
    try{
        const tool=Object.create(MoveTool.prototype);
        const layers=[0,20].map((x,i)=>({id:String(i),bounds:{x,y:10,w:10,h:10}}));
        tool.layerManager={config:{width:51,height:100},getLayers:()=>layers};
        tool.getLayerBoundingBox=layer=>layer.bounds;
        assert.equal(tool.computeSnapping(41,10,10,10).x,41);
        assert.equal(tool.activeGapGuides.filter(guide=>guide.axis==='x').length,0);
    }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

test('shortcut assignments are physical, unique, bounded and detect conflicts',()=>{
    const keys=SHORTCUT_COMMANDS.flatMap(command=>shortcutKeys(command));assert.equal(new Set(keys).size,keys.length);
    assert.equal(eventChord({code:'KeyS',ctrlKey:true,shiftKey:true},'win32'),'Ctrl+Shift+KeyS');
    assert.equal(normalizeChord('Alt+F4'),null);assert.equal(normalizeChord('Ctrl+Escape'),null);
    assert.equal(shortcutConflict('tool:brush','KeyP').id,'tool:pencil');
    const bindings=normalizeShortcutBindings({'tool:pencil':'','tool:brush':'KeyP','bad':'Ctrl+KeyS'});
    assert.deepEqual(bindings,{'tool:pencil':'','tool:brush':'KeyP'});
    assert.deepEqual(normalizeShortcutBindings({'tool:brush':'Ctrl+KeyS'}),{'tool:brush':''});
});

test('export diagnostics account for parent visibility, clipping and fractional geometry',()=>{
    const group={id:'g',isGroup:true,visible:false},hidden={id:'h',groupId:'g'},outside={id:'o',sourceRect:{x:-.5,y:0,w:5,h:5}};
    const messages=inspectExportLayers([group,hidden,outside],{width:4,height:4});
    assert.equal(messages.length,3);assert.match(messages[0],/Скрытых объектов: 1/);
    assert.deepEqual(inspectExportLayers([group,hidden,outside],{width:8,height:8},['h']),[messages[0]]);
});

test('file errors give actionable messages without echoing untrusted error details',()=>{
    assert.match(fileErrorMessage(Error('os error 112')),/места/);
    assert.match(fileErrorMessage(Error('os error 5')),/доступа/);
    assert.match(fileErrorMessage(Error('FILE_CHANGED')),/отдельным файлом/);
    assert.match(fileErrorMessage(Error('os error 32')),/занят/);
    assert.doesNotMatch(fileErrorMessage(Error('<script>raw failure</script>')),/script/);
});

test('deep group caches stay bounded and invalidate through all ancestors',()=>{
    const previous=globalThis.document;let draws=0,allocations=0;
    const context=()=>({save(){},restore(){},clearRect(){},drawImage(){draws++;}});
    globalThis.document={createElement(){allocations++;return {width:1,height:1,getContext:context};}};
    try{
        const layers=Array.from({length:160},(_,i)=>({id:`g${i}`,isGroup:true,width:1,height:1,groupId:i?`g${i-1}`:null}));
        const leaf={id:'leaf',groupId:'g159',canvas:{width:1,height:1},contentRevision:1};layers.push(leaf);
        const ctx=context();drawLayers(ctx,layers);assert.equal(allocations,160);assert.equal(draws,161);
        drawLayers(ctx,layers);assert.equal(allocations,160);assert.equal(draws,162);
        leaf.contentRevision++;drawLayers(ctx,layers);assert.equal(allocations,160);assert.equal(draws,323);
    }finally{globalThis.document=previous;}
});

test('nested grouping preserves parent membership and undo restores all branches',()=>{
    const manager=new LayerManager(new EventBus());
    const root={id:'root',isGroup:true},child={id:'child',groupId:'a'},a={id:'a',isGroup:true,groupId:'root'},b={id:'b',groupId:'root'};
    manager.layers=[child,a,b,root];manager.activeLayerId='b';manager.selectedLayerIds=new Set(['child','a','b']);
    manager.addGroup=()=>{const group={id:'new',isGroup:true};manager.layers.push(group);return group;};
    const result=manager.groupSelectedLayers();assert.deepEqual(result.targets,[a,b]);assert.equal(result.group.groupId,'root');assert.equal(child.groupId,'a');
    const command=new GroupLayersCommand(manager,result.group,result.targets,result.oldOrder,result.oldGroupIds);
    command.undo();assert.deepEqual(manager.layers,[child,a,b,root]);assert.equal(a.groupId,'root');assert.equal(b.groupId,'root');
    command.execute();assert.equal(a.groupId,'new');assert.equal(b.groupId,'new');assert.equal(child.groupId,'a');
    root.locked=true;manager.selectedLayerIds=new Set(['a']);manager.activeLayerId='a';assert.equal(manager.groupSelectedLayers(),null);
});

test('batch appearance edits avoid applying opacity twice to selected group children',()=>{
    const child={id:'a',groupId:'g',opacity:1},group={id:'g',isGroup:true,opacity:1},locked={id:'b',locked:true,opacity:1};
    const manager={getLayers:()=>[child,group,locked],getSelectedLayers:()=>[child,group,locked],isInIsolation:()=>true};
    const commands=[];const inspector=Object.create(PropertiesInspector.prototype);
    inspector.app={layerManager:manager,bus:new EventBus(),history:{push:command=>commands.push(command)}};
    inspector.get=()=>({value:'selected'});inspector.sync=()=>{};
    inspector.setProperty(group,'opacity',.5);assert.equal(child.opacity,1);assert.equal(group.opacity,.5);assert.equal(locked.opacity,1);
    commands[0].undo();assert.equal(group.opacity,1);
});

test('prefix edits reuse the raster layer and refit only when its size changes',()=>{
    const oldDocument=globalThis.document;globalThis.document={getElementById:()=>null};
    try{
        const layer={id:'p',objectType:'prefix',width:20,height:10,canvas:{width:20,height:10},ctx:{clearRect(){},drawImage(){}},invalidateSource(){this.revision=(this.revision||0)+1;}};
        const project={id:'project',layers:[layer],config:{width:20,height:10}};let fits=0,resizes=0,allocations=0;
        const editor=Object.create(PrefixEditor.prototype);editor.project=()=>project;editor.updatePreview=()=>{};
        editor.renderer={render:data=>({canvas:{width:data.width,height:10},data,missing:[]})};
        editor.app={config:{width:20,height:10},layerManager:{setLayers(){allocations++;}},renderer:{resize(){resizes++;}},bus:new EventBus(),workspace:{autoFitOnResize:true,fitToScreen(){fits++;}}};
        editor.apply(project,{width:20});editor.apply(project,{width:20});assert.equal(project.layers[0],layer);assert.equal(allocations,0);assert.equal(fits,0);assert.equal(resizes,0);
        editor.apply(project,{width:30});assert.equal(layer.width,30);assert.equal(fits,1);assert.equal(resizes,1);assert.equal(layer.revision,3);
    }finally{globalThis.document=oldDocument;}
});

test('quarter-turn rotation preserves every master pixel even at reduced object size',()=>{
    const oldDocument=globalThis.document;let matrix;
    globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({transform(...values){matrix=values;},drawImage(){}})})};
    try{
        const tool=Object.create(MoveTool.prototype),master={width:101,height:57},box={x:10,y:20,w:7,h:4};
        const rotated=tool.createRotatedSource(master,box,Math.PI/2);
        assert.equal(rotated.canvas.width,57);assert.equal(rotated.canvas.height,101);assert.deepEqual(matrix,[0,1,-1,0,57,0]);
        assert.equal(rotated.rect.w,4);assert.equal(rotated.rect.h,7);
    }finally{globalThis.document=oldDocument;}
});

test('prefix block cache reuses unchanged blocks and stays bounded',()=>{
    const renderer=new PrefixRenderer();let renders=0;
    renderer.renderBlock=block=>({canvas:{width:++renders},missing:[],block});
    const first=renderer.cachedBlock({text:'VIP'});
    assert.strictEqual(renderer.cachedBlock({text:'VIP'}),first);assert.equal(renders,1);
    const changed=renderer.cachedBlock({text:'ADMIN'});assert.notStrictEqual(changed,first);
    for(let i=0;i<50;i++)renderer.cachedBlock({text:String(i)});
    assert.equal(renderer.blockCache.size,16);
});

test('arrow reordering moves a group branch among siblings and never out of its parent',()=>{
    const manager=new LayerManager(new EventBus());
    const base={id:'base',isBase:true},a={id:'a',groupId:'g'},g={id:'g',isGroup:true},b={id:'b',groupId:'h'},h={id:'h',isGroup:true};
    manager.layers=[base,a,g,b,h];
    assert.equal(manager.moveLayer('g',1),true);assert.deepEqual(manager.layers.map(layer=>layer.id),['base','b','h','a','g']);
    assert.equal(manager.moveLayer('a',-1),false);assert.equal(a.groupId,'g');
    assert.equal(manager.moveLayer('g',-1),true);assert.deepEqual(manager.layers.map(layer=>layer.id),['base','a','g','b','h']);
    g.locked=true;assert.equal(manager.moveLayer('g',1),false);
});

test('layer labels survive serialization and change fingerprints without reencoding pixels',()=>{
    let encodes=0;const layer={id:'a',name:'Layer',colorLabel:'violet',contentRevision:1,canvas:{toDataURL(){encodes++;return 'encoded';}}};
    const app={projects:[{id:'p',layers:[layer]}],activeProjectId:'p',layerManager:{getLayers:()=>[layer]}};
    const manager=new ProjectManager(app),before=manager.getDocumentFingerprint('p');
    assert.equal(manager.serializeProject().layers[0].colorLabel,'violet');
    layer.colorLabel='blue';assert.notEqual(manager.getDocumentFingerprint('p'),before);
    assert.equal(manager.serializeProject().layers[0].colorLabel,'blue');assert.equal(encodes,1);
});

test('brush strokes stay inside an irregular selection and preserve its subtracted hole',()=>{
    const oldDocument=globalThis.document,oldWindow=globalThis.window;
    globalThis.document={getElementById:()=>null};globalThis.window={};
    try{
        const area=combineSelection({x:2,y:2,width:5,height:5},{x:4,y:4,width:1,height:1},'subtract');
        const painted=new Set();let path=[];let clip=null;
        const ctx={save(){},restore(){clip=null;},beginPath(){path=[];},rect(x,y,width,height){path.push({x,y,width,height});},clip(){clip=[...path];},
            fillRect(x,y,width,height){for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++)if(!clip||clip.some(r=>px>=r.x&&px<r.x+r.width&&py>=r.y&&py<r.y+r.height))painted.add(`${px},${py}`);}};
        const layer={width:10,height:10,type:'bitmap',visible:true,ctx,getImageData:()=>({}),invalidateSource(){}};
        const brush=new BrushTool(new EventBus(),{isEditable:()=>true},{});brush.toolManager={tools:{marquee:{selection:area}}};
        brush.onPointerDown(0,4,'#FFFFFF',5,layer);brush.onPointerMove(9,4,'#FFFFFF',5,layer);
        assert.equal(painted.size,24);assert.equal(painted.has('4,4'),false);
        for(const point of painted)assert.equal(containsPixel(area,...point.split(',').map(Number)),true);
    }finally{globalThis.document=oldDocument;globalThis.window=oldWindow;}
});

test('prefix history restores text shadows and each independent corner together',()=>{
    const project={prefixData:normalizePrefixDocument()},before=structuredClone(project.prefixData);
    Object.assign(project.prefixData.blocks[0],{radiusTopLeft:3,radiusTopRight:5,radiusBottomLeft:1,radiusBottomRight:0,textShadowMode:'gradient',textShadowX:-2,textShadowY:3,textShadowColors:['#123456','#654321']});
    const after=structuredClone(project.prefixData),commands=[];let saves=0;
    const editor=Object.create(PrefixEditor.prototype);editor.invalidFields=new Map();editor.pending={project,before};
    editor.app={history:{push:command=>commands.push(command)},saveProjectState(){saves++;}};
    editor.apply=(target,data)=>{target.prefixData=structuredClone(data);};editor.sync=()=>{};
    assert.equal(editor.commitPendingEdit(),true);assert.equal(commands.length,1);assert.equal(saves,1);
    commands[0].undo();assert.deepEqual(project.prefixData,before);
    commands[0].execute();assert.deepEqual(project.prefixData,after);
    assert.equal(editor.commitPendingEdit(),true);assert.equal(commands.length,1);
});
