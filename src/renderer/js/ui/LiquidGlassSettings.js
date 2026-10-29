import {labelHTML,bindText} from '../core/Locale.mjs';
export function renderLiquidGlassSettings(container,settings) {
    const row=document.createElement('div');row.className='liquid-glass-setting';
    row.innerHTML=`<label class="md-switch"><input type="checkbox" id="setting-liquid-glass" aria-describedby="liquid-glass-description"><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span class="md-switch-label">Liquid Glass</span></label><p class="settings-group-desc" id="liquid-glass-description">${labelHTML('Полупрозрачные панели, мягкое размытие фона и стеклянные блики.')}</p>`;
    container.append(row);
    const input=row.querySelector('input'),description=row.querySelector('p');
    const update=()=>{
        const pixel=settings.get('theme').includes('minecraft');
        input.disabled=pixel;input.checked=!pixel&&settings.get('liquidGlassEnabled');
        bindText(description,pixel?'Liquid Glass недоступен в темах Minecraft.':'Полупрозрачные панели, мягкое размытие фона и стеклянные блики.');
    };
    input.addEventListener('change',()=>settings.set('liquidGlassEnabled',input.checked));
    const observer=new MutationObserver(update);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-liquid-glass']});
    window.addEventListener('molly-language-changed',update);update();
    return ()=>{observer.disconnect();window.removeEventListener('molly-language-changed',update);};
}
