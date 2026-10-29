import test from 'node:test';
import assert from 'node:assert/strict';
import {RESOURCE_COLORS,RESOURCE_DESIGNS,applyResourceDesign,normalizeResourceDesign,resourceDesignPreset,resourceDesignFromColor} from '../../src/renderer/js/graphics/ResourceDesign.mjs';
import {GUI_DESIGNS} from '../../src/renderer/js/core/GuiDesignPresets.mjs';
import Layer from '../../src/renderer/js/graphics/Layer.js';
import {RasterCanvas} from '../helpers/raster-canvas.mjs';
import {LayerFXCommand} from '../../src/renderer/js/core/Commands.js';

test('all resource designs preserve alpha and custom ramps keep exact dark/base/light roles',()=>{
    assert.deepEqual(RESOURCE_COLORS.map(item=>item.id),['red','orange','yellow','green','cyan','blue','purple']);
    assert.equal(RESOURCE_DESIGNS.length,42);assert.equal(new Set(RESOURCE_DESIGNS.map(item=>item.id)).size,42);
    const original=Uint8ClampedArray.from([36,36,36,255,198,198,198,128,255,255,255,255,12,34,56,0]);
    const image=()=>({width:4,height:1,data:original.slice()});
    for(const preset of [...RESOURCE_DESIGNS,...GUI_DESIGNS]){const data=applyResourceDesign(image(),resourceDesignPreset(preset.id)).data;for(let i=3;i<data.length;i+=4)assert.equal(data[i],original[i]);assert.deepEqual([...data.slice(12)],[12,34,56,0]);}
    assert.deepEqual(applyResourceDesign(image(),resourceDesignPreset()).data,original);
    const custom=applyResourceDesign(image(),{preset:'custom',dark:'#112233',surface:'#445566',light:'#778899'});
    assert.deepEqual([...custom.data.slice(0,12)],[17,34,51,255,68,85,102,128,119,136,153,255]);
    assert.equal(normalizeResourceDesign([]),null);assert.equal(normalizeResourceDesign({preset:'custom',dark:'bad'}).dark,'#373737');
});

test('each basic color retains its original ramp and gains five distinct ordered shades',()=>{
    const luma=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).reduce((sum,value)=>sum+value,0);
    for(const color of RESOURCE_COLORS){
        const variants=RESOURCE_DESIGNS.filter(item=>item.family===color.id);
        assert.equal(variants.length,6);assert.equal(new Set(variants.map(item=>item.surface)).size,6);
        const original=resourceDesignPreset(color.id);assert.equal(original.dark,color.dark);assert.equal(original.surface,color.surface);assert.equal(original.light,color.light);
        variants.forEach((variant,index)=>{
            if(index)assert.ok(luma(variants[index-1].surface)>luma(variant.surface));
            assert.ok(luma(variant.dark)<luma(variant.surface));assert.ok(luma(variant.surface)<luma(variant.light));
            assert.deepEqual(normalizeResourceDesign(resourceDesignPreset(variant.id)),resourceDesignPreset(variant.id));
        });
    }
});

test('a user-selected HEX color stays exact while its shadow and highlight adapt automatically',()=>{
    for(const color of ['#EE2266','#336699','#000000','#FFFFFF','#808080','#00AA55']){
        const design=resourceDesignFromColor(color);assert.equal(design.surface,color);assert.equal(design.preset,'custom');
        const channels=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),luma=hex=>channels(hex).reduce((sum,c)=>sum+c,0);
        assert.ok(luma(design.dark)<=luma(color));assert.ok(luma(design.light)>=luma(color));
        assert.deepEqual(normalizeResourceDesign(design),design);
        if(['#000000','#FFFFFF','#808080'].includes(color))for(const key of ['dark','light'])assert.equal(new Set(channels(design[key])).size,1);
    }
    assert.equal(resourceDesignFromColor(' f80 ').surface,'#FF8800');
    for(const invalid of [null,123,'#12','zzzzzz','#GG0011','red'])assert.equal(resourceDesignFromColor(invalid),null);
});

test('retired GUI resource palettes reopen as custom colors without changing their appearance',()=>{
    for(const palette of GUI_DESIGNS.filter(item=>item.id!=='vanilla')){
        const saved={preset:palette.id,dark:palette.dark,surface:palette.surface,light:palette.light};
        assert.deepEqual(normalizeResourceDesign(saved),{...saved,preset:'custom'});
    }
    assert.equal(resourceDesignPreset().preset,'vanilla');
});

test('live resource appearance is undoable and never recolors the pristine master',()=>{
    const previous=globalThis.document;globalThis.document={createElement:()=>new RasterCanvas()};
    try{
        const layer=new Layer('icon','Icon',3,1),image={width:3,height:1,data:Uint8ClampedArray.from([36,36,36,255,198,198,198,255,255,255,255,255])};
        layer.ctx.putImageData(image,0,0);const master=layer.cloneCanvas();layer.setMasterSource(master,{x:0,y:0,w:3,h:1});
        layer.setFX({resourceDesign:resourceDesignPreset()});assert.equal(layer.getRenderCanvas(),layer.canvas);
        const original=layer.canvas.data.slice(),command=new LayerFXCommand(layer,layer.fx,{resourceDesign:resourceDesignPreset('sapphire')});
        command.execute();const colored=layer.getRenderCanvas().data.slice();assert.notDeepEqual(colored,original);
        assert.deepEqual(layer.canvas.data,original);assert.deepEqual(master.data,original);assert.equal(layer.sourceCanvas,master);
        command.undo();assert.deepEqual(layer.getRenderCanvas().data,original);command.execute();assert.deepEqual(layer.getRenderCanvas().data,colored);
        layer.setFX({resourceDesign:resourceDesignPreset('vanilla')});assert.deepEqual(layer.canvas.data,original);
    }finally{globalThis.document=previous;}
});
