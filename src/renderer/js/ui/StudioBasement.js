import {bindText,labelHTML,translate} from '../core/Locale.mjs';
import {BASEMENT_COLORS as colors} from '../utils/Palettes.js';
function drawRoom(canvas){
    const c=canvas.getContext('2d');
    const rect=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    rect(0,0,320,180,'#171b29');rect(12,12,296,115,'#303042');
    for(let y=14;y<126;y+=14)for(let x=14+(y%28?0:-15);x<308;x+=30){rect(Math.max(12,x),y,Math.min(28,308-Math.max(12,x)),12,y%28?'#363449':'#343247');}
    rect(12,127,296,41,'#654b45');
    for(let y=128;y<168;y+=10)rect(12,y,296,1,'#3c3036');
    for(let x=18;x<300;x+=36)rect(x,128,1,40,'#49373b');
    // Stairs, shelves and an old workbench; all art is drawn on whole pixels.
    for(let i=0;i<6;i++){rect(20+i*5,46+i*15,31,6,'#b39578');rect(20+i*5,52+i*15,31,9,'#574753');}
    rect(94,42,115,5,'#937466');
    for(let i=0;i<7;i++)rect(100+i*14,24+(i%3)*3,9,18-(i%3)*3,colors[i+1]);
    rect(86,112,146,9,'#a27d65');rect(90,121,6,34,'#59414a');rect(220,121,6,34,'#59414a');
    rect(134,68,56,42,'#101923');rect(138,72,48,32,'#83bfc5');
    rect(158,110,8,3,'#a7abb5');rect(147,113,30,3,'#c6b7bf');
    rect(145,83,32,16,'#374357');rect(149,79,24,5,'#cad9d2');
    rect(148,87,7,9,'#7694a1');rect(159,87,7,9,'#7694a1');rect(170,87,4,9,'#7694a1');
    rect(96,94,24,16,'#f0d6b2');rect(99,98,18,1,'#9d7967');rect(99,102,13,1,'#9d7967');
    rect(200,101,12,10,'#c49bad');rect(212,103,4,5,'#c49bad');rect(203,96,1,3,'#e0c7c5');
    rect(246,111,45,35,'#392f41');rect(248,113,41,11,'#9c7361');rect(248,127,41,17,'#7e594f');rect(266,123,5,8,'#e6bd72');
    rect(239,54,48,37,'#a6836a');rect(242,57,42,31,'#f1dab5');
    for(let i=0;i<5;i++)rect(246+i*7,64+(i%2)*6,5,14,colors[i+2]);
    rect(214,16,2,24,'#95847f');rect(204,40,22,4,'#9b7c5f');rect(208,44,14,9,'#f4d896');rect(212,46,6,5,'#fff3c3');
}
export function installStudioBasement(settings){
    const logo=document.querySelector('.launcher-hero-logo');if(!logo)return;
    let taps=0,last=0,dialog=null;
    logo.tabIndex=0;logo.removeAttribute('aria-hidden');logo.setAttribute('role','img');logo.setAttribute('aria-label','MollyStudio');
    const open=()=>{
        if(dialog?.isConnected)return;
        const previous=document.activeElement;
        dialog=document.createElement('dialog');dialog.className='studio-basement';dialog.setAttribute('aria-labelledby','basement-heading');
        dialog.innerHTML=`<header><div><small>MOLLYSTUDIO / SECRET ROOM</small><h2 id="basement-heading">${labelHTML('Подвал MollyStudio')}</h2></div><button class="md-btn outlined" type="button" data-basement-close>${labelHTML('Наверх')}</button></header>
        <div class="basement-room"><canvas width="320" height="180" role="img" aria-label="${translate('Пиксельная мастерская автора')}"></canvas>
        ${[['note','Записка на столе'],['sketch','Наброски на стене'],['chest','Секретный сундук']].map(([id,label])=>`<button type="button" class="basement-hotspot basement-${id}" data-basement="${id}" aria-label="${translate(label)}" title="${translate(label)}"></button>`).join('')}</div>
        <section class="basement-message" aria-live="polite"><h3 data-basement-title></h3><p data-basement-message></p></section>
        <div class="basement-reward" hidden><div class="basement-swatches"></div><button type="button" class="md-btn primary" data-basement-add></button></div>`;
        document.body.append(dialog);drawRoom(dialog.querySelector('canvas'));
        const room=dialog;
        const message=(title,text)=>{if(dialog!==room||!room.isConnected)return;bindText(room.querySelector('[data-basement-title]'),title);bindText(room.querySelector('[data-basement-message]'),text);};
        message('Ты нашёл мастерскую!','Осмотрись: на столе лежит записка, на стене — наброски, а в сундуке кое-что спрятано.');
        dialog.querySelector('[data-basement="note"]').onclick=()=>message('Записка','Здесь можно спокойно пробовать, ошибаться и начинать заново. Самый важный пиксель — тот, который ты решился поставить. Спасибо, что рисуешь в MollyStudio!');
        dialog.querySelector('[data-basement="sketch"]').onclick=()=>message('Наброски','Маленькая рамка, пара кнопок и любимые цвета. Иногда целая идея начинается с нескольких пикселей.');
        dialog.querySelector('[data-basement="chest"]').onclick=()=>{
            message('Полуночная мастерская','Секретная палитра найдена! Добавь её в общий список палитр редакторов и генераторов.');dialog.querySelector('.basement-reward').hidden=false;
        };
        const copy=async text=>{try{await navigator.clipboard.writeText(text);message('Скопировано','Цвета можно использовать в своих проектах.');}catch{message('Не удалось скопировать','Попробуй ещё раз.');}};
        for(const color of colors){const button=document.createElement('button');button.type='button';button.style.backgroundColor=color;button.title=color;button.setAttribute('aria-label',color);button.onclick=()=>copy(color);dialog.querySelector('.basement-swatches').append(button);}
        const add=dialog.querySelector('[data-basement-add]');
        const syncReward=()=>{const unlocked=settings.get('basementPaletteUnlocked');bindText(add,unlocked?'Палитра добавлена':'Добавить палитру');add.disabled=unlocked;};
        syncReward();
        add.onclick=()=>{try{settings.set('basementPaletteUnlocked',true);syncReward();message('Палитра добавлена','Полуночная мастерская теперь доступна рядом с остальными палитрами.');}catch{message('Не удалось сохранить палитру','Попробуй ещё раз.');}};
        dialog.querySelector('[data-basement-close]').onclick=()=>dialog.close();
        dialog.addEventListener('close',()=>{dialog.remove();dialog=null;if(previous?.isConnected)previous.focus();},{once:true});
        dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
        dialog.showModal();
    };
    const tap=event=>{if(!event.shiftKey){taps=0;return;}const now=performance.now();if(now-last>5000)taps=0;last=now;if(++taps===7){taps=0;open();}};
    logo.addEventListener('click',tap);
    logo.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();tap(event);}});
}
