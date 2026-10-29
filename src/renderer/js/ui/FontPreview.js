import PrefixRenderer from '../graphics/PrefixRenderer.js';
const renderer=new PrefixRenderer(),views=new WeakMap();
export function syncFontPreview(select){
    if(!select||!globalThis.document?.createElement)return;
    let group=views.get(select);
    if(!group){
        group=document.createElement('div');group.className='bitmap-font-choices';group.setAttribute('role','group');
        select.after(group);views.set(select,group);
        for(const option of select.options){
            const button=document.createElement('button');button.type='button';button.className='md-btn outlined';button.dataset.fontChoice=option.value;
            const label=document.createElement('span');label.textContent=option.textContent;button.append(label);
            button.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));syncFontPreview(select);});group.append(button);
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
    for(const button of group.children)button.setAttribute('aria-pressed',String(button.dataset.fontChoice===select.value));
}
