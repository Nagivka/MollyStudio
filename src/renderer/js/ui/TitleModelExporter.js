import {createTitleBlockbenchModel} from '../graphics/TitleModelExport.mjs';
import {safeFileStem} from '../core/FileNames.mjs';
import {fileErrorMessage} from '../core/FileErrors.mjs';

/** Build and save a captured scene; the inspector owns no native file IO. */
export async function exportTitleModel(editor){
        if(editor.exporting||editor.commitPendingEdit()===false)return false;
        const project=editor.project();if(!project)return false;
        editor.exporting=true;
        const button=editor.panel.querySelector('[data-title-model-export]'),wasDisabled=button?.disabled;
        if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
        let writing=false;
        try{
            editor.renderer.prepare(project.titleData);
            const textures={};for(const batch of editor.renderer.mesh.modelBatches){
                const image=editor.renderer.images.get(batch.texture),canvas=Object.assign(document.createElement('canvas'),{width:image.width,height:image.height});
                canvas.getContext('2d').drawImage(image,0,0);textures[batch.texture]={width:image.width,height:image.height,source:canvas.toDataURL('image/png')};canvas.width=canvas.height=1;
            }
            const model=createTitleBlockbenchModel(editor.renderer.mesh,textures,project.name||'Title');
            const content=JSON.stringify(model),name=safeFileStem(project.name,'Title')+'.bbmodel';
            const api=window.desktopAPI;
            if(api){writing=true;const result=await api.showSaveDialog({title:'Экспорт 3D-модели',defaultPath:name,filters:[{name:'Blockbench',extensions:['bbmodel']}]});if(result.canceled||!result.filePath)return false;await api.writeFile(result.filePath,content,'utf8');}
            else {const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
            editor.app.showToast('3D-модель экспортирована','success');return model;
        }catch(error){editor.app.showToast(writing?fileErrorMessage(error,'model-export'):error.message,'error');return false;}
        finally{editor.exporting=false;if(button){button.disabled=wasDisabled;button.removeAttribute('aria-busy');}editor.viewport.redraw();}
    }
