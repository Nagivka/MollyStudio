import test from 'node:test';
import assert from 'node:assert/strict';
import {WeatherOcclusion,roundedRectDistance,normalizeCornerRadii,intersectRects} from '../../src/renderer/js/core/WeatherOcclusion.mjs';

test('rounded protection follows the actual pill silhouette, including asymmetric corners',()=>{
    const shape={left:0,top:0,right:100,bottom:40,radii:normalizeCornerRadii(100,40,Array(4).fill([999,999]))};
    assert.equal(roundedRectDistance(50,20,shape),-20);
    assert.ok(roundedRectDistance(0,0,shape)>0);
    assert.ok(roundedRectDistance(20,0,shape)<=0);
    const asymmetric={left:0,top:0,right:100,bottom:100,radii:normalizeCornerRadii(100,100,[[80,80],[20,20],[0,0],[0,0]])};
    assert.ok(roundedRectDistance(60,1,asymmetric)>0);
    assert.ok(roundedRectDistance(85,30,asymmetric)<0);
});

test('particles are hidden strictly inside the actual element, without an approach zone',()=>{
    const scene=new WeatherOcclusion();scene.setShapes([{left:100,top:100,right:200,bottom:150}]);
    assert.equal(scene.visibility(150,120),0);
    assert.equal(scene.visibility(199.99,125),0);
    assert.equal(scene.visibility(200.01,125),1);
    assert.equal(scene.visibility(99.99,120),1);
    assert.equal(scene.visibility(150,99.99),1);
    assert.equal(scene.visibility(150,150.01),1);
    scene.setShapes([{left:100,top:100,right:200,bottom:150},{left:120,top:110,right:180,bottom:140}]);
    assert.equal(scene.visibility(150,120),0);
});

test('scroll clipping protects only the visible portion, and rebuilding removes obsolete regions',()=>{
    const scene=new WeatherOcclusion(32);
    scene.setShapes([{left:0,top:0,right:100,bottom:100,clip:{left:50,top:50,right:90,bottom:90}}]);
    assert.equal(scene.visibility(75,75),0);assert.equal(scene.visibility(20,20),1);
    assert.deepEqual(intersectRects({left:0,top:0,right:10,bottom:10},{left:9,top:9,right:20,bottom:20}),{left:9,top:9,right:10,bottom:10});
    scene.setShapes([{left:400,top:400,right:420,bottom:420}]);assert.equal(scene.visibility(75,75,2),1);
    scene.clear();assert.equal(scene.visibility(410,410,2),1);
});

test('spatial lookup agrees with a direct distance check across cell edges and negative positions',()=>{
    const shapes=Array.from({length:60},(_,index)=>({left:index*37-200,top:index%5*41-40,right:index*37-175,bottom:index%5*41-10}));
    const scene=new WeatherOcclusion(64);scene.setShapes(shapes);
    for(let x=-240;x<2100;x+=11)for(let y=-80;y<220;y+=23){
        const distance=Math.min(...shapes.map(shape=>roundedRectDistance(x,y,shape)));
        assert.equal(scene.visibility(x,y),distance<=0?0:1);
    }
});
