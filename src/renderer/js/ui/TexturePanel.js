import {numberFieldHTML,numberValue} from './Controls.mjs';
import {bindText, labelHTML} from '../core/Locale.mjs';

import Layer from '../graphics/Layer.js';
import {SURFACE_TEXTURES, normalizeTexture} from '../graphics/SurfaceTexture.mjs';
import {LayerFXCommand} from '../core/Commands.js';
import {isObjectLocked} from '../core/ObjectProperties.mjs';

/** Preview is isolated from the document; Apply records a single reversible FX edit. */
export default class TexturePanel {
    constructor(app) { this.app=app; }
    create() {
        if(this.dialog)return;
        const dialog=document.createElement('dialog');this.dialog=dialog;
        dialog.className='surface-texture-dialog asset-picker-dialog';dialog.setAttribute('aria-labelledby','texture-heading');
        dialog.innerHTML=`<header><h2 id="texture-heading"><!--i18n-->Фактура слоя</h2><button class="md-icon-btn" type="button" data-texture-close aria-label="Закрыть" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C"><i class="material-symbols-rounded">close</i></button></header>
            <div class="asset-picker-body"><p data-texture-layer></p><canvas data-texture-preview aria-label="Предпросмотр фактуры" data-i18n-aria-label="%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D1%81%D0%BC%D0%BE%D1%82%D1%80%20%D1%84%D0%B0%D0%BA%D1%82%D1%83%D1%80%D1%8B"></canvas>
            <div class="texture-fields"><label class="prop-field-block"><span><!--i18n-->Рисунок</span><select class="md-select" data-texture="type">${SURFACE_TEXTURES.map(item=>`<option value="${item.id}">${labelHTML(item.name)}</option>`).join('')}</select></label>
            ${numberFieldHTML({label:"Сила, %",attribute:"data-texture",attributeValue:"amount",min:0,max:100})}
            ${numberFieldHTML({label:"Масштаб, px",attribute:"data-texture",attributeValue:"scale",min:1,max:16})}
            ${numberFieldHTML({label:"Вариант рисунка",attribute:"data-texture",attributeValue:"seed",min:0,max:65535})}</div>
            <p class="prop-help-text"><!--i18n-->Исходные пиксели сохраняются. Фактуру можно изменить или отключить в любой момент; она сохраняется в проекте и экспортируется в PNG.</p><p data-texture-status role="status" aria-live="polite"></p></div>
            <footer><button class="md-btn outlined" type="button" data-texture-close><!--i18n-->Отмена</button><button class="md-btn primary" type="button" data-texture-apply><!--i18n-->Применить</button></footer>`;
        document.body.append(dialog);
        dialog.querySelectorAll('[data-texture-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
        dialog.addEventListener('close',()=>{
            cancelAnimationFrame(this.frame);this.frame=null;
            if(this.previewLayer){for(const canvas of [this.previewLayer.canvas,this.previewLayer.fxCanvas,this.previewLayer.thumbCanvas,...Object.values(this.previewLayer.fxScratch)])if(canvas)canvas.width=canvas.height=1;}
            this.previewLayer=null;this.layer=null;this.project=null;
            this.returnFocus?.isConnected&&this.returnFocus.focus({preventScroll:true});
        });
        dialog.addEventListener('input',event=>{if(!event.target.matches('[data-texture]'))return;cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.preview());});
        dialog.querySelector('[data-texture-apply]').addEventListener('click',()=>this.apply());
    }
    open(layer=this.app.layerManager.getActiveLayer()) {
        if(this.app.getActiveProject()?.type==='prefix'){
            const editor=this.app.prefixEditor;
            if(editor.commitPendingEdit()!==false&&editor.tabs.select('background'))editor.panel.querySelector('[data-prefix-texture]')?.scrollIntoView({block:'center'});
            return;
        }
        if(!layer||layer.isGroup){this.app.showToast('Выберите отдельный слой для фактуры.','info');return;}
        if(!layer.isBase&&isObjectLocked(layer,this.app.layerManager.getLayers())){this.app.showToast('Сначала разблокируйте слой.','lock');return;}
        if(this.app.tools.finishDocument({preserveSelection:true})===false)return;
        this.create();if(this.dialog.open)return;
        this.layer=layer;this.project=this.app.getActiveProject();this.before=structuredClone(layer.fx);this.revision=layer.contentRevision;
        this.returnFocus=document.activeElement;
        this.previewLayer=new Layer('texture-preview','',layer.width,layer.height);
        this.previewLayer.ctx.drawImage(layer.canvas,0,0);
        const texture=normalizeTexture(layer.fx?.texture);
        this.dialog.querySelectorAll('[data-texture]').forEach(input=>{input.value=texture[input.dataset.texture];});
        bindText(this.dialog.querySelector('[data-texture-layer]'), "Слой: {0}", {0: layer.name});
        this.dialog.showModal();this.preview();
    }
    settings() {
        const value={};
        const type=this.dialog.querySelector('[data-texture="type"]').value;
        for(const input of this.dialog.querySelectorAll('[data-texture]')){
            if(type!=='none'&&input.type==='number'&&numberValue(input)===null)throw Error(`Введите целое число от ${input.min} до ${input.max}.`);
            value[input.dataset.texture]=input.value;
        }
        return normalizeTexture(value);
    }
    preview() {
        if(!this.previewLayer)return;
        try{
            const type=this.dialog.querySelector('[data-texture="type"]').value;
            this.dialog.querySelectorAll('input[data-texture]').forEach(input=>{input.disabled=type==='none';});
            const texture=this.settings();this.previewLayer.setFX({...this.before,texture});
            const image=this.previewLayer.getRenderCanvas(),preview=this.dialog.querySelector('[data-texture-preview]');
            const scale=Math.min(4,720/image.width,360/image.height);
            preview.width=Math.max(1,Math.round(image.width*scale));preview.height=Math.max(1,Math.round(image.height*scale));
            const ctx=preview.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(image,0,0,preview.width,preview.height);
            bindText(this.dialog.querySelector('[data-texture-status]'), texture.type==='none'?'Фактура отключена.':'Предпросмотр готов.');
            this.dialog.querySelector('[data-texture-apply]').disabled=false;
        }catch(error){bindText(this.dialog.querySelector('[data-texture-status]'), error.message);this.dialog.querySelector('[data-texture-apply]').disabled=true;}
    }
    apply() {
        try{
            if(this.project!==this.app.getActiveProject()||!this.app.layerManager.getLayers().includes(this.layer))throw Error('Проект изменился. Откройте фактуру заново.');
            if(this.revision!==this.layer.contentRevision||JSON.stringify(this.before)!==JSON.stringify(this.layer.fx))throw Error('Слой изменился. Откройте фактуру заново.');
            if(!this.layer.isBase&&isObjectLocked(this.layer,this.app.layerManager.getLayers()))throw Error('Слой заблокирован.');
            const texture=this.settings();
            if(JSON.stringify(normalizeTexture(this.before?.texture))!==JSON.stringify(texture)){
                const command=new LayerFXCommand(this.layer,this.before,{...this.before,texture},this.app.bus);
                command.name='Фактура слоя';command.execute();this.app.history.push(command);
            }
            this.dialog.close();
        }catch(error){bindText(this.dialog.querySelector('[data-texture-status]'), error.message);}
    }
}
