import {TITLE_FONT_MODELS} from '../utils/TitleFontModels.js';
import {TITLE_FONT_CATALOG} from '../core/TitleFontCatalog.mjs';
import {titleRowSettings} from '../core/TitleDocument.mjs';
import {titleMaterialState} from '../core/TitleAppearance.mjs';

import {cross,unit,subtract,emptyBounds,expandBounds,boundsCenter,applyObjectTransform} from './TitleSceneMath.mjs';
const corners=(from,to)=>{
    const [x0,y0,z0]=from,[x1,y1,z1]=to;
    return {
        north:[[x1,y1,z0],[x1,y0,z0],[x0,y0,z0],[x0,y1,z0]],
        south:[[x0,y1,z1],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1]],
        east:[[x1,y1,z1],[x1,y0,z1],[x1,y0,z0],[x1,y1,z0]],
        west:[[x0,y1,z0],[x0,y0,z0],[x0,y0,z1],[x0,y1,z1]],
        up:[[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],
        down:[[x0,y0,z1],[x0,y0,z0],[x1,y0,z0],[x1,y0,z1]]
    };
};

/** Camera/output changes and embedded file bytes do not change mesh buffers. */
export function titleMeshKey(data,materials){
    const geometry=({appearance,texture,subtitleTexture,originalColors,top,bottom,side,...value})=>value;
    const {yaw,pitch,zoom,resolution,padding,projection,output,cameraTarget,rows,...geometryData}=data;
    return JSON.stringify({...geometry(geometryData),rows:rows.map(row=>row?geometry(row):null),materials:materials.map(state=>state.key)});
}

/** Native models only. Cross-family fallbacks keep legacy files readable. */
export function resolveTitleGlyph(font,input,creeperA=true){
    const selected=TITLE_FONT_CATALOG[font]||TITLE_FONT_CATALOG['minecraft-ten'];
    const choices=[font,selected.baseFont,/\p{Script=Cyrillic}/u.test(input)?'minecraft-ten-cyrillic':'minecraft-ten'];
    for(const candidate of [...new Set(choices.filter(Boolean))]){
        const models=TITLE_FONT_MODELS[candidate];
        let character=input.toLowerCase();
        if(creeperA&&/[aAаА]/.test(input)&&models?.profiles['😳'])character='😳';
        if(models?.characters[character])return {font:candidate,character,profile:models.profiles[character],elements:models.characters[character],missing:false};
    }
    return {font:'minecraft-ten',character:'?',profile:TITLE_FONT_MODELS['minecraft-ten'].profiles['?'],elements:TITLE_FONT_MODELS['minecraft-ten'].characters['?'],missing:true};
}

