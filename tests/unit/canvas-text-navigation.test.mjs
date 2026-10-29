import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenizeBitmapText,layoutBitmapText} from '../../src/renderer/js/graphics/BitmapTextLayout.mjs';
import {caretPosition,hitCaret,moveHorizontal,moveVertical,normalizeText,SnapshotHistory} from '../../src/renderer/js/graphics/TextNavigation.mjs';
import {textWorldPoint,textLocalPoint,transformTextAxes} from '../../src/renderer/js/graphics/TextTransform.mjs';
import CanvasTextEditor from '../../src/renderer/js/ui/CanvasTextEditor.js';
import TextTool from '../../src/renderer/js/tools/TextTool.js';
const layout=(text,options={})=>layoutBitmapText(tokenizeBitmapText(text).tokens,()=>({advance:4,offsetY:0}),{sourceText:text,...options});

test('bitmap editor keeps source positions through hidden formatting codes and CRLF',()=>{
    const text='&aAB\r\nC',result=layout(text);
    assert.equal(result.lines[0].start,0);assert.equal(result.lines[0].end,4);assert.equal(result.lines[1].start,6);
    assert.equal(result.lines[0].glyphs[0].start,2);assert.equal(result.lines[0].glyphs[1].end,4);
    assert.equal(caretPosition(result,6).line,1);assert.equal(hitCaret(result,2,10).index,7);
});
test('bitmap editor distinguishes both caret positions at a wrapped line boundary',()=>{
    const result=layout('ABCD',{maxWidth:8});
    assert.equal(caretPosition(result,2,0).line,0);assert.equal(caretPosition(result,2,1).line,1);
    assert.deepEqual(moveHorizontal(result,2,0,1),{index:2,line:1});
    assert.deepEqual(moveHorizontal(result,2,1,-1),{index:2,line:0});
});
test('bitmap frame reports vertical overset independently of stored text and font size',()=>{
    const result=layout('A\nB\nC',{maxWidth:20,frameHeight:15});
    assert.equal(result.visibleLines,1);assert.equal(result.overflow,true);assert.equal(result.contentHeight,30);
    assert.equal(result.text,'A\nB\nC');assert.equal(layout(result.text,{maxWidth:20,frameHeight:30}).overflow,false);
});
test('a too-wide bitmap glyph reports the width required for an exact fit',()=>{
    const result=layout('A',{maxWidth:2,frameHeight:20});
    assert.equal(result.width,2);assert.equal(result.horizontalOverflow,true);assert.equal(result.minRequiredWidth,4);
    assert.equal(layout('A',{maxWidth:4,frameHeight:20}).overflow,false);
});
test('a point object ignores a previously stored frame height',()=>{
    const result=layout('A\nB',{maxWidth:0,frameHeight:1});assert.equal(result.height,20);assert.equal(result.overflow,false);
});
test('raised bitmap glyphs stay inside a new text frame with matching caret coordinates',()=>{
    const result=layoutBitmapText(tokenizeBitmapText('A\nB').tokens,()=>({advance:4,offsetY:-2}),{sourceText:'A\nB',maxWidth:10,frameHeight:22});
    assert.equal(result.glyphs[0].y,0);assert.equal(result.lines[0].y,2);assert.equal(result.overflow,false);
    assert.equal(hitCaret(result,0,11).line,0);assert.equal(hitCaret(result,0,12).line,1);
});
test('rotated and reflected text coordinates invert exactly for frame hit testing',()=>{
    for(const rotation of [-35,45,90,180,270])for(const flipX of [true,false]){
        const data={x:31,y:19,scaleX:2,scaleY:3,rotation,flipX,shearX:.4},local={x:17,y:23};
        const restored=textLocalPoint(data,textWorldPoint(data,local));
        assert.ok(Math.abs(restored.x-local.x)<1e-10);assert.ok(Math.abs(restored.y-local.y)<1e-10);
    }
});
test('world resizing and flipping rotated text preserve both transformed axes without rasterizing',()=>{
    const before={x:30,y:40,scaleX:2,scaleY:3,rotation:35};
    for(const map of [(x,y)=>({x:x*2+12,y:y*.5-9}),(x,y)=>({x:100-x,y})]){
        const after={...before,...transformTextAxes(before,map)};
        for(const point of [{x:0,y:0},{x:40,y:0},{x:0,y:20},{x:40,y:20}]){
            const original=textWorldPoint(before,point),expected=map(original.x,original.y),actual=textWorldPoint(after,point);
            assert.ok(Math.abs(expected.x-actual.x)<1e-8);assert.ok(Math.abs(expected.y-actual.y)<1e-8);
        }
    }
});
test('bitmap navigation never separates a surrogate pair or combining grapheme',()=>{
    const result=layout('A👩‍💻е́Z');
    assert.deepEqual(result.boundaries,[0,1,6,8,9]);
    assert.equal(moveHorizontal(result,1,null,1).index,6);assert.equal(moveHorizontal(result,8,null,-1).index,6);
    assert.equal(normalizeText('abc👩‍💻',6),'abc');
});
test('bitmap vertical navigation keeps its column through a short line',()=>{
    const result=layout('ABCD\nA\nABCD'),down=moveVertical(result,3,0,1);
    assert.equal(down.index,6);assert.equal(moveVertical(result,down.index,down.line,1,down.goalX).index,10);
});
test('canvas editing history coalesces typing but keeps a later style operation separate',()=>{
    const history=new SnapshotHistory(),snap=(text,size=8)=>({data:{text,fontSize:size},selection:{start:text.length,end:text.length}});
    history.record(snap(''),snap('A'),{group:'typing',time:1});history.record(snap('A'),snap('AB'),{group:'typing',time:2});
    history.breakGroup();history.record(snap('AB'),snap('AB',16));
    assert.equal(history.undoStack.length,2);assert.equal(history.undo().data.fontSize,8);assert.equal(history.undo().data.text,'');
});
test('local undo failure keeps the history entry available for a later retry',()=>{
    const editor=Object.create(CanvasTextEditor.prototype),history=new SnapshotHistory();
    history.record({data:{text:'before'}},{data:{text:'after'}});
    Object.assign(editor,{history,tool:{toolManager:{}},commitProperty(){},restore:()=>false,notify(){},focus(){}});
    assert.equal(editor.undo(true),false);assert.equal(history.undoStack.length,1);assert.equal(history.redoStack.length,0);
    editor.restore=()=>true;assert.equal(editor.undo(true),true);assert.equal(history.redoStack.length,1);
});
test('text frame handle hit areas stay eight screen pixels at a fractional scale and rotation',()=>{
    const data={x:10,y:20,maxWidth:60,scaleX:.5,scaleY:2,rotation:35,shearX:.25},layer={textData:data};
    const editor=Object.create(CanvasTextEditor.prototype);
    Object.assign(editor,{manager:{getActiveLayer:()=>layer},tool:{canEditText:()=>true,getTextLayout:()=>({width:60,height:40})},zoom:()=>2});
    const world=textWorldPoint(data,{x:60,y:20});
    assert.equal(editor.findHandle({x:world.x+3.9,y:world.y}).kind,'width');
    assert.equal(editor.findHandle({x:world.x+4.1,y:world.y}),null);
    assert.equal(editor.findHandle(textWorldPoint(data,{x:60,y:40})).kind,'corner');
});
test('a known glyph can be inspected while its bitmap atlas is still loading',()=>{
    const tool=Object.create(TextTool.prototype);tool.fontImages={};
    assert.equal(tool.getGlyph('A','minecraft').pending,true);
    assert.equal(tool.glyphCache.size,0);
});
test('frame whitespace receives clicks above a bitmap while upper opaque layers block lower text',()=>{
    const frame={type:'text',textData:{x:10,y:20,maxWidth:50}},bitmap={type:'bitmap'};
    const editor=Object.create(CanvasTextEditor.prototype);
    Object.assign(editor,{manager:{layers:[bitmap,frame],findLayerAt:()=>bitmap},tool:{canEditText:layer=>layer.type==='text',getTextLayout:()=>({width:50,height:20})}});
    assert.equal(editor.findAt({x:40,y:30}),frame);
    editor.manager.layers=[frame,bitmap];assert.equal(editor.findAt({x:40,y:30}),null);
    editor.manager.layers=[frame];editor.manager.findLayerAt=()=>frame;
    assert.equal(editor.findAt({x:61,y:30}),frame,'the shadow pixels of a text object remain clickable');
});
