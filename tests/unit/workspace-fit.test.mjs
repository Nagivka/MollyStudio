import test from 'node:test';
import assert from 'node:assert/strict';
import Workspace, { chooseFitZoom, alignViewportPan, ZOOM_STEPS } from '../../src/renderer/js/ui/Workspace.js';

test('canvas auto-fit chooses the largest pixel zoom that fits the viewport', () => {
    assert.equal(chooseFitZoom(256, 128, 1024, 768), 4);
    assert.equal(chooseFitZoom(256, 128, 80, 80), 0.25);
    assert.equal(chooseFitZoom(4096, 4096, 1, 1), 0.125);
    assert.equal(chooseFitZoom(1, 1, 500, 500), 32);
});

test('canvas origin stays on a physical pixel at fractional Windows display scales', () => {
    for (const ratio of [1, 1.25, 1.5, 1.75, 2, 3]) {
        for (const origin of [0, 13.3, 45.5, -20.2]) for (const pan of [-100.8, -.5, 0, 12.75, 255.9]) {
            const aligned = alignViewportPan(pan, origin, ratio);
            const physical = (origin + aligned) * ratio;
            assert.ok(Math.abs(physical - Math.round(physical)) < 1e-8);
            assert.ok(Math.abs(aligned - pan) <= .5 / ratio + 1e-8);
            assert.equal(alignViewportPan(aligned, origin, ratio), aligned);
        }
    }
    assert.equal(ZOOM_STEPS[2] * 3, 1);
});

test('keyboard focus ring stays two screen pixels across all canvas zoom levels', t => {
    const previous=globalThis.window;globalThis.window={devicePixelRatio:1.25};t.after(()=>{globalThis.window=previous;});
    const properties=new Map(),workspace=Object.assign(Object.create(Workspace.prototype),{
        wrapper:{style:{setProperty:(key,value)=>properties.set(key,value)}},workspace:{getBoundingClientRect:()=>({left:45.5,top:100})},
        panX:0,panY:0,updateZoomHUD(){},renderGrid(){},updateBrushCursor(){}
    });
    for(const zoom of ZOOM_STEPS){workspace.zoom=zoom;workspace.updateTransform();assert.equal(parseFloat(properties.get('--canvas-focus-width'))*zoom,2);}
});
