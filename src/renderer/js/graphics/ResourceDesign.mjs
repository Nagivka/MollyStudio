import {GUI_DESIGNS} from '../core/GuiDesignPresets.mjs';

const hex=value=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value);
const rgb=value=>[1,3,5].map(index=>parseInt(value.slice(index,index+2),16));
function hsv(hue,saturation,value){
    const c=value*saturation,x=c*(1-Math.abs((hue/60)%2-1)),m=value-c;
    const channels=hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
    return '#'+channels.map(channel=>Math.round((channel+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
// Legacy layer effects still use these ramps when reopening saved documents.
const ramp=(hue,saturation,value)=>({
    dark:hsv(hue,Math.max(.95,saturation),value*.3),
    surface:hsv(hue,saturation,value),
    light:hsv(hue,Math.max(.62,saturation-.08),Math.min(1,value+.18))
});
export const RESOURCE_COLORS=Object.freeze([
    ['red','Красный',0],['orange','Оранжевый',28],['yellow','Жёлтый',50],
    ['green','Зелёный',115],['cyan','Голубой',190],['blue','Синий',225],['purple','Фиолетовый',280]
].map(([id,name,hue])=>Object.freeze({id,name,hue,...ramp(hue,1,.9)})));
const shades=[['lightest','Очень светлый',.68,1],['light','Светлый',.82,1],['soft','Мягкий',.95,.98],['','Основной',1,.9],['dark','Тёмный',1,.72],['deep','Очень тёмный',1,.52]];
export const RESOURCE_DESIGNS=Object.freeze(RESOURCE_COLORS.flatMap(color=>shades.map(([suffix,shadeName,saturation,value])=>Object.freeze({
    id:suffix?`${color.id}-${suffix}`:color.id,name:suffix?`${color.name} — ${shadeName}`:color.name,
    family:color.id,familyName:color.name,shadeName,
    ...ramp(color.hue,saturation,value)
}))));
const neutral=()=>({preset:'vanilla',dark:'#373737',surface:'#C6C6C6',light:'#FFFFFF'});
/** An exact user-selected base with a softer automatic contour and highlight. */
export function resourceDesignFromColor(value){
    if(typeof value!=='string')return null;
    let digits=value.trim().replace(/^#/,'');
    if(/^[\da-f]{3}$/i.test(digits))digits=[...digits].map(char=>char+char).join('');
    if(!/^[\da-f]{6}$/i.test(digits))return null;
    const surface='#'+digits.toUpperCase(),[r,g,b]=rgb(surface).map(channel=>channel/255);
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,saturation=max?delta/max:0;
    const hue=delta?((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360:0;
    return {preset:'custom',surface,dark:hsv(hue,saturation?Math.min(1,saturation+.06):0,max*.5),light:hsv(hue,saturation*.86,max+(1-max)*.3)};
}
export function resourceDesignPreset(id='vanilla') {
    if(id==='vanilla')return neutral();
    const preset=RESOURCE_DESIGNS.find(item=>item.id===id);
    if(preset)return {preset:preset.id,dark:preset.dark,surface:preset.surface,light:preset.light};
    // Old saved GUI palettes remain visually identical as custom icon colors.
    const legacy=GUI_DESIGNS.find(item=>item.id===id);
    return legacy?{preset:'custom',dark:legacy.dark,surface:legacy.surface,light:legacy.light}:neutral();
}
export function normalizeResourceDesign(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    if(value.preset!=='custom'){
        const preset=resourceDesignPreset(value.preset);
        if(preset.preset!=='custom')return preset;
        return {preset:'custom',...Object.fromEntries(['dark','surface','light'].map(key=>[key,hex(value[key])?value[key].toUpperCase():preset[key]]))};
    }
    const defaults=resourceDesignPreset();
    return {preset:'custom',...Object.fromEntries(['dark','surface','light'].map(key=>[key,hex(value[key])?value[key].toUpperCase():defaults[key]]))};
}
/** A live shade ramp over the neutral source. Alpha and source pixels stay intact. */
export function applyResourceDesign(image,value) {
    const design=normalizeResourceDesign(value);
    if(!design||design.preset==='vanilla')return image;
    const dark=rgb(design.dark),surface=rgb(design.surface),light=rgb(design.light),data=image.data;
    for(let i=0;i<data.length;i+=4){
        if(!data[i+3])continue;
        const shade=(data[i]+data[i+1]+data[i+2])/3,upper=shade>=198;
        const a=upper?surface:dark,b=upper?light:surface,t=Math.max(0,Math.min(1,upper?(shade-198)/57:(shade-36)/162));
        for(let c=0;c<3;c++)data[i+c]=Math.round(a[c]+(b[c]-a[c])*t);
    }
    return image;
}
