import {WeatherOcclusion,intersectRects,normalizeCornerRadii} from '../core/WeatherOcclusion.mjs';

const controls='button,input:not([type="hidden"]),select,textarea,progress,meter,[role="button"],[role="tab"],[role="slider"],[role="checkbox"],.md-switch-track,.m3-switch-track,[contenteditable="true"],.layer-item,.launcher-drop-strip';
const surfaces='.custom-titlebar,.settings-win-titlebar,.buttons-win-titlebar,.new-win-titlebar,dialog[open],.modal-overlay.show > .modal,.menu-dropdown,[role="menu"],[role="tooltip"],[popover]:popover-open,#workspace,#right-panel-resizer,.weather-preview';
const panels='.md-panel,.settings-group,.settings-theme-card,.m3-recent-card,.m3-empty-recent,.unsaved-draft-card,.launcher-search,.update-panel,.ui-disclosure,.prefix-card,.prefix-section,.title-inspector,.tool-popover,.bottom-status-bar,.doc-tab-bar,.panel-resizer-v,.settings-win-sidebar';
const icons='svg,img,[role="img"],progress,meter,.material-symbols-rounded,canvas:not(.ambient-weather):not(.weather-preview-canvas):not(#grid-screen-canvas)';
const paintedColor=value=>Boolean(value)&&value!=='transparent'&&
    !/^rgba\([^,]+,[^,]+,[^,]+,\s*0(?:\.0+)?\s*\)$/.test(value)&&
    !/\/\s*0(?:\.0+)?%?\s*\)$/.test(value);
const paintsBox=style=>paintedColor(style.backgroundColor)||style.backgroundImage!=='none'||
    ['Top','Right','Bottom','Left'].some(side=>parseFloat(style['border'+side+'Width'])>0&&style['border'+side+'Style']!=='none'&&paintedColor(style['border'+side+'Color']));
// aria-hidden affects screen readers, not whether text is painted.
const nonText='script,style,canvas,svg,.material-symbols-rounded,.sr-only,.visually-hidden';
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
        this.observer.observe(document.body,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','open','role','src','width','height','aria-expanded']});
        this.rootObserver=new MutationObserver(this.invalidate);
        this.rootObserver.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
        this.resizeObserver=new ResizeObserver(this.invalidate);this.resizeObserver.observe(preview?canvas.parentElement:document.documentElement);
        document.addEventListener('scroll',this.invalidate,true);
        for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel','focusin','toggle','load'])document.addEventListener(event,this.motion,true);
        this.fontsChanged=this.invalidate;
        document.fonts?.addEventListener('loadingdone',this.fontsChanged);
    }

    update(){
        const moving=document.getAnimations().some(animation=>{
            if(animation.playState!=='running'||!animation.effect?.target)return false;
            const target=animation.effect.target;
            if(!(target instanceof Element))return false;
            if(target.closest('#workspace')&&!['workspace','canvas-wrapper'].includes(target.id)||target.closest(controls)&&!target.matches(controls))return false;
            if(!this.animationTypes.has(animation)){
                const geometry=/^(opacity|visibility|transform|translate|scale|rotate|width|height|maxWidth|maxHeight|minWidth|minHeight|left|right|top|bottom|margin.*|padding.*|gap|gridTemplate.*|fontSize|lineHeight|border.*Width)$/;
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
        const addElement=(element,force=false)=>{
            if(element===this.canvas||covered.has(element)||!element.getClientRects().length)return;
            // Viewport-sized drawing overlays are mostly transparent; the
            // actual project is already protected by its canvas wrapper.
            if(element.matches('#workspace > canvas:not(.ruler-top):not(.ruler-left)'))return;
            if(!this.preview&&element.closest('.weather-preview')&&!element.matches('.weather-preview'))return;
            for(let parent=element.parentElement;parent;parent=parent.parentElement)if(covered.has(parent))return;
            const {style,rect,visible}=record(element),clip=element.parentElement?record(element.parentElement).clip:canvasRect;
            if(!visible||!clip||!intersectRects(rect,clip))return;
            // Transparent hit targets may be much larger than their contents.
            // Protect the visible text/icons below, rather than their padding.
            if(!force&&!paintsBox(style))return;
            const sx=rect.width/(element.offsetWidth||rect.width||1),sy=rect.height/(element.offsetHeight||rect.height||1);
            const radius=(value,dimension,scale)=>value?.endsWith('%')?parseFloat(value)*dimension/100:(parseFloat(value)||0)*scale;
            const radii=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>{
                const [x,y=x]=style[key].split(' ');return [radius(x,rect.width,sx),radius(y,rect.height,sy)];
            });
            shapes.push({...rectOf(rect),clip,radii:normalizeCornerRadii(rect.width,rect.height,radii)});covered.add(element);
        };
        if(!this.preview)for(const element of document.querySelectorAll(surfaces))addElement(element,true);
        for(const element of scope.querySelectorAll(panels))addElement(element);
        for(const element of scope.querySelectorAll(controls))addElement(element);
        for(const element of scope.querySelectorAll(icons))addElement(element,true);
        const walker=document.createTreeWalker(this.preview?scope:document.body,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:node=>{
            if(node.nodeType===Node.ELEMENT_NODE)return covered.has(node)||node.matches(nonText)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP;
            return node.data.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
        }});
        let text;
        while((text=walker.nextNode())){
            const element=text.parentElement;if(!element.getClientRects().length)continue;
            const {visible,clip}=record(element);if(!visible||!clip)continue;
            const range=document.createRange();
            // Protect each rendered line as a readable unit, including spaces.
            // DOM ranges retain the real font baseline, wrapping and transforms.
            range.setStart(text,text.data.search(/\S/));range.setEnd(text,text.data.trimEnd().length);
            for(const rect of range.getClientRects()){
                if(rect.width<=0||rect.height<=0||!intersectRects(rect,clip))continue;
                shapes.push({left:Math.floor(rect.left)-1,top:Math.floor(rect.top)-1,
                    right:Math.ceil(rect.right)+1,bottom:Math.ceil(rect.bottom)+1,clip});
            }
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
        if(document.documentElement.classList.contains('developer-weather-bounds')){
            context.save();context.setTransform(scale,0,0,scale,-origin.left*scale,-origin.top*scale);
            context.globalAlpha=1;context.globalCompositeOperation='source-over';context.strokeStyle='#00e5ff';context.lineWidth=1/scale;
            for(const shape of this.index.shapes){
                context.save();if(shape.clip){const c=shape.clip;context.beginPath();context.rect(c.left,c.top,c.right-c.left,c.bottom-c.top);context.clip();}
                context.strokeRect(shape.left,shape.top,shape.right-shape.left,shape.bottom-shape.top);context.restore();
            }
            context.restore();
        }
    }

    releaseMask(){this.mask.width=this.mask.height=1;this.maskRevision=-1;this.maskKey=null;}
    dispose(){
        this.observer.disconnect();this.rootObserver.disconnect();this.resizeObserver.disconnect();
        document.removeEventListener('scroll',this.invalidate,true);
        for(const event of ['transitionrun','transitionend','transitioncancel','animationstart','animationend','animationcancel','focusin','toggle','load'])document.removeEventListener(event,this.motion,true);
        document.fonts?.removeEventListener('loadingdone',this.fontsChanged);this.index.clear();
        this.releaseMask();
    }
}
