import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenizeBitmapText,layoutBitmapText} from '../../src/renderer/js/graphics/BitmapTextLayout.mjs';
const measure=char=>({advance:char===' '?2:4,offsetY:0});

test('bitmap formatting preserves hard breaks, RGB colors and invalid literal codes',()=>{
    const parsed=tokenizeBitmapText('&aA&#FF0011B&x&0&0&F&F&0&0C&rD\r\n&zE');
    assert.equal(parsed.tokens.map(t=>t.char).join(''),'ABCD\n&zE');
    assert.deepEqual(parsed.tokens.slice(0,4).map(t=>t.color),['#55FF55','#FF0011','#00FF00',null]);
});

test('hard line breaks and empty lines retain their vertical position',()=>{
    const layout=layoutBitmapText(tokenizeBitmapText('A\n\nB').tokens,measure,{lineHeight:12});
    assert.equal(layout.lines.length,3);assert.equal(layout.glyphs[1].y,24);
});

test('word wrapping and alignment use measured widths and split long words',()=>{
    const layout=layoutBitmapText(tokenizeBitmapText('AA BB CCCCC').tokens,measure,{maxWidth:12,align:'right'});
    assert.deepEqual(layout.lines.map(line=>line.glyphs.map(t=>t.char).join('')),['AA','BB','CCC','CC']);
    assert.equal(layout.lines[0].x,4);assert.equal(layout.lines[3].x,4);
});

test('formatting tokens do not change wrapping widths or unsupported glyph counts',()=>{
    const plain=layoutBitmapText(tokenizeBitmapText('ABCD').tokens,measure,{maxWidth:8});
    const colored=layoutBitmapText(tokenizeBitmapText('&aAB&bCD').tokens,measure,{maxWidth:8});
    assert.deepEqual(plain.lines.map(l=>l.width),colored.lines.map(l=>l.width));
});
