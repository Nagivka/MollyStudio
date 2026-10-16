import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefixDocument, applyPrefixPreset, validatePrefixDocument } from '../www/js/core/PrefixDocument.mjs';
import { createProjectFromForm, normalizeProjectData, buildEditorUrl } from '../www/js/core/ProjectFactory.mjs';
import { normalizeWorkspaceState } from '../www/js/core/WorkspaceState.mjs';

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
test('unknown or oversized prefix documents fail before image decoding', () => {
    assert.throws(()=>validatePrefixDocument({version:2,blocks:[{text:'VIP'}]}));
    assert.throws(()=>validatePrefixDocument({version:1,blocks:[{text:'a'.repeat(65)}]}));
    assert.equal(validatePrefixDocument(normalizePrefixDocument()).blocks[0].text,'VIP');
});
test('workspace recovery rejects external reference sources and malformed guides', () => {
    const data=normalizeWorkspaceState({referenceSrc:'https://example.com/private.png',guides:{horizontal:[1,1,NaN,Infinity,2],vertical:Array(600).fill(3)},referenceOpacity:10});
    assert.equal(data.referenceSrc,null);assert.deepEqual(data.guides.horizontal,[1,2]);assert.deepEqual(data.guides.vertical,[3]);assert.equal(data.referenceOpacity,1);
});
