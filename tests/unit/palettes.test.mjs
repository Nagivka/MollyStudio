import test from 'node:test';
import assert from 'node:assert/strict';
import {Palettes,PaletteOptions,paletteOptionsMarkup,populatePaletteSelect} from '../../src/renderer/js/utils/Palettes.js';

test('every useful palette is named, bounded and uses valid unique swatches',()=>{
    assert.equal(PaletteOptions.length,11);
    assert.deepEqual(PaletteOptions.map(([id])=>id),Object.keys(Palettes));
    for(const [id,name] of PaletteOptions){
        assert.ok(name.length>4);
        assert.equal(Palettes[id].length,16);
        assert.equal(new Set(Palettes[id]).size,16);
        assert.ok(Palettes[id].every(color=>/^#[0-9A-F]{6}$/.test(color)));
    }
    assert.equal(Palettes.minecraft[6],'#FFAA00');
    assert.doesNotMatch(paletteOptionsMarkup(),/nord|pico8|dracula|endesga|resurrect|solarized|gameboy|c64/);
});

test('removed palette IDs fall back cleanly and custom palettes stay available',()=>{
    const select={value:'nord',innerHTML:''};populatePaletteSelect(select);
    assert.equal(select.value,'minecraft');assert.ok(select.innerHTML.includes('Золото и бронза'));
    populatePaletteSelect(select,{selected:'ocean'});assert.equal(select.value,'ocean');
    populatePaletteSelect(select,{custom:true,selected:'custom'});assert.equal(select.value,'custom');
    assert.match(select.innerHTML,/Моя палитра/);
    populatePaletteSelect(select,{selected:'custom'});assert.equal(select.value,'minecraft');
});
