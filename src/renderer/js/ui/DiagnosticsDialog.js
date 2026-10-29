import {collectDiagnostics} from '../core/Diagnostics.mjs';
import {bindText,labelHTML,attributeHTML} from '../core/Locale.mjs';
import {actionButtonHTML} from './Controls.mjs';
export async function openDiagnostics(){
    const existing=document.querySelector('.diagnostics-dialog');if(existing){existing.focus();return;}
    const dialog=document.createElement('dialog');dialog.className='diagnostics-dialog';dialog.setAttribute('aria-labelledby','diagnostics-heading');
    dialog.innerHTML='<header><h2 id="diagnostics-heading">'+labelHTML('Отчёт диагностики')+'</h2></header><p>'+labelHTML('Отчёт содержит технические сведения, коды ошибок и время операций. Проекты, текст, пути файлов и изображения не включаются. Ничего не отправляется автоматически.')+'</p><textarea class="md-input" readonly rows="14"'+attributeHTML('aria-label','Содержимое отчёта')+'></textarea><output role="status"></output><footer>'+actionButtonHTML({action:'close',label:'Закрыть',icon:'close',attribute:'data-diagnostics'})+actionButtonHTML({action:'copy',label:'Копировать',icon:'content_copy',attribute:'data-diagnostics'})+actionButtonHTML({action:'save',label:'Сохранить отчёт',icon:'download',attribute:'data-diagnostics'})+'</footer>';
    document.body.append(dialog);const focus=document.activeElement;dialog.showModal();
    dialog.addEventListener('close',()=>{dialog.remove();focus?.isConnected&&focus.focus();},{once:true});
    dialog.querySelector('[data-diagnostics=close]').onclick=()=>dialog.close();
    const copy=dialog.querySelector('[data-diagnostics=copy]'),save=dialog.querySelector('[data-diagnostics=save]');
    copy.disabled=save.disabled=true;
    try{
        const report=JSON.stringify(await collectDiagnostics(),null,2);if(!dialog.isConnected)return;dialog.querySelector('textarea').value=report;
        copy.disabled=save.disabled=false;
        copy.onclick=async()=>{copy.disabled=true;try{await navigator.clipboard.writeText(report);bindText(dialog.querySelector('output'),'Информация скопирована');}catch{bindText(dialog.querySelector('output'),'Не удалось скопировать информацию');}finally{copy.disabled=false;}};
        save.onclick=async()=>{save.disabled=true;try{const api=window.desktopAPI;if(api){const result=await api.showSaveDialog({defaultPath:'MollyStudio-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return;await api.writeFile(result.filePath,report);}else{const url=URL.createObjectURL(new Blob([report],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='MollyStudio-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}bindText(dialog.querySelector('output'),'Отчёт сохранён');}catch{bindText(dialog.querySelector('output'),'Не удалось сохранить отчёт');}finally{save.disabled=false;}};
    }catch{bindText(dialog.querySelector('output'),'Не удалось подготовить отчёт');}
}
