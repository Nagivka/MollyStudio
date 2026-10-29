const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const photos=require('./data/forum-media.json');
const style=`
#attachment-batch{display:block;width:100%;min-width:0;max-width:100%;margin:8px 0;padding:10px;background:#101823;color:#f2f7ff;border:1px solid #63728a;border-radius:7px;font:12px/1.6 Consolas,monospace;resize:vertical}

:root{color-scheme:dark;--bg:#10151d;--panel:#1a2230;--line:#344054;--muted:#b2bed0;--accent:#a5d8ff;font-family:Inter,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#f2f5fb}button,input,textarea{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer;border:1px solid #52647d;background:#25354b;color:#f3f7ff;border-radius:10px;padding:11px 16px;font-weight:650}button:hover{background:#354d6c}button:disabled{opacity:.46;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.primary{background:#a5d8ff;color:#102c42;border-color:#a5d8ff}.primary:hover{background:#c5e6ff}.small{font-size:12px;padding:6px 9px;font-weight:500}header{padding:34px max(24px,calc((100vw - 1360px)/2));border-bottom:1px solid var(--line);background:linear-gradient(120deg,#1b2e44,#10151d 75%)}.eyebrow{font-size:12px;color:#a5d8ff;text-transform:uppercase;letter-spacing:.15em;font-weight:700}header h1{font-size:clamp(24px,4vw,34px);letter-spacing:-.03em;margin:8px 0}header p{color:var(--muted);line-height:1.6;max-width:850px;margin:0}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.status{min-height:24px;font-size:13px;color:var(--accent);margin:12px 0 0}.layout{max-width:1408px;margin:28px auto;display:grid;grid-template-columns:minmax(0,1fr) 326px;gap:24px;padding:0 24px;align-items:start}aside{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;position:sticky;top:18px;max-height:calc(100dvh - 36px);overflow:auto}aside h2{font-size:17px;margin:0 0 12px}aside p,aside li{font-size:13px;color:var(--muted);line-height:1.65}aside ol{padding-left:20px}aside code{background:#2d3c51;padding:1px 4px;border-radius:3px}#progress{display:block;color:#a5d8ff;font-size:13px;margin:16px 0}.attachment{border-top:1px solid var(--line);padding:14px 0}.attachment img{width:72px;height:48px;object-fit:cover;border:1px solid #53637c;border-radius:5px}.attachment-top{display:flex;align-items:center;gap:10px}.attachment-top strong{font-size:13px;display:block}.attachment-top span{color:var(--muted);font-size:11px}.attachment label{font-size:12px;display:block;margin-top:10px;color:var(--muted)}.attachment input{width:100%;margin-top:5px;border:1px solid #63728a;border-radius:7px;background:#101823;color:#f2f7ff;padding:10px 8px;min-width:0;font-size:12px}.attachment input[aria-invalid=true]{border-color:#ff9f9f}.attachment .small{margin-top:8px}.hint{font-size:12px!important}.preview-label{display:flex;justify-content:space-between;gap:16px;margin:0 0 12px;color:var(--muted);font-size:12px}article{background:#fff;color:#293241;padding:clamp(20px,4vw,48px);border-radius:14px;line-height:1.75;overflow:hidden;box-shadow:0 8px 48px #0002}article h1{text-align:center;font-size:clamp(26px,3.2vw,38px);line-height:1.22;letter-spacing:-.035em;margin:0 0 18px;color:#142236}article h2{font-size:24px;line-height:1.35;letter-spacing:-.02em;color:#19334f;margin:38px 0 12px}article p{margin:12px 0}article .lead{font-size:18px;color:#3d5068}article ul{padding-left:23px}article li{margin:5px 0}article code{background:#edf2f7;border-radius:4px;padding:2px 5px;font-size:.92em}article figure{margin:24px 0 32px}article figure img{width:100%;height:auto;display:block;border:1px solid #cbd3de;border-radius:8px;cursor:zoom-in;background:#15181f}article figcaption{font-size:12px;color:#65748a;margin-top:8px;line-height:1.5}article .note{border-left:3px solid #4a82ba;padding:6px 0 6px 16px;color:#526179}article .meta{text-align:center;font-size:14px;color:#617086}.code-panel{margin-top:20px;border:1px solid var(--line);border-radius:12px;padding:16px}.code-panel[hidden]{display:none}.code-panel textarea{width:100%;height:360px;resize:vertical;background:#10151d;border:1px solid #5e718e;border-radius:8px;padding:12px;color:#ecf4ff;font:13px/1.65 Consolas,monospace;white-space:pre-wrap}.code-panel p{color:var(--muted);font-size:13px}dialog{border:1px solid #52647d;border-radius:12px;padding:12px;background:#131a24;color:#fff;max-width:98vw;max-height:98dvh}dialog::backdrop{background:#000d}dialog .viewer-head{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:10px;font-size:13px}dialog img{display:block;max-width:calc(98vw - 30px);max-height:calc(98dvh - 90px);width:auto;height:auto}footer{max-width:1408px;padding:0 24px 30px;margin:auto;color:var(--muted);font-size:12px}@media(max-width:1000px){.layout{grid-template-columns:1fr}aside{position:static;max-height:none;order:-1}.attachments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}header{padding:26px 24px}}@media(max-width:560px){.layout{padding:0 12px;margin-top:16px;gap:16px}.attachments{grid-template-columns:1fr}header{padding:24px 16px}.actions{flex-direction:column}.actions button{width:100%}article h2{font-size:21px}article .lead{font-size:16px}}@media print{header,aside,.preview-label,.code-panel,footer,dialog{display:none}.layout{display:block;max-width:none;margin:0;padding:0}body{background:white}article{box-shadow:none;padding:0}article figure{break-inside:avoid}}
`;

