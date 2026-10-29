// Uploaded pixel sprites use whole backing-store pixels and a uniform scale.
export function weatherBitmapGeometry(width,height,size,scale=1) {
    const unit=Math.max(1,Math.round(size*scale/Math.max(width,height)));
    return {width:width*unit/scale,height:height*unit/scale,
        left:-Math.floor(width*unit/2)/scale,top:-Math.floor(height*unit/2)/scale};
}
export function drawWeatherBitmap(ctx,image,x,y,size,{scale=1,rotation=0,flip=false,source}={}) {
    const width=source?.size||image.naturalWidth||image.width;
    const height=source?.size||image.naturalHeight||image.height;
    if(!width||!height)return;
    const box=weatherBitmapGeometry(width,height,size,scale);
    ctx.save();ctx.imageSmoothingEnabled=false;
    ctx.translate(Math.round(x*scale)/scale,Math.round(y*scale)/scale);
    ctx.rotate(Math.round(rotation/(Math.PI/2))*Math.PI/2);
    if(flip)ctx.scale(-1,1);
    ctx.drawImage(image,source?.x||0,source?.y||0,width,height,box.left,box.top,box.width,box.height);
    ctx.restore();
}
