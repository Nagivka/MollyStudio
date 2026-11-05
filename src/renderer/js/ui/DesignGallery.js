import {bindText, bindAttribute, translate, uiLabel} from '../core/Locale.mjs';
import {PREFIX_DESIGNS,GUI_DESIGNS,applyPrefixDesign,recolorGuiPixels} from '../core/DesignPresets.mjs';
import {DrawCommand} from '../core/Commands.js';
import {editLayerPixels} from '../graphics/LayerEdit.mjs';
import {paintPixelPreview,alignPixelPreview,watchPixelRatio,fittedPixelScale} from '../graphics/PixelPreview.mjs';
import {getExportRegion} from '../graphics/ExportImage.js';

export default class DesignGallery{
    constructor(app){
        this.app=app;this.generation=0;
        const syncDisplay=()=>{
            if(!this.dialog?.open)return;
            if(this.previewRatio===devicePixelRatio){this.alignPreviews();return;}
            this.previewRatio=devicePixelRatio;
            for(const canvas of this.previews.values())canvas.width=canvas.height=1;
            this.previews.clear();this.render();
        };
        globalThis.window?.addEventListener?.('resize',syncDisplay);
        this.stopWatchingRatio=watchPixelRatio(syncDisplay);
    }
    alignPreviews(){
        if(!this.dialog?.open||this.alignmentFrame)return;
        this.alignmentFrame=requestAnimationFrame(()=>{
            this.alignmentFrame=null;
            if(this.dialog?.open)this.dialog.querySelectorAll('canvas').forEach(alignPixelPreview);
        });
    }
    create(){
        if(this.dialog)return;
        const dialog=document.createElement('dialog');dialog.className='design-gallery-dialog';dialog.setAttribute('aria-labelledby','design-gallery-heading');
        dialog.innerHTML=`<header><h2 id="design-gallery-heading"><!--i18n-->Готовые оформления</h2><button type="button" class="md-icon-btn" data-design-close aria-label="Закрыть" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C"><i class="material-symbols-rounded">close</i></button></header><div class="design-gallery-body"><p data-design-help></p><div class="asset-picker-filters"><label class="prop-field-block"><span><!--i18n-->Поиск оформления</span><input type="search" class="md-input" data-design-search></label><label class="prop-field-block"><span><!--i18n-->Категория</span><select class="md-select" data-design-category></select></label></div><div class="design-gallery-grid" data-design-grid></div><p data-design-status role="status" aria-live="polite"></p></div><footer><button type="button" class="md-btn outlined" data-design-close><!--i18n-->Отмена</button><button type="button" class="md-btn primary" data-design-apply><!--i18n-->Применить оформление</button></footer>`;
        document.body.append(dialog);this.dialog=dialog;
        this.previewLayoutObserver=new ResizeObserver(()=>this.alignPreviews());
        this.previewLayoutObserver.observe(dialog.querySelector('.design-gallery-body'));
        dialog.querySelectorAll('[data-design-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
        dialog.addEventListener('close',()=>{this.generation++;this.ready=false;this.previewObserver?.disconnect();if(this.source)this.source.width=this.source.height=1;this.source=null;for(const canvas of this.previews?.values()||[])canvas.width=canvas.height=1;this.previews?.clear();dialog.querySelector('[data-design-grid]').replaceChildren();this.returnFocus?.isConnected&&this.returnFocus.focus({preventScroll:true});});
        for(const selector of ['[data-design-search]','[data-design-category]'])dialog.querySelector(selector).addEventListener('input',()=>this.render());
        dialog.querySelector('[data-design-apply]').addEventListener('click',()=>this.apply());
    }
    async open(){
        const project=this.app.getActiveProject();if(!project||!['gui','prefix'].includes(project.type)){this.app.showToast('Оформления доступны в GUI и префиксах.','info');return;}
        if(this.app.tools.finishDocument({preserveSelection:true})===false||this.app.prefixEditor.commitPendingEdit()===false)return;
        this.create();if(this.dialog.open)return;this.ready=false;this.previews=new Map();this.project=project;this.prefix=project.type==='prefix';this.selected=null;this.blockIndex=this.app.prefixEditor.selected;this.returnFocus=document.activeElement;
        bindText(this.dialog.querySelector('[data-design-help]'), this.prefix?'Оформление применяется к выбранному блоку. Текст и шрифт сохраняются. Можно отменить через Ctrl+Z.':'Перерисовывается исходная заготовка в базовом слое GUI. Содержимое других слоёв сохраняется. Изменение можно отменить через Ctrl+Z.');
        const category=this.dialog.querySelector('[data-design-category]');category.replaceChildren();
        this.previewRatio=devicePixelRatio;
        for(const name of ['Все',...new Set((this.prefix?PREFIX_DESIGNS:GUI_DESIGNS).map(item=>item.category))]){const option=document.createElement('option');option.value=name;bindText(option,name);category.append(option);}
        this.dialog.querySelector('[data-design-apply]').disabled=true;bindText(this.dialog.querySelector('[data-design-status]'), 'Загрузка предпросмотров…');
        this.dialog.querySelector('[data-design-grid]').replaceChildren();
        if(!this.dialog.open)this.dialog.showModal();const generation=++this.generation,prefix=this.prefix;let source=null;
        try{
            await project.templateLoadPromise;
            if(generation!==this.generation)return;
            this.base=project.layers.find(layer=>layer.isBase);this.baseRevision=this.base?.contentRevision;
            if(prefix){await this.app.prefixEditor.renderer.load();}
            else{
                source=document.createElement('canvas');source.width=project.config.width;source.height=project.config.height;const ctx=source.getContext('2d');
                if(project.templatePath){const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Не удалось загрузить исходный шаблон GUI.'));img.src=project.templatePath.startsWith('assets/')?project.templatePath:project.templatePath.startsWith('gui_container/')?`assets/${project.templatePath}`:`assets/images/${project.templatePath}`;});ctx.drawImage(image,0,0);}
                else{const base=project.layers.find(layer=>layer.isBase);if(!base)throw Error('Сначала выберите шаблон GUI через «Файл → Выбрать шаблон GUI».');ctx.drawImage(base.canvas,0,0);}
            }
            if(generation!==this.generation){if(source)source.width=source.height=1;return;}this.source=source;this.ready=true;this.render();
        }catch(error){
            if(source)source.width=source.height=1;
            if(generation===this.generation){
                this.source=null;this.ready=false;this.selected=null;
                for(const canvas of this.previews.values())canvas.width=canvas.height=1;
                this.previews.clear();this.dialog.querySelector('[data-design-grid]').replaceChildren();
                this.dialog.querySelector('[data-design-apply]').disabled=true;
                bindText(this.dialog.querySelector('[data-design-status]'), error.message);
            }
        }
    }
    image(preset){
        if(this.previews.has(preset.id))return this.previews.get(preset.id);
        const source=this.fullImage(preset),canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');
        try{
            const region=getExportRegion(source,true);
            const scale=this.prefix?Math.max(1,fittedPixelScale(region.width,region.height,184,72,{deviceRatio:devicePixelRatio,maxScale:3})):1;
            paintPixelPreview(canvas,source,{region,scale});
        }
        catch(error){canvas.width=canvas.height=1;throw error;}
        finally{source.width=source.height=1;}
        this.previews.set(preset.id,canvas);return canvas;
    }
    fullImage(preset){
        let canvas;
        if(this.prefix){const data=structuredClone(this.project.prefixData);data.blocks[this.blockIndex]=applyPrefixDesign(data.blocks[this.blockIndex],preset.id);canvas=this.app.prefixEditor.renderer.render(data).canvas;}
        else{
            canvas=document.createElement('canvas');canvas.width=this.source.width;canvas.height=this.source.height;
            try{const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=false;ctx.drawImage(this.source,0,0);ctx.putImageData(recolorGuiPixels(ctx.getImageData(0,0,canvas.width,canvas.height),preset.id),0,0);}
            catch(error){canvas.width=canvas.height=1;throw error;}
        }
        return canvas;
    }
    render(){
        if(!this.ready||!this.dialog.open)return;
        const grid=this.dialog.querySelector('[data-design-grid]');grid.replaceChildren();const query=this.dialog.querySelector('[data-design-search]').value.toLocaleLowerCase(),category=this.dialog.querySelector('[data-design-category]').value;
        grid.classList.toggle('wide-previews',!this.prefix&&getExportRegion(this.source,true).width>200);
        grid.classList.toggle('prefix-previews',this.prefix);
        this.previewObserver?.disconnect();
        const generation=this.generation;
        const observer=new IntersectionObserver(entries=>{
            if(!this.dialog.open||generation!==this.generation||this.previewObserver!==observer)return;
            for(const entry of entries)if(entry.isIntersecting){
                const stage=entry.target,preset=(this.prefix?PREFIX_DESIGNS:GUI_DESIGNS).find(item=>item.id===stage.dataset.designId);
                try{const canvas=this.image(preset);stage.firstElementChild.append(canvas);alignPixelPreview(canvas);}
                catch(error){bindText(stage,error.message);}
                observer.unobserve(stage);
            }
        },{root:this.dialog.querySelector('.design-gallery-body'),rootMargin:'160px'});
        this.previewObserver=observer;
        const presets=(this.prefix?PREFIX_DESIGNS:GUI_DESIGNS).filter(item=>(item.name+' '+translate(item.name)).toLocaleLowerCase().includes(query)&&(category==='Все'||item.category===category));
        if(!presets.some(preset=>preset.id===this.selected))this.selected=null;
        this.dialog.querySelector('[data-design-apply]').disabled=!this.selected;
        for(const preset of presets){const button=document.createElement('button');button.type='button';button.className='design-gallery-card';button.setAttribute('aria-pressed',String(this.selected===preset.id));bindAttribute(button, "aria-label", "Оформление: {0}", {0: uiLabel(preset.name)});
            const stage=document.createElement('div');stage.className='design-preview-stage';stage.dataset.designId=preset.id;
            const content=document.createElement('div');content.className='design-preview-content';stage.append(content);
            stage.addEventListener('scroll',()=>{const canvas=stage.querySelector('canvas');if(canvas)alignPixelPreview(canvas);},{passive:true});
            const label=document.createElement('span');bindText(label,preset.name);button.append(stage,label);
            button.addEventListener('click',()=>{this.selected=preset.id;grid.querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));this.dialog.querySelector('[data-design-apply]').disabled=false;bindText(this.dialog.querySelector('[data-design-status]'), "Выбрано: {0}.", {0: uiLabel(preset.name)});});grid.append(button);this.previewObserver.observe(stage);}
        bindText(this.dialog.querySelector('[data-design-status]'),presets.length?'{0} оформлений. Выберите вариант и нажмите «Применить».':'Оформления не найдены.',{0:presets.length});
        Promise.allSettled(this.dialog.getAnimations().map(animation=>animation.finished)).then(()=>this.alignPreviews());
    }
    apply(){
        if(!this.selected||this.app.getActiveProject()!==this.project){bindText(this.dialog.querySelector('[data-design-status]'), 'Активный проект изменился. Откройте оформления снова.');return;}
        try{
            if(this.prefix){if(this.app.prefixEditor.selected!==this.blockIndex)throw Error('Выбранный блок изменился. Откройте оформления снова.');if(this.app.prefixEditor.change(data=>{data.blocks[this.blockIndex]=applyPrefixDesign(data.blocks[this.blockIndex],this.selected);})===false)throw Error('Не удалось применить оформление. Проверьте размеры и параметры префикса.');}
            else{
                const layer=this.app.layerManager.getLayers().find(item=>item.isBase);if(!layer)throw Error('Не найден базовый слой GUI.');
                if(layer!==this.base||layer.contentRevision!==this.baseRevision)throw Error('Фон GUI изменился. Откройте оформления снова.');
                const before=layer.getImageData(),image=this.fullImage(GUI_DESIGNS.find(item=>item.id===this.selected));let snapshot;
                try{snapshot=editLayerPixels(layer,()=>{layer.ctx.clearRect(0,0,layer.width,layer.height);layer.ctx.drawImage(image,0,0);if(layer.fx)delete layer.fx.texture;layer.invalidateSource();},before);}
                catch(error){this.app.bus.emit('CANVAS_UPDATED');throw error;}
                finally{image.width=image.height=1;}
                this.app.history.push(new DrawCommand(layer,snapshot.before,snapshot.after,'Оформление GUI','palette'));this.app.bus.emit('CANVAS_UPDATED');
            }
            this.dialog.close();
        }catch(error){bindText(this.dialog.querySelector('[data-design-status]'), error.message);}
    }
}
