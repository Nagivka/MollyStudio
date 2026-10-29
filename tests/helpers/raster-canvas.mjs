// Small deterministic pixel context for renderer unit tests. No browser, native
// window, fonts, network or graphics driver is involved. Only the compositing
// operations exercised by PrefixRenderer are implemented here.
export class RasterCanvas{
    constructor(width=1,height=1){this._width=width;this._height=height;this.reset();}
    reset(){this.data=new Uint8ClampedArray(this._width*this._height*4);this.context=new RasterContext(this);}
    set width(value){this._width=value;this.reset();}get width(){return this._width;}
    set height(value){this._height=value;this.reset();}get height(){return this._height;}
    getContext(){return this.context;}
}
class RasterContext{
    constructor(canvas){this.canvas=canvas;this.globalAlpha=1;this.globalCompositeOperation='source-over';this.fillStyle='#000000';}
    save(){(this.stack||=[]).push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,fillStyle:this.fillStyle,clipRegions:this.clipRegions});}
    restore(){const state=this.stack?.pop();if(state)Object.assign(this,state);}
    beginPath(){this.path=[];}
    rect(x,y,width,height){(this.path||=[]).push({x,y,width,height});}
    clip(){
        const next=[];
        for(const a of this.path||[]){
            if(!this.clipRegions){if(a.width>0&&a.height>0)next.push(a);continue;}
            for(const b of this.clipRegions){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);if(right>x&&bottom>y)next.push({x,y,width:right-x,height:bottom-y});}
        }
        this.clipRegions=next;
    }
    insideClip(x,y){return !this.clipRegions||this.clipRegions.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);}
    createImageData(width,height){return {width,height,data:new Uint8ClampedArray(width*height*4)};}
    getImageData(x,y,width,height){const image=this.createImageData(width,height);for(let py=0;py<height;py++)for(let px=0;px<width;px++)if(x+px>=0&&x+px<this.canvas.width&&y+py>=0&&y+py<this.canvas.height)image.data.set(this.canvas.data.subarray(((y+py)*this.canvas.width+x+px)*4,((y+py)*this.canvas.width+x+px)*4+4),(py*width+px)*4);return image;}
    putImageData(image,x,y){for(let py=0;py<image.height;py++)for(let px=0;px<image.width;px++)if(x+px>=0&&x+px<this.canvas.width&&y+py>=0&&y+py<this.canvas.height)this.canvas.data.set(image.data.subarray((py*image.width+px)*4,(py*image.width+px)*4+4),((y+py)*this.canvas.width+x+px)*4);}
    paint(x,y,color){
        x=Math.floor(x);y=Math.floor(y);
        if(x<0||y<0||x>=this.canvas.width||y>=this.canvas.height||!this.insideClip(x,y))return;const index=(y*this.canvas.width+x)*4,data=this.canvas.data,sourceAlpha=color[3]/255*this.globalAlpha,destAlpha=data[index+3]/255;
        if(this.globalCompositeOperation==='source-in'){data.set([color[0],color[1],color[2],Math.round(sourceAlpha*destAlpha*255)],index);return;}
        if(this.globalCompositeOperation==='source-atop'){
            if(!destAlpha)return;
            for(let channel=0;channel<3;channel++)data[index+channel]=Math.round(color[channel]*sourceAlpha+data[index+channel]*(1-sourceAlpha));return;
        }
        const alpha=sourceAlpha+destAlpha*(1-sourceAlpha);if(!alpha){data.fill(0,index,index+4);return;}
        for(let channel=0;channel<3;channel++)data[index+channel]=Math.round((color[channel]*sourceAlpha+data[index+channel]*destAlpha*(1-sourceAlpha))/alpha);data[index+3]=Math.round(alpha*255);
    }
    fillRect(x,y,width,height){let hex=this.fillStyle.replace('#','');if(hex.length===3)hex=[...hex].map(char=>char+char).join('');const color=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16));color.push(255);for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++)this.paint(px,py,color);}
    clearRect(x,y,width,height){for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++)if(px>=0&&px<this.canvas.width&&py>=0&&py<this.canvas.height&&this.insideClip(px,py))this.canvas.data.fill(0,(py*this.canvas.width+px)*4,(py*this.canvas.width+px)*4+4);}
    drawImage(image,...args){
        let sx=0,sy=0,sw=image.width,sh=image.height,dx,dy,dw,dh;
        if(args.length===2)[dx,dy]=args;
        else if(args.length===4)[dx,dy,dw,dh]=args;
        else [sx,sy,sw,sh,dx,dy,dw,dh]=args;
        dw??=sw;dh??=sh;
        for(let py=0;py<dh;py++)for(let px=0;px<dw;px++){
            const sourceX=Math.floor(sx+(px+.5)*sw/dw),sourceY=Math.floor(sy+(py+.5)*sh/dh);if(sourceX<0||sourceY<0||sourceX>=image.width||sourceY>=image.height)continue;
            this.paint(dx+px,dy+py,image.data.subarray((sourceY*image.width+sourceX)*4,(sourceY*image.width+sourceX)*4+4));
        }
    }
}
