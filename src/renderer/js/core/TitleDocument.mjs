import {TITLE_FONT_CATALOG} from './TitleFontCatalog.mjs';
import {normalizeTitleAppearance,titleMaterialRecord} from './TitleAppearance.mjs';
import {titleLanguageModes,titleLanguageForLine,titleFontForLanguage,TITLE_TEXT_LANGUAGES} from './TitleLanguages.mjs';

const number=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)))):fallback;
const precise=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.round(Number(value)*1000)/1000)):fallback;
const color=(value,fallback)=>/^#[a-f0-9]{6}$/i.test(String(value))?value.toUpperCase():fallback;

export const TITLE_FONTS=Object.freeze(Object.keys(TITLE_FONT_CATALOG));
export function titleMaterials(font){return [...(TITLE_FONT_CATALOG[font]?.materials||['none'])];}

export const DEFAULT_TITLE_TRANSFORM=Object.freeze({position:Object.freeze([0,0,0]),rotation:Object.freeze([0,0,0]),scale:Object.freeze([1,1,1]),visible:true,locked:false});
export function normalizeTitleTransform(value={}){
    if(!value||typeof value!=='object')value={};
    const vector=(key,fallback,min,max)=>[0,1,2].map(i=>{const n=Number(value[key]?.[i]);return Number.isFinite(n)?Math.round(Math.max(min,Math.min(max,n))*1000)/1000:fallback;});
    return {position:vector('position',0,-4096,4096),rotation:vector('rotation',0,-180,180),scale:vector('scale',1,.01,20),visible:value.visible!==false,locked:value.locked===true};
}
function normalizeTransforms(value){
    const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
    for(const [id,transform] of Object.entries(value).slice(0,4096))if(/^row-\d+(?:\/char-\d+-[a-f0-9]+(?:\/cube-\d+)?)?$/.test(id))result[id]=normalizeTitleTransform(transform);
    return result;
}

export function normalizeTitleDocument(value={}) {
    if(!value||typeof value!=='object'||Array.isArray(value))value={};
    const text=String(value.text??'MINECRAFT').normalize('NFC').replace(/\r/g,'').split('\n').slice(0,3).map(line=>[...line.replace(/[\u0000-\u001f]/g,' ')].slice(0,64).join('')).join('\n');
    const rowLanguages=[0,1,2].map(index=>titleLanguageModes.includes(value.rowLanguages?.[index])?value.rowLanguages[index]:'auto');
    const language=titleLanguageForLine(text.split('\n')[0],rowLanguages[0],value.font);
    const requestedFont=TITLE_FONTS.includes(value.font)?value.font:'minecraft-ten';
    const font=titleFontForLanguage(requestedFont,language)||TITLE_TEXT_LANGUAGES[language].font,materials=titleMaterials(font);
    const fallback=font==='minecraft-ten'?'stone':'none';
    const settings=(item,defaults,index)=>{
        const source=item&&typeof item==='object'&&!Array.isArray(item)?item:{};
        const language=titleLanguageForLine(text.split('\n')[index]||'',rowLanguages[index],source.font||defaults.font);
        const font=titleFontForLanguage(TITLE_FONTS.includes(source.font)?source.font:defaults.font,language)||TITLE_TEXT_LANGUAGES[language].font;
        return {font,texture:titleMaterialRecord(font,source.texture??defaults.texture).id,
            role:['auto','top','bottom','small'].includes(source.role)?source.role:'auto',
            spacing:precise(source.spacing,defaults.spacing,0,20),lineGap:precise(source.lineGap,defaults.lineGap,-4,20),
            depth:number(source.depth,defaults.depth,0,48),
            creeperA:typeof source.creeperA==='boolean'?source.creeperA:defaults.creeperA,
            scale:[0,1,2].map(i=>precise(source.scale?.[i],defaults.scale?.[i]??1,.05,4)),
            kerning:typeof source.kerning==='boolean'?source.kerning:defaults.kerning,terminators:typeof source.terminators==='boolean'?source.terminators:defaults.terminators,
            originalColors:typeof source.originalColors==='boolean'?source.originalColors:defaults.originalColors,top:color(source.top,defaults.top),bottom:color(source.bottom,defaults.bottom),side:color(source.side,defaults.side),
            appearance:normalizeTitleAppearance(source.appearance??defaults.appearance,font)};
    };
    const result={
        text,rowLanguages,
        transforms:normalizeTransforms(value.transforms),font,layout:value.layout==='stacked'?'stacked':'logo',
        spacing:precise(value.spacing,TITLE_FONT_CATALOG[font].characterSpacing||0,0,20),lineGap:precise(value.lineGap,0,-4,20),depth:number(value.depth,22,0,48),
        meshMode:value.meshMode==='solid'?'solid':'original',
        scale:[0,1,2].map(i=>precise(value.scale?.[i],1,.05,4)),kerning:value.kerning!==false,terminators:!!value.terminators,
        outline:value.outline===0||value.outline===false?0:1,creeperA:value.creeperA!==false,
        texture:titleMaterialRecord(font,value.texture??fallback).id,
        subtitleTexture:value.subtitleTexture==='same'?'same':materials.includes(value.subtitleTexture)?value.subtitleTexture:materials.includes('gold')?'gold':'none',
        originalColors:value.originalColors!==false,
        top:color(value.top,'#BEB9AA'),bottom:color(value.bottom,'#918D82'),side:color(value.side,'#282A2A'),
        projection:value.projection==='orthographic'?'orthographic':'perspective',
        yaw:precise(value.yaw,0,-180,180),pitch:precise(value.pitch,-28,-80,80),zoom:precise(value.zoom,100,10,600),
        cameraTarget:[0,1,2].map(i=>precise(value.cameraTarget?.[i],0,-4096,4096)),
        resolution:[1024,2048,4096].includes(Number(value.resolution))?Number(value.resolution):2048,
        output:value.output==='square'?'square':'auto',padding:number(value.padding,24,0,128)
    };
    result.appearance=normalizeTitleAppearance(value.appearance,font);
    result.rows=[0,1,2].map(index=>value.rows?.[index]&&typeof value.rows[index]==='object'?settings(value.rows[index],result,index):null);
    return result;
}

