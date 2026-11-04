const fs=require('node:fs');
const path=require('node:path');
const {PNG}=require('pngjs');
const directory=path.resolve(__dirname,'../src/renderer/assets/images/icon');
function resized(image,size){
    const out=new PNG({width:size,height:size});
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const from=(Math.floor(y*image.height/size)*image.width+Math.floor(x*image.width/size))*4;
        image.data.copy(out.data,(y*size+x)*4,from,from+4);
    }
    return PNG.sync.write(out);
}
function icns(image){
    const chunks=[[16,'icp4'],[32,'icp5'],[64,'icp6'],[128,'ic07'],[256,'ic08'],[512,'ic09'],[1024,'ic10']].map(([size,type])=>{
        const png=resized(image,size),header=Buffer.alloc(8);header.write(type);header.writeUInt32BE(png.length+8,4);return Buffer.concat([header,png]);
    });
    const header=Buffer.alloc(8);header.write('icns');header.writeUInt32BE(8+chunks.reduce((n,c)=>n+c.length,0),4);return Buffer.concat([header,...chunks]);
}
const app=PNG.sync.read(fs.readFileSync(path.join(directory,'icon256.png')));
const ico=fs.readFileSync(path.join(directory,'mlst.ico'));let best;
for(let i=0;i<ico.readUInt16LE(4);i++){
    const offset=6+i*16,length=ico.readUInt32LE(offset+8),start=ico.readUInt32LE(offset+12),bytes=ico.subarray(start,start+length);
    if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const image=PNG.sync.read(bytes);if(!best||image.width>best.width)best=image;}
}
if(!best)throw Error('The MLST icon must contain an embedded PNG.');
fs.writeFileSync(path.join(directory,'app.icns'),icns(app));
fs.writeFileSync(path.join(directory,'mlst.icns'),icns(best));
fs.writeFileSync(path.join(directory,'icon512.png'),resized(app,512));
