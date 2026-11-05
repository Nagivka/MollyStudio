import {getExportRegion} from './ExportImage.js';

/** Fit to a CSS box using whole physical pixels per source pixel where possible. */
export function fittedPixelScale(width,height,maxWidth,maxHeight,{deviceRatio=1,maxScale=8}={}){
    const ratio=Math.max(.1,Math.min(4,Number(deviceRatio)||1));
    const fit=Math.max(.000001,Math.min(maxWidth/width,maxHeight/height,maxScale))*ratio;
    return (fit>=1?Math.floor(fit+1e-8):fit)/ratio;
}

export function paintFittedPixelPreview(canvas,source,{maxWidth,maxHeight,maxScale=8,region=getExportRegion(source,true),deviceRatio=globalThis.devicePixelRatio||1}={}){
    const scale=fittedPixelScale(region.width,region.height,maxWidth,maxHeight,{deviceRatio,maxScale});
    const size=paintPixelPreview(canvas,source,{region,scale,deviceRatio});alignPixelPreview(canvas);return size;
}

/** One nearest-neighbour resample to physical display pixels; CSS never shrinks the result again. */
export function pixelPreviewSize(width,height,scale=1,deviceRatio=1){
    const ratio=Math.max(.1,Math.min(4,Number(deviceRatio)||1)),zoom=Math.max(.000001,Number(scale)||1);
    const density=Math.min(ratio,8192/(width*zoom),8192/(height*zoom),Math.sqrt(16*1024*1024/(width*height*zoom*zoom)));
    const pixelWidth=Math.max(1,Math.round(width*zoom*density)),pixelHeight=Math.max(1,Math.round(height*zoom*density));
    return {pixelWidth,pixelHeight,width:pixelWidth/density,height:pixelHeight/density,density,scale:zoom};
}
export function paintPixelPreview(canvas,source,{region=getExportRegion(source,true),scale=1,deviceRatio=globalThis.devicePixelRatio||1}={}){
    const size=pixelPreviewSize(region.width,region.height,scale,deviceRatio);
    canvas.width=size.pixelWidth;canvas.height=size.pixelHeight;
    canvas.style.width=`${size.width}px`;canvas.style.height=`${size.height}px`;
    canvas.dataset.sourceWidth=String(region.width);canvas.dataset.sourceHeight=String(region.height);canvas.dataset.previewScale=String(scale);
    const pixels=source.getContext('2d',{willReadFrequently:true}).getImageData(region.x,region.y,region.width,region.height).data;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(size.pixelWidth,size.pixelHeight);
    for(let y=0;y<size.pixelHeight;y++){
        const row=Math.min(region.height-1,Math.floor((y+.5)*region.height/size.pixelHeight))*region.width;
        for(let x=0;x<size.pixelWidth;x++){
            const index=(row+Math.min(region.width-1,Math.floor((x+.5)*region.width/size.pixelWidth)))*4,target=(y*size.pixelWidth+x)*4;
            image.data[target]=pixels[index];image.data[target+1]=pixels[index+1];image.data[target+2]=pixels[index+2];image.data[target+3]=pixels[index+3];
        }
    }
    ctx.putImageData(image,0,0);return size;
}
export function alignPixelPreview(canvas){
    if(!canvas.isConnected)return;
    canvas.style.translate='0px 0px';const r=canvas.getBoundingClientRect(),ratio=globalThis.devicePixelRatio||1;
    canvas.style.translate=`${Math.round(r.left*ratio)/ratio-r.left}px ${Math.round(r.top*ratio)/ratio-r.top}px`;
}

/** Moving a window between monitors can change DPR without changing its CSS size. */
export function watchPixelRatio(callback){
    if(!globalThis.matchMedia)return ()=>{};
    let query;
    const changed=()=>{listen();callback();};
    const listen=()=>{
        query?.removeEventListener('change',changed);
        query=matchMedia(`(resolution: ${globalThis.devicePixelRatio||1}dppx)`);
        query.addEventListener('change',changed,{once:true});
    };
    listen();return ()=>query.removeEventListener('change',changed);
}
