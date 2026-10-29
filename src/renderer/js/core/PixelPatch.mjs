/** Retain only the changed rectangle; metadata still describes the entire layer. */
export function compactImagePair(before,after) {
    if(!before?.data||!after?.data||before.width!==after.width||before.height!==after.height||before.data.length!==after.data.length||before.data.length<16384)return null;
    const {width,height}=before;if(before.data.length!==width*height*4)return null;
    if(!ArrayBuffer.isView(before.data)||!ArrayBuffer.isView(after.data)||before.data.BYTES_PER_ELEMENT!==1||after.data.BYTES_PER_ELEMENT!==1||before.data.byteOffset%4||after.data.byteOffset%4)return null;
    const a=new Uint32Array(before.data.buffer,before.data.byteOffset,width*height),b=new Uint32Array(after.data.buffer,after.data.byteOffset,width*height);
    let minX=width,minY=height,maxX=-1,maxY=-1;
    for(let y=0;y<height;y++){
        for(let x=0;x<width;x++){
            const i=y*width+x;if(a[i]===b[i])continue;
            if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        }
        // Bounds only grow. Once dense enough, retaining the original pair is
        // already cheaper than allocating a patch, so stop scanning immediately.
        if(maxX>=0&&(maxX-minX+1)*(maxY-minY+1)>=width*height*.75)return null;
    }
    const w=maxX<0?0:maxX-minX+1,h=maxY<0?0:maxY-minY+1;
    if(w*h>=width*height*.75)return null;
    const extract=image=>{
        const data=new Uint8ClampedArray(w*h*4);
        for(let row=0;row<h;row++){const start=((minY+row)*width+minX)*4;data.set(image.data.subarray(start,start+w*4),row*w*4);}
        return {pixelPatch:true,width,height,x:w?minX:0,y:h?minY:0,patchWidth:w,patchHeight:h,data,mollySnapshot:image.mollySnapshot};
    };
    return {before:extract(before),after:extract(after)};
}