function browserApp(media,version){
    media.forEach(photo=>{photo.data=document.querySelector(`figure[data-photo="${photo.id}"] img`).src;document.querySelector(`[data-photo-thumb="${photo.id}"]`).src=photo.data;});
    const byId=id=>document.getElementById(id),key='mollystudio-forum-attachments-v4';
    const status=message=>{byId('copy-status').textContent=message;};
    const fields=[...document.querySelectorAll('[data-attachment]')];
    function reference(value){
        value=value.trim();
        const attachment=value.match(/^\[ATTACH[^\]]*\](\d+)\[\/ATTACH\]$/i);if(attachment)value=attachment[1];
        if(/^\d{1,20}$/.test(value))return `[ATTACH type="full"]${value}[/ATTACH]`;
        const image=value.match(/^\[IMG\]([\s\S]+)\[\/IMG\]$/i);if(image)value=image[1].trim();
        try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password)return null;return `[IMG]${url.href.replaceAll('[','%5B').replaceAll(']','%5D')}[/IMG]`;}catch{return null;}
    }
    function refresh(){
        const values={};let ready=0;
        fields.forEach(input=>{const valid=reference(input.value);input.setAttribute('aria-invalid',String(!!input.value.trim()&&!valid));if(valid)ready++;values[input.dataset.attachment]=input.value;});
        byId('progress').textContent=`Фотографии: ${ready} из ${media.length} готовы к вставке`;
        byId('copy-bbcode').disabled=ready!==media.length;
        try{localStorage.setItem(key,JSON.stringify(values));}catch{}
        if(!byId('code-panel').hidden)showCode(false);
    }
    try{const saved=JSON.parse(localStorage.getItem(key)||'{}');fields.forEach(input=>{if(typeof saved?.[input.dataset.attachment]==='string')input.value=saved[input.dataset.attachment];});}catch{}
    fields.forEach(input=>input.addEventListener('input',refresh));
    function importAttachments(){
        const source=byId('attachment-batch').value,candidates=[];
        const add=(value,label)=>{const normalized=reference(value);if(normalized&&!candidates.some(item=>item.normalized===normalized))candidates.push({value,label,normalized});};
        const tags=[...source.matchAll(/\[ATTACH\b([^\]]*)\](\d+)\[\/ATTACH\]|\[IMG[^\]]*\]([^\[]+)\[\/IMG\]/gi)];
        if(tags.length)for(const tag of tags)add(tag[2]||tag[3],tag[0]);
        else for(const line of source.split(/\r?\n/)){const value=line.match(/https?:\/\/[^\s<>"\]]+/i)?.[0]||line.trim();add(value,line);}
        const matched=new Set(),assigned=new Set();let count=0;
        for(const item of candidates){
            let name=item.label.toLowerCase();try{name=decodeURIComponent(name);}catch{}
            const photo=media.find(photo=>name.includes(photo.file.slice(0,-4).toLowerCase()));
            if(photo&&!assigned.has(photo.id)){fields.find(input=>input.dataset.attachment===photo.id).value=item.value;matched.add(item);assigned.add(photo.id);count++;}
        }
        const remaining=candidates.filter(item=>!matched.has(item));
        const unassigned=fields.filter(input=>!assigned.has(input.dataset.attachment));
        const missing=unassigned.filter(input=>!reference(input.value));
        const destinations=remaining.length===unassigned.length?unassigned:missing;
        if(remaining.length&&remaining.length===destinations.length)remaining.forEach((item,index)=>{destinations[index].value=item.value;count++;});
        refresh();
        byId('batch-status').textContent=count?`Подставлено изображений: ${count}. Проверьте подписи перед копированием.`:candidates.length?'Для назначения по порядку вставьте весь блок вложений. По именам файлов можно назначать отдельные изображения.':'Вставьте теги вложений, ссылки или список номеров.';
    }
    byId('attachment-batch').addEventListener('input',importAttachments);
    byId('import-attachments').addEventListener('click',importAttachments);
    function bbcode(withPhotos){
        const walk=node=>{
            if(node.nodeType===Node.TEXT_NODE)return node.textContent;
            if(node.nodeType!==Node.ELEMENT_NODE)return '';
            if(node.tagName==='FIGURE'){
                if(!withPhotos)return '';
                const ref=reference(fields.find(input=>input.dataset.attachment===node.dataset.photo).value);
                return ref?`\n\n[CENTER]${ref}\n[SIZE=2][I]${node.querySelector('figcaption').textContent}[/I][/SIZE][/CENTER]\n\n`:'';
            }
            const inside=[...node.childNodes].map(walk).join('');
            switch(node.tagName){
                case 'H1':return `\n[CENTER][COLOR=#5CA7DF][SIZE=7][B]${inside}[/B][/SIZE][/COLOR][/CENTER]\n\n`;
                case 'H2':return `\n[COLOR=#5CA7DF][SIZE=5][B]${inside}[/B][/SIZE][/COLOR]\n\n`;
                case 'P':return node.classList.contains('meta')?`[CENTER][SIZE=3]${inside}[/SIZE][/CENTER]\n\n`:node.classList.contains('note')?`[QUOTE]${inside}[/QUOTE]\n\n`:node.classList.contains('lead')?`[SIZE=4]${inside}[/SIZE]\n\n`:`${inside}\n\n`;
                case 'STRONG':return `[B]${inside}[/B]`;
                case 'EM':return `[I]${inside}[/I]`;
                case 'CODE':return inside;
                case 'UL':return `\n[LIST]\n${inside}[/LIST]\n\n`;
                case 'OL':return `\n[LIST=1]\n${inside}[/LIST]\n\n`;
                case 'LI':return `[*]${inside.trim()}\n`;
                case 'BR':return '\n';
                default:return inside;
            }
        };
        return walk(byId('forum-post')).replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    }
    function showCode(focus=true,complete=!byId('copy-bbcode').disabled){
        byId('code-panel').hidden=false;
        byId('bbcode').value=bbcode(complete);byId('code-note').textContent=complete?`Код включает все ${media.length} изображений и BBCode-оформление. Вставьте его в режиме BBCode на форуме.`:'Пока показан BBCode текста без изображений. Вставьте блок вложений, чтобы изображения появились в коде.';
        if(focus){byId('bbcode').focus();byId('bbcode').select();}
    }
    async function copyCode(){
        if(byId('copy-bbcode').disabled)return;
        const value=bbcode(true);
        try{await navigator.clipboard.writeText(value);status(`BBCode с ${media.length} изображениями скопирован. Фотографии уже расставлены по разделам — вставьте весь код на форум.`);}
        catch{showCode();status('Код выделен ниже. Нажмите Ctrl+C, затем вставьте его на форум.');}
    }
    async function copyText(){
        try{await navigator.clipboard.writeText(bbcode(false));status('BBCode текста скопирован: заголовки, цвета, списки и выделения, без изображений.');}
        catch{showCode(true,false);status('BBCode выделен ниже. Нажмите Ctrl+C, затем вставьте его на форум.');}
    }
    function bytes(photo){return Uint8Array.from(atob(photo.data.split(',')[1]),char=>char.charCodeAt(0));}
    function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    function zip(){
        const table=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);return value>>>0;});
        const locals=[],central=[];let offset=0,size=0;
        for(const photo of media){
            const name=new TextEncoder().encode(photo.file),data=bytes(photo);let crc=0xffffffff;
            for(const byte of data)crc=(crc>>>8)^table[(crc^byte)&255];crc=(crc^0xffffffff)>>>0;
            const local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
            l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,0x21,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);locals.push(local,data);
            const record=new Uint8Array(46+name.length),c=new DataView(record.buffer);
            c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);record.set(name,46);central.push(record);size+=record.length;offset+=local.length+data.length;
        }
        const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,media.length,true);view.setUint16(10,media.length,true);view.setUint32(12,size,true);view.setUint32(16,offset,true);
        download(new Blob([...locals,...central,end],{type:'application/zip'}),`MollyStudio-${version}-forum-images.zip`);status(`Архив с ${media.length} изображениями подготовлен. Загрузите PNG на форум, затем вставьте сюда весь блок тегов вложений.`);
    }
    byId('download-all').addEventListener('click',zip);byId('copy-bbcode').addEventListener('click',copyCode);byId('copy-text').addEventListener('click',copyText);byId('show-code').addEventListener('click',()=>showCode());
    document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',()=>{const photo=media.find(item=>item.id===button.dataset.download);download(new Blob([bytes(photo)],{type:'image/png'}),photo.file);}));
    const viewer=byId('viewer');document.querySelectorAll('article figure img').forEach(image=>{
        image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label',image.alt+' — открыть оригинал');
        const open=()=>{byId('viewer-image').src=image.src;byId('viewer-image').alt=image.alt;byId('viewer-title').textContent=image.alt;viewer.showModal();};
        image.addEventListener('click',open);image.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();open();}});
    });byId('close-viewer').addEventListener('click',()=>viewer.close());viewer.addEventListener('click',event=>{if(event.target===viewer)viewer.close();});
    refresh();
}