export function titleRowSettings(data,index){
    const row=index<0?null:data.rows?.[index];
    index=Math.max(0,index);
    const role=data.layout==='logo'?(index===0?'top':index===1?'bottom':'small'):'top';
    const value={...data,texture:index>0&&data.subtitleTexture!=='same'?data.subtitleTexture:data.texture,...row,role:row?.role&&row.role!=='auto'?row.role:role};
    const language=titleLanguageForLine(data.text.split('\n')[index]||'',data.rowLanguages?.[index],value.font);
    const font=titleFontForLanguage(value.font,language)||TITLE_TEXT_LANGUAGES[language].font;
    return {...value,font,language,texture:titleMaterialRecord(font,value.texture).id,appearance:normalizeTitleAppearance(value.appearance,font)};
}

export function addTitleRow(value){
    const data=normalizeTitleDocument(value),lines=data.text.split('\n');
    if(lines.length>=3)return null;
    data.rows=lines.map((_,index)=>({...data.rows[index],role:titleRowSettings(data,index).role}));
    data.layout='stacked';
    data.rows[lines.length]={role:'top'};data.rowLanguages[lines.length]='auto';
    data.text=[...lines,''].join('\n');
    return normalizeTitleDocument(data);
}

export function removeTitleRow(value,index){
    const data=normalizeTitleDocument(value),lines=data.text.split('\n');
    if(lines.length<=1||!Number.isInteger(index)||index<0||index>=lines.length)return null;
    // Capture automatic roles before indices change, preserving each remaining heading.
    const rows=lines.map((_,row)=>({...data.rows[row],role:titleRowSettings(data,row).role}));
    lines.splice(index,1);rows.splice(index,1);data.rowLanguages.splice(index,1);
    data.text=lines.join('\n');data.rows=rows;data.rowLanguages.push('auto');
    const transforms={};
    for(const [id,transform] of Object.entries(data.transforms)){
        const row=Number(/^row-(\d+)/.exec(id)[1]);
        if(row!==index)transforms[id.replace(/^row-\d+/,`row-${row>index?row-1:row}`)]=transform;
    }
    data.transforms=transforms;
    return normalizeTitleDocument(data);
}
