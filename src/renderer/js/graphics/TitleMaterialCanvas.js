import {TITLE_FONT_CATALOG} from '../core/TitleFontCatalog.mjs';
import {TITLE_FONT_MODELS} from '../utils/TitleFontModels.js';

const canvas=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});
function gradient(ctx,stops,start,end,smooth){
 stops=[...stops].sort((a,b)=>a.at-b.at);
 const paint=ctx.createLinearGradient(0,start,0,Math.max(start+.001,end));
 if(smooth)for(const stop of stops)paint.addColorStop(stop.at,stop.color);
 else for(let i=0;i<stops.length;i++){
  const from=i?(stops[i-1].at+stops[i].at)/2:0,to=i+1<stops.length?(stops[i].at+stops[i+1].at)/2:1;
  paint.addColorStop(from,stops[i].color);paint.addColorStop(to,stops[i].color);
 }
 return paint;
}

// Keep each glyph's front, top and underside aligned in atlas space. Restarting
// a pattern at every cuboid creates seams across letters made of several boxes.
function tileGlyphs(ctx,state,font,tile,width,height){
 const a=state.appearance,sy=height/(font.textureHeight||320);
 const shifted=canvas(tile.width,tile.height),paint=shifted.getContext('2d');paint.imageSmoothingEnabled=false;
 const pattern=paint.createPattern(tile,'repeat');pattern.setTransform(new DOMMatrix().translate(-a.tileX,-a.tileY));paint.fillStyle=pattern;paint.fillRect(0,0,shifted.width,shifted.height);
 const w=Math.max(1,Math.round(tile.width*a.tileScale)),h=Math.max(1,Math.round(tile.height*a.tileScale));
 const fract=n=>n-Math.floor(n),random=(x,y,z)=>{x=fract(x*.1031);y=fract(y*.1031);z=fract(z*.1031);const q=x*(z+31.32)+y*(y+31.32)+z*(x+31.32);return fract((x+y+q*2)*(z+q));};
 const draw=(area,index,region)=>{
  const [x0,y0,x1,y1,start=0]=area;if(x1<=x0||y1<=y0)return;
  ctx.save();ctx.beginPath();ctx.rect(x0,y0,x1-x0,y1-y0);ctx.clip();ctx.fillStyle='#FFFFFF';ctx.fillRect(x0,y0,x1-x0,y1-y0);
  const stamp=(x,y,salt)=>{ctx.save();ctx.translate(x0+x+w/2,y0+y+h/2);if(a.randomRotation){const turns=Math.floor(random(index+salt,x,y)*4);ctx.rotate((tile.width===tile.height?turns:(turns%2)*2)*Math.PI/2);}if(a.randomMirror&&random(index+400,x,y)<.5)ctx.scale(-1,1);ctx.drawImage(shifted,-w/2,-h/2,w,h);ctx.restore();};
  if(region===1){for(let y=y1-y0;y>0;y-=h)for(let x=0;x<x1-x0;x+=w)stamp(x,y-h,200);}
  else{
   for(let y=start;y<y1-y0;y+=h)for(let x=0;x<x1-x0;x+=w)stamp(x,y,region===2?300:0);
   for(let y=start;y>0;y-=h)for(let x=0;x<x1-x0;x+=w)stamp(x,y-h,100);
  }
  ctx.restore();
 };
 let index=0;
 for(const elements of Object.values(TITLE_FONT_MODELS[state.font].characters)){
  const regions=[null,null,null];
  for(const cube of elements)for(const face of Object.values(cube.faces)){
   const raw=face?.uv||face;if(!Array.isArray(raw))continue;
   const uv=raw.map((n,i)=>Math.round(n/16*(i%2?height:width))),lo=Math.min(uv[1],uv[3]),hi=Math.max(uv[1],uv[3]);
   const front=font.faces.find(row=>lo>=row[0]*sy&&hi<=row.at(-1)*sy);
   const top=!front&&font.ends.find(row=>lo>=row[0]*sy&&hi<=row[1]*sy);
   const bottom=!front&&!top&&font.ends.find(row=>lo>=row[2]*sy&&hi<=row[3]*sy);
   const region=front?0:top?1:bottom?2:-1;if(region<0)continue;
   const row=front||top||bottom,y0=front?row[0]:row[region===1?0:2],y1=front?row.at(-1):row[region===1?1:3];
   const x0=Math.min(uv[0],uv[2]),x1=Math.max(uv[0],uv[2]);
   if(!regions[region])regions[region]=[x0,y0*sy,x1,y1*sy,front?.length===4?(front[1]-front[0])*sy:0];
   else{regions[region][0]=Math.min(regions[region][0],x0);regions[region][2]=Math.max(regions[region][2],x1);}
  }
  regions.forEach((area,region)=>{if(area)draw(area,index,region);});index++;
 }
 shifted.width=shifted.height=1;
}