(async()=>{
    for(const photo of photos)photo.data='data:image/png;base64,'+(await fs.readFile(path.join(root,'forum-media',photo.file))).toString('base64');
    const figure=id=>{const photo=photos.find(item=>item.id===id);return `<figure data-photo="${id}"><img src="${photo.data}" alt="${escape(photo.title)}" loading="lazy"><figcaption>${escape(photo.caption)}</figcaption></figure>`;};
    const version=require('../electron-builder.cjs').buildVersion;
    const {GUI_DESIGNS}=await import('../src/renderer/js/core/GuiDesignPresets.mjs');
    const portable=path.join(root,'dist',`MollyStudio-${version}-x64-portable.exe`);
    const size=await fs.stat(portable).catch(()=>null);
    const values={version,portableSize:size?`${(size.size/1000000).toFixed(2).replace('.',',')} МБ`:'указан во вложениях',designCount:GUI_DESIGNS.length,categoryCount:new Set(GUI_DESIGNS.map(p=>p.category)).size};
    const article=(await fs.readFile(path.join(__dirname,'data/forum-post.html'),'utf8'))
        .replace(/\{\{figure:([a-z-]+)\}\}/g,(_,id)=>figure(id))
        .replace(/\{\{(\w+)\}\}/g,(_,key)=>{if(!Object.hasOwn(values,key))throw Error('Unknown article token: '+key);return escape(values[key]);});
    const controls=photos.map((photo,index)=>`<div class="attachment"><div class="attachment-top"><img data-photo-thumb="${photo.id}" alt="" loading="lazy"><div><strong>${index+1}. ${escape(photo.title)}</strong><span>${escape(photo.file)}</span></div></div><label for="attachment-${photo.id}">Ссылка или номер вложения форума</label><input id="attachment-${photo.id}" data-attachment="${photo.id}" placeholder="https://… или 82237" autocomplete="off" spellcheck="false"><button type="button" class="small" data-download="${photo.id}">Скачать PNG</button></div>`).join('');
    const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MollyStudio — описание для форума</title><style>${style}</style></head><body>
<header><div class="eyebrow">MollyStudio / публикация на форуме</div><h1>Описание, скриншоты и примеры</h1><p>Ниже — готовый текст публикации. Кнопки и инструкция на этой странице в копию не попадут. Изображения встроены в HTML: страницу можно открыть без интернета и перенести одним файлом.</p><div class="actions"><button type="button" class="primary" id="download-all">1. Скачать изображения ZIP</button><button type="button" id="copy-text">BBCode текста без фото</button><button type="button" class="primary" id="copy-bbcode" disabled>Копировать BBCode с фото</button><button type="button" id="show-code">Показать BBCode</button></div><p class="status" id="copy-status" role="status" aria-live="polite"></p></header>
<main class="layout"><div><div class="preview-label"><span>Предпросмотр публикации</span><span>Версия ${version} · стандартная тема</span></div><article id="forum-post">${article}</article><section class="code-panel" id="code-panel" hidden aria-labelledby="code-title"><h2 id="code-title">BBCode для вставки</h2><p id="code-note"></p><textarea id="bbcode" readonly aria-label="Код публикации BBCode" spellcheck="false"></textarea></section></div>
<aside aria-labelledby="prepare-title"><h2 id="prepare-title">Как вставить с фотографиями</h2><ol><li>Скачайте ZIP и загрузите ${photos.length} PNG во вложения форума.</li><li>В редакторе форума вставьте все вложения и скопируйте получившийся блок BBCode.</li><li>Вставьте весь блок в поле ниже — изображения распределятся автоматически.</li><li>Нажмите «Копировать BBCode с фото» и вставьте код в режиме BBCode редактора форума.</li></ol><p class="hint">Загрузка на форум нужна один раз. Теги с именами файлов распознаются в любом порядке; без имён — в порядке файлов ZIP. Отдельные ссылки можно уточнить ниже.</p><label for="attachment-batch" class="hint">Все вложения одним блоком</label><textarea id="attachment-batch" rows="5" placeholder="[ATTACH type=&quot;full&quot; alt=&quot;03-editor.png&quot;]12345[/ATTACH]" spellcheck="false"></textarea><button type="button" class="small" id="import-attachments">Распознать вложения</button><p id="batch-status" class="hint" role="status"></p><output id="progress" aria-live="polite"></output><div class="attachments">${controls}</div><p class="hint">Введённые ссылки сохраняются только в этом браузере. Страница ничего не отправляет на сервер.</p></aside></main>
<footer>Тринадцать снимков из текущего приложения: окна сняты в полноэкранном режиме, диалоги — крупным планом. Семь сравнительных иллюстраций отрисованы движками MollyStudio. Снимки интерфейса — в стандартной тёмной теме, сравнительные иллюстрации — в стиле Minecraft.</footer>
<dialog id="viewer" aria-labelledby="viewer-title"><div class="viewer-head"><strong id="viewer-title"></strong><button type="button" id="close-viewer">Закрыть</button></div><img id="viewer-image" alt=""></dialog>
<script>(${browserApp.toString()})(${JSON.stringify(photos.map(({data,...photo})=>photo)).replaceAll('<','\\u003c')},${JSON.stringify(version)});</script></body></html>`;
    await fs.writeFile(path.join(root,'forum-description.html'),html);
    console.log(`Created forum-description.html (${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB), ${photos.length} embedded images.`);
})();
