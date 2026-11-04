import {seasonalDetail} from '../core/SeasonalDetails.mjs';
import {bindAttribute} from '../core/Locale.mjs';
const art={
    halloween:'<path fill="#e28b32" d="M12 7C2 3 1 22 10 23h4c9-1 8-20-2-16Z"/><path fill="#558449" d="m11 7 1-5 4 1-2 4Z"/><path fill="#573b28" d="m6 12 4-2-1 4Zm12 0-4-2 1 4ZM7 17l3 1 2-2 2 2 3-1-2 4H9Z"/>',
    newyear:'<path fill="#4a996b" d="m12 2 7 9h-3l5 8H3l5-8H5Z"/><path fill="#af7447" d="M10 19h4v4h-4Z"/><circle fill="#f0bd53" cx="12" cy="7" r="1.5"/><circle fill="#e37988" cx="8" cy="14" r="1.5"/><circle fill="#95d2ed" cx="15" cy="17" r="1.5"/>',
    christmas:'<path fill="#efc96a" d="m12 1 3 7 8 1-6 5 2 9-7-5-7 5 2-9-6-5 8-1Z"/>',
    studioBirthday:'<path fill="#8bc7ee" d="M3 12h18v10H3Z"/><path fill="#f3b6cd" d="M3 12h18v4H3Z"/><path fill="#fff0cf" d="M5 8h14v5H5Z"/><path fill="#78a7e8" d="M11 4h2v4h-2Z"/><path fill="#f5cb62" d="m12 0 2 3-2 2-2-2Z"/>',
    authorBirthday:'<path fill="#bd89dd" d="M3 12h18v10H3Z"/><path fill="#f3b6cd" d="M3 12h18v4H3Z"/><path fill="#fff0cf" d="M5 8h14v5H5Z"/><path fill="#d89aee" d="M11 4h2v4h-2Z"/><path fill="#f5cb62" d="m12 0 2 3-2 2-2-2Z"/>'

};
const images={halloween:'../../assets/seasonal/pumpkin.png',newyear:'../../assets/seasonal/spruce.png',christmas:'../../assets/items_minecraft/nether_star.png',studioBirthday:'../../assets/items_minecraft/cake.png',authorBirthday:'../../assets/items_minecraft/cake.png'};
const greetings={newyear:'С Новым годом!',halloween:'С Хэллоуином!',christmas:'С Рождеством!',studioBirthday:'С днём рождения, MollyStudio!',authorBirthday:'С днём рождения, Nagivka!'};
let timer=0,currentSettings={},listening=false;
export function syncSeasonalDetails(settings) {
    currentSettings=settings;
    if(typeof document==='undefined')return;
    const title=document.querySelector('.launcher-hero-title');
    clearTimeout(timer);timer=0;
    if(!title)return;
    title.querySelector('.seasonal-decoration')?.remove();
    if(settings.seasonalDetailsEnabled===false)return;
    const now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    timer=setTimeout(()=>syncSeasonalDetails(currentSettings),midnight-now+50);
    if(!listening){
        listening=true;
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSeasonalDetails(currentSettings);});
        window.addEventListener('focus',()=>syncSeasonalDetails(currentSettings));
        window.addEventListener('pagehide',()=>{clearTimeout(timer);timer=0;});
    }
    const override=settings.developerUnlocked&&Object.hasOwn(art,settings.developerHoliday)?settings.developerHoliday:null;
    const season=override||seasonalDetail();if(!season)return;
    const decoration=document.createElement('span');decoration.className='seasonal-decoration';decoration.dataset.season=season;decoration.setAttribute('role','img');bindAttribute(decoration,'aria-label',greetings[season]);bindAttribute(decoration,'title',greetings[season]);
    if(settings.theme?.includes('minecraft')){
        const image=document.createElement('img');image.alt='';image.draggable=false;image.src=new URL(images[season],import.meta.url).href;decoration.append(image);
    }else decoration.innerHTML=`<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${art[season]}</svg>`;
    title.append(decoration);
}
