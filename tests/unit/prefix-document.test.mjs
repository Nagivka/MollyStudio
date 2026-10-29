import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefixDocument, applyPrefixPreset, validatePrefixDocument } from '../../src/renderer/js/core/PrefixDocument.mjs';
import { createProjectFromForm, normalizeProjectData, buildEditorUrl } from '../../src/renderer/js/core/ProjectFactory.mjs';
import { normalizeWorkspaceState } from '../../src/renderer/js/core/WorkspaceState.mjs';
import { prefixShadePreview, prefixShadeRamp, prefixTextShadowRamp, prefixGradientPosition } from '../../src/renderer/js/graphics/PrefixShading.mjs';
import { prefixCornerRadii, prefixRoundedRect } from '../../src/renderer/js/graphics/PrefixGeometry.mjs';

test('prefix corners migrate the old radius and retain independent normalized values', () => {
    const legacy=normalizePrefixDocument({blocks:[{radius:5}]}).blocks[0];
    const keys=['radiusTopLeft','radiusTopRight','radiusBottomRight','radiusBottomLeft'];
    assert.deepEqual(keys.map(key=>legacy[key]),[5,5,5,5]);
    const block=normalizePrefixDocument({blocks:[{radius:5,radiusTopLeft:0,radiusTopRight:3,radiusBottomRight:99,radiusBottomLeft:-10}]}).blocks[0];
    assert.deepEqual(keys.map(key=>block[key]),[0,3,32,0]);
    assert.deepEqual(normalizePrefixDocument(JSON.parse(JSON.stringify({blocks:[block]}))).blocks[0],block);
    assert.deepEqual(keys.map(key=>applyPrefixPreset(block,'ocean')[key]),[0,3,32,0]);
});

test('prefix rounding uses circular pixel arcs rather than diagonal corner cuts', () => {
    const inside=prefixRoundedRect(20,20,[6,0,0,0]);
    assert.equal(inside(0,0),false);assert.equal(inside(1,1),false);
    assert.equal(inside(2,1),true); // The old diagonal cut would remove this pixel.
    assert.equal(inside(19,0),true);assert.equal(inside(0,19),true);assert.equal(inside(19,19),true);
    const square=prefixRoundedRect(20,20,[0,0,0,0]);
    assert.equal(square(0,0),true);assert.equal(square(-1,0),false);assert.equal(square(20,0),false);
});

test('each prefix corner is independent and inner borders follow the same contour', () => {
    const pixels=[[0,0],[19,0],[19,19],[0,19]];
    for(let corner=0;corner<4;corner++){
        const radii=[0,0,0,0];radii[corner]=6;
        const outer=prefixRoundedRect(20,20,radii),inner=prefixRoundedRect(20,20,radii,2);
        for(let index=0;index<4;index++)assert.equal(outer(...pixels[index]),index!==corner);
        for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(inner(x,y))assert.equal(outer(x,y),true);
    }
    assert.deepEqual(prefixCornerRadii(10,6,[32,32,32,32]),[3,3,3,3]);
    const thin=prefixRoundedRect(1,1,[32,32,32,32]);assert.equal(thin(0,0),true);
    assert.equal(prefixRoundedRect(1,1,[32,32,32,32],1)(0,0),false);
});

test('prefix projects use the same creation contract in all windows', () => {
    const project=createProjectFromForm({getElementById:()=>({value:'Ранги'})},'prefix');
    assert.equal(project.type,'prefix');assert.equal(project.name,'Ранги');assert.equal(normalizeProjectData(project).template,'none');
    assert.equal(new URL(buildEditorUrl(project),'https://local.test/').searchParams.get('type'),'prefix');
});
test('prefix normalization bounds allocations and repairs duplicate block identities', () => {
    const data=normalizePrefixDocument({blocks:Array.from({length:100},()=>({id:'same',text:'X'.repeat(10000),paddingX:Infinity,paddingY:100,shadowX:-999,backgroundColors:Array(100).fill('bad')}))});
    assert.equal(data.blocks.length,8);assert.equal(new Set(data.blocks.map(block=>block.id)).size,8);
    assert.equal(data.blocks[0].text.length,64);assert.equal(data.blocks[0].paddingY,16);assert.equal(data.blocks[0].shadowX,-8);assert.equal(data.blocks[0].backgroundColors.length,8);
});
test('prefix presets preserve content and do not share mutable colors', () => {
    const block=normalizePrefixDocument().blocks[0],next=applyPrefixPreset({...block,text:'АДМИН'},'ocean');
    assert.equal(next.text,'АДМИН');next.backgroundColors[0]='#000000';assert.notEqual(applyPrefixPreset(block,'ocean').backgroundColors[0],'#000000');
});
test('new prefixes enable auto shading while existing documents retain their rendering mode', () => {
    assert.equal(normalizePrefixDocument().blocks[0].autoShade,true);
    assert.equal(normalizePrefixDocument().blocks[0].textShadowMode,'auto');
    const legacy=normalizePrefixDocument({version:1,blocks:[{text:'VIP',borderColor:'#654321'}]}).blocks[0];
    assert.equal(legacy.autoShade,false);assert.equal(legacy.borderColor,'#654321');
    assert.equal(legacy.highlightColor,null);assert.equal(legacy.bevelShadowColor,null);
    assert.equal(legacy.textShadowMode,'solid');assert.equal(legacy.textShadowX,1);assert.equal(legacy.textShadowY,1);assert.equal(legacy.textShadowOpacity,100);
    const saved=JSON.parse(JSON.stringify(normalizePrefixDocument({blocks:[{...legacy,autoShade:true,tintedBorder:false,highlightColor:'#123456',bevelShadowColor:'#654321'}]})));
    assert.deepEqual(normalizePrefixDocument(saved),saved);
});

