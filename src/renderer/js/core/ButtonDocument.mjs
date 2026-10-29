import ButtonRenderer,{normalizeButtonStyle} from '../graphics/ButtonRenderer.js';

const hex=(value,fallback)=>typeof value==='string'&&/^#[\da-f]{6}$/i.test(value)?value.toUpperCase():fallback;
const integer=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
export function normalizeButtonData(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const colors=value.colors||{};
    const map=value.sourceMap;
    const sourceMap=map&&Number.isInteger(map.width)&&Number.isInteger(map.height)&&map.width>0&&map.width<=4096&&map.height>0&&map.height<=4096&&Array.isArray(map.matrix)&&map.matrix.length===6&&map.matrix.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000)?{width:map.width,height:map.height,matrix:[...map.matrix]}:null;
    return {version:1,sourceMap,width:integer(value.width,1,4096,18),height:integer(value.height,1,4096,18),
        style:normalizeButtonStyle(value.style),colorMode:value.colorMode==='gradient'?'gradient':'solid',
        baseColor:hex(value.baseColor,'#C5C5C5'),autoShade:value.autoShade!==false,tintedBorder:value.tintedBorder===true,
        transparentBorder:value.transparentBorder===true,opacity:integer(value.opacity,0,100,100),chin:integer(value.chin,1,5,1),bevel:integer(value.bevel,1,5,1),
        gradientAngle:integer(value.gradientAngle,0,360,90),gradientColors:Array.isArray(value.gradientColors)&&value.gradientColors.length>=2?value.gradientColors.slice(0,8).map(color=>hex(color,'#C5C5C5')):['#3B82F6','#1D4ED8'],
        colors:{border:hex(colors.border,'#000000'),highlight:hex(colors.highlight,'#ECECEC'),shadow:hex(colors.shadow,'#7C7C7C'),surface:hex(colors.surface,'#C5C5C5')}};
}
export function renderButtonData(data){
    const spec=normalizeButtonData(data);if(!spec)throw Error('Некорректные параметры кнопки.');
    const renderer=new ButtonRenderer();
    Object.assign(renderer,{colorMode:spec.colorMode,gradientColors:spec.gradientColors,gradientAngle:spec.gradientAngle,autoShadeEnabled:spec.autoShade,tintedBorderEnabled:spec.tintedBorder});
    const colors=spec.autoShade?renderer.calculateMinecraftShades(spec.baseColor,spec.tintedBorder):{...spec.colors,surface:spec.baseColor};
    const base=renderer.renderButton(spec.width,spec.height,colors,spec.style,spec.opacity,spec.transparentBorder,spec.chin,spec.bevel);
    if(!spec.sourceMap||spec.sourceMap.width===base.width&&spec.sourceMap.height===base.height&&spec.sourceMap.matrix.every((value,index)=>value===[base.width,0,0,base.height,0,0][index])){
        base.buttonSourceMap={width:base.width,height:base.height,matrix:[base.width,0,0,base.height,0,0]};return base;
    }
    const canvas=document.createElement('canvas');canvas.width=spec.sourceMap.width;canvas.height=spec.sourceMap.height;
    const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.transform(...spec.sourceMap.matrix);ctx.drawImage(base,0,0,1,1);
    canvas.buttonSourceMap=structuredClone(spec.sourceMap);base.width=base.height=1;return canvas;
}
