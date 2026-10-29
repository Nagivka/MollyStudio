import {DrawCommand,TextDataCommand,CompoundCommand} from '../core/Commands.js';
import {inheritButtonSource} from '../graphics/ButtonSource.mjs';
import {boundsOf,resizeAtAnchor} from './TransformGeometry.mjs';
import {captureTextState,restoreTextState} from '../graphics/TextEdit.mjs';
import {transformTextAxes} from '../graphics/TextTransform.mjs';

/** Numeric batch operations are distinct from the active object's drag handles. */
export function transformBatch(tool,kind,options={}) {
    const active=tool.getEditableLayer();if(!active)return false;
    if(tool.isTransforming||tool.isMoving)tool.commitAction();
    const targets=options.targets||[...new Set(tool.getAlignmentUnits(active).flatMap(unit=>tool.getMoveTargets(unit.layer,false)))];
    const items=targets.map(layer=>({layer,box:layer.sourceRect||tool.getLayerBoundingBox(layer)})).filter(item=>item.box);
    const bounds=boundsOf(items.map(item=>item.box));if(!bounds?.w||!bounds.h)return false;
    let next={...bounds},sx=1,sy=1;
    const quarter=((Number(options.angle)||0)%360+360)%360;
    if(kind==='resize'||kind==='scale'){
        let w=kind==='scale'?bounds.w*options.factor:Number(options.width),h=kind==='scale'?bounds.h*options.factor:Number(options.height);
        if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)return false;
        w=Math.max(1,Math.min(4096,Math.round(w)));h=Math.max(1,Math.min(4096,Math.round(h)));
        if(options.axis&&tool.isLockAspect()){if(options.axis==='w')h=Math.max(1,Math.min(4096,Math.round(w*bounds.h/bounds.w)));else w=Math.max(1,Math.min(4096,Math.round(h*bounds.w/bounds.h)));}
        const [x,y]=(document.getElementById('prop-resize-anchor')?.value||'0,0').split(',').map(Number);
        next=resizeAtAnchor(bounds,w,h,{x,y});if(!next)return false;sx=w/bounds.w;sy=h/bounds.h;
        if(sx===1&&sy===1)return false;
    }else if(kind==='rotate'){
        if(![90,180,270].includes(quarter))return false;
        const swap=quarter!==180;next={x:bounds.x+(bounds.w-(swap?bounds.h:bounds.w))/2,y:bounds.y+(bounds.h-(swap?bounds.w:bounds.h))/2,w:swap?bounds.h:bounds.w,h:swap?bounds.w:bounds.h};
    }else if(kind!=='flip')return false;
    const point=(x,y)=>{
        const u=x-bounds.x,v=y-bounds.y;
        if(kind==='rotate')return quarter===90?{x:next.x+bounds.h-v,y:next.y+u}:quarter===180?{x:next.x+bounds.w-u,y:next.y+bounds.h-v}:{x:next.x+v,y:next.y+bounds.w-u};
        if(kind==='flip')return {x:bounds.x+(options.horizontal?bounds.w-u:u),y:bounds.y+(options.vertical?bounds.h-v:v)};
        return {x:next.x+u*sx,y:next.y+v*sy};
    };
    const transformed=box=>{
        const corners=[[box.x,box.y],[box.x+box.w,box.y],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h]].map(([x,y])=>point(x,y));
        const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));
        return {x,y,w:Math.max(1,Math.max(...corners.map(p=>p.x))-x),h:Math.max(1,Math.max(...corners.map(p=>p.y))-y)};
    };
    const extra=items.reduce((sum,{layer,box})=>sum+(layer.type==='text'?0:(!layer.sourceCanvas?box.w*box.h:0)+(['flip','rotate'].includes(kind)?(layer.sourceCanvas?.width||box.w)*(layer.sourceCanvas?.height||box.h):0)),0);
    if(tool.layerManager.canAllocateLayers?.(0,extra)===false)return false;
    const prepared=[],temporaries=[];let applied=false,succeeded=false;
    try{
        for(const {layer,box} of items){
            if(layer.type==='text'){
                const before=structuredClone(layer.textData),data=structuredClone(before),origin=point(before.x,before.y),odd=(Number(before.rotation)||0)%180!==0;
                data.x=origin.x;data.y=origin.y;
                if(kind==='rotate')data.rotation=((Number(before.rotation)||0)+quarter)%360;
                else if((Number(before.rotation)||0)%90!==0||before.shearX)Object.assign(data,transformTextAxes(before,point));
                else if(kind==='flip'){
                    if(options.horizontal)data[odd?'flipY':'flipX']=!data[odd?'flipY':'flipX'];
                    if(options.vertical)data[odd?'flipX':'flipY']=!data[odd?'flipX':'flipY'];
                }else{data.scaleX=(Number(before.scaleX)||1)*(odd?sy:sx);data.scaleY=(Number(before.scaleY)||1)*(odd?sx:sy);}
                if(![data.x,data.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000)||[data.scaleX,data.scaleY].some(n=>n!=null&&(!Number.isFinite(n)||n<=0||n>1000000)))throw Error('Преобразование выходит за допустимые координаты или масштаб.');
                if(data.shearX!=null&&(!Number.isFinite(data.shearX)||Math.abs(data.shearX)>1000000))throw Error('Некорректное преобразование текста.');
                prepared.push({layer,before,data,state:captureTextState(layer),revision:layer.contentRevision||0});
            }else{
                let source=tool.ensureSourceCanvas(layer);if(!source)throw Error('Не удалось подготовить исходник объекта.');
                if(['flip','rotate'].includes(kind)){
                    const canvas=document.createElement('canvas'),swap=kind==='rotate'&&quarter!==180;
                    temporaries.push(canvas);
                    canvas.width=swap?source.height:source.width;canvas.height=swap?source.width:source.height;
                    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;
                    if(kind==='flip'){ctx.translate(options.horizontal?canvas.width:0,options.vertical?canvas.height:0);ctx.scale(options.horizontal?-1:1,options.vertical?-1:1);}
                    else if(quarter===90){ctx.translate(canvas.width,0);ctx.rotate(Math.PI/2);}
                    else if(quarter===180){ctx.translate(canvas.width,canvas.height);ctx.rotate(Math.PI);}
                    else{ctx.translate(0,canvas.height);ctx.rotate(-Math.PI/2);}
                    ctx.drawImage(source,0,0);inheritButtonSource(source,canvas,ctx);source=canvas;
                }
                const rect=transformed(box);
                if(![rect.x,rect.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000))throw Error('Преобразование выходит за допустимые координаты.');
                prepared.push({layer,before:layer.getImageData(),source,rect,revision:layer.contentRevision||0});
            }
        }
        const commands=[];
        applied=true;
        for(const item of prepared){
            const {layer,before}=item;
            if(item.data){layer.textData=item.data;tool.bus.emit('RENDER_TEXT_LAYER',layer,{throwErrors:true});commands.push(new TextDataCommand(layer,before,item.data,tool.bus));}
            else{layer.clear(false);tool.drawResampled(layer.ctx,item.source,item.rect.x,item.rect.y,item.rect.w,item.rect.h,0,tool.getResampleMode());layer.setMasterSource(item.source,item.rect);layer.shapeData=null;commands.push(new DrawCommand(layer,before,layer.getImageData()));}
        }
        const command=new CompoundCommand(commands);command.name=kind==='rotate'?'Поворот выбранных объектов':kind==='flip'?'Отражение выбранных объектов':'Масштабирование выбранных объектов';command.icon='transform';tool.history.push(command);
        succeeded=true;
    }catch(error){
        const failures=[];
        if(applied){
            for(const item of [...prepared].reverse()){
                try{if(item.state)restoreTextState(item.layer,item.state);else{item.layer.putImageData(item.before);item.layer.contentRevision=item.revision;}}
                catch(failure){failures.push(failure);}
            }
            tool.bus.emit('CANVAS_UPDATED');
        }
        if(failures.length)console.error(new AggregateError([error,...failures],'Не удалось полностью восстановить объекты после ошибки преобразования.'));
        window.mollyEditor?.showToast(failures.length?'Ошибка преобразования. Не все объекты удалось восстановить; проверьте документ.':error.message,'error');return false;
    }finally{if(!succeeded)for(const canvas of temporaries)canvas.width=canvas.height=1;}
    tool.syncBoxWithActiveLayer();tool.bus.emit('CANVAS_UPDATED');return true;
}
