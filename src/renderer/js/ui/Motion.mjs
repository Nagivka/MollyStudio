// CSS cannot cancel Web Animations API effects. Keep those effects under the
// same motion preferences and release them when their document is hidden.
const running=new Set();
let installed=false;
export function motionEnabled(){return !document.documentElement.classList.contains('no-animations')&&!matchMedia('(prefers-reduced-motion: reduce)').matches;}
function install(){
    if(installed)return;installed=true;
    const settle=()=>{
        const root=document.documentElement;
        for(const entry of [...running])if(!motionEnabled()||document.hidden||(entry.feature&&root.classList.contains(entry.feature))||!entry.element.isConnected){entry.animation.cancel();running.delete(entry);}
    };
    new MutationObserver(settle).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme']});
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',settle);
    document.addEventListener('visibilitychange',settle);
    window.addEventListener('pagehide',()=>{for(const entry of running)entry.animation.cancel();running.clear();});
}
export function animateUI(element,keyframes,options,{feature}={}){
    if(!element?.animate||!motionEnabled()||(feature&&document.documentElement.classList.contains(feature)))return null;
    install();
    for(const entry of running)if(entry.element===element){entry.animation.cancel();running.delete(entry);}
    const animation=element.animate(keyframes,options),entry={animation,element,feature};running.add(entry);
    animation.finished.catch(()=>{}).finally(()=>running.delete(entry));
    return animation;
}
