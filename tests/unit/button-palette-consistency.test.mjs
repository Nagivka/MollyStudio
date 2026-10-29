import test from 'node:test';
import assert from 'node:assert/strict';
import ButtonGeneratorModel from '../../src/renderer/js/ui/ButtonGeneratorModel.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';

test('a constant gradient matches the same solid auto-shaded button in all five styles',t=>{
    const previous=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};t.after(()=>{globalThis.document=previous;});
    const model=new ButtonGeneratorModel();model.autoShadeEnabled=true;
    for(const base of ['#C5C5C5','#FF2200','#000000','#FFFFFF','#123456'])for(const tinted of [true,false])for(const style of ['default','ten','flat','outline','double']){
        model.tintedBorderEnabled=tinted;model.colorMode='solid';const colors=model.calculateMinecraftShades(base,tinted);
        const solid=model.renderButton(18,18,colors,style,100,false,1,1);
        model.colorMode='gradient';model.gradientColors=[base,base];
        const gradient=model.renderButton(18,18,colors,style,100,false,1,1);
        assert.deepEqual(gradient.data,solid.data,`${base}, tinted ${tinted}, ${style}`);
    }
});

test('disabling the tinted border keeps every gradient border pixel black',t=>{
    const previous=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};t.after(()=>{globalThis.document=previous;});
    const model=new ButtonGeneratorModel();model.colorMode='gradient';model.autoShadeEnabled=true;model.tintedBorderEnabled=false;
    model.gradientColors=['#FF0000','#0000FF'];
    const image=model.renderButton(18,18,model.colors,'ten',100,false,1,1);
    for(let x=0;x<18;x++)assert.deepEqual([...image.data.slice(x*4,x*4+4)],[0,0,0,255]);
});

test('TEN pixels follow the requested outline, closed bevel, face and lower shadow pattern',t=>{
    const previous=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};t.after(()=>{globalThis.document=previous;});
    const model=new ButtonGeneratorModel();model.colorMode='solid';
    const image=model.renderButton(8,8,{border:'#000000',highlight:'#010101',surface:'#020202',shadow:'#030303'},'ten',100,false,1,1);
    const rows=[];for(let y=0;y<8;y++){let row='';for(let x=0;x<8;x++)row+=image.data[(y*8+x)*4];rows.push(row);}
    assert.deepEqual(rows,['00000000','01111110','01222210','01222210','01222210','01111110','03333330','00000000']);
});
