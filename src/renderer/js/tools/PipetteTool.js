import Tool from './Tool.js';
import {translate} from '../core/Locale.mjs';

export default class PipetteTool extends Tool {
    constructor(...args){super(...args);this.bus.on('TOOL_CHANGED',id=>{if(id!=='pipette')this.deactivate();});this.bus.on('PREVIEW_CLEARED',()=>this.hideLoupe());globalThis.window?.addEventListener?.('blur',()=>this.hideLoupe());}
    onPointerDown(x, y,color,size,layer,event) {
        this.isSampling = true;
        this.sample(x, y);
        this.showLoupe(x,y,event);
    }

    onPointerMove(x, y,color,size,layer,event) { if (this.isSampling) this.sample(x, y);this.showLoupe(x,y,event); }
    onPointerUp(x, y) { if (this.isSampling && Number.isFinite(x) && Number.isFinite(y)){this.sample(x,y);const hex=this.readSample(x,y);if(hex)this.bus.emit('COLOR_COMMITTED',hex);} this.isSampling = false; }
    cancelAction() { this.isSampling = false;this.hideLoupe(); }
    deactivate(){this.cancelAction();}
    onHoverMove(x,y,event){this.showLoupe(x,y,event);}
    hideLoupe(){if(this.loupe)this.loupe.hidden=true;}
    sourceCanvas(){return document.getElementById('pipette-source')?.value==='layer'?this.layerManager.getActiveLayer()?.canvas:document.getElementById('main-canvas');}
    showLoupe(x,y,event){
        const source=this.sourceCanvas(),px=Math.floor(x),py=Math.floor(y);
        if(!event||!source||px<0||py<0||px>=source.width||py>=source.height){this.hideLoupe();return;}
        if(!this.loupe){
            this.loupe=document.createElement('div');this.loupe.className='pipette-loupe';this.loupe.setAttribute('aria-hidden','true');
            this.loupeCanvas=document.createElement('canvas');this.loupeCanvas.width=this.loupeCanvas.height=90;
            this.loupeLabel=document.createElement('div');this.loupe.append(this.loupeCanvas,this.loupeLabel);document.body.append(this.loupe);
        }
        const ctx=this.loupeCanvas.getContext('2d');ctx.clearRect(0,0,90,90);ctx.imageSmoothingEnabled=false;ctx.drawImage(source,px-4,py-4,9,9,0,0,90,90);
        ctx.lineWidth=1;ctx.strokeStyle='#ffffff30';ctx.beginPath();for(let i=10;i<90;i+=10){ctx.moveTo(i+.5,0);ctx.lineTo(i+.5,90);ctx.moveTo(0,i+.5);ctx.lineTo(90,i+.5);}ctx.stroke();
        const mode=document.getElementById('pipette-sample')?.value,extent=mode==='5x5'?5:mode==='3x3'?3:1,offset=(9-extent)*5;
        ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(offset,offset,extent*10,extent*10);ctx.strokeStyle='#FFF';ctx.lineWidth=1;ctx.strokeRect(offset,offset,extent*10,extent*10);
        const hex=this.readSample(x,y);this.loupeLabel.textContent=(hex||translate('Прозрачный'))+` · ${extent}×${extent}\nX: ${px}, Y: ${py}`;
        this.loupe.hidden=false;const r=this.loupe.getBoundingClientRect();
        this.loupe.style.left=Math.max(4,Math.min(innerWidth-r.width-4,event.clientX+18+r.width>innerWidth?event.clientX-r.width-18:event.clientX+18))+'px';
        this.loupe.style.top=Math.max(4,Math.min(innerHeight-r.height-4,event.clientY+18))+'px';
    }

    sample(x, y) {
        const hex=this.readSample(x,y);if(hex)this.bus.emit('COLOR_SELECTED',hex);
    }

    readSample(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const px = Math.floor(x);
        const py = Math.floor(y);

        const mainCanvas = this.sourceCanvas();
        if (!mainCanvas) return;

        const cw = mainCanvas.width;
        const ch = mainCanvas.height;

        if (px < 0 || px >= cw || py < 0 || py >= ch) return;

        const ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
        const sampleSelect = document.getElementById('pipette-sample');
        const mode = sampleSelect ? sampleSelect.value : 'point';

        let r = 0, g = 0, b = 0, count = 0;

        if (mode === '3x3' || mode === '5x5') {
            const radius = mode === '5x5' ? 2 : 1;
            const minX = Math.max(0, px - radius);
            const minY = Math.max(0, py - radius);
            const maxX = Math.min(cw - 1, px + radius);
            const maxY = Math.min(ch - 1, py + radius);
            const w = maxX - minX + 1;
            const h = maxY - minY + 1;

            const blockData = ctx.getImageData(minX, minY, w, h).data;
            for (let i = 0; i < blockData.length; i += 4) {
                if (blockData[i + 3] > 0) {
                    const weight = blockData[i + 3] / 255;
                    r += blockData[i] * weight;
                    g += blockData[i + 1] * weight;
                    b += blockData[i + 2] * weight;
                    count += weight;
                }
            }
        }

        if (count === 0) {
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3] === 0) return;
            r = pixel[0];
            g = pixel[1];
            b = pixel[2];
            count = 1;
        }

        const avgR = Math.min(255, Math.max(0, Math.round(r / count)));
        const avgG = Math.min(255, Math.max(0, Math.round(g / count)));
        const avgB = Math.min(255, Math.max(0, Math.round(b / count)));

        const hex = '#' + [avgR, avgG, avgB].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        return hex;
    }
}