/** Assemble original cuboids and closed glyph profiles into the editable scene. */
export function buildTitleMesh(data){
    const batches=new Map(),missing=new Set(),rawFaces=[],modelBatches=new Map(),nodes=[],byId=new Map(),bounds=emptyBounds();
    const addNode=(node)=>{node.baseBounds=emptyBounds();node.bounds=emptyBounds();node.visible=data.transforms[node.id]?.visible!==false;node.locked=data.transforms[node.id]?.locked===true;nodes.push(node);byId.set(node.id,node);return node;};
    const lines=data.text.split('\n');
    let flowBottom=null,flowRow=-1;
    lines.forEach((line,row)=>{
        const settings=titleRowSettings(data,row),type=settings.role;
        if(!line.trim())return;
        const metadata=TITLE_FONT_CATALOG[settings.font],fontHeight=metadata.height;
        const materialKeys=new Map();
        const faceStart=rawFaces.length,nodeStart=nodes.length;
        const rowNode=addNode({id:'row-'+row,parent:null,type:'row',label:line||String(row+1),row});
        const characters=[];let offset=0,previous='';
        const original=data.meshMode!=='solid',spacers=original&&settings.spacing>0&&TITLE_FONT_MODELS[settings.font].characters['\u200b'];
        const tokens=[...line].flatMap((input,index)=>index&&spacers?[{input:'\u200b',index:20000+index},{input,index}]:[{input,index}]);
        if(original&&(settings.terminators||metadata.forcedTerminators)){if(metadata.terminatorSpace){tokens.unshift({input:' ',index:10002});tokens.push({input:' ',index:10003});}tokens.unshift({input:'┫',index:10000});tokens.push({input:'┣',index:10001});}
        for(const token of tokens){
            const input=token.input;
            const characterIndex=token.index;
            if(input===' '&&!(original&&TITLE_FONT_MODELS[settings.font].characters[' '])){offset+=(metadata.spaceWidth+settings.spacing)*(original?settings.scale[0]:1);if(!original)previous='';continue;}
            const glyph=resolveTitleGlyph(settings.font,input,data.creeperA);
            if(input==='\u200b'&&spacers)glyph.elements=glyph.elements.map(cube=>{const result={...cube,from:[...cube.from],to:[...cube.to]};if(result.to[0]>result.from[0])result.to[0]+=settings.spacing-1;else result.from[0]+=settings.spacing-1;return result;});
            const points=glyph.elements.flatMap(cube=>[cube.from,cube.to]);
            const min=[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))),max=[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis])));
            const [x0,,x1]=original?[min[0],min[1],max[0],max[1]]:glyph.profile?.bounds||[min[0],min[1],max[0],max[1]];
            if(glyph.missing)missing.add(input);
            if(settings.kerning)offset-=metadata.shifts?.[previous+glyph.character]||0;
            characters.push({...glyph,offset,input,characterIndex,maxX:x1,min,max,advanceWidth:x1-x0});
            offset+=x1-x0+(spacers?0:settings.spacing*(original?settings.scale[0]:1));previous=glyph.character;
        }
        const rowWidth=Math.max(0,...characters.map(glyph=>glyph.offset+glyph.advanceWidth)),rowScale=type==='bottom'?.75:type==='small'?.35:1;
        for(const glyph of characters){
            const profile=glyph.profile;
            const glyphNode=addNode({id:rowNode.id+'/char-'+glyph.characterIndex+'-'+glyph.input.codePointAt(0).toString(16),parent:rowNode.id,type:'glyph',label:glyph.input==='\u200b'?'Интервал':glyph.input===' '? 'Пробел':glyph.input==='┫'?'Левый край':glyph.input==='┣'?'Правый край':glyph.input,font:glyph.font,row});
            if(!materialKeys.has(glyph.font))materialKeys.set(glyph.font,titleMaterialState(settings,glyph.font).key);
            const key=materialKeys.get(glyph.font);
            if(original||!profile){
                const elements=glyph.elements.map(cube=>({from:[...cube.from],to:[...cube.to],faces:cube.faces}));
                if(type==='small')for(const cube of elements){const endpoint=cube.to[2]>cube.from[2]?cube.to:cube.from;endpoint[2]-=6;}
                const zMin=Math.min(...elements.flatMap(c=>[c.from[2],c.to[2]])),zMax=Math.max(...elements.flatMap(c=>[c.from[2],c.to[2]]));
                const turn=(point,cube)=>{
                    let [x,y,z]=point;
                    x=(glyph.maxX-x+glyph.offset-rowWidth/2)*rowScale;z-=zMin;
                    if(type==='bottom'){y=(y*2-(fontHeight*2+18)-settings.lineGap)*.75;z=z*.75-8+(!metadata.flat&&point[2]===Math.max(cube.from[2],cube.to[2])?24:0);}
                    else if(type==='small'){y=y*.35-fontHeight*.35-settings.lineGap;z=(z-(zMax-zMin))*.35;}
                    else{z-=(zMax-zMin)/2;y-=data.layout==='stacked'?row*(fontHeight+4+settings.lineGap):0;}
                    x*=settings.scale[0];y*=settings.scale[1];z*=settings.scale[2]*data.depth/22;
                    if(type==='bottom')[y,z]=[z,-y];
                    return [x/4,y/4,-z/4];
                };
                for(const [cubeIndex,cube] of elements.entries()){
                    if(!data.outline&&cube.from.every((n,i)=>n>cube.to[i]))continue;
                    const cubeNode=addNode({id:glyphNode.id+'/cube-'+cubeIndex,parent:glyphNode.id,type:'cube',label:String(cubeIndex+1),row,part:'source'});
                    const faces=corners(cube.from,cube.to);
                    for(const [side,definition] of Object.entries(cube.faces)){
                        const points=faces[side].map(point=>turn(point,cube));
                        for(const point of points){for(const node of [rowNode,glyphNode,cubeNode])expandBounds(node.baseBounds,point);expandBounds(bounds,point);}
                        rawFaces.push({points,uv:definition.uv||definition,texture:key,objectId:cubeNode.id,glyphId:glyphNode.id,rowId:rowNode.id});
                    }
                }
                continue;
            }
            const depth=data.depth;
            const bodyDepth=type==='small'?Math.max(0,depth-6):depth;
            const bodyMin=-bodyDepth/2,bodyMax=bodyDepth/2;
            const transform=point=>{
                let [x,y,z]=point;
                x=glyph.maxX-x+glyph.offset-rowWidth/2;
                if(type==='bottom'){
                    y=(y*2-(fontHeight*2+18)-settings.lineGap)*.75;
                    // One affine extrusion for body AND contour. Endpoint-only
                    // stretching leaves gaps where a subdivided wall meets a cap.
                    z=(z-bodyMin)*(.75+(bodyDepth?24/bodyDepth:0))-8;
                }else if(type==='small'){
                    y=y*.35-(fontHeight*.35)-settings.lineGap;
                    z=(z-bodyMax)*.35;
                }else y-=data.layout==='stacked'?row*(fontHeight+4+settings.lineGap):0;
                // A 180-degree Y rotation maps the reference front to positive Z.
                x*=rowScale*settings.scale[0];y*=settings.scale[1];z*=settings.scale[2];
                if(type==='bottom')[y,z]=[z,-y];
                return [x/4,y/4,-z/4];
            };
            const parts=[{index:profile.bodyIndex,outline:false,min:bodyMin,max:bodyMax}];
            if(data.outline&&profile.ring.length)parts.push({index:profile.borderIndex,outline:true,min:bodyMin-(bodyDepth?2:0),max:bodyMax+(bodyDepth?2:0)});
            for(const part of parts){
                const cubeNode=addNode({id:glyphNode.id+'/cube-'+part.index,parent:glyphNode.id,type:'cube',label:String(part.index+1),row,part:part.outline?'outline':'body'});
                const constant=uv=>[uv[0],uv[1],uv[0],uv[1]];
                const face=(points,uv,texture=key)=>{
                    points=points.map(transform);
                    for(const point of points){for(const node of [rowNode,glyphNode,cubeNode])expandBounds(node.baseBounds,point);expandBounds(bounds,point);}
                    rawFaces.push({points,uv,texture,objectId:cubeNode.id,glyphId:glyphNode.id,rowId:rowNode.id});
                };
                const painted=(points,uv,swatch)=>face(points,constant(uv||[(swatch+.5)*16/3,8]),uv?key:'contour-swatches');
                for(const [x0,y0,x1,y1,north,south] of part.outline?profile.ring:profile.caps){
                    const quad=corners([x0,y0,part.min],[x1,y1,part.max]);
                    if(part.outline){painted(quad.north,profile.borderUV,2);painted(quad.south,profile.borderUV,2);}
                    else{face(quad.north,north);face(quad.south,south);}
                }
                if(part.min===part.max)continue;
                for(const [side,coordinate,start,end] of part.outline?profile.ringEdges:profile.edges){
                    const horizontal=side==='up'||side==='down';
                    const shade=side==='up'?profile.lightUV:profile.sideUV;
                    const shadeIndex=side==='up'?0:1;
                    const sections=part.outline?[[part.min,bodyMin,profile.borderUV,2],[bodyMin,bodyMax,shade,shadeIndex],[bodyMax,part.max,profile.borderUV,2]]:[[part.min,part.max,shade,shadeIndex]];
                    for(const [z0,z1,uv,swatch] of sections){
                        if(z0===z1)continue;
                        const quad=corners(horizontal?[start,coordinate,z0]:[coordinate,start,z0],horizontal?[end,coordinate,z1]:[coordinate,end,z1]);
                        painted(quad[side],uv,swatch);
                    }
                }
            }
        }
        if(original&&metadata.autoBorder&&data.outline&&Number.isFinite(rowNode.baseBounds.min[0])){
            const glyphNode=addNode({id:rowNode.id+'/char-10004-0',parent:rowNode.id,type:'glyph',label:'Рамка',font:settings.font,row});
            const cubeNode=addNode({id:glyphNode.id+'/cube-0',parent:glyphNode.id,type:'cube',label:'1',part:'source',row});
            const size=(settings.scale[0]+settings.scale[1])*rowScale/4;
            const from=rowNode.baseBounds.max.map(n=>n+size),to=rowNode.baseBounds.min.map(n=>n-size),uv=[0,metadata.border/320*16,16/1000,(metadata.border+1)/320*16];
            for(const points of Object.values(corners(from,to))){
                for(const point of points){for(const node of [rowNode,glyphNode,cubeNode])expandBounds(node.baseBounds,point);expandBounds(bounds,point);}
                rawFaces.push({points,uv,texture:titleMaterialState(settings,settings.font).key,objectId:cubeNode.id,glyphId:glyphNode.id,rowId:rowNode.id});
            }
        }
        if(data.layout==='stacked'&&Number.isFinite(rowNode.baseBounds.min[1])){
            if(flowBottom!==null){
                const blanks=row-flowRow-1,gap=(4+settings.lineGap+blanks*(fontHeight+4+settings.lineGap))*settings.scale[1]/4;
                const shift=flowBottom-gap-rowNode.baseBounds.max[1];
                for(let i=faceStart;i<rawFaces.length;i++)for(const point of rawFaces[i].points)point[1]+=shift;
                for(let i=nodeStart;i<nodes.length;i++){nodes[i].baseBounds.min[1]+=shift;nodes[i].baseBounds.max[1]+=shift;}
            }
            flowBottom=rowNode.baseBounds.min[1];flowRow=row;
        }
    });
    if(data.layout==='stacked'){
        bounds.min.fill(Infinity);bounds.max.fill(-Infinity);
        for(const node of nodes)if(node.type==='row'&&Number.isFinite(node.baseBounds.min[0])){expandBounds(bounds,node.baseBounds.min);expandBounds(bounds,node.baseBounds.max);}
    }
    const center=Number.isFinite(bounds.min[0])?boundsCenter(bounds):[0,0,0];
    for(const node of nodes){
        if(Number.isFinite(node.baseBounds.min[0])){
            node.pivot=subtract(boundsCenter(node.baseBounds),center);
            node.baseBounds={min:subtract(node.baseBounds.min,center),max:subtract(node.baseBounds.max,center)};
        }else{node.pivot=[0,0,0];node.baseBounds={min:[0,0,0],max:[0,0,0]};}
    }
    for(const node of nodes){
        let pivot=node.pivot,current=node;
        while(current){pivot=applyObjectTransform(pivot,current.pivot,data.transforms[current.id]);current=byId.get(current.parent);}
        node.worldPivot=pivot;
    }
    const renderedBounds=emptyBounds();
    for(const face of rawFaces){
        const chain=[byId.get(face.objectId),byId.get(face.glyphId),byId.get(face.rowId)];
        const points=face.points.map(point=>{
            let result=subtract(point,center);
            for(const node of chain)result=applyObjectTransform(result,node.pivot,data.transforms[node.id]);
            return result;
        });
        for(const point of points)for(const node of chain)expandBounds(node.bounds,point);
        const visible=chain.every(node=>node.visible);
        const normal=unit(cross(subtract(points[1],points[0]),subtract(points[2],points[0])));
        if(!Math.hypot(...normal))continue;
        const key=face.texture;
        if(!modelBatches.has(key))modelBatches.set(key,{texture:key,triangles:[]});
        if(visible&&!batches.has(key))batches.set(key,{texture:key,vertices:[],triangles:[]});
        const batch=batches.get(key),[u0,v0,u1,v1]=face.uv,coords=[[u0,v0],[u0,v1],[u1,v1],[u1,v0]];
        for(const indices of [[0,1,2],[0,2,3]]){
            const triangle={objectId:face.objectId,glyphId:face.glyphId,rowId:face.rowId,points:indices.map(i=>points[i]),uv:indices.map(i=>coords[i].map(n=>n/16))};
            modelBatches.get(key).triangles.push(triangle);
            if(!visible)continue;
            batch.triangles.push(triangle);
            for(const i of indices){expandBounds(renderedBounds,points[i]);batch.vertices.push(...points[i],...normal,...coords[i].map(n=>n/16));}
        }
    }
    for(const node of nodes)if(!Number.isFinite(node.bounds.min[0]))node.bounds=node.baseBounds;
    return {batches:[...batches.values()],modelBatches:[...modelBatches.values()],nodes,baseBounds:Number.isFinite(bounds.min[0])?{min:subtract(bounds.min,center),max:subtract(bounds.max,center)}:{min:[-1,-1,-1],max:[1,1,1]},bounds:Number.isFinite(renderedBounds.min[0])?renderedBounds:{min:[-1,-1,-1],max:[1,1,1]},missing:[...missing]};
}