test('text shadow settings round trip and normalize invalid or oversized values', () => {
    const block=normalizePrefixDocument({blocks:[{text:'VIP',textShadowMode:'gradient',textShadowColors:['#123456','#abcdef'],textShadowAngle:135,textShadowX:-9,textShadowY:12,textShadowDarkness:60,textShadowOpacity:45}]}).blocks[0];
    assert.deepEqual(block.textShadowColors,['#123456','#ABCDEF']);
    assert.deepEqual(normalizePrefixDocument(JSON.parse(JSON.stringify({version:1,blocks:[block]}))).blocks[0],block);
    const invalid=normalizePrefixDocument({blocks:[{textShadowMode:'bad',textShadowX:-999,textShadowY:Infinity,textShadowAngle:1000,textShadowOpacity:-5,textShadowDarkness:999,textShadowColors:Array(100).fill('bad')}]}).blocks[0];
    assert.equal(invalid.textShadowMode,'solid');assert.equal(invalid.textShadowX,-16);assert.equal(invalid.textShadowY,1);
    assert.equal(invalid.textShadowAngle,360);assert.equal(invalid.textShadowOpacity,0);assert.equal(invalid.textShadowDarkness,100);assert.equal(invalid.textShadowColors.length,8);
});

test('automatic text shadow follows background colors, including gradients and transparency fallback', () => {
    const block=normalizePrefixDocument({blocks:[{textShadowMode:'auto',textShadowDarkness:75,background:'gradient',backgroundColors:['#FF0000','#0000FF'],textMode:'gradient',textColors:['#00FF00','#FFFFFF']}]}).blocks[0];
    const ramp=prefixTextShadowRamp(block);assert.equal(ramp.length,256);assert.deepEqual(ramp[0],[64,0,0]);assert.deepEqual(ramp.at(-1),[0,0,64]);
    assert.deepEqual(prefixTextShadowRamp({...block,background:'solid'}),[[64,0,0]]);
    assert.deepEqual(prefixTextShadowRamp({...block,background:'none'})[0],[0,64,0]);
    assert.deepEqual(prefixTextShadowRamp({...block,textShadowDarkness:0})[0],[255,0,0]);
    assert.deepEqual(prefixTextShadowRamp({...block,textShadowDarkness:100}).at(-1),[0,0,0]);
});

test('manual text shadow colors ignore automatic shading and gradient position uses the same axes as the backdrop', () => {
    const block=normalizePrefixDocument({blocks:[{textShadowMode:'solid',textShadowColor:'#123456',textShadowDarkness:100}]}).blocks[0];
    assert.deepEqual(prefixTextShadowRamp(block),[[18,52,86]]);
    const ramp=prefixTextShadowRamp({...block,textShadowMode:'gradient',textShadowColors:['#00FF00','#FF00FF']});
    assert.deepEqual(ramp[0],[0,255,0]);assert.deepEqual(ramp.at(-1),[255,0,255]);
    assert.equal(prefixGradientPosition(0,0,2,7,5),0);assert.equal(prefixGradientPosition(0,6,2,7,5),1);
    assert.ok(prefixGradientPosition(90,3,0,7,5)<1e-8);assert.equal(prefixGradientPosition(90,3,4,7,5),1);
});
test('prefix shading matches the Minecraft button palette and respects manual colors', () => {
    const block=normalizePrefixDocument().blocks[0];block.background='solid';block.backgroundColors=['#C5C5C5'];
    assert.deepEqual(prefixShadePreview(block),{surface:'#C5C5C5',highlight:'#ECECEC',shadow:'#7C7C7C',border:'#262626'});
    assert.equal(prefixShadePreview({...block,tintedBorder:false}).border,'#000000');
    assert.deepEqual(prefixShadePreview({...block,autoShade:false,borderColor:'#010203',highlightColor:'#FFDDCC',bevelShadowColor:'#223344'}),{surface:'#C5C5C5',border:'#010203',highlight:'#FFDDCC',shadow:'#223344'});
});
test('gradient shading uses a bounded lookup with distinct shading at both endpoints', () => {
    const block=normalizePrefixDocument().blocks[0];block.backgroundColors=['#FF0000','#0000FF'];
    const ramp=prefixShadeRamp(block);assert.equal(ramp.length,256);
    assert.deepEqual(ramp[0].surface,[255,0,0]);assert.deepEqual(ramp.at(-1).surface,[0,0,255]);
    assert.notDeepEqual(ramp[0].border,ramp.at(-1).border);assert.notDeepEqual(ramp[0].highlight,ramp.at(-1).highlight);
    assert.equal(prefixShadeRamp({...block,background:'solid'}).length,1);
});
test('unknown or oversized prefix documents fail before image decoding', () => {
    assert.throws(()=>validatePrefixDocument({version:2,blocks:[{text:'VIP'}]}));
    assert.throws(()=>validatePrefixDocument({version:1,blocks:[{text:'a'.repeat(65)}]}));
    assert.equal(validatePrefixDocument(normalizePrefixDocument()).blocks[0].text,'VIP');
});
test('workspace recovery rejects external reference sources and malformed guides', () => {
    const data=normalizeWorkspaceState({referenceSrc:'https://example.com/private.png',guides:{horizontal:[1,1,NaN,Infinity,2],vertical:Array(600).fill(3)},referenceOpacity:10});
    assert.equal(data.referenceSrc,null);assert.deepEqual(data.guides.horizontal,[1,2]);assert.deepEqual(data.guides.vertical,[3]);assert.equal(data.referenceOpacity,1);
});
