import {seasonalDetail} from '../core/SeasonalDetails.mjs';
const art={
    halloween:'<path fill="#e28b32" d="M12 7C2 3 1 22 10 23h4c9-1 8-20-2-16Z"/><path fill="#558449" d="m11 7 1-5 4 1-2 4Z"/><path fill="#573b28" d="m6 12 4-2-1 4Zm12 0-4-2 1 4ZM7 17l3 1 2-2 2 2 3-1-2 4H9Z"/>',
    newyear:'<path fill="#4a996b" d="m12 2 7 9h-3l5 8H3l5-8H5Z"/><path fill="#af7447" d="M10 19h4v4h-4Z"/><circle fill="#f0bd53" cx="12" cy="7" r="1.5"/><circle fill="#e37988" cx="8" cy="14" r="1.5"/><circle fill="#95d2ed" cx="15" cy="17" r="1.5"/>',
    winter:'<path fill="none" stroke="#8bc9df" stroke-width="2" stroke-linecap="round" d="M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3M4 11l4-1-1-4m13 7-4 1 1 4M4 13l4 1-1 4m13-7-4-1 1-4"/>',
    spring:'<path stroke="#6ca362" stroke-width="2" fill="none" d="M12 13v10m0-4 6-3"/><g fill="#e69cba"><ellipse cx="12" cy="7" rx="3" ry="5"/><ellipse cx="12" cy="13" rx="3" ry="5"/><ellipse cx="9" cy="10" rx="5" ry="3"/><ellipse cx="15" cy="10" rx="5" ry="3"/></g><circle cx="12" cy="10" r="3" fill="#f0c978"/>',
    summer:'<g stroke="#e0ab3c" stroke-width="2" stroke-linecap="round"><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></g><circle fill="#eac45b" cx="12" cy="12" r="6"/>',
    autumn:'<path fill="#d49147" d="M20 3C3 1 1 14 7 18c7 6 15-3 13-15Z"/><path fill="none" stroke="#906237" stroke-width="1.5" stroke-linecap="round" d="m4 23 11-14m-5 7 6-1m-5-1-1-5"/>'
};
const images={halloween:'pumpkin.png',newyear:'spruce.png',winter:'snowball.png',spring:'cherry.png',summer:'sunflower.png',autumn:'leaves.png'};
let timer=0,currentSettings={},listening=false;
export function syncSeasonalDetails(settings) {
    currentSettings=settings;
    if(typeof document==='undefined')return;
    const title=document.querySelector('.launcher-hero-title');
    clearTimeout(timer);timer=0;
    if(!title)return;
    title.querySelector('.seasonal-decoration')?.remove();
    if(settings.seasonalDetailsEnabled===false)return;
    const season=seasonalDetail();if(!season)return;
    const decoration=document.createElement('span');decoration.className='seasonal-decoration';decoration.dataset.season=season;decoration.setAttribute('aria-hidden','true');
    if(settings.theme?.includes('minecraft')){
        const image=document.createElement('img');image.alt='';image.draggable=false;image.src=new URL('../../assets/seasonal/'+images[season],import.meta.url).href;decoration.append(image);
    }else decoration.innerHTML=`<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${art[season]}</svg>`;
    title.append(decoration);
    const now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    timer=setTimeout(()=>syncSeasonalDetails(currentSettings),midnight-now+50);
    if(!listening){
        listening=true;
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSeasonalDetails(currentSettings);});
        window.addEventListener('focus',()=>syncSeasonalDetails(currentSettings));
        window.addEventListener('pagehide',()=>{clearTimeout(timer);timer=0;});
    }
}
