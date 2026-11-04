import {turnTitlePoint as rotate,titleOutputPlan,titleEditingPlan,fitTitleFrame} from './TitleCamera.mjs';
import {boundsCorners,subtract,add,unit,intersectTriangle} from './TitleSceneMath.mjs';
import {normalizeTitleDocument} from '../core/TitleDocument.mjs';
import {buildTitleMesh,resolveTitleGlyph,titleMeshKey} from './TitleMesh.mjs';
import {TITLE_FONT_CATALOG} from '../core/TitleFontCatalog.mjs';
import {TITLE_MATERIAL_CATALOG} from '../core/TitleMaterialCatalog.mjs';
import {titleMaterialState,titleMaterialCatalog} from '../core/TitleAppearance.mjs';
import {titleRowSettings} from '../core/TitleDocument.mjs';
import {composeTitleMaterial} from './TitleMaterialCanvas.js';

const BASIC_ASSETS=['contour-swatches.png',...Object.values(TITLE_MATERIAL_CATALOG.fonts).flatMap(font=>font.textures.filter(record=>['none','stone','gold'].includes(record.id)).map(record=>record.asset))];
const color=hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255);
const VERTEX=`
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform vec2 uAngles;
uniform vec3 uTarget;
uniform vec2 uClip;
uniform vec2 uShift;
uniform vec3 uCamera;
uniform vec3 uOrtho;
uniform bool uPerspective;
varying vec2 vUV;
varying vec3 vNormal;
varying float vHeight;
vec3 turn(vec3 p){
    float c=cos(uAngles.x),s=sin(uAngles.x),a=cos(uAngles.y),b=sin(uAngles.y);
    vec3 q=vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);
    return vec3(q.x,q.y*a-q.z*b,q.y*b+q.z*a);
}
void main(){
    vec3 p=turn(aPosition-uTarget);
    float near=uClip.x,far=uClip.y,z=p.z-uCamera.z;
    gl_Position=vec4(p.x*uCamera.x,p.y*uCamera.y,-((far+near)/(far-near))*z-(2.0*far*near)/(far-near),-z);
    gl_Position.xy-=uShift*uCamera.xy*gl_Position.w;
    if(!uPerspective)gl_Position=vec4((p.x-uShift.x)/uOrtho.x,(p.y-uShift.y)/uOrtho.y,-p.z/uOrtho.z,1.0);
    vUV=aUV;vNormal=aNormal;vHeight=aPosition.y;
}`;
const FRAGMENT=`
precision highp float;
uniform sampler2D uTexture;
uniform bool uOriginal;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uSide;
uniform vec2 uRange;
uniform bool uWire;
varying vec2 vUV;
varying vec3 vNormal;
varying float vHeight;
void main(){
    if(uWire){gl_FragColor=vec4(0.3,0.68,1.0,1.0);return;}
    vec4 texel=texture2D(uTexture,vUV);
    if(texel.a<0.5)discard;
    vec3 n=normalize(vNormal);
    // The reference preview uses MeshBasicMaterial: preserve authored colors.
    float light=1.0;
    vec3 result=texel.rgb;
    if(!uOriginal){
        float k=clamp((vHeight-uRange.x)/max(0.01,uRange.y-uRange.x),0.0,1.0);
        vec3 tint=abs(n.z)>0.5?mix(uBottom,uTop,k):uSide;
        result=texel.rgb*tint;
    }
    gl_FragColor=vec4(result*light*texel.a,texel.a);
}`;

