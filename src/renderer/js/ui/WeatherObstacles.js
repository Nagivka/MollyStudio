import {WeatherOcclusion,intersectRects,normalizeCornerRadii} from '../core/WeatherOcclusion.mjs';

const controls='button,input:not([type="hidden"]),select,textarea,[role="button"],.md-switch-track,.m3-switch-track,[contenteditable="true"],.layer-item,.launcher-drop-strip';
const surfaces='.custom-titlebar,.settings-win-titlebar,.buttons-win-titlebar,.new-win-titlebar,dialog[open],.modal-overlay.show,.menu-dropdown,[role="menu"],#workspace,.weather-preview';
const nonText='script,style,canvas,svg,.material-symbols-rounded,[aria-hidden="true"],.sr-only,.visually-hidden';
const clipped=value=>/^(hidden|clip|auto|scroll)$/.test(value);
const rectOf=rect=>({left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom});

/** UI geometry is read once per invalidated frame, not once for every particle. */
export default class WeatherObstacles{
    constructor(canvas,{preview=false}={}){
        this.canvas=canvas;this.preview=preview;this.index=new WeatherOcclusion();this.dirty=true;
        this.animationTypes=new WeakMap();
        this.mask=document.createElement('canvas');this.mask.width=this.mask.height=1;this.maskRevision=-1;
        this.invalidate=()=>{this.dirty=true;};
        this.motion=event=>{
            if(event.target===canvas)return;
            this.dirty=true;
        };
        this.observer=new MutationObserver(records=>{
            if(records.some(record=>record.target!==canvas&&!record.target.closest?.('.ambient-weather,.weather-preview-canvas')))this.dirty=true;
        });
        this.observer.observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});
        this.rootObserver=new MutationObserver(this.invalidate);
        this.rootObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
        this.resizeObserver=new ResizeObserver(this.invalidate);this.resizeObserver.observe(preview?canvas.parentElement:document.documentElement);
        document.addEventListener('scroll',this.invalidate,true);
        for(const event of ['transitionrun','animationstart','focusin'])document.addEventListener(event,this.motion,true);
        document.fonts?.addEventListener('loadingdone',this.invalidate);
    }

    update(){
        const moving=document.getAnimations().some(animation=>{
            if(animation.playState!=='running'||!animation.effect?.target)return false;
            const target=animation.effect.target;
            if(!(target instanceof Element))return false;
            if(target.closest('#workspace')&&target.id!=='workspace'||target.closest(controls)&&!target.matches(controls))return false;
            if(!this.animationTypes.has(animation)){
                const geometry=/^(transform|translate|scale|rotate|width|height|maxWidth|maxHeight|minWidth|minHeight|left|right|top|bottom|margin.*|padding.*|gap|gridTemplate.*|fontSize|lineHeight|border.*Width)$/;
                this.animationTypes.set(animation,animation.effect.getKeyframes().some(frame=>Object.keys(frame).some(key=>geometry.test(key))));
            }
            return this.animationTypes.get(animation);
        });
        const motionEnded=this.wasMoving&&!moving;this.wasMoving=moving;
        if(!this.dirty&&!moving&&!motionEnded)return;
        this.dirty=false;
        const canvasRect=rectOf(this.canvas.getBoundingClientRect()),cache=new Map(),scope=this.preview?this.canvas.parentElement:document;
        const record=element=>{
            if(cache.has(element))return cache.get(element);
            const parent=element.parentElement?record(element.parentElement):{visible:true,clip:canvasRect};
            const style=getComputedStyle(element),rect=element.getBoundingClientRect();
            let clip=parent.clip;
            if(clip&&(clipped(style.overflowX)||clipped(style.overflowY))){
                const sx=rect.width/(element.offsetWidth||rect.width||1),sy=rect.height/(element.offsetHeight||rect.height||1);
                const left=rect.left+element.clientLeft*sx,top=rect.top+element.clientTop*sy;
                clip=intersectRects(clip,{left:clipped(style.overflowX)?left:clip.left,right:clipped(style.overflowX)?left+element.clientWidth*sx:clip.right,top:clipped(style.overflowY)?top:clip.top,bottom:clipped(style.overflowY)?top+element.clientHeight*sy:clip.bottom});
            }
            const result={style,rect,clip,visible:parent.visible&&style.visibility==='visible'&&style.display!=='none'&&Number(style.opacity)>.01};
            cache.set(element,result);return result;
        };
        const shapes=[],covered=new Set();
        const addElement=element=>{
            if(element===this.canvas||covered.has(element)||!element.getClientRects().length)return;
            if(!this.preview&&element.closest('.weather-preview')&&!element.matches('.weather-preview'))return;
            for(let parent=element.parentElement;parent;parent=parent.parentElement)if(covered.has(parent))return;
            const {style,rect,visible}=record(element),clip=element.parentElement?record(element.parentElement).clip:canvasRect;
            if(!visible||!clip||!intersectRects(rect,clip))return;
            const sx=rect.width/(element.offsetWidth||rect.width||1),sy=rect.height/(element.offsetHeight||rect.height||1);
            const radius=(value,dimension,scale)=>value?.endsWith('%')?parseFloat(value)*dimension/100:(parseFloat(value)||0)*scale;
            const radii=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>{
                const [x,y=x]=style[key].split(' ');return [radius(x,rect.width,sx),radius(y,rect.height,sy)];
            });
            shapes.push({...rectOf(rect),clip,radii:normalizeCornerRadii(rect.width,rect.height,radii)});covered.add(element);
        };
        if(!this.preview)for(const element of document.querySelectorAll(surfaces))addElement(element);
        for(const element of scope.querySelectorAll(controls))addElement(element);
        const walker=document.createTreeWalker(this.preview?scope:document.body,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:node=>{
            if(node.nodeType===Node.ELEMENT_NODE)return covered.has(node)||node.matches(nonText)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP;
            return node.data.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
        }});
        let text;
        while((text=walker.nextNode())){
            const element=text.parentElement;if(!element.getClientRects().length)continue;
            const {visible,clip}=record(element);if(!visible||!clip)continue;
            const range=document.createRange();range.selectNodeContents(text);
            for(const rect of range.getClientRects())if(intersectRects(rect,clip))shapes.push({...rectOf(rect),clip});
        }
        this.index.setShapes(shapes);
    }

    visibility(x,y){return this.index.visibility(x,y);}

    /** Erase only the pixels inside actual UI boundaries, without an approach zone. */
    apply(context,{width,height,scale,origin}){
        if(!this.index.shapes.length){this.releaseMask();return;}
        const key=[width,height,scale,origin.left,origin.top].join(',');
        if(this.maskRevision!==this.index.revision||this.maskKey!==key){
            const mask=this.mask;
            if(mask.width!==width||mask.height!==height){mask.width=width;mask.height=height;}
            const ctx=mask.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);
            ctx.setTransform(scale,0,0,scale,-origin.left*scale,-origin.top*scale);ctx.fillStyle='#000000';
            for(const shape of this.index.shapes){
                ctx.save();
                if(shape.clip){const clip=shape.clip;ctx.beginPath();ctx.rect(clip.left,clip.top,clip.right-clip.left,clip.bottom-clip.top);ctx.clip();}
                ctx.beginPath();ctx.roundRect(shape.left,shape.top,shape.right-shape.left,shape.bottom-shape.top,(shape.radii||[[0,0],[0,0],[0,0],[0,0]]).map(([x,y])=>({x,y})));ctx.fill();
                ctx.restore();
            }
            this.maskRevision=this.index.revision;this.maskKey=key;
        }
        context.save();
        context.setTransform(1,0,0,1,0,0);context.globalCompositeOperation='destination-out';context.globalAlpha=1;context.drawImage(this.mask,0,0);
        context.restore();
    }

    releaseMask(){this.mask.width=this.mask.height=1;this.maskRevision=-1;this.maskKey=null;}
    dispose(){
        this.observer.disconnect();this.rootObserver.disconnect();this.resizeObserver.disconnect();
        document.removeEventListener('scroll',this.invalidate,true);
        for(const event of ['transitionrun','animationstart','focusin'])document.removeEventListener(event,this.motion,true);
        document.fonts?.removeEventListener('loadingdone',this.invalidate);this.index.clear();
        this.releaseMask();
    }
}
