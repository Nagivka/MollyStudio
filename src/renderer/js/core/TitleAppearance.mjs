import {TITLE_MATERIAL_CATALOG} from './TitleMaterialCatalog.mjs';

const finite=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.round(Math.max(min,Math.min(max,Number(value)))*1000)/1000:fallback;
const hex=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value))?value.toUpperCase():fallback;
const imageChecks=new WeakMap();
function hash(value){
 let first=2166136261,second=2246822507;
 for(let i=0;i<value.length;i++){const n=value.charCodeAt(i);first=Math.imul(first^n,16777619);second=Math.imul(second^n,3266489909);}
 return (first>>>0).toString(36)+'_'+(second>>>0).toString(36);
}
function checkedImage(value,previous){
 if(previous&&previous.value===value)return previous;
 if(typeof value!=='string'||value.length>8*1024*1024+64||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return {value:null,key:null};
 return {value,key:value.length.toString(36)+'_'+hash(value)};
}
export const TITLE_BLENDS=Object.freeze(['multiply','screen','overlay','soft-light','hard-light','darken','lighten','color-dodge','color-burn','difference','exclusion','hue','saturation','color','luminosity','source-over']);
export const titleMaterialCatalog=font=>TITLE_MATERIAL_CATALOG.fonts[font];
export function normalizeTitleAppearance(value={},font){
 if(!value||typeof value!=='object'||Array.isArray(value))value={};
 const previous=imageChecks.get(value),image=checkedImage(value.image,previous?.image),overlayImage=checkedImage(value.overlayImage,previous?.overlayImage);
 const stops=Array.isArray(value.stops)?value.stops.slice(0,5):[];
 const result={
  source:['texture','gradient','tileable','file'].includes(value.source)?value.source:'texture',
  stops:stops.length>=2?stops.map((stop,index)=>({color:hex(stop?.color,index?'#DA371E':'#FFCF76'),at:finite(stop?.at,index/(stops.length-1),0,1)})):[{color:'#FFCF76',at:0},{color:'#DA371E',at:1}],
  smooth:value.smooth!==false,edgeBrightness:finite(value.edgeBrightness,35,0,100),textureResolution:[1,2,4].includes(Number(value.textureResolution))?Number(value.textureResolution):1,
  tileable:Object.hasOwn(TITLE_MATERIAL_CATALOG.tileables,value.tileable)?value.tileable:'cobblestone',tileScale:finite(value.tileScale,2,.05,20),tileX:finite(value.tileX,0,-256,256),tileY:finite(value.tileY,0,-256,256),randomRotation:!!value.randomRotation,randomMirror:!!value.randomMirror,
  image:image.value,fileMode:value.fileMode==='tileable'?'tileable':'atlas',
  overlay:typeof value.overlay==='string'&&value.overlay.length<100?value.overlay:'none',overlayOpacity:finite(value.overlayOpacity,100,0,100),overlayBlend:TITLE_BLENDS.includes(value.overlayBlend)?value.overlayBlend:'overlay',overlayColorBlend:TITLE_BLENDS.includes(value.overlayColorBlend)?value.overlayColorBlend:'multiply',overlayColor:hex(value.overlayColor,'#FFFFFF'),overlayImage:overlayImage.value,disableFontOverlay:!!value.disableFontOverlay,
  hue:finite(value.hue,0,-180,180),saturation:finite(value.saturation,100,0,200),brightness:finite(value.brightness,100,0,200),contrast:finite(value.contrast,100,0,200),
  tint:hex(value.tint,'#FFFFFF'),tintOpacity:finite(value.tintOpacity,100,0,100),tintBlend:TITLE_BLENDS.includes(value.tintBlend)?value.tintBlend:'multiply',
  customBorder:!!value.customBorder,borderColor:hex(value.borderColor,'#000000'),customEdge:!!value.customEdge,edgeColor:hex(value.edgeColor,'#000000'),fadeToBorder:!!value.fadeToBorder
 };
 if(font&&!titleMaterialCatalog(font)?.overlays.some(item=>item.id===result.overlay))result.overlay='none';
 imageChecks.set(result,{image,overlayImage});return result;
}
export function titleMaterialRecord(font,value){
 const items=titleMaterialCatalog(font)?.textures||[];
 return items.find(record=>record.id===value)||items.find(record=>record.sourceId===value)||items.find(record=>record.id==='none');
}
export function titleMaterialState(settings,font=settings.font){
 const appearance=normalizeTitleAppearance(settings.appearance,font),record=titleMaterialRecord(font,settings.texture);
 const source=appearance.source==='texture'?record:titleMaterialRecord(font,'none');
 const overlay=titleMaterialCatalog(font)?.overlays.find(item=>item.id===appearance.overlay)||null;
 const recipe={appearance,originalColors:settings.originalColors!==false,top:settings.top,bottom:settings.bottom,side:settings.side};
 const checks=imageChecks.get(appearance),identity={...appearance,image:checks.image.key,overlayImage:checks.overlayImage.key};
 const isDefault=JSON.stringify(identity)===DEFAULT_APPEARANCE&&settings.originalColors!==false;
 const key=font+'-'+record.sourceId+(isDefault?'':'-'+hash(JSON.stringify({...recipe,appearance:identity})));
 return {font,key,source,record,overlay,appearance,recipe};
}
const DEFAULT_APPEARANCE=JSON.stringify(normalizeTitleAppearance());
