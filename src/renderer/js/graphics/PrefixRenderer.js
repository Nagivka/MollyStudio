import { fontMaps, normalizeBitmapText, bitmapGlyphOffsetY, resolveBitmapGlyph } from '../utils/FontData.js';
import { normalizePrefixDocument, PREFIX_LIMITS } from '../core/PrefixDocument.mjs';
import { prefixShadeRamp, prefixTextShadowRamp, prefixPositionSampler, prefixColorSampler } from './PrefixShading.mjs';
import { prefixRoundedRect } from './PrefixGeometry.mjs';
import {applySurfaceTexture} from './SurfaceTexture.mjs';

function canvas(width, height) { const result = document.createElement('canvas'); result.width = width; result.height = height; return result; }
function rgb(hex) { return [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)); }

/** Pixel-only badge renderer. Font atlases and measured glyphs are shared across renders. */
export default class PrefixRenderer {
    constructor() { this.images = {}; this.glyphs = new Map(); this.ready = null; this.blockCache = new Map(); }

    load() {
        if (!this.ready) this.ready = Promise.all(Object.entries({minecraft:'default.png',smallcaps:'smallcaps.png',square:'square.png','minecraft-ten':'ten.png'}).map(([id,file]) => new Promise((resolve,reject) => {
            const image = new Image();
            image.onload = () => { this.images[id] = image; resolve(); };
            image.onerror = () => reject(new Error(`Не удалось загрузить шрифт префикса: ${file}`));
            image.src = `assets/images/${file}`;
        }))).catch(error => { this.ready = null; throw error; });
        return this.ready;
    }

