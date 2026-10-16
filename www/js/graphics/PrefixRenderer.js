import { fontMaps, fontReplacements } from '../utils/FontData.js';
import { normalizePrefixDocument, PREFIX_LIMITS } from '../core/PrefixDocument.mjs';

const ICONS = {
    crown: ['1001001','1101011','1111111','0111110','0111110'],
    star: ['0001000','0011100','1111111','0111110','0011100','0110110','0100010'],
    heart: ['0110110','1111111','1111111','0111110','0011100','0001000'],
    bolt: ['0001100','0011000','0110000','0111110','0001100','0011000','0010000'],
    shield: ['1111111','1111111','1111111','0111110','0111110','0011100','0001000'],
    check: ['0000001','0000011','1000110','1101100','0111000','0010000']
};
function canvas(width, height) { const result = document.createElement('canvas'); result.width = width; result.height = height; return result; }
function rgb(hex) { return [1,3,5].map(index => parseInt(hex.slice(index,index+2),16)); }
function sample(stops, t) {
    if (stops.length === 1) return rgb(stops[0]);
    const position = Math.max(0, Math.min(1, t)) * (stops.length - 1), index = Math.min(stops.length - 2, Math.floor(position));
    const a = rgb(stops[index]), b = rgb(stops[index+1]);
    return a.map((value, channel) => Math.round(value + (b[channel]-value)*(position-index)));
}
function gradientAt(stops, angle, x, y, w, h) {
    const radians = angle * Math.PI / 180, dx = Math.cos(radians), dy = Math.sin(radians);
    const extent = Math.abs(dx)*(w-1) + Math.abs(dy)*(h-1);
    return sample(stops, extent < 1e-8 ? 0 : .5 + ((x-(w-1)/2)*dx+(y-(h-1)/2)*dy)/extent);
}

/** Pixel-only badge renderer. Font atlases and measured glyphs are shared across renders. */
export default class PrefixRenderer {
    constructor() { this.images = {}; this.glyphs = new Map(); this.ready = null; }

    load() {
        if (!this.ready) this.ready = Promise.all(Object.entries({minecraft:'default.png',smallcaps:'smallcaps.png','minecraft-ten':'ten.png'}).map(([id,file]) => new Promise((resolve,reject) => {
            const image = new Image();
            image.onload = () => { this.images[id] = image; resolve(); };
            image.onerror = () => reject(new Error(`Не удалось загрузить шрифт префикса: ${file}`));
            image.src = `assets/images/${file}`;
        }))).catch(error => { this.ready = null; throw error; });
        return this.ready;
    }

