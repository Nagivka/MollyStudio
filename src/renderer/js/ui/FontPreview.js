import PrefixRenderer from '../graphics/PrefixRenderer.js';
import {bindAttribute} from '../core/Locale.mjs';
import {BITMAP_FONTS} from '../core/BitmapFonts.mjs';
import {paintFittedPixelPreview,alignPixelPreview,watchPixelRatio} from '../graphics/PixelPreview.mjs';
const renderer=new PrefixRenderer(),views=new WeakMap();
let alignmentFrame=0;
const alignSamples=()=>{
    if(alignmentFrame)return;
    alignmentFrame=requestAnimationFrame(()=>{alignmentFrame=0;document.querySelectorAll('.bitmap-font-sample').forEach(alignPixelPreview);});
};
// Scrolling an inspector moves its samples without resizing the font group.
globalThis.document?.addEventListener?.('scroll',alignSamples,{capture:true,passive:true});
globalThis.window?.addEventListener?.('resize',alignSamples,{passive:true});
export function syncFontPreview(select){
    if(!select||!globalThis.document?.createElement)return;
    select.hidden=true;
    for(const option of select.options){const font=BITMAP_FONTS.find(font=>font.id===option.value);if(font&&option.textContent!==font.name)option.textContent=font.name;}
    let group=views.get(select);
    if(!group){
        group=document.createElement('div');group.className='bitmap-font-choices';group.setAttribute('role','group');
        bindAttribute(group,'aria-label','Выбор шрифта');
        select.after(group);views.set(select,group);
        for(const option of select.options){
            const button=document.createElement('button');button.type='button';button.className='md-btn outlined';button.dataset.fontChoice=option.value;
            const label=document.createElement('span');label.textContent=option.textContent;button.append(label);
            button.addEventListener('click',()=>{
                if(select.disabled||select.value===option.value)return;
                select.value=option.value;
                // Native selects emit input before change. Prefix editing uses
                // input for live changes and change for the undo boundary.
                select.dispatchEvent(new Event('input',{bubbles:true}));
                select.dispatchEvent(new Event('change',{bubbles:true}));
                syncFontPreview(select);
            });group.append(button);
        }
        select.addEventListener('change',()=>syncFontPreview(select));
        const samples=new Map();let frame=0;
        const render=()=>{
            frame=0;
            if(!group.isConnected||!group.checkVisibility())return;
            for(const [button,{source,canvas}] of samples){
                paintFittedPixelPreview(canvas,source,{region:{x:0,y:0,width:source.width,height:source.height},maxWidth:Math.max(1,button.clientWidth-12),maxHeight:22,maxScale:2});
            }
        };
        const schedule=()=>{if(!frame)frame=requestAnimationFrame(render);};
        const observer=new ResizeObserver(schedule);observer.observe(group);
        watchPixelRatio(schedule);
        renderer.load().then(()=>{
            if(!group.isConnected)return;
            for(const button of group.children){
                const {mask}=renderer.textMask({text:'Abc Абв 123',font:button.dataset.fontChoice,letterSpacing:0});
                const canvas=document.createElement('canvas');canvas.className='bitmap-font-sample';canvas.setAttribute('aria-hidden','true');button.append(canvas);samples.set(button,{source:mask,canvas});
            }
            schedule();
        }).catch(()=>{});
    }
    for(const button of group.children){button.disabled=select.disabled;button.setAttribute('aria-pressed',String(button.dataset.fontChoice===select.value));}
}
