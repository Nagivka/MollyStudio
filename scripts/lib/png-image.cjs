const {PNG}=require('pngjs');
function wrap(png){return {
    getSize:()=>({width:png.width,height:png.height}),
    toPNG:()=>PNG.sync.write(png),
    toBitmap:()=>{const bytes=Buffer.from(png.data);for(let i=0;i<bytes.length;i+=4){const red=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=red;}return bytes;}
};}
module.exports={createFromBuffer:bytes=>wrap(PNG.sync.read(bytes)),createFromBitmap:(bytes,{width,height})=>{const png=new PNG({width,height});png.data=Buffer.from(bytes);for(let i=0;i<bytes.length;i+=4){const blue=png.data[i];png.data[i]=png.data[i+2];png.data[i+2]=blue;}return wrap(png);}};