/** Standalone WebGL renderer. Only baked model data/artwork is shared with the reference. */
export default class TitleRenderer {
    constructor(){
        this.canvas=document.createElement('canvas');
        this.images=new Map();this.textures=new Map();this.meshKey=null;this.mesh=null;this.ready=null;this.loaded=false;this.alphaMaps=new Map();this.imageRequests=new Map();this.imageUse=new Map();
        this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;});
        this.canvas.addEventListener('webglcontextrestored',()=>{this.gl=null;this.program=null;this.batches=[];this.textures.clear();this.meshKey=null;this.lost=false;});
    }
    loadImage(asset,key=asset){
        if(this.images.has(key)){this.imageUse.set(key,performance.now());return Promise.resolve(this.images.get(key));}
        if(this.imageRequests.has(key))return this.imageRequests.get(key);
        const request=new Promise((resolve,reject)=>{
            const image=new Image();
            image.onload=()=>{
                if(image.width*image.height>20*1024*1024||Math.max(image.width,image.height)>8192){reject(Error('Изображение материала слишком велико. Максимум — 20 мегапикселей и 8192 px по стороне.'));return;}
                // A closed scene may have retired this request while decoding.
                // Do not restore its cache or overwrite a later scene's image.
                if(this.imageRequests.get(key)===request){this.images.set(key,image);this.imageUse.set(key,performance.now());}
                resolve(image);
            };
            image.onerror=()=>reject(Error('Не удалось загрузить материал надписи: '+(asset.startsWith('data:')?'изображение':asset)));
            image.src=asset.startsWith('data:')?asset:new URL('../../assets/title_generator/'+asset,import.meta.url).href;
        }).finally(()=>{if(this.imageRequests.get(key)===request)this.imageRequests.delete(key);});
        this.imageRequests.set(key,request);return request;
    }
    load(){
        if(!this.ready)this.ready=Promise.all(BASIC_ASSETS.map(asset=>this.loadImage(asset))).then(()=>{this.images.set('contour-swatches',this.images.get('contour-swatches.png'));this.loaded=true;}).catch(error=>{this.ready=null;throw error;});
        return this.ready;
    }
    materialStates(value){
        const data=normalizeTitleDocument(value),states=new Map();
        data.text.split('\n').forEach((line,row)=>{
            const settings=titleRowSettings(data,row),fonts=new Set([settings.font]);
            for(const input of line)if(input!==' ')fonts.add(resolveTitleGlyph(settings.font,input,data.creeperA).font);
            for(const font of fonts){const state=titleMaterialState(settings,font);states.set(state.key,state);}
        });
        return [...states.values()];
    }
    materialResources(state){
        const a=state.appearance,resources={base:a.source==='file'&&a.fileMode==='atlas'&&a.image?{asset:a.image,key:a.image}:{asset:state.source.asset,key:state.source.asset}};
        if(a.source==='tileable'&&TITLE_MATERIAL_CATALOG.tileables[a.tileable])resources.tile={asset:TITLE_MATERIAL_CATALOG.tileables[a.tileable].asset,key:TITLE_MATERIAL_CATALOG.tileables[a.tileable].asset};
        if(a.source==='file'&&a.fileMode==='tileable'&&a.image)resources.tile={asset:a.image,key:a.image};
        if(a.overlayImage)resources.overlay={asset:a.overlayImage,key:a.overlayImage};
        else if(state.overlay)resources.overlay={asset:state.overlay.asset,key:state.overlay.asset};
        const fontOverlay=titleMaterialCatalog(state.font)?.fontOverlay;
        if(fontOverlay&&!a.disableFontOverlay&&a.source!=='texture')resources.fontOverlay={asset:fontOverlay,key:fontOverlay};
        return resources;
    }
    hasResources(value){return this.materialStates(value).every(state=>Object.values(this.materialResources(state)).every(item=>this.images.has(item.key)));}
    async loadFor(value){
        await this.load();
        await Promise.all(this.materialStates(value).flatMap(state=>Object.values(this.materialResources(state)).map(item=>this.loadImage(item.asset,item.key))));
    }
    prepareMaterials(data,states=this.materialStates(data)){
        const protectedKeys=new Set(BASIC_ASSETS);
        for(const state of states){
            const resources=this.materialResources(state),images={};
            for(const [name,item] of Object.entries(resources)){
                const image=this.images.get(item.key);if(!image)throw Error('Материал ещё загружается. Дождитесь завершения загрузки.');images[name]=image;protectedKeys.add(item.key);this.imageUse.set(item.key,performance.now());
            }
            if(!this.images.has(state.key)){
                const raw=state.key===state.font+'-'+state.record.sourceId&&state.appearance.source==='texture';
                this.images.set(state.key,raw?images.base:composeTitleMaterial(state,images.base,images));
            }
            protectedKeys.add(state.key);this.imageUse.set(state.key,performance.now());
        }
        // Decoded artwork is bounded; browsing the catalog must not retain every
        // 4000px atlas forever. Active materials and the small boot set stay alive.
        this.materialProtection=new Set(protectedKeys);
        for(const key of this.parentRenderer?.materialProtection||[])protectedKeys.add(key);
        const entries=[...this.images.entries()].sort((a,b)=>(this.imageUse.get(a[0])||0)-(this.imageUse.get(b[0])||0));
        const pixels=()=>[...new Set(this.images.values())].reduce((n,image)=>n+image.width*image.height,0);
        for(const [key] of entries){if(pixels()<=32*1024*1024)break;if(protectedKeys.has(key)||key==='contour-swatches')continue;this.images.delete(key);this.alphaMaps.delete(key);this.parentRenderer?.alphaMaps.delete(key);this.exportRenderer?.alphaMaps.delete(key);this.imageUse.delete(key);}
    }
    initialize(){
        if(this.gl)return;
        const gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,preserveDrawingBuffer:true,premultipliedAlpha:true});
        if(!gl)throw Error('Для 3D-генератора требуется WebGL. Проверьте аппаратное ускорение.');
        const compile=(type,source)=>{
            const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
            if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(error);}
            return shader;
        };
        const vertex=compile(gl.VERTEX_SHADER,VERTEX),fragment=compile(gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();
        gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw Error(error);}
        this.gl=gl;this.program=program;this.batches=[];
        this.uniforms=Object.fromEntries(['uAngles','uTarget','uClip','uShift','uWire','uCamera','uOrtho','uPerspective','uTexture','uOriginal','uTop','uBottom','uSide','uRange'].map(key=>[key,gl.getUniformLocation(program,key)]));
        this.attributes=['aPosition','aNormal','aUV'].map(name=>gl.getAttribLocation(program,name));
        gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);this.wireBuffer=gl.createBuffer();
    }
    uploadTexture(name){
        if(this.textures.has(name))return this.textures.get(name);
        const gl=this.gl,image=this.images.get(name);if(!image)throw Error('Материал ещё не загружен.');
        const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        // Crisp source texels, with MSAA reserved for the model silhouette.
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        this.textures.set(name,texture);return texture;
    }
    build(data){
        const gl=this.gl;for(const batch of this.batches)gl.deleteBuffer(batch.buffer);
        this.mesh=buildTitleMesh(data);this.count=0;
        const used=new Set(this.mesh.batches.map(batch=>batch.texture));
        for(const [key,texture] of this.textures)if(!used.has(key)){gl.deleteTexture(texture);this.textures.delete(key);}
        this.batches=this.mesh.batches.map(batch=>{
            const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(batch.vertices),gl.STATIC_DRAW);
            const count=batch.vertices.length/8;this.count+=count;
            return {buffer,count,texture:this.uploadTexture(batch.texture)};
        });
    }
    prepare(value){
        this.initialize();if(this.lost||this.gl.isContextLost())throw Error('3D-контекст временно недоступен.');
        const data=normalizeTitleDocument(value),materials=this.materialStates(data);this.prepareMaterials(data,materials);
        const key=titleMeshKey(data,materials);if(this.meshKey!==key){this.build(data);this.meshKey=key;}
        return data;
    }
    plan(data,width,height,view=null){
        if(!view){const output=titleOutputPlan(this.mesh.bounds,data,this.mesh.baseBounds);return {...output,width,height,frame:fitTitleFrame(width,height,output.width,output.height),outputWidth:output.width,outputHeight:output.height};}
        return titleEditingPlan(this.mesh.bounds,this.mesh.baseBounds,{...data,yaw:view.yaw,pitch:view.pitch,zoom:view.zoom,cameraTarget:view.target||data.cameraTarget},width,height);
    }

    draw(data,plan,selection=null){
        const {gl,uniforms:u}=this;
        const maxSize=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
        if(plan.width>maxSize||plan.height>maxSize)throw Error('Выбранное разрешение не поддерживается видеокартой.');
        if(this.canvas.width!==plan.width||this.canvas.height!==plan.height){this.canvas.width=plan.width;this.canvas.height=plan.height;}
        this.lastPlan=plan;
        const frame=plan.frame||{x:0,y:0,width:plan.width,height:plan.height};
        gl.viewport(frame.x,plan.height-frame.y-frame.height,frame.width,frame.height);gl.useProgram(this.program);
        gl.uniform3f(u.uOrtho,plan.halfHeight*plan.ratio,plan.halfHeight,plan.depth);gl.uniform1i(u.uPerspective,plan.perspective);
        gl.uniform2f(u.uAngles,plan.yaw,plan.pitch);gl.uniform3fv(u.uTarget,plan.target);gl.uniform2fv(u.uShift,plan.shift||[0,0]);gl.uniform2f(u.uClip,Math.max(.01,plan.distance-plan.depth-10),Math.max(1,plan.distance+plan.depth+10));
        gl.uniform3f(u.uCamera,1/(plan.tangent*plan.ratio),1/plan.tangent,plan.distance);
        gl.uniform1i(u.uOriginal,true);gl.uniform3fv(u.uTop,color(data.top));gl.uniform3fv(u.uBottom,color(data.bottom));gl.uniform3fv(u.uSide,color(data.side));
        gl.uniform2f(u.uRange,this.mesh.bounds.min[1],this.mesh.bounds.max[1]);gl.uniform1i(u.uTexture,0);gl.uniform1i(u.uWire,0);
        gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        const bind=buffer=>{
            gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
            for(let i=0;i<3;i++){gl.enableVertexAttribArray(this.attributes[i]);gl.vertexAttribPointer(this.attributes[i],i===2?2:3,gl.FLOAT,false,32,i===2?24:i*12);}
        };
        for(const batch of this.batches){bind(batch.buffer);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,batch.texture);gl.drawArrays(gl.TRIANGLES,0,batch.count);}
        const node=this.mesh.nodes.find(node=>node.id===selection);
        if(node){
            const points=boundsCorners(node.bounds),vertices=[];
            for(let i=0;i<8;i++)for(let axis=0;axis<3;axis++)if(!(i&(1<<axis)))for(const p of [points[i],points[i|(1<<axis)]])vertices.push(...p,0,0,1,0,0);
            bind(this.wireBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
            gl.uniform1i(u.uWire,1);gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.LINES,0,vertices.length/8);gl.enable(gl.DEPTH_TEST);gl.uniform1i(u.uWire,0);
        }
    }
    drawViewport(value,width,height,view,selection){
        const data=this.prepare(value),plan=this.plan(data,Math.max(1,Math.round(width)),Math.max(1,Math.round(height)),view);
        this.draw(data,plan,selection);return this.mesh;
    }
    render(value,options={}){
        if(!this.exportRenderer){this.exportRenderer=new TitleRenderer();this.exportRenderer.images=this.images;this.exportRenderer.parentRenderer=this;}
        return this.exportRenderer.renderSnapshot(value,options);
    }
    renderSnapshot(value,{scale=1}={}){
        const data=this.prepare(value),output=titleOutputPlan(this.mesh.bounds,data,this.mesh.baseBounds),factor=Math.max(1,Math.min(16,Math.round(Number(scale)||1)));
        const plan={...output,width:output.width*factor,height:output.height*factor};
        if(plan.width*plan.height>64*1024*1024||Math.max(plan.width,plan.height)>16384)throw Error('Уменьшите масштаб экспорта: итоговое изображение слишком велико.');
        this.draw(data,plan);
        const canvas=Object.assign(document.createElement('canvas'),{width:plan.width,height:plan.height});canvas.getContext('2d').drawImage(this.canvas,0,0);
        return {canvas,data,missing:this.mesh.missing,triangles:this.count/3};
    }
    projectPoint(point){
        const plan=this.lastPlan;if(!plan)return null;
        const p=rotate(subtract(point,plan.target),plan.yaw,plan.pitch);
        const shift=plan.shift||[0,0];
        const x=plan.perspective?(p[0]/(plan.distance-p[2])-shift[0])/(plan.tangent*plan.ratio):(p[0]-shift[0])/(plan.halfHeight*plan.ratio);
        const y=plan.perspective?(p[1]/(plan.distance-p[2])-shift[1])/plan.tangent:(p[1]-shift[1])/plan.halfHeight;
        const frame=plan.frame||{x:0,y:0,width:plan.width,height:plan.height};
        return [(frame.x+(x+1)/2*frame.width)/plan.width,(frame.y+(1-y)/2*frame.height)/plan.height];
    }
    screenDelta(dx,dy,anchor=null){
        const plan=this.lastPlan,z=anchor?rotate(subtract(anchor,plan.target),plan.yaw,plan.pitch)[2]:0,scale=plan.perspective?Math.max(.01,plan.distance-z)*plan.tangent:plan.halfHeight;
        if(plan.frame){dx*=plan.width/plan.frame.width;dy*=plan.height/plan.frame.height;}
        return this.unturn([dx*scale*2*plan.ratio,-dy*scale*2,0]);
    }
    unturn([x,y,z]){
        const {yaw,pitch}=this.lastPlan,c=Math.cos(-pitch),s=Math.sin(-pitch),a=Math.cos(-yaw),b=Math.sin(-yaw);
        const v=y*c-z*s,w=y*s+z*c;return [x*a+w*b,v,-x*b+w*a];
    }
    alphaAt(texture,u,v){
        if(!this.alphaMaps.has(texture)){
            const image=this.images.get(texture),canvas=Object.assign(document.createElement('canvas'),{width:image.width,height:image.height});
            const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
            this.alphaMaps.set(texture,{width:image.width,height:image.height,pixels:ctx.getImageData(0,0,image.width,image.height).data});canvas.width=canvas.height=1;
        }
        const {width,height,pixels}=this.alphaMaps.get(texture),x=Math.min(width-1,Math.max(0,Math.floor(u*width))),y=Math.min(height-1,Math.max(0,Math.floor(v*height)));
        return pixels[(y*width+x)*4+3];
    }
    screenRay(x,y){
        const p=this.lastPlan;if(!p)return null;
        if(p.frame){const f=p.frame;x=(x*p.width-f.x)/f.width;y=(y*p.height-f.y)/f.height;if(x<0||x>1||y<0||y>1)return null;}
        const shift=p.shift||[0,0];
        const localOrigin=p.perspective?[0,0,p.distance]:[(x*2-1)*p.halfHeight*p.ratio+shift[0],(1-y*2)*p.halfHeight+shift[1],p.depth];
        const localDirection=p.perspective?unit([(x*2-1)*p.tangent*p.ratio+shift[0],(1-y*2)*p.tangent+shift[1],-1]):[0,0,-1];
        const origin=add(this.unturn(localOrigin),p.target),direction=this.unturn(localDirection);
        return {origin,direction};
    }
    axisParameter(x,y,anchor,axis){
        const ray=this.screenRay(x,y);if(!ray)return null;
        const {origin,direction}=ray,offset=subtract(origin,anchor),denominator=1-direction[axis]**2;
        if(denominator<1e-3)return null;
        const alongRay=offset.reduce((sum,n,i)=>sum+n*direction[i],0);
        return (offset[axis]-direction[axis]*alongRay)/denominator;
    }
    pick(x,y){
        const ray=this.screenRay(x,y);if(!ray)return null;
        const {origin,direction}=ray;let nearest=null;
        for(const batch of this.mesh.batches)for(const triangle of batch.triangles){
            const hit=intersectTriangle(origin,direction,...triangle.points);
            if(!hit||nearest&&hit.distance>=nearest.distance)continue;
            const uv=[0,1].map(axis=>hit.weights.reduce((sum,w,i)=>sum+w*triangle.uv[i][axis],0));
            if(this.alphaAt(batch.texture,...uv)<128)continue;
            nearest={...hit,...triangle};
        }
        return nearest;
    }
    releaseSceneResources(){
        this.exportRenderer?.releaseSceneResources();
        const gl=this.gl;
        if(gl){for(const batch of this.batches||[])gl.deleteBuffer(batch.buffer);for(const texture of this.textures.values())gl.deleteTexture(texture);}
        this.batches=[];this.textures.clear();this.alphaMaps.clear();this.meshKey=null;this.mesh=null;this.lastPlan=null;this.materialProtection=new Set();this.canvas.width=this.canvas.height=1;
        if(!this.parentRenderer){
            const keep=new Set([...BASIC_ASSETS,'contour-swatches']);
            for(const key of this.imageRequests.keys())if(!keep.has(key))this.imageRequests.delete(key);
            for(const key of this.images.keys())if(!keep.has(key)){this.images.delete(key);this.imageUse.delete(key);}
        }
    }
    dispose(){
        this.exportRenderer?.dispose();this.exportRenderer=null;this.alphaMaps.clear();
        this.imageRequests.clear();
        if(!this.parentRenderer){this.images.clear();this.imageUse.clear();}
        const gl=this.gl;if(!gl)return;
        for(const batch of this.batches)gl.deleteBuffer(batch.buffer);
        for(const texture of this.textures.values())gl.deleteTexture(texture);
        gl.deleteBuffer(this.wireBuffer);gl.deleteProgram(this.program);this.textures.clear();this.batches=[];this.meshKey=null;this.gl=null;this.canvas.width=this.canvas.height=1;
    }
}
