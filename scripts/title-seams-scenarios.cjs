const assert=require('node:assert/strict');
const path=require('node:path');
const {app,root,ready,makeWindow}=require('./lib/electron-harness.cjs');
(async()=>{let win;try{
    await ready();win=makeWindow(1280,900);await win.loadFile(path.join(root,'src/renderer/editor.html'),{query:{new:'true',type:'title'}});
    await win.page.evaluate(async()=>{
        const {default:Renderer}=await import(new URL('js/graphics/TitleRenderer.js',location.href));
        const renderer=new Renderer();
        try{
            renderer.canvas.getContext('webgl',{antialias:false,alpha:true,preserveDrawingBuffer:true,premultipliedAlpha:true});renderer.initialize();
            const atlas=Object.assign(document.createElement('canvas'),{width:8,height:8}),paint=atlas.getContext('2d');
            paint.fillStyle='#000000';paint.fillRect(0,0,8,8);paint.fillStyle='#ffffff';paint.fillRect(2,2,4,4);
            renderer.images.set('seam-fixture',atlas);
            // Sample exactly at a face's UV edge next to a black atlas gutter.
            const vertices=[];
            for(const point of [[-1,-1,0],[1,-1,0],[1,1,0],[-1,-1,0],[1,1,0],[-1,1,0]])vertices.push(...point,0,0,1,.75,.5,.25,.25,.75,.75);
            const gl=renderer.gl,buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
            renderer.mesh={nodes:[],bounds:{min:[-1,-1,0],max:[1,1,0]}};
            renderer.batches=[{buffer,count:6,texture:renderer.uploadTexture('seam-fixture'),texelSize:[1/8,1/8]}];
            renderer.draw({top:'#FFFFFF',bottom:'#FFFFFF',side:'#FFFFFF'},{width:129,height:129,halfHeight:1,ratio:1,depth:10,yaw:0,pitch:0,target:[0,0,0],shift:[0,0],perspective:false,distance:5,tangent:1});
            const pixel=new Uint8Array(4);gl.readPixels(64,64,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
            if(pixel.some(value=>value!==255))throw Error('An atlas gutter darkened the face edge: '+Array.from(pixel));
            if(gl.getError()!==gl.NO_ERROR)throw Error('Seam-safe rendering reported a WebGL error');
        }finally{renderer.dispose();}
    });
    assert.deepEqual(win.__testErrors,[]);console.log('PASS face-edge sampling excludes neighboring black atlas texels');
}catch(error){console.error(error);process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}})();
