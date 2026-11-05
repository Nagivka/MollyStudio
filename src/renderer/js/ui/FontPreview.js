import PrefixRenderer from '../graphics/PrefixRenderer.js';
import {bindAttribute} from '../core/Locale.mjs';
import {BITMAP_FONTS} from '../core/BitmapFonts.mjs';
const renderer=new PrefixRenderer(),views=new WeakMap();
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
        renderer.load().then(()=>{
            if(!group.isConnected)return;
            for(const button of group.children){
                const {mask}=renderer.textMask({text:'Abc Абв 123',font:button.dataset.fontChoice,letterSpacing:0});
                const scale=button.clientWidth>=mask.width*2+12?2:1;
                mask.style.width=mask.width*scale+'px';mask.style.height=mask.height*scale+'px';
                mask.className='bitmap-font-sample';mask.setAttribute('aria-hidden','true');button.append(mask);
            }
        }).catch(()=>{});
    }
    for(const button of group.children){button.disabled=select.disabled;button.setAttribute('aria-pressed',String(button.dataset.fontChoice===select.value));}
}
