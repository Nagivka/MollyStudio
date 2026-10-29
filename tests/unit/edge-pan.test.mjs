import test from 'node:test';
import assert from 'node:assert/strict';
import {edgePanVelocity} from '../../src/renderer/js/ui/Workspace.js';

test('edge pan accelerates towards each viewport edge and stays idle in the centre',()=>{
    const r={left:100,top:100,right:700,bottom:600};
    assert.deepEqual(edgePanVelocity(400,350,r),{x:0,y:0});
    assert.equal(edgePanVelocity(100,350,r).x,-360);
    assert.equal(edgePanVelocity(700,350,r).x,360);
    assert.equal(edgePanVelocity(400,100,r).y,-360);
    assert.equal(edgePanVelocity(400,600,r).y,360);
    assert.equal(edgePanVelocity(676,350,r).x,90);
    assert.ok(Math.hypot(...Object.values(edgePanVelocity(800,700,r)))<=360.00001);
    assert.deepEqual(edgePanVelocity(NaN,NaN,r),{x:0,y:0});
});
