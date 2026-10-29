import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDraggedColor} from '../../src/renderer/js/ui/ColorDragDrop.js';

test('dragged colors normalize HEX and opaque browser RGB only',()=>{
    assert.equal(normalizeDraggedColor(' #a1b2c3 '),'#A1B2C3');
    assert.equal(normalizeDraggedColor('rgb(12, 255, 0)'),'#0CFF00');
    assert.equal(normalizeDraggedColor('rgba(1, 2, 3, 1)'),'#010203');
    for(const value of ['red','#fff','rgb(300, 0, 0)','rgba(1, 2, 3, .5)','<script>','#123456/path'])assert.equal(normalizeDraggedColor(value),null);
});