    glyph(character, font) {
        const actual = normalizeBitmapText(character, font);
        let {fontId:id,index} = resolveBitmapGlyph(actual,font), missing = false;
        if (index < 0) { index = fontMaps[id].indexOf('?'); missing = true; }
        // Unknown input characters all draw the same fallback tile. Cache the
        // resolved glyph, so repeated pastes cannot grow thousands of canvases.
        const key = `${id}:${index}:${missing ? 1 : 0}`;
        if (this.glyphs.has(key)) return this.glyphs.get(key);
        const tile = canvas(8,8), ctx = tile.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(this.images[id],index%16*8,Math.floor(index/16)*8,8,8,0,bitmapGlyphOffsetY(id,actual),8,8);
        const pixels = ctx.getImageData(0,0,8,8).data;
        let left=8,right=-1,top=8,bottom=-1;
        for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(pixels[(y*8+x)*4+3]) { left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y); }
        const result = {tile,left:left===8?0:left,width:right<0?3:right-left+1,top,bottom,missing};
        this.glyphs.set(key,result); return result;
    }

    textMask(block) {
        const text = normalizeBitmapText(block.text, block.font);
        const chars = [...text], glyphs = chars.map(char => char===' '?null:this.glyph(char,block.font));
        const missing = [...new Set(chars.filter((_,i)=>glyphs[i]?.missing))];
        let width = 0, top=8, bottom=-1;
        glyphs.forEach((glyph,index) => { width += (glyph?.width ?? 3) + (index<glyphs.length-1?1+block.letterSpacing:0); if(glyph) {top=Math.min(top,glyph.top);bottom=Math.max(bottom,glyph.bottom);} });
        if(bottom<top) {top=0;bottom=6;}
        const mask=canvas(Math.max(1,width),Math.max(1,bottom-top+1)),ctx=mask.getContext('2d');let x=0;
        glyphs.forEach(glyph=>{if(glyph)ctx.drawImage(glyph.tile,glyph.left,top,glyph.width,mask.height,x,0,glyph.width,mask.height);x+=(glyph?.width??3)+1+block.letterSpacing;});
        return {mask,missing};
    }

    renderBlock(block) {
        const {mask:text,missing}=this.textMask(block);
        const content=block.text.length?text:canvas(1,1),cctx=content.getContext('2d');
        let result,colored,complete=false;
        try {
            const border=block.borderWidth,shadowX=block.textShadow?block.textShadowX:0,shadowY=block.textShadow?block.textShadowY:0;
            const w=content.width+block.paddingX*2+border*2+Math.abs(shadowX),h=content.height+block.paddingY*2+border*2+Math.abs(shadowY);
            const contentX=border+block.paddingX+Math.max(0,-shadowX),contentY=border+block.paddingY+Math.max(0,-shadowY);
            result=canvas(w,h);const ctx=result.getContext('2d',{willReadFrequently:true}),image=ctx.createImageData(w,h),d=image.data;
            const autoShade=block.autoShade&&block.background!=='none',ramp=autoShade?prefixShadeRamp(block):null;
            const backgroundPosition=prefixPositionSampler(block.backgroundAngle,w,h);
            const backgroundColor=prefixColorSampler(block.background==='solid'?[block.backgroundColors[0]]:block.backgroundColors,block.backgroundAngle,w,h);
            const textColor=prefixColorSampler(block.textMode==='solid'?[block.textColors[0]]:block.textColors,block.textAngle,content.width,content.height);
            const borderColor=rgb(block.borderColor);
            const manualHighlight=block.highlightColor?rgb(block.highlightColor):null,manualShadow=block.bevelShadowColor?rgb(block.bevelShadowColor):null;
            const corners=[block.radiusTopLeft,block.radiusTopRight,block.radiusBottomRight,block.radiusBottomLeft];
            const inside=prefixRoundedRect(w,h,corners),inner=prefixRoundedRect(w,h,corners,border);
            for(let y=0;y<h;y++)for(let x=0;x<w;x++){
                if(!inside(x,y))continue;
                const edge=border>0&&!inner(x,y);
                if(!edge&&block.background==='none')continue;
                const shades=autoShade?ramp[Math.round(backgroundPosition(x,y)*(ramp.length-1))]:null;
                let col=shades?(edge?shades.border:shades.surface):edge?borderColor:backgroundColor(x,y);
                if(!edge&&block.bevel&&block.background!=='none') {
                    const highlight=!inner(x,y-1),shade=!inner(x,y+1);
                    if(highlight||shade)col=shades?(highlight?shades.highlight:shades.shadow):highlight?(manualHighlight||col.map(value=>Math.round(value+(255-value)*.28))):(manualShadow||col.map(value=>Math.round(value*.72)));
                }
                const offset=(y*w+x)*4;d.set([...col,255],offset);
            }
            if(block.background!=='none')applySurfaceTexture(image,block.texture,(x,y)=>inner(x,y)&&(!block.bevel||(inner(x,y-1)&&inner(x,y+1))));
            ctx.putImageData(image,0,0);
            colored=canvas(content.width,content.height);const cc=colored.getContext('2d');
            const pixels=cc.createImageData(content.width,content.height),alpha=cctx.getImageData(0,0,content.width,content.height).data;
            if(block.textShadow&&block.textShadowOpacity){
                const ramp=prefixTextShadowRamp(block),backdrop=block.textShadowMode==='auto'&&block.background!=='none';
                const angle=backdrop?block.backgroundAngle:block.textShadowMode==='auto'?block.textAngle:block.textShadowAngle;
                const shadowPosition=backdrop?backgroundPosition:prefixPositionSampler(angle,content.width,content.height);
                for(let y=0;y<content.height;y++)for(let x=0;x<content.width;x++){
                    const offset=(y*content.width+x)*4;
                    const position=backdrop?shadowPosition(contentX+x+shadowX,contentY+y+shadowY):shadowPosition(x,y);
                    pixels.data.set([...ramp[Math.round(position*(ramp.length-1))],Math.round(alpha[offset+3]*block.textShadowOpacity/100)],offset);
                }
                cc.putImageData(pixels,0,0);ctx.drawImage(colored,contentX+shadowX,contentY+shadowY);
            }
            for(let y=0;y<content.height;y++)for(let x=0;x<content.width;x++){
                const offset=(y*content.width+x)*4;
                pixels.data.set([...textColor(x,y),alpha[offset+3]],offset);
            }
            cc.putImageData(pixels,0,0);ctx.drawImage(colored,contentX,contentY);
            complete=true;return {canvas:result,missing};
        } finally {
            text.width=text.height=1;
            if(content!==text)content.width=content.height=1;
            if(colored)colored.width=colored.height=1;
            if(!complete&&result)result.width=result.height=1;
        }
    }

    cachedBlock(block) {
        const key=JSON.stringify(block);
        let result=this.blockCache.get(key);
        if(result)this.blockCache.delete(key);
        else result=this.renderBlock(block);
        this.blockCache.set(key,result);
        // A document uses at most 8 blocks. The last 16 keep every block of the
        // current composition alive while older cached surfaces are released.
        if(this.blockCache.size>16){
            const oldest=this.blockCache.keys().next().value,discarded=this.blockCache.get(oldest);
            this.blockCache.delete(oldest);discarded.canvas.width=discarded.canvas.height=1;
        }
        return result;
    }

    render(value) {
        if(!this.images.minecraft||!this.images.smallcaps||!this.images['minecraft-ten'])throw new Error('Шрифты префикса ещё загружаются.');
        const data=normalizePrefixDocument(value),blocks=data.blocks.map(block=>this.cachedBlock(block));
        let x=0,minX=0,minY=0,maxX=0,maxY=0;const height=Math.max(...blocks.map(item=>item.canvas.height));
        const positions=blocks.map((item,index)=>{const block=data.blocks[index],y=Math.floor((height-item.canvas.height)/2),result={x,y};
            minX=Math.min(minX,x+(block.shadow?block.shadowX:0));minY=Math.min(minY,y+(block.shadow?block.shadowY:0));
            maxX=Math.max(maxX,x+item.canvas.width+(block.shadow?Math.max(0,block.shadowX):0));maxY=Math.max(maxY,y+item.canvas.height+(block.shadow?Math.max(0,block.shadowY):0));x+=item.canvas.width+data.gap;return result;});
        const width=maxX-minX+data.margin*2,totalHeight=maxY-minY+data.margin*2;
        if(width>PREFIX_LIMITS.dimension||totalHeight>PREFIX_LIMITS.dimension)throw new Error('Префикс шире 4096 px. Уменьшите текст или отступы.');
        const output=canvas(width,totalHeight),ctx=output.getContext('2d');ctx.imageSmoothingEnabled=false;
        try {
            blocks.forEach((item,index)=>{const block=data.blocks[index],pos=positions[index],dx=pos.x-minX+data.margin,dy=pos.y-minY+data.margin;
                if(block.shadow&&block.shadowOpacity){
                    const shadow=canvas(item.canvas.width,item.canvas.height),s=shadow.getContext('2d');
                    try{s.drawImage(item.canvas,0,0);s.globalCompositeOperation='source-in';s.fillStyle=block.shadowColor;s.fillRect(0,0,shadow.width,shadow.height);ctx.globalAlpha=block.shadowOpacity/100;ctx.drawImage(shadow,dx+block.shadowX,dy+block.shadowY);}
                    finally{ctx.globalAlpha=1;shadow.width=shadow.height=1;}
                }
                ctx.drawImage(item.canvas,dx,dy);
            });
        }catch(error){output.width=output.height=1;throw error;}
        return {canvas:output,missing:[...new Set(blocks.flatMap(item=>item.missing))],data};
    }
}
