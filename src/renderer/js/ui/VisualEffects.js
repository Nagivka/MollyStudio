import {motionEnabled} from './IconDisclosure.js';
import {animateUI} from './Motion.mjs';
import {translate} from '../core/Locale.mjs';
import {advanceCardSpring} from './CardMotion.mjs';

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
    try{transition=document.startViewTransition(()=>{if(request===themeRequest)apply();});}
    catch{if(request===themeRequest)apply();return;}
    const current=transition;
    current.ready.then(()=>{
        if(!motionEnabled()||current!==transition)return;
        const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
        animateUI(document.documentElement,{clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]},
            {duration:480,easing:'cubic-bezier(.2,0,0,1)',pseudoElement:'::view-transition-new(root)'},{feature:'no-theme-transition'});
    }).catch(()=>{});
    current.finished.catch(()=>{}).finally(()=>{if(transition===current)transition=null;});
}

export function installVisualEffects(){
    if(installed)return;installed=true;
    const active=new Set();let hovered=null,bounds=null;
    const cards=new Map();let cardFrame=0,lastFrame=0;
    const clearCard=card=>{card.style.removeProperty('transform');delete card.dataset.cardPhysics;cards.delete(card);};
    const paint=(card,state)=>{const [x,y,lift]=state.position;card.style.transform=pixelTheme()?`translateY(${Math.round(lift*devicePixelRatio)/devicePixelRatio}px)`:`perspective(900px) rotateX(${x.toFixed(3)}deg) rotateY(${y.toFixed(3)}deg) translateY(${lift.toFixed(3)}px)`;};
    const tick=time=>{
        cardFrame=0;const dt=lastFrame?(time-lastFrame)/1000:1/60;lastFrame=time;
        for(const [card,state] of cards){
            if(!card.isConnected){clearCard(card);continue;}
            const settled=advanceCardSpring(state,state.target,dt);
            if(settled){state.position=[...state.target];state.velocity.fill(0);}
            if(settled&&card!==hovered)clearCard(card);else paint(card,state);
        }
        if([...cards.values()].some(state=>state.velocity.some(v=>Math.abs(v)>.03)||state.position.some((v,i)=>Math.abs(v-state.target[i])>.015)))cardFrame=requestAnimationFrame(tick);
        else lastFrame=0;
    };
    const wake=()=>{if(!cardFrame)cardFrame=requestAnimationFrame(tick);};
    const release=()=>{if(hovered){const state=cards.get(hovered);if(state){state.target=[0,0,0];wake();}else hovered.style.removeProperty('transform');}hovered=null;bounds=null;};
    const clean=()=>{for(const node of active)node.remove();active.clear();for(const card of cards.keys())clearCard(card);hovered?.style.removeProperty('transform');hovered=null;bounds=null;cancelAnimationFrame(cardFrame);cardFrame=0;lastFrame=0;if(!motionEnabled())transition?.skipTransition();};
    document.addEventListener('pointerdown',event=>{
        const target=event.target.closest?.('button,[role="button"],[role="tab"],.doc-tab');
        if(event.button!==0||!motionEnabled()||document.documentElement.classList.contains('no-click-effects')||!target||target.disabled||target.closest('[inert],[aria-disabled="true"]')||event.target.closest('input,textarea,select'))return;
        const r=target.getBoundingClientRect(),x=Math.min(r.right,Math.max(r.left,event.clientX)),y=Math.min(r.bottom,Math.max(r.top,event.clientY));
        const node=document.createElement('span');node.className='ui-click-response'+(pixelTheme()?' pixel':'');node.ariaHidden='true';
        node.style.left=x+'px';node.style.top=y+'px';document.body.append(node);active.add(node);
        const animation=animateUI(node,pixelTheme()?{opacity:[.7,0],scale:[1,2]}:{opacity:[.55,0],scale:[.4,1.8]}, {duration:360,easing:pixelTheme()?'steps(4,end)':'ease-out'},{feature:'no-click-effects'});
        const remove=()=>{node.remove();active.delete(node);};
        const timeout=setTimeout(remove,500);
        animation?.finished.catch(()=>{}).finally(()=>{clearTimeout(timeout);remove();});
    });
    document.addEventListener('pointermove',event=>{
        const card=event.target.closest?.('.m3-recent-card');
        if(hovered&&hovered!==card)release();
        if(!card||!motionEnabled()||document.documentElement.classList.contains('no-card-motion')||event.pointerType==='touch'||event.buttons){release();return;}
        if(hovered!==card||!bounds)bounds=card.getBoundingClientRect();hovered=card;
        // Keep pixel art on the physical grid in Minecraft themes.
        const r=bounds,x=(event.clientX-r.left)/Math.max(1,r.width)-.5,y=(event.clientY-r.top)/Math.max(1,r.height)-.5;
        let state=cards.get(card);
        if(!state){state={position:[0,0,0],velocity:[0,0,0],target:[0,0,0]};cards.set(card,state);card.dataset.cardPhysics='true';paint(card,state);}
        state.target=pixelTheme()?[0,0,-4]:[-Math.max(-.5,Math.min(.5,y))*16,Math.max(-.5,Math.min(.5,x))*16,-4];wake();
    });
    document.addEventListener('pointerout',event=>{if(hovered&&!hovered.contains(event.relatedTarget))release();});
    document.addEventListener('molly-project-saved',event=>{
        if(document.documentElement.classList.contains('no-save-feedback'))return;
        const tab=document.getElementById('doc-tab-'+event.detail?.id),icon=tab?.querySelector('.doc-tab-icon');if(!icon)return;
        const old=icon.dataset.savedOriginal||icon.textContent;icon.dataset.savedOriginal=old;icon.textContent='check';
        tab.dataset.savedFeedback='true';icon.setAttribute('aria-label',translate('Сохранено'));
        if(motionEnabled())animateUI(icon,pixelTheme()?{opacity:[.4,1]}:{scale:[.6,1.2,1]},{duration:360},{feature:'no-save-feedback'});
        clearTimeout(icon.saveFeedbackTimer);icon.saveFeedbackTimer=setTimeout(()=>{icon.textContent=old;delete icon.dataset.savedOriginal;delete tab.dataset.savedFeedback;icon.removeAttribute('aria-label');},1600);
    });
    new MutationObserver(records=>{if(records.some(record=>record.attributeName==='data-theme')||!motionEnabled()||document.documentElement.classList.contains('no-card-motion')||document.documentElement.classList.contains('no-click-effects'))clean();if(document.documentElement.classList.contains('no-theme-transition'))transition?.skipTransition();}).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme']});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',clean);
    window.addEventListener('blur',clean);document.addEventListener('visibilitychange',()=>{if(document.hidden)clean();});
    window.addEventListener('resize',clean);document.addEventListener('scroll',()=>{if(hovered)clean();},{capture:true,passive:true});
}
