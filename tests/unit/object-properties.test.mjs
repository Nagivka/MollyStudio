import test from 'node:test';
import assert from 'node:assert/strict';
import {describeObject,isObjectLocked} from '../../src/renderer/js/core/ObjectProperties.mjs';

test('property controls use editable metadata rather than arbitrary layer names',()=>{
    for(const name of ['Прямоугольник','Контур круга','Линия','Текст'])assert.equal(describeObject({name,type:'bitmap',objectType:'rect-filled'}).kind,'bitmap');
    assert.equal(describeObject({type:'text',textData:{}}).kind,'text');
    assert.equal(describeObject({isBase:true,type:'bitmap'}).kind,'template');
    assert.equal(describeObject({type:'group'}).kind,'group');
});

test('each shape exposes its actual geometry capabilities',()=>{
    assert.deepEqual(Object.fromEntries(['radius','stroke','fill'].map(key=>[key,Boolean(describeObject({shapeData:{type:'rect-filled'}})[key])])),{radius:true,stroke:false,fill:true});
    const outline=describeObject({shapeData:{type:'circle-empty',filled:false}});assert.ok(outline.stroke&&outline.fill&&!outline.radius);
    const line=describeObject({shapeData:{type:'line'}});assert.ok(line.stroke&&!line.fill&&!line.radius);
});

test('object locks follow parent groups but visibility does not block appearance controls',()=>{
    const group={id:'g',isGroup:true,locked:true},child={id:'c',groupId:'g',locked:false};
    assert.ok(isObjectLocked(child,[group,child]));group.locked=false;group.visible=false;
    assert.equal(isObjectLocked(child,[group,child]),false);
    child.groupId='c';assert.ok(isObjectLocked(child,[child]));
});
