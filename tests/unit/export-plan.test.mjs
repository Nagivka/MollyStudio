import test from 'node:test';
import assert from 'node:assert/strict';
import {safeFileStem,uniqueExportNames,parsePrefixList,planSpriteSheet} from '../../src/renderer/js/graphics/ExportPlan.mjs';
import {createExportArchive,crc32} from '../../src/renderer/js/graphics/ExportArchive.mjs';

test('export filenames are safe on Windows and collision-free ignoring case',()=>{
    assert.equal(safeFileStem('CON'),'_CON');assert.equal(safeFileStem('../a:b?. '),'.._a_b_');
    assert.deepEqual(uniqueExportNames(['VIP','vip','VIP_2']),['VIP.png','vip_2.png','VIP_2_2.png']);
    assert.equal(safeFileStem('...'),'image');assert.ok(uniqueExportNames(['имя'],{numbered:true})[0].startsWith('001_'));
});

test('duplicate export names preserve supplementary Unicode characters when adding a suffix',()=>{
    const name='a'.repeat(87)+'🎨'+'tail',names=uniqueExportNames([name,name,name]);
    assert.equal(new Set(names).size,3);
    for(const filename of names)assert.equal(new TextDecoder().decode(new TextEncoder().encode(filename)),filename);
    assert.ok(names[1].endsWith('🎨_2.png'));
});

test('batch prefix text is bounded and never silently truncates names',()=>{
    assert.deepEqual(parsePrefixList(' VIP\r\n\n ADMIN '),['VIP','ADMIN']);
    assert.throws(()=>parsePrefixList('a'.repeat(65)),/64/);assert.throws(()=>parsePrefixList('x\n'.repeat(201)),/200/);
});

test('sprite sheet places variable-sized images in bounded cells',()=>{
    const plan=planSpriteSheet([{width:4,height:3},{width:8,height:2},{width:1,height:9}],{columns:2,gap:2});
    assert.equal(plan.width,18);assert.equal(plan.height,20);assert.deepEqual(plan.frames[2],{x:0,y:11,width:1,height:9});
    assert.throws(()=>planSpriteSheet([{width:16385,height:1}]),/велик/);
});

test('ZIP headers, UTF-8 names, offsets and CRCs describe their exact stored bytes',()=>{
    const data=new TextEncoder().encode('123456789');assert.equal(crc32(data),0xcbf43926);
    const archive=createExportArchive([{name:'префикс.png',data},{name:'manifest.json',data:'{}'}]),view=new DataView(archive.buffer);
    assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint16(6,true),0x800);
    assert.equal(view.getUint32(14,true),0xcbf43926);const length=view.getUint16(26,true);
    assert.equal(new TextDecoder().decode(archive.slice(30,30+length)),'префикс.png');
    const end=archive.length-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+10,true),2);
    assert.equal(view.getUint32(view.getUint32(end+16,true),true),0x02014b50);
    assert.throws(()=>createExportArchive([{name:'../bad',data}]),/имя/);
    assert.throws(()=>createExportArchive([{name:'A',data},{name:'a',data}]),/имя/);
});