/** Bake the reference atlas operations; colors stay attached to model UVs. */
export function composeTitleMaterial(state,base,{tile,overlay,fontOverlay}={}){
 const a=state.appearance,font=TITLE_FONT_CATALOG[state.font],factor=a.source==='gradient'?4:a.textureResolution;
 const orderedStops=[...a.stops].sort((a,b)=>a.at-b.at);
 const output=canvas(Math.min(4000,base.width*factor),Math.min(1280,base.height*factor)),ctx=output.getContext('2d');
 const sy=output.height/(font.textureHeight||320);
 ctx.imageSmoothingEnabled=false;ctx.drawImage(base,0,0,output.width,output.height);
 const ends=font.ends||[[0,22,62,84]],faces=font.faces||[[22,62]];
 const eachEnd=fn=>{for(const e of ends)for(const [start,end] of [[e[0],e[1]],[e[2],e[3]]])if(end>start)fn(start*sy,end*sy);};
 if(a.source==='gradient'){
  ctx.globalCompositeOperation='source-atop';
  for(let i=0;i<faces.length;i++){
   const face=faces[i],edge=ends[i],start=face.length===4?face[1]:face[0],end=face.length===4?face[2]:face[1];
   ctx.fillStyle=orderedStops[0].color;ctx.fillRect(0,edge[0]*sy,output.width,(start-edge[0])*sy);
   ctx.fillStyle=gradient(ctx,orderedStops,start*sy,end*sy,a.smooth);ctx.fillRect(0,start*sy,output.width,(end-start)*sy);
   ctx.fillStyle=orderedStops.at(-1).color;ctx.fillRect(0,end*sy,output.width,(edge[3]-end)*sy);
  }
 }else if(tile){
  ctx.globalCompositeOperation='source-atop';
  tileGlyphs(ctx,state,font,tile,output.width,output.height);
 }
 if(a.source==='gradient'||tile){
  ctx.globalCompositeOperation='source-atop';ctx.fillStyle=`rgba(0,0,0,${(100-a.edgeBrightness)/100})`;eachEnd((start,end)=>ctx.fillRect(0,start,output.width,end-start));
  if(fontOverlay&&!a.disableFontOverlay){ctx.globalCompositeOperation='source-over';ctx.drawImage(fontOverlay,0,0,output.width,output.height);}
 }
 if(state.recipe.originalColors===false){
  ctx.globalCompositeOperation='multiply';
  for(const face of faces){const start=(face.length===4?face[1]:face[0])*sy,end=(face.length===4?face[2]:face[1])*sy;ctx.fillStyle=gradient(ctx,[{color:state.recipe.top,at:0},{color:state.recipe.bottom,at:1}],start,end,true);ctx.fillRect(0,start,output.width,end-start);}
  ctx.fillStyle=state.recipe.side;eachEnd((start,end)=>ctx.fillRect(0,start,output.width,end-start));
 }
 if(a.hue||a.saturation!==100||a.brightness!==100||a.contrast!==100){
  const filtered=canvas(output.width,output.height),f=filtered.getContext('2d');f.filter=`hue-rotate(${a.hue}deg) saturate(${a.saturation}%) brightness(${a.brightness}%) contrast(${a.contrast}%)`;f.drawImage(output,0,0);ctx.clearRect(0,0,output.width,output.height);ctx.globalCompositeOperation='source-over';ctx.drawImage(filtered,0,0);filtered.width=filtered.height=1;
 }
 if(a.tintOpacity){ctx.globalCompositeOperation=a.tintBlend;ctx.globalAlpha=a.tintOpacity/100;ctx.fillStyle=a.tint;ctx.fillRect(0,0,output.width,output.height);ctx.globalAlpha=1;}
 if(a.customEdge){ctx.globalCompositeOperation='source-atop';ctx.fillStyle=a.edgeColor;eachEnd((start,end)=>ctx.fillRect(0,start,output.width,end-start));}
 if(overlay){
  const tinted=canvas(overlay.width,overlay.height),t=tinted.getContext('2d');t.drawImage(overlay,0,0);t.globalCompositeOperation=a.overlayColorBlend;t.fillStyle=a.overlayColor;t.fillRect(0,0,tinted.width,tinted.height);t.globalCompositeOperation='destination-in';t.drawImage(overlay,0,0);
  ctx.globalCompositeOperation=a.overlayBlend;ctx.globalAlpha=a.overlayOpacity/100;ctx.drawImage(tinted,0,0,output.width,output.height);ctx.globalAlpha=1;tinted.width=tinted.height=1;
 }
 if(a.customBorder){ctx.globalCompositeOperation='source-atop';ctx.fillStyle=a.borderColor;ctx.fillRect(0,font.border*sy,output.width,output.height-font.border*sy);}
 if(a.fadeToBorder){
  ctx.globalCompositeOperation='source-atop';
  const p=ctx.getImageData(0,Math.min(output.height-1,Math.round(font.border*sy)),1,1).data,solid=`rgb(${p[0]},${p[1]},${p[2]})`,clear=`rgba(${p[0]},${p[1]},${p[2]},0)`;
  for(let i=0;i<ends.length;i++){const e=ends[i],g=ctx.createLinearGradient(0,e[0]*sy,0,e[3]*sy);g.addColorStop(0,solid);g.addColorStop((e[1]-e[0])/(e[3]-e[0]),clear);g.addColorStop((e[2]-e[0])/(e[3]-e[0]),clear);g.addColorStop(1,solid);ctx.fillStyle=g;ctx.fillRect(0,e[0]*sy,output.width,(e[3]-e[0])*sy);}
 }
 // Composition/blending must never paint into the reference's transparent cutouts.
 ctx.globalAlpha=1;ctx.globalCompositeOperation='destination-in';ctx.drawImage(base,0,0,output.width,output.height);ctx.globalCompositeOperation='source-over';
 return output;
}
