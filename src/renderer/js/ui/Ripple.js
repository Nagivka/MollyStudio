/**
 * Material Design 3 State Layer & Ripple Effect
 * Provides smooth, organic tactile feedback on user clicks across interactive elements.
 */
import { motionEnabled } from './IconDisclosure.js';

const installedDocuments = new WeakSet();

export function initRippleEffect() {
    if (installedDocuments.has(document)) return;
    installedDocuments.add(document);
    const active=new Set(),targets=new WeakMap();
    const settle=()=>{if(document.hidden||!motionEnabled()||document.documentElement.classList.contains('no-click-effects'))for(const finish of [...active])finish(true);};
    new MutationObserver(settle).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',settle);
    document.addEventListener('visibilitychange',settle);window.addEventListener('blur',()=>{for(const finish of [...active])finish(true);});
    document.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('input, select, textarea')) return;
        const target = e.target.closest('button, [role="button"], [role="tab"], .tool-btn, .menu-btn, .doc-tab, .md-item-card, .m3-recent-card, .color-square-slot');
        if (!target || target.disabled || target.closest('[inert], [aria-disabled="true"]')) return;
        if (['minecraft', 'light-minecraft'].includes(document.documentElement.dataset.theme)) return;
        if (!motionEnabled()||document.documentElement.classList.contains('no-click-effects')) return;

        const rect = target.getBoundingClientRect();
        const diameter = Math.max(rect.width, rect.height) * 1.5;
        const radius = diameter / 2;

        const ripple = document.createElement('span');
        ripple.className = 'md-ripple-wave';
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.width = `${diameter}px`;
        ripple.style.height = `${diameter}px`;
        ripple.style.left = `${e.clientX - rect.left - radius}px`;
        ripple.style.top = `${e.clientY - rect.top - radius}px`;

        let state=targets.get(target);
        if(!state){
            const comp=window.getComputedStyle(target);
            state={count:0,position:target.style.position,overflow:target.style.overflow,
                changedPosition:comp.position==='static',changedOverflow:comp.overflow!=='hidden'};
            targets.set(target,state);
            if(state.changedPosition)target.style.position='relative';
            if(state.changedOverflow)target.style.overflow='hidden';
        }
        state.count++;

        target.appendChild(ripple);

        let cleaned = false,removed=false,fadeTimer,safety;
        const remove=()=>{
            if(removed)return;removed=true;clearTimeout(fadeTimer);clearTimeout(safety);ripple.remove();active.delete(cleanUp);
            window.removeEventListener('pointerup',cleanUp);window.removeEventListener('pointercancel',cleanUp);
            if(--state.count===0){
                if(state.changedPosition&&target.style.position==='relative')target.style.position=state.position;
                if(state.changedOverflow&&target.style.overflow==='hidden')target.style.overflow=state.overflow;
                targets.delete(target);
            }
        };
        const cleanUp = (immediate=false) => {
            if(immediate===true){remove();return;}
            if (cleaned) return;cleaned = true;
            ripple.style.transition = 'opacity 200ms ease';
            ripple.style.opacity = '0';
            fadeTimer=setTimeout(remove,200);
            window.removeEventListener('pointerup', cleanUp);
            window.removeEventListener('pointercancel', cleanUp);
        };
        active.add(cleanUp);

        window.addEventListener('pointerup', cleanUp, { once: true });
        window.addEventListener('pointercancel', cleanUp, { once: true });
        // Fail-safe cleanup so ripple never stays stuck on screen if pointerup is swallowed
        safety=setTimeout(cleanUp,450);
    });
}
