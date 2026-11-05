import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceCardSpring} from '../../src/renderer/js/ui/CardMotion.mjs';
test('card springs converge consistently at different display refresh rates and return without drift',()=>{
    for(const fps of [30,60,144]){
        const state={position:[0,0,0],velocity:[0,0,0]},target=[8,-8,-4];let peak=0;
        for(let i=0;i<fps*2;i++){advanceCardSpring(state,target,1/fps);peak=Math.max(peak,state.position[0]);}
        assert.ok(peak>8&&peak<8.5);
        assert.ok(state.position.every((v,i)=>Math.abs(v-target[i])<.001));
        for(let i=0;i<fps*2;i++)advanceCardSpring(state,[0,0,0],1/fps);
        assert.ok(state.position.every(v=>Math.abs(v)<.001));
        assert.ok(state.velocity.every(v=>Math.abs(v)<.001));
    }
});
test('resuming after a long pause does not destabilize card physics',()=>{
    const state={position:[0,0,0],velocity:[0,0,0]};advanceCardSpring(state,[8,-8,-4],60);
    assert.ok(state.position.every(v=>Number.isFinite(v)&&Math.abs(v)<8));
});
