import {motionEnabled} from './IconDisclosure.js';
import {translate} from '../core/Locale.mjs';

const pixelTheme=()=>document.documentElement.dataset.theme?.includes('minecraft');
let transition,themeRequest=0,installed=false;

/** Theme transitions are only requested by deliberate UI actions, never on startup. */
export function revealTheme(apply,button){
    const request=++themeRequest,previous=transition;
    transition=null;
    previous?.skipTransition();
    // A hidden/minimized window may not produce the snapshot frame needed by
    // View Transitions. Settings must still commit and reach the other windows.
    if(document.hidden||!motionEnabled()||document.documentElement.classList.contains('no-theme-transition')||!document.startViewTransition){apply();return;}
    const r=button?.getBoundingClientRect(),x=r?r.left+r.width/2:innerWidth/2,y=r?r.top+r.height/2:innerHeight/2;
    // Skipping a transition still runs its deferred update callback. Only the
    // latest request may apply a theme, including when it disables animation.
    transition=document.startViewTransition(()=>{if(request===themeRequest)apply();});
    const current=transition;
    current.ready.then(()=>{
        if(!motionEnabled()||current!==transition)return;
        const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
        document.documentElement.animate({clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]},
            {duration:480,easing:'cubic-bezier(.2,0,0,1)',pseudoElement:'::view-transition-new(root)'});
    }).catch(()=>{});
    current.finished.catch(()=>{}).finally(()=>{if(transition===current)transition=null;});
}

export function installVisualEffects(){
    if(installed)return;installed=true;
    const active=new Set();let hovered=null;
    const clean=()=>{for(const node of active)node.remove();active.clear();hovered?.style.removeProperty('transform');hovered=null;if(!motionEnabled())transition?.skipTransition();};
    document.addEventListener('pointerdown',event=>{
        const target=event.target.closest?.('button,[role="button"],[role="tab"],.doc-tab');
        if(event.button!==0||!motionEnabled()||document.documentElement.classList.contains('no-click-effects')||!target||target.disabled||target.closest('[inert],[aria-disabled="true"]')||event.target.closest('input,textarea,select'))return;
        const r=target.getBoundingClientRect(),x=Math.min(r.right,Math.max(r.left,event.clientX)),y=Math.min(r.bottom,Math.max(r.top,event.clientY));
        const node=document.createElement('span');node.className='ui-click-response'+(pixelTheme()?' pixel':'');node.ariaHidden='true';
        node.style.left=x+'px';node.style.top=y+'px';document.body.append(node);active.add(node);
        const animation=node.animate(pixelTheme()?{opacity:[.7,0],scale:[1,2]}:{opacity:[.55,0],scale:[.4,1.8]}, {duration:360,easing:pixelTheme()?'steps(4,end)':'ease-out'});
        const remove=()=>{node.remove();active.delete(node);};
        const timeout=setTimeout(remove,500);
        animation.finished.catch(()=>{}).finally(()=>{clearTimeout(timeout);remove();});
    });
    document.addEventListener('pointermove',event=>{
        const card=event.target.closest?.('.m3-recent-card');
        if(hovered&&hovered!==card){hovered.style.removeProperty('transform');hovered=null;}
        if(!card||!motionEnabled()||document.documentElement.classList.contains('no-card-motion')||event.pointerType==='touch'||event.buttons)return;
        hovered=card;
        // Keep pixel art on the physical grid in Minecraft themes.
        if(pixelTheme()){card.style.transform='translateY(-2px)';return;}
        const r=card.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;
        card.style.transform=`perspective(900px) rotateX(${-Math.max(-.5,Math.min(.5,y))*12}deg) rotateY(${Math.max(-.5,Math.min(.5,x))*12}deg) translateY(-2px)`;
    });
    document.addEventListener('pointerout',event=>{if(hovered&&!hovered.contains(event.relatedTarget)){hovered.style.removeProperty('transform');hovered=null;}});
    document.addEventListener('molly-project-saved',event=>{
        if(document.documentElement.classList.contains('no-save-feedback'))return;
        const tab=document.getElementById('doc-tab-'+event.detail.id),icon=tab?.querySelector('.doc-tab-icon');if(!icon)return;
        const old=icon.dataset.savedOriginal||icon.textContent;icon.dataset.savedOriginal=old;icon.textContent='check';
        tab.dataset.savedFeedback='true';icon.setAttribute('aria-label',translate('Сохранено'));
        if(motionEnabled())icon.animate({scale:[.6,1.2,1]},{duration:360});
        clearTimeout(icon.saveFeedbackTimer);icon.saveFeedbackTimer=setTimeout(()=>{icon.textContent=old;delete icon.dataset.savedOriginal;delete tab.dataset.savedFeedback;icon.removeAttribute('aria-label');},1600);
    });
    new MutationObserver(()=>{if(!motionEnabled()||document.documentElement.classList.contains('no-card-motion')||document.documentElement.classList.contains('no-click-effects'))clean();if(document.documentElement.classList.contains('no-theme-transition'))transition?.skipTransition();}).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',clean);
    window.addEventListener('blur',clean);document.addEventListener('visibilitychange',()=>{if(document.hidden)clean();});
}
