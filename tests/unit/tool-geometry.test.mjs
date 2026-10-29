import test from 'node:test';
import assert from 'node:assert/strict';
import { clipLine, dragRectangle } from '../../src/renderer/js/tools/ToolGeometry.js';
import MoveTool from '../../src/renderer/js/tools/MoveTool.js';
import Workspace from '../../src/renderer/js/ui/Workspace.js';

test('centered and constrained shape geometry works in all drag directions', () => {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const rect = dragRectangle(20, 20, 20 + sx * 7, 20 + sy * 4, {shiftKey:true,altKey:true});
        assert.equal(Math.abs(rect.x1 - rect.x0), 14);
        assert.equal(Math.abs(rect.y1 - rect.y0), 14);
        assert.equal(rect.x0 + rect.x1, 40);
        assert.equal(rect.y0 + rect.y1, 40);
    }
});

test('shape geometry rejects nonfinite input and limits oversized drags', () => {
    assert.equal(dragRectangle(0,0,Infinity,10),null);
    const rect = dragRectangle(0,0,1e6,-1e6);
    assert.equal(Math.abs(rect.x1-rect.x0)+1,4096);
    assert.equal(Math.abs(rect.y1-rect.y0)+1,4096);
});

test('line clipping bounds work outside the viewport without unbounded raster loops', () => {
    assert.deepEqual(clipLine(-1e9, 5, 1e9, 5, 32, 32), {x0:0,y0:5,x1:31,y1:5});
    assert.equal(clipLine(-20,-20,-10,-10,32,32),null);
    assert.equal(clipLine(NaN,0,1,1,32,32),null);
    assert.deepEqual(clipLine(5,-20,5,50,32,32,2), {x0:5,y0:-2,x1:5,y1:33});
});

test('Ctrl resizing preserves anchors of all eight handles and Alt preserves the center', () => {
    const tool=Object.create(MoveTool.prototype);
    tool.boxStart={x:10,y:10,w:10,h:10};tool.activeSourceCanvas={width:10,height:10};
    tool.isLockAspect=()=>false;tool.updateDimensionBadge=()=>{};
    for (const id of ['nw','n','ne','w','e','sw','s','se']) {
        tool.currentBox={...tool.boxStart};tool.scaleBoxFromHandle(id,3,3,false,false,{ctrlKey:true});
        const box=tool.currentBox;
        if(id.includes('w'))assert.equal(box.x+box.w,20,id);
        else if(id.includes('e'))assert.equal(box.x,10,id);
        if(id.includes('n'))assert.equal(box.y+box.h,20,id);
        else if(id.includes('s'))assert.equal(box.y,10,id);
        tool.scaleBoxFromHandle(id,3,3,false,true,{ctrlKey:true});
        assert.ok(Math.abs(tool.currentBox.x+tool.currentBox.w/2-15)<=.5,id);
        assert.ok(Math.abs(tool.currentBox.y+tool.currentBox.h/2-15)<=.5,id);
    }
});

test('Workspace retains subpixel coordinates for screen-sized transform hit tests', () => {
    const workspace={canvas:{getBoundingClientRect:()=>({left:100,top:200,width:1024,height:1024})},config:{width:64,height:64}};
    const pointer={clientX:284,clientY:360};
    assert.equal(Workspace.prototype.getExactCoordinates.call(workspace,pointer,true).x,11.5);
    assert.equal(Workspace.prototype.getExactCoordinates.call(workspace,pointer).x,11);
});
