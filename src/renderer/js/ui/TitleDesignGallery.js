import TitleRenderer from '../graphics/TitleRenderer.js';
import {normalizeTitleDocument,titleRowSettings} from '../core/TitleDocument.mjs';
import {titleMaterialCatalog} from '../core/TitleAppearance.mjs';
import {TITLE_DESIGNS,applyTitleDesign} from '../core/TitleDesignPresets.mjs';
import {bindText,bindAttribute,translate} from '../core/Locale.mjs';

export function openTitleDesignGallery(editor){
    if(editor.commitPendingEdit()===false||document.querySelector('.title-design-gallery[open]'))return;
    const project=editor.project();if(!project)return;
    const row=editor.currentRow,revision=editor.app.projectManager.getRevision(project.id),settings=titleRowSettings(project.titleData,row);
    const line=project.titleData.text.split('\n')[Math.max(0,row)]||'MINECRAFT',focus=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='title-material-library title-design-gallery';
    const heading=document.createElement('h2');heading.id='title-design-heading';bindText(heading,'Готовые оформления');dialog.setAttribute('aria-labelledby',heading.id);
    const search=document.createElement('input');search.type='search';search.className='md-input';bindAttribute(search,'aria-label','Поиск оформления');bindAttribute(search,'placeholder','Поиск оформления');
    const status=document.createElement('p');status.setAttribute('role','status');bindText(status,'Загрузка предпросмотров…');
    const grid=document.createElement('div');grid.className='title-material-grid';
    const close=document.createElement('button');close.type='button';close.className='md-btn outlined';bindText(close,'Закрыть');close.onclick=()=>dialog.close();
    const items=TITLE_DESIGNS.filter(p=>titleMaterialCatalog(settings.font).textures.some(t=>t.id===p.texture||t.sourceId===p.texture));
    const renderer=new TitleRenderer();let active=true;
    const cards=items.map(preset=>{
        const button=document.createElement('button');button.type='button';button.className='title-material-card';button.disabled=true;button.dataset.titleDesign=String(TITLE_DESIGNS.indexOf(preset));
        const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.setAttribute('aria-hidden','true');
        const label=document.createElement('span');bindText(label,preset.name);button.append(canvas,label);grid.append(button);
        button.onclick=()=>{
            if(editor.project()!==project||editor.currentRow!==row||editor.app.projectManager.getRevision(project.id)!==revision){dialog.close();return;}
            editor.changeSettings(value=>Object.assign(value,applyTitleDesign(value,preset)));dialog.close();
        };
        return {preset,button,canvas};
    });
    search.oninput=()=>{const q=search.value.trim().toLocaleLowerCase();for(const {preset,button} of cards)button.hidden=!(preset.name+' '+translate(preset.name)).toLocaleLowerCase().includes(q);};
    dialog.append(heading,search,status,grid,close);document.body.append(dialog);
    dialog.addEventListener('close',()=>{active=false;for(const {canvas} of cards)canvas.width=canvas.height=1;dialog.remove();if(focus?.isConnected)focus.focus({preventScroll:true});},{once:true});
    dialog.showModal();search.focus();
    (async()=>{
        let ready=0;
        try{
            for(const {preset,button,canvas} of cards){
                if(!active)break;
                const data=normalizeTitleDocument({...applyTitleDesign(settings,preset),text:line.slice(0,24),rowLanguages:[settings.language],rows:[],resolution:320,padding:8});
                try{
                    await renderer.loadFor(data);if(!active)break;
                    const result=renderer.renderSnapshot(data,{maxSize:280});
                    canvas.width=result.canvas.width;canvas.height=result.canvas.height;canvas.getContext('2d').drawImage(result.canvas,0,0);result.canvas.width=result.canvas.height=1;
                    button.disabled=false;ready++;
                }catch(error){button.title=error.message;}
                await new Promise(resolve=>setTimeout(resolve,0));
            }
            if(active)bindText(status,'{0} оформлений',{0:ready});
        }finally{renderer.dispose();}
    })();
}
