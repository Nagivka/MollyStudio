import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { smallCaps, gradientCharacters, formatGradient, normalizeColors } from '../../src/renderer/js/utils/MinecraftUtilities.mjs';
import { MINECRAFT_BLOCKS } from '../../src/renderer/js/utils/MinecraftBlocks.js';

test('small caps converts Russian and English while preserving emoji', () => {
    assert.equal(smallCaps('Admin Привет 🚀'), 'ᴀᴅᴍɪɴ пᴘиʙᴇт 🚀');
    assert.equal(smallCaps('Привет', {transliterate:true}), 'ᴘʀɪᴠᴇᴛ');
    assert.equal(smallCaps(smallCaps('Abcxyz'), {reverse:true}), 'abcxyz');
});

test('small caps covers all 33 Russian letters exactly, including case and reverse conversion',()=>{
    const alphabet='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
    const expected='ᴀбʙгдᴇᴇжзийᴋлᴍʜᴏпᴘᴄтуȹxцчшщъыьэюя';
    assert.equal([...alphabet].length,33);assert.equal([...expected].length,33);
    assert.equal(smallCaps(alphabet),expected);
    assert.equal(smallCaps(alphabet.toLowerCase()),expected);
    assert.equal(smallCaps(expected,{reverse:true,language:'ru'}),'абвгдёёжзийклмнопрстуфхцчшщъыьэюя');
    assert.equal(smallCaps('АБВ ABC',{language:'en'}),'АБВ ᴀʙᴄ');
    assert.equal(smallCaps('АБВ ABC',{language:'ru'}),'ᴀбʙ ABC');
});

test('small caps covers the complete English alphabet in both cases and reverse mode',()=>{
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ',expected='ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ';
    assert.equal(smallCaps(alphabet),expected);
    assert.equal(smallCaps(alphabet.toLowerCase()),expected);
    assert.equal(smallCaps(expected,{reverse:true,language:'en'}),alphabet.toLowerCase());
});
test('gradient endpoints and intermediate color stops are exact', () => {
    assert.deepEqual(gradientCharacters('abc', ['#000000','#FF0000','#FFFFFF']).map(char=>char.color), ['#000000','#FF0000','#FFFFFF']);
    assert.equal(gradientCharacters('x', ['#123456','#FFFFFF'])[0].color, '#123456');
    assert.deepEqual(gradientCharacters('', []), []);
    assert.deepEqual(normalizeColors(['invalid', '#aabbcc']), ['#AABBCC']);
});
test('gradient keeps emoji and combining marks intact and optionally skips whitespace', () => {
    assert.equal(gradientCharacters('👨‍👩‍👧‍👦á', ['#000000','#FFFFFF']).length, 2);
    assert.deepEqual(gradientCharacters('a b', ['#000000','#FFFFFF'], {skipSpaces:true}).map(char=>char.color), ['#000000',null,'#FFFFFF']);
    const result = gradientCharacters('a'.repeat(4095)+'🚀', []);
    assert.equal(result.length,4095);
});
test('gradient JSON is roundtrippable and MiniMessage escapes literal input', () => {
    const input = '<bold>"\\\n🚀';
    const json = JSON.parse(formatGradient(input, ['#AABBCC'], 'json', {bold:true}));
    assert.equal(json.extra.map(char=>char.text).join(''),input);
    assert.equal(json.bold,true); assert.equal(json.italic,false);
    const mini = formatGradient('<\\', ['#FFFFFF']);
    assert.ok(mini.includes('\\<')); assert.ok(mini.includes('\\\\'));
});
test('legacy gradient reapplies decorations after every RGB reset and ends with reset', () => {
    assert.equal(formatGradient('ab', ['#FF0000'], 'hex', {bold:true}), '&#FF0000&la&#FF0000&lb&r');
    assert.equal(formatGradient('a', ['#123456'], 'section'), '§x§1§2§3§4§5§6a§r');
    assert.equal(formatGradient('', [], 'hex'), '');
});
test('generated block catalog has unique IDs, translated names and valid transparent PNGs', async () => {
    assert.ok(MINECRAFT_BLOCKS.length>=800);
    assert.equal(new Set(MINECRAFT_BLOCKS.map(item=>item.id)).size,MINECRAFT_BLOCKS.length);
    for (const item of MINECRAFT_BLOCKS) {
        assert.match(item.file,/^[a-z0-9_]+\.png$/);
        const data=await fs.readFile(new URL('../../src/renderer/assets/blocks_minecraft/'+item.file,import.meta.url));
        assert.equal(data.readUInt32BE(16),64);assert.equal(data.readUInt32BE(20),64);assert.equal(data[25],6);
        assert.ok(item.name);assert.equal(item.category,'block_renders');
    }
    assert.equal(MINECRAFT_BLOCKS.find(item=>item.minecraftId==='stone').name,'Камень');
});