    glyph(character, font) {
        const key = `${font}:${character}`;
        if (this.glyphs.has(key)) return this.glyphs.get(key);
        let actual = character, id = font;
        if (font === 'smallcaps') actual = actual.replace(/[А-ЯЁ]/g, value => value.toLowerCase()).replace(/а/g,'a');
        if (font === 'minecraft') actual = actual.replace(/Ё/g,'Е').replace(/Й/g,'И');
        let index = fontMaps[id].indexOf(actual), missing = false;
        if (index < 0) { id = 'minecraft-ten'; index = fontMaps[id].indexOf(actual); }
        if (index < 0) { index = fontMaps[id].indexOf('?'); missing = true; }
        const tile = canvas(8,8), ctx = tile.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(this.images[id],index%16*8,Math.floor(index/16)*8,8,8,0,0,8,8);
        const pixels = ctx.getImageData(0,0,8,8).data;
        let left=8,right=-1,top=8,bottom=-1;
        for(let y=0;y<8;y++) for(let x=0;x<8;x++) if(pixels[(y*8+x)*4+3]) { left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y); }
        const result = {tile,left:left===8?0:left,width:right<0?3:right-left+1,top,bottom,missing};
        this.glyphs.set(key,result); return result;
    }

    textMask(block) {
        let text = block.text;
        for (const [from,to] of Object.entries(fontReplacements)) text = text.split(from).join(to);
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
        const {mask:text,missing}=this.textMask(block),icon=ICONS[block.icon];
        const hasText=block.text.length>0,iconWidth=icon?7:0,gap=icon&&hasText?2:0;
        const content=canvas((hasText?text.width:0)+iconWidth+gap||1,Math.max(hasText?text.height:0,icon?.length||0,1));
        const cctx=content.getContext('2d');cctx.fillStyle='#fff';
        const iconX=block.iconSide==='left'?0:(hasText?text.width:0)+gap;
        if(icon) icon.forEach((row,y)=>[...row].forEach((value,x)=>{if(value==='1')cctx.fillRect(iconX+x,Math.floor((content.height-icon.length)/2)+y,1,1);}));
        if(hasText)cctx.drawImage(text,block.iconSide==='left'?iconWidth+gap:0,Math.floor((content.height-text.height)/2));
        const border=block.borderWidth,shadow=block.textShadow?1:0;
        const w=content.width+block.paddingX*2+border*2+shadow,h=content.height+block.paddingY*2+border*2+shadow;
        const result=canvas(w,h),ctx=result.getContext('2d',{willReadFrequently:true}),image=ctx.createImageData(w,h),d=image.data;
        const inside=(x,y,inset=0)=>{const r=Math.max(0,Math.min(block.radius-inset,Math.floor((w-2*inset)/2),Math.floor((h-2*inset)/2)));return x>=inset&&y>=inset&&x<w-inset&&y<h-inset&&Math.min(x-inset,w-1-inset-x)+Math.min(y-inset,h-1-inset-y)>=r;};
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
            if(!inside(x,y))continue;
            const edge=border>0&&!inside(x,y,border);
            if(!edge&&block.background==='none')continue;
            let col=edge?rgb(block.borderColor):gradientAt(block.background==='solid'?[block.backgroundColors[0]]:block.backgroundColors,block.backgroundAngle,x,y,w,h);
            if(!edge&&block.bevel&&block.background!=='none') {
                const highlight=!inside(x,y-1,border),shade=!inside(x,y+1,border);
                if(highlight||shade)col=col.map(value=>Math.round(highlight?value+(255-value)*.28:value*.72));
            }
            const offset=(y*w+x)*4;d.set([...col,255],offset);
        }
        ctx.putImageData(image,0,0);
        const colored=canvas(content.width,content.height),cc=colored.getContext('2d');
        cc.drawImage(content,0,0);cc.globalCompositeOperation='source-in';
        if(block.textShadow){cc.fillStyle=block.textShadowColor;cc.fillRect(0,0,colored.width,colored.height);ctx.drawImage(colored,border+block.paddingX+1,border+block.paddingY+1);}
        const pixels=cc.createImageData(content.width,content.height),alpha=cctx.getImageData(0,0,content.width,content.height).data;
        for(let y=0;y<content.height;y++)for(let x=0;x<content.width;x++){const offset=(y*content.width+x)*4;pixels.data.set([...gradientAt(block.textMode==='solid'?[block.textColors[0]]:block.textColors,block.textAngle,x,y,content.width,content.height),alpha[offset+3]],offset);}
        cc.putImageData(pixels,0,0);ctx.drawImage(colored,border+block.paddingX,border+block.paddingY);
        return {canvas:result,missing};
    }

    render(value) {
        if(!this.images.minecraft||!this.images.smallcaps||!this.images['minecraft-ten'])throw new Error('Шрифты префикса ещё загружаются.');
        const data=normalizePrefixDocument(value),blocks=data.blocks.map(block=>this.renderBlock(block));
        let x=0,minX=0,minY=0,maxX=0,maxY=0;const height=Math.max(...blocks.map(item=>item.canvas.height));
        const positions=blocks.map((item,index)=>{const block=data.blocks[index],y=Math.floor((height-item.canvas.height)/2),result={x,y};
            minX=Math.min(minX,x+(block.shadow?block.shadowX:0));minY=Math.min(minY,y+(block.shadow?block.shadowY:0));
            maxX=Math.max(maxX,x+item.canvas.width+(block.shadow?Math.max(0,block.shadowX):0));maxY=Math.max(maxY,y+item.canvas.height+(block.shadow?Math.max(0,block.shadowY):0));x+=item.canvas.width+data.gap;return result;});
        const width=maxX-minX+data.margin*2,totalHeight=maxY-minY+data.margin*2;
        if(width>PREFIX_LIMITS.dimension||totalHeight>PREFIX_LIMITS.dimension)throw new Error('Префикс шире 4096 px. Уменьшите текст или отступы.');
        const output=canvas(width,totalHeight),ctx=output.getContext('2d');ctx.imageSmoothingEnabled=false;
        blocks.forEach((item,index)=>{const block=data.blocks[index],pos=positions[index],dx=pos.x-minX+data.margin,dy=pos.y-minY+data.margin;
            if(block.shadow&&block.shadowOpacity){const shadow=canvas(item.canvas.width,item.canvas.height),s=shadow.getContext('2d');s.drawImage(item.canvas,0,0);s.globalCompositeOperation='source-in';s.fillStyle=block.shadowColor;s.fillRect(0,0,shadow.width,shadow.height);ctx.globalAlpha=block.shadowOpacity/100;ctx.drawImage(shadow,dx+block.shadowX,dy+block.shadowY);ctx.globalAlpha=1;}
            ctx.drawImage(item.canvas,dx,dy);
        });
        return {canvas:output,missing:[...new Set(blocks.flatMap(item=>item.missing))],data};
    }
}
