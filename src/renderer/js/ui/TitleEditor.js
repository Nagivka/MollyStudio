import {exportTitleModel} from './TitleModelExporter.js';
import {titleControlAvailability} from '../core/TitleControls.mjs';
import TitleRenderer from '../graphics/TitleRenderer.js';
import TitleViewport from './TitleViewport.js';
import Layer from '../graphics/Layer.js';
import {normalizeTitleDocument,normalizeTitleTransform} from '../core/TitleDocument.mjs';
import {TITLE_FONT_CATALOG} from '../core/TitleFontCatalog.mjs';
import {TITLE_MATERIAL_CATALOG} from '../core/TitleMaterialCatalog.mjs';
import {normalizeTitleAppearance,TITLE_BLENDS,titleMaterialCatalog} from '../core/TitleAppearance.mjs';
import {titleRowSettings} from '../core/TitleDocument.mjs';
import {TITLE_TEXT_LANGUAGES,titleLanguageIssues,titleFontsForLanguage} from '../core/TitleLanguages.mjs';
import {bindText,labelHTML,bindAttribute,uiLabel,translate} from '../core/Locale.mjs';

const clone=value=>structuredClone(value);
const PRESETS=[
    {name:'Классика',texture:'stone',originalColors:true,swatch:['#BEB9AA','#77736A']},
    {name:'Золото',texture:'gold',originalColors:true,swatch:['#FFE880','#BC790E']},
    {name:'Алмаз',texture:'none',originalColors:false,top:'#D8FFFF',bottom:'#34C7DC',side:'#155D83'},
    {name:'Изумруд',texture:'none',originalColors:false,top:'#D6FFBF',bottom:'#39B765',side:'#155037'},
    {name:'Незерит',texture:'none',originalColors:false,top:'#D4C5D4',bottom:'#6D6172',side:'#29212E'},
    {name:'Лава',texture:'stone',originalColors:false,top:'#FFF589',bottom:'#F25A23',side:'#621D26'}
];
const text=labelHTML;
const blendNames={'multiply':'Умножение','screen':'Экран','overlay':'Перекрытие','soft-light':'Мягкий свет','hard-light':'Жёсткий свет','darken':'Затемнение','lighten':'Осветление','color-dodge':'Осветление основы','color-burn':'Затемнение основы','difference':'Разница','exclusion':'Исключение','hue':'Цветовой тон','saturation':'Насыщенность','color':'Цветность','luminosity':'Яркость','source-over':'Обычное'};
const blendOptions=TITLE_BLENDS.map(id=>[id,blendNames[id]]);
const select=(key,label,options)=>`<label>${text(label)}<select class="md-select" data-title-field="${key}">${options.map(([id,label])=>`<option value="${id}">${text(label)}</option>`).join('')}</select></label>`;
const numeric=(key,label,min,max)=>`<label>${text(label)}<input class="md-number-input" type="number" min="${min}" max="${max}" step="1" data-title-field="${key}"></label>`;
const appearanceSelect=(key,label,options)=>select(key,label,options).replace('data-title-field=','data-title-appearance=');
const appearanceNumber=(key,label,min,max)=>numeric(key,label,min,max).replace('data-title-field=','data-title-appearance=');
const appearanceToggle=(key,label)=>toggle(key,label).replace('data-title-field=','data-title-appearance=');
const appearanceColor=(key,label)=>`<label>${text(label)}<input type="color" data-title-appearance="${key}"></label>`;
const toggle=(key,label)=>`<label class="md-switch"><input type="checkbox" data-title-field="${key}"><span class="md-switch-track"><span class="md-switch-thumb"></span></span><span>${text(label)}</span></label>`;
const icon=name=>`<i class="material-symbols-rounded" aria-hidden="true">${name}</i>`;
const group=(label,symbol,content)=>`<section class="title-control-group"><h4>${icon(symbol)}${text(label)}</h4>${content}</section>`;
const disclosure=(label,symbol,content)=>`<details class="title-details"><summary>${icon(symbol)}${text(label)}${icon('expand_more')}</summary><div class="title-details-body">${content}</div></details>`;
const choice=(kind,controls,action)=>`<div class="title-choice-row">${controls}<button type="button" class="md-btn outlined title-visual-choice" ${action}><img data-title-choice="${kind}" alt="">${icon('grid_view')}</button></div>`;

export default class TitleEditor {
    constructor(app){
        this.app=app;this.renderer=new TitleRenderer();this.pending=null;this.currentRow=-1;this.requestSerial=0;this.loading=null;this.rendered=new WeakMap();
        this.panel=document.createElement('aside');this.panel.id='title-editor';this.panel.hidden=true;this.panel.className='title-inspector';
        bindAttribute(this.panel,'aria-label','Генератор надписей');
        this.panel.innerHTML=`
            <header class="title-inspector-header">
                <h3>${text('3D-генератор надписей')}</h3>
                <div class="title-inspector-tabs" role="tablist">${[['settings','text_fields','Текст'],['material','palette','Оформление'],['scene','deployed_code','Сцена']].map(([id,symbol,label])=>`<button type="button" class="md-btn outlined" role="tab" data-title-tab="${id}">${icon(symbol)}${text(label)}</button>`).join('')}</div>
                <div class="title-scope" hidden>
                    <label>${text('Применять к')}<select class="md-select" data-title-row><option value="-1">${text('Вся надпись')}</option><option value="0">${text('Строка 1')}</option><option value="1">${text('Строка 2')}</option><option value="2">${text('Строка 3')}</option></select></label>
                    <button class="md-icon-btn" type="button" data-title-row-reset hidden>${icon('restart_alt')}</button>
                    <p class="field-hint" data-title-scope-description hidden></p>
                </div>
                <p class="title-warning" role="status"></p>
                <button class="md-btn outlined" type="button" data-title-retry hidden>${text('Повторить загрузку')}</button>
            </header>
            <div class="title-inspector-body">
            <div class="title-settings-panel">
            ${group('Текст надписи','text_fields',`
                <label>${text('Текст')}<textarea class="md-input" rows="3" maxlength="386" data-title-field="text" aria-describedby="title-text-help"></textarea></label>
                <p id="title-text-help" class="field-hint">${text('До трёх строк, по 64 символа. Enter добавляет строку.')}</p>
                ${disclosure('Язык строк','translate',`<p class="field-hint">${text('Язык определяется автоматически. Используйте один алфавит в каждой строке.')}</p>
                    <div class="title-row-languages">${[0,1,2].map(index=>`<label>${text('Язык строки {0}',{0:index+1})}<select class="md-select" data-title-language="${index}"><option value="auto">${text('Авто')}</option>${Object.entries(TITLE_TEXT_LANGUAGES).map(([id,item])=>`<option value="${id}">${text(item.name)}</option>`).join('')}</select></label>`).join('')}</div>`)}
            `)}
            ${group('Форма текста','tune',`
                ${choice('font',select('font','Шрифт',[]),'data-title-library="fonts"')}
                <div class="title-fields">${numeric('depth','Глубина букв',0,48)}${numeric('spacing','Интервал букв',0,20)}</div>
                <div class="title-layout-options" hidden>
                    ${select('layout','Компоновка',[['logo','Заголовок, подзаголовок, подпись'],['stacked','Строки одного размера']])}
                    <div class="title-fields">${numeric('lineGap','Между строками',-4,20)}${select('role','Роль строки',[['auto','По компоновке'],['top','Заголовок'],['bottom','Подзаголовок'],['small','Подпись']])}</div>
                </div>
                ${disclosure('Детали шрифта','tune',`${toggle('kerning','Оптические интервалы')}${toggle('terminators','Краевые элементы строки')}${toggle('creeperA','Крипер в букве A')}`)}
            `)}
            </div>
            <div class="title-material-panel" hidden>
            ${group('Готовые оформления','palette',`<div class="title-presets">${PRESETS.map((preset,index)=>{
                const [top,bottom]=preset.swatch||[preset.top,preset.bottom];
                return `<button class="md-btn outlined" type="button" data-title-preset="${index}"><span class="title-preset-swatch" aria-hidden="true" style="--swatch-top:${top};--swatch-bottom:${bottom}"></span>${text(preset.name)}</button>`;
            }).join('')}</div>`)}
            ${group('Поверхность букв','layers',`
            ${appearanceSelect('source','Тип поверхности',[['texture','Готовый материал'],['gradient','Градиент'],['tileable','Повторяющаяся текстура'],['file','Своё изображение']])}
            ${choice('texture',select('texture','Материал',[]),'data-title-material-library')}
            ${select('subtitleTexture','Подзаголовок и подпись',[['same','Как основной текст']])}
            <div data-title-source="gradient"><div class="title-gradient-stops"></div><button class="md-btn outlined" type="button" data-title-add-stop>${text('Добавить цвет')}</button>${appearanceToggle('smooth','Плавный градиент')}</div>
            <div data-title-source="tileable">
                ${appearanceSelect('tileable','Текстура',Object.entries(TITLE_MATERIAL_CATALOG.tileables).map(([id,item])=>[id,item.name]))}
                <button class="md-btn outlined" type="button" data-title-library="tileables">${text('Библиотека текстур')}</button>
            </div>
            <div data-title-source="file">${appearanceSelect('fileMode','Тип изображения',[['atlas','Атлас шрифта'],['tileable','Повторяющаяся текстура']])}<button class="md-btn outlined" type="button" data-title-import="image">${text('Выбрать изображение')}</button><p class="field-hint" data-title-file-info></p></div>
            ${disclosure('Параметры текстуры','tune',`
                <div class="title-tile-options"><div class="title-fields">${appearanceNumber('tileScale','Размер текстуры',.05,20)}${appearanceNumber('tileX','Сдвиг текстуры X',-256,256)}${appearanceNumber('tileY','Сдвиг текстуры Y',-256,256)}</div>${appearanceToggle('randomRotation','Случайные повороты')}${appearanceToggle('randomMirror','Случайные отражения')}</div>
                ${appearanceSelect('textureResolution','Разрешение материала',[[1,'1×'],[2,'2×'],[4,'4×']])}${appearanceNumber('edgeBrightness','Яркость боковых граней, %',0,100)}${appearanceToggle('disableFontOverlay','Отключить детали шрифта')}
            `)}
            `)}
            ${disclosure('Наложение','layers',`
            ${appearanceSelect('overlay','Текстура наложения',[['none','Нет']])}
            <button class="md-btn outlined" type="button" data-title-library="overlays">${text('Библиотека наложений')}</button>
            <button class="md-btn outlined" type="button" data-title-import="overlayImage">${text('Загрузить своё наложение')}</button>
            <button class="md-btn outlined" type="button" data-title-clear-overlay hidden>${text('Удалить своё наложение')}</button>
            <div class="title-overlay-options">${appearanceNumber('overlayOpacity','Непрозрачность, %',0,100)}${appearanceSelect('overlayBlend','Режим наложения',blendOptions)}${appearanceColor('overlayColor','Цвет наложения')}${appearanceSelect('overlayColorBlend','Смешивание цвета наложения',blendOptions)}</div>
            `)}
            ${disclosure('Цвет и грани','tune',`
            <div class="title-fields">${appearanceNumber('hue','Тон, °',-180,180)}${appearanceNumber('saturation','Насыщенность, %',0,200)}${appearanceNumber('brightness','Яркость, %',0,200)}${appearanceNumber('contrast','Контраст, %',0,200)}</div>
            ${appearanceColor('tint','Тонирование')}${appearanceNumber('tintOpacity','Сила тонирования, %',0,100)}${appearanceSelect('tintBlend','Смешивание цвета',blendOptions)}
            ${appearanceToggle('customBorder','Свой цвет контура')}${appearanceColor('borderColor','Цвет контура')}
            ${appearanceToggle('customEdge','Свой цвет боковых граней')}${appearanceColor('edgeColor','Цвет боковых граней')}${appearanceToggle('fadeToBorder','Переход к цвету контура')}
            ${toggle('originalColors','Оригинальные цвета материала')}
            <div class="title-fields" data-title-custom-colors>${[['top','Верх текста'],['bottom','Низ текста'],['side','Боковые грани']].map(([key,label])=>`<label>${text(label)}<input type="color" data-title-field="${key}"></label>`).join('')}</div>
            `)}
            </div>
            <div class="title-scene-panel" hidden>
                ${group('Выбранный объект','select_all',`
                    <p class="field-hint title-selection-hint"></p>
                    <fieldset class="title-transform-fields" disabled hidden><legend>${text('Преобразование')}</legend>
                    ${[['position','Положение'],['rotation','Вращение'],['scale','Масштаб']].map(([key,label])=>`<div class="title-transform-group"><span>${text(label)}</span><div>${['X','Y','Z'].map((axis,i)=>`<label>${axis}<input type="number" class="md-number-input" step="any" min="${key==='scale'?.01:key==='rotation'?-180:-4096}" max="${key==='scale'?20:key==='rotation'?180:4096}" data-title-transform="${key}" data-axis="${i}"></label>`).join('')}</div></div>`).join('')}
                    <button class="md-btn outlined" type="button" data-title-reset-object>${text('Сбросить преобразование')}</button></fieldset>
                    <button class="md-btn outlined" type="button" data-title-edit-selection hidden>${text('Оформить эту строку')}</button>
                `)}
                ${group('Камера','photo_camera',`
                    ${select('projection','Проекция',[['perspective','Перспективная'],['orthographic','Ортогональная']])}
                    <button type="button" class="md-btn outlined" data-title-reset-camera>${icon('restart_alt')}${text('Сбросить камеру')}</button>
                    ${disclosure('Точный ракурс','tune',`<div class="title-fields">${numeric('yaw','Поворот Y, °',-180,180)}${numeric('pitch','Поворот X, °',-80,80)}${numeric('zoom','Приближение, %',10,600)}</div>`)}
                `)}
                ${group('Строки и буквы','layers','<div class="title-outliner" role="tree"></div>')}
            </div>
            </div>`;
        const tabs=this.panel.querySelector('.title-inspector-tabs');
        const retry=this.panel.querySelector('[data-title-retry]');
        for(const [selector,label] of [['[data-title-library="fonts"]','Библиотека шрифтов'],['[data-title-material-library]','Библиотека материалов'],['[data-title-row-reset]','Наследовать общие настройки']]){
            const button=this.panel.querySelector(selector);bindAttribute(button,'title',label);bindAttribute(button,'aria-label',label);
        }
        bindAttribute(tabs,'aria-label','Параметры надписи');
        bindAttribute(this.panel.querySelector('.title-outliner'),'aria-label','Строки и буквы');
        retry.onclick=async()=>{const project=this.project();if(!project||this.opening)return;retry.disabled=true;try{await this.show(project);}finally{retry.disabled=false;}};
        for(const name of ['settings','material','scene']){
            const section=this.panel.querySelector(`.title-${name}-panel`);
            const button=tabs.querySelector('[data-title-tab="'+name+'"]');button.id='title-tab-'+name;button.setAttribute('aria-controls','title-section-'+name);button.tabIndex=name==='settings'?0:-1;
            section.id='title-section-'+name;section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby',button.id);
        }
        this.setTab('settings');
        tabs.addEventListener('keydown',event=>{
            if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            const buttons=[...tabs.querySelectorAll('[data-title-tab]')],index=buttons.indexOf(event.target.closest('[data-title-tab]'));if(index<0)return;
            event.preventDefault();if(this.commitPendingEdit()===false)return;
            const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
            this.setTab(buttons[next].dataset.titleTab);buttons[next].focus();
        });
        this.panel.querySelector('.title-outliner').addEventListener('keydown',event=>this.navigateScene(event));
        for(const input of this.panel.querySelectorAll('[data-title-field="yaw"],[data-title-field="pitch"],[data-title-field="zoom"]'))input.step='any';
        this.panel.querySelector('[data-title-appearance="tileScale"]').step='0.05';
        document.getElementById('workspace').after(this.panel);
        this.viewport=new TitleViewport(this);
        this.panel.addEventListener('input',event=>this.edit(event));
        this.panel.addEventListener('change',event=>{if(event.target.matches('[data-title-row]')){if(this.commitPendingEdit()===false){this.sync();return;}this.currentRow=Number(event.target.value);this.sync();}else this.commitPendingEdit();});
        this.panel.addEventListener('focusout',()=>this.commitPendingEdit());
        this.panel.addEventListener('keydown',event=>{
            if(event.key!=='Escape'||!event.target.matches('[aria-invalid="true"]'))return;
            event.preventDefault();event.stopPropagation();event.target.removeAttribute('aria-invalid');event.target.blur();this.sync(true);this.syncTransform(true);this.syncRenderStatus();
        });
        this.panel.addEventListener('click',event=>{
            const library=event.target.closest('[data-title-library]');if(library){this.openMaterialLibrary(library.dataset.titleLibrary);return;}
            if(event.target.closest('[data-title-material-library]')){this.openMaterialLibrary();return;}
            const importer=event.target.closest('[data-title-import]');if(importer){this.importArtwork(importer.dataset.titleImport);return;}
            if(event.target.closest('[data-title-clear-overlay]')){this.changeSettings(value=>{value.appearance={...value.appearance,overlayImage:null};});return;}
            if(event.target.closest('[data-title-row-reset]')){if(this.currentRow>=0)this.change(data=>{data.rows[this.currentRow]=null;});return;}
            if(event.target.closest('[data-title-add-stop]')){this.changeSettings(settings=>{const a=normalizeTitleAppearance(settings.appearance);if(a.stops.length<5){const ordered=[...a.stops].sort((a,b)=>a.at-b.at);let start=0,end=1,gap=-1;for(let i=0;i<ordered.length-1;i++){const size=ordered[i+1].at-ordered[i].at;if(size>gap){gap=size;start=ordered[i].at;end=ordered[i+1].at;}}const at=(start+end)/2;a.stops.push({color:at<.4?'#FFA3A3':at>.6?'#E19A3E':'#F4C1A4',at});a.stops.sort((a,b)=>a.at-b.at);}settings.appearance=a;});return;}
            const remove=event.target.closest('[data-title-remove-stop]');if(remove){this.changeSettings(settings=>{const a=normalizeTitleAppearance(settings.appearance);if(a.stops.length>2)a.stops.splice(Number(remove.dataset.titleRemoveStop),1);settings.appearance=a;});return;}
            const tab=event.target.closest('[data-title-tab]');
            if(tab){if(this.commitPendingEdit()===false)return;this.setTab(tab.dataset.titleTab);return;}
            const row=event.target.closest('[data-scene-node]');
            if(row){
                if(this.commitPendingEdit()===false)return;
                const id=row.dataset.sceneNode,action=event.target.closest('[data-node-action]')?.dataset.nodeAction;
                if(action==='expand'){const set=this.viewport.state.expanded;set.has(id)?set.delete(id):set.add(id);this.syncScene();}
                else if(action==='visible'||action==='locked')this.change(data=>{const t=normalizeTitleTransform(data.transforms[id]);t[action]=!t[action];data.transforms[id]=t;});
                else this.viewport.select(id);
                return;
            }
            if(event.target.closest('[data-title-reset-object]')){const id=this.viewport.state.selection;if(id)this.change(data=>{const transform=normalizeTitleTransform(data.transforms[id]);data.transforms[id]={...normalizeTitleTransform(),visible:transform.visible,locked:transform.locked};});return;}
            if(event.target.closest('[data-title-edit-selection]')){
                if(this.commitPendingEdit()===false)return;
                const node=this.viewport.node();if(!node)return;
                const project=this.project();this.currentRow=project.titleData.text.includes('\n')||project.titleData.rows[0]?node.row:-1;
                this.setTab('material');this.sync();this.panel.querySelector('[data-title-tab="material"]').focus();return;
            }

            if(event.target.closest('[data-title-reset-camera]')){
                this.viewport.resetCamera();return;
            }
            const button=event.target.closest('[data-title-preset]');if(!button)return;
            this.changeSettings(value=>{const {name,swatch,...preset}=PRESETS[Number(button.dataset.titlePreset)];Object.assign(value,preset);value.appearance=normalizeTitleAppearance();});
        });
        window.addEventListener('pagehide',()=>this.renderer.dispose());
    }
    project(){const project=this.app.getActiveProject();return project?.type==='title'?project:null;}
    releaseProject(project){
        if(this.displayedProject===project)this.displayedProject=null;
        this.rendered.delete(project);this.viewport.states.delete(project);
        if(!this.app.projects.some(item=>item.type==='title'))this.renderer.releaseSceneResources();
    }
    setTab(name){
        if(!['settings','material','scene'].includes(name))return;
        const changed=this.panel.dataset.titleActiveTab!==name;this.panel.dataset.titleActiveTab=name;
        for(const button of this.panel.querySelectorAll('[data-title-tab]')){const active=button.dataset.titleTab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
        this.panel.querySelector('.title-scene-panel').hidden=name!=='scene';this.panel.querySelector('.title-settings-panel').hidden=name!=='settings';this.panel.querySelector('.title-material-panel').hidden=name!=='material';
        if(changed){this.panel.querySelector('.title-inspector-body').scrollTop=0;this.panel.scrollTop=0;}
    }
    async show(project){
        const visible=project.type==='title';this.panel.hidden=!visible;document.body.classList.toggle('title-project',visible);
        if(!visible||this.displayedProject!==project)for(const dialog of document.querySelectorAll('.title-material-library'))dialog.close();
        if(!visible){this.opening=null;this.displayedProject=null;this.syncAvailability();this.viewport.show(false);return;}
        if(this.displayedProject!==project){this.displayedProject=project;this.currentRow=-1;this.materialFont=null;for(const input of this.panel.querySelectorAll('[aria-invalid]'))input.removeAttribute('aria-invalid');this.setTab('settings');}
        project.titleData=normalizeTitleDocument(project.titleData);
        this.app.tools.setTool('hand');
        const opening={project};this.opening=opening;this.syncAvailability();this.viewport.show(true);
        bindText(this.panel.querySelector('.title-warning'),'Загружается материал…');
        try{
            await this.renderer.loadFor(project.titleData);if(!this.app.projects.includes(project))return;
            if(this.loading?.project===project)return true;
            project.titleData=normalizeTitleDocument(project.titleData);
            const needsRender=this.rendered.get(project)!==JSON.stringify(project.titleData)||!project.layers.some(layer=>layer.objectType==='title');
            if(needsRender)this.apply(project,project.titleData);
            if(this.project()===project){this.renderer.prepare(project.titleData);this.syncRenderStatus();this.viewport.syncCamera();this.sync();this.viewport.redraw();}
            return true;
        }catch(error){if(this.project()===project)this.showGraphicsError(error);this.app.showToast(error.message,'error');return false;}
        finally{if(this.opening===opening){this.opening=null;this.syncAvailability();if(this.project()===project)this.sync();}}
    }
    syncAvailability(){
        const project=this.project(),opening=!!project&&this.opening?.project===project,loading=this.loading?.project===project?this.loading:null;
        this.panel.inert=opening;this.viewport.stage.inert=opening||!!loading;
        this.panel.querySelector('.title-inspector-body').inert=!!loading?.before;
        this.viewport.element.classList.toggle('is-loading',opening||!!project&&!this.renderer.hasResources(project.titleData));
    }
    syncRenderStatus(missing=this.renderer.mesh?.missing||[]){
        this.panel.querySelector('[data-title-retry]').hidden=true;
        bindText(this.panel.querySelector('.title-warning'),missing.length?'Нет символов: {0}':'',{0:missing.join(' ')});
    }
    showGraphicsError(error){
        this.panel.querySelector('.title-warning').textContent=translate(error.message||'Не удалось создать изображение надписи.');
        this.panel.querySelector('[data-title-retry]').hidden=false;
    }
    apply(project,value){
        const result=this.renderer.render(value);let adopted=false;
        try{
            // Both renderers must accept the new scene before replacing the
            // complete document. A lost viewport context must not half-apply an edit.
            if(this.project()===project)this.renderer.prepare(result.data);
            const previous=project.layers.find(layer=>layer.objectType==='title');
            const layer=previous||new Layer('title_'+project.id,'Надпись',result.canvas.width,result.canvas.height);
            const resized=layer.width!==result.canvas.width||layer.height!==result.canvas.height;
            // The completed snapshot is already an independent 2D canvas. Adopt
            // it atomically instead of clearing and copying over the last good
            // image, and avoid an extra full-resolution bitmap copy per edit.
            const context=result.canvas.getContext('2d');if(!context)throw Error('Не удалось создать изображение надписи.');
            layer.canvas=result.canvas;layer.ctx=context;layer.width=result.canvas.width;layer.height=result.canvas.height;context.imageSmoothingEnabled=false;adopted=true;
            layer.locked=true;layer.objectType='title';layer.invalidateSource();
            project.titleData=result.data;this.rendered.set(project,JSON.stringify(result.data));project.layers=[layer];project.config={width:layer.width,height:layer.height};
            project.activeLayerId=layer.id;project.selectedLayerIds=[layer.id];
            if(this.project()===project){
                this.viewport.syncCamera();
                const old={...this.app.config};Object.assign(this.app.config,project.config);
                if(!previous)this.app.layerManager.setLayers([layer]);
                if(old.width!==layer.width||old.height!==layer.height)this.app.renderer.resize(layer.width,layer.height);
                if(resized&&this.app.workspace.autoFitOnResize)this.app.workspace.fitToScreen();
                if(!previous)this.app.bus.emit('LAYER_ORDER_CHANGED');
                this.app.bus.emit('CANVAS_UPDATED');
                this.syncRenderStatus(result.missing);
                bindText(document.getElementById('doc-info'),'{0} × {1} px · 3D',{0:layer.width,1:layer.height});
                this.viewport.redraw();
            }
        }finally{if(!adopted)result.canvas.width=result.canvas.height=1;}
    }
    safeApply(project,value){
        try{this.apply(project,value);return true;}
        catch(error){this.app.showToast(error.message,'error');return false;}
    }
    restoreSnapshot(project,value,operation){
        if(this.viewport.drag?.project===project)this.viewport.cancelDrag();
        const serial=++this.requestSerial;
        const complete=this.loading?.project===project&&this.loading.before?this.loading.before:project.titleData;
        const history=operation?this.app.history.trackRestore(operation.command,operation.undo,this.loading?.project===project?this.loading.historyCheckpoint:null):null;
        this.loading=null;
        if(this.pending?.project===project)this.pending=null;
        if(!this.app.projects.includes(project)){this.sync();return;}
        if(this.renderer.hasResources(value)){
            try{this.apply(project,value);}
            catch(error){project.titleData=complete;try{this.apply(project,complete);}catch{}throw error;}
            finally{this.sync();}
            return;
        }
        const before=clone(complete);
        project.titleData=normalizeTitleDocument(value);this.loading={project,next:project.titleData,before,historyCheckpoint:history?.checkpoint};bindText(this.panel.querySelector('.title-warning'),'Загружается материал…');this.sync();
        this.renderer.loadFor(value).then(()=>{
            if(serial!==this.requestSerial)return;
            this.loading=null;if(this.app.projects.includes(project))this.apply(project,value);this.sync();
        }).catch(error=>{
            if(serial!==this.requestSerial)return;
            this.loading=null;project.titleData=before;
            if(this.app.projects.includes(project)&&this.renderer.hasResources(before))this.safeApply(project,before);
            history?.rollback();
            this.sync();this.app.showToast(error.message,'error');
        });
    }
    targetSettings(value){
        if(this.currentRow<0)return value;
        if(!value.rows[this.currentRow]){const inherited=titleRowSettings(value,this.currentRow);value.rows[this.currentRow]={font:inherited.font,texture:inherited.texture,role:'auto',spacing:inherited.spacing,lineGap:inherited.lineGap,scale:[...inherited.scale],kerning:inherited.kerning,terminators:inherited.terminators,appearance:clone(inherited.appearance),originalColors:inherited.originalColors,top:inherited.top,bottom:inherited.bottom,side:inherited.side};}
        return value.rows[this.currentRow];
    }
    requestApply(project,next){
        if(!this.pending)this.pending={project,before:clone(project.titleData)};
        const serial=++this.requestSerial;
        if(this.renderer.hasResources(next)){this.loading=null;const applied=this.safeApply(project,next);this.sync(!applied);return;}
        this.loading={project,next};bindText(this.panel.querySelector('.title-warning'),'Загружается материал…');
        this.renderer.loadFor(next).then(()=>{
            if(serial!==this.requestSerial)return;
            this.loading=null;const applied=this.app.projects.includes(project)&&this.safeApply(project,next);this.commitPendingEdit();this.sync(!applied);
        }).catch(error=>{if(serial!==this.requestSerial)return;this.loading=null;this.commitPendingEdit();this.sync(true);this.app.showToast(error.message,'error');});
    }
    edit(event){
        const input=event.target,key=input.dataset.titleField,appearanceKey=input.dataset.titleAppearance,stopIndex=input.dataset.titleStop,transformKey=input.dataset.titleTransform,project=this.project();
        if(this.loading?.before){this.sync();return;}
        if(input.dataset.titleLanguage!==undefined&&project){this.editTextLanguage(project);return;}
        if((!key&&!appearanceKey&&stopIndex===undefined&&!transformKey)||!project)return;
        if(key==='text'){
            this.editTextLanguage(project);return;
        }
        if(input.type==='number'&&(!input.value||!input.checkValidity())){input.setAttribute('aria-invalid','true');return;}
        input.removeAttribute('aria-invalid');
        const value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
        if(transformKey){
            const id=this.viewport.state.selection;if(!id||this.viewport.isLocked(this.viewport.node()))return;
            if(!this.pending)this.pending={project,before:clone(project.titleData)};
            const transform=normalizeTitleTransform(project.titleData.transforms[id]);transform[transformKey][Number(input.dataset.axis)]=Number(value);
            const applied=this.safeApply(project,{...project.titleData,transforms:{...project.titleData.transforms,[id]:transform}});this.syncTransform(!applied);return;
        }
        const next=clone(this.loading?.project===project?this.loading.next:project.titleData);
        const globalKeys=['layout','subtitleTexture','depth','creeperA','projection','yaw','pitch','zoom'];
        const target=globalKeys.includes(key)?next:this.targetSettings(next);
        if(appearanceKey){target.appearance={...target.appearance,[appearanceKey]:value};if(appearanceKey==='overlay')target.appearance.overlayImage=null;}
        else if(stopIndex!==undefined){target.appearance=clone(target.appearance);target.appearance.stops[Number(stopIndex)][input.dataset.stopProperty]=input.dataset.stopProperty==='at'?Number(value)/100:value;}
        else{target[key]=value;if(key==='font')target.spacing=TITLE_FONT_CATALOG[value].characterSpacing||0;}
        this.requestApply(project,normalizeTitleDocument(next));
    }
    editTextLanguage(project){
        const input=this.panel.querySelector('[data-title-field="text"]'),rowLanguages=[...this.panel.querySelectorAll('[data-title-language]')].map(select=>select.value);
        const lines=input.value.normalize('NFC').replace(/\r/g,'').split('\n');
        for(const select of this.panel.querySelectorAll('[data-title-language]'))select.closest('label').hidden=Number(select.dataset.titleLanguage)>=lines.length;
        if(lines.length>3||lines.some(line=>[...line].length>64)){input.setAttribute('aria-invalid','true');bindText(this.panel.querySelector('.title-warning'),'Не более 3 строк и 64 символов в строке.');return;}
        const issues=titleLanguageIssues(input.value,rowLanguages);
        if(issues.length){input.setAttribute('aria-invalid','true');const issue=issues[0];bindText(this.panel.querySelector('.title-warning'),'Строка {0}: используйте один язык — {1}.',{0:issue.index+1,1:uiLabel(TITLE_TEXT_LANGUAGES[issue.language].name)});return;}
        input.removeAttribute('aria-invalid');const next=clone(this.loading?.project===project?this.loading.next:project.titleData);next.text=input.value;next.rowLanguages=rowLanguages;
        this.requestApply(project,normalizeTitleDocument(next));this.sync();
    }
    changeSettings(mutator){
        const project=this.project();if(!project||this.commitPendingEdit()===false)return;
        const next=clone(project.titleData);mutator(this.targetSettings(next));this.requestApply(project,normalizeTitleDocument(next));if(!this.loading)this.commitPendingEdit();
    }
    change(mutator){
        if(this.commitPendingEdit()===false)return false;
        const project=this.project();if(!project)return false;
        const next=clone(project.titleData);mutator(next);this.pending={project,before:clone(project.titleData)};
        this.requestApply(project,normalizeTitleDocument(next));if(!this.loading)this.commitPendingEdit();this.sync();return true;
    }
    commitPendingEdit(){
        if(this.loading||this.opening?.project===this.project())return false;
        this.viewport.finishDrag();
        this.viewport.flushCamera();
        const invalid=this.panel.querySelector('[aria-invalid="true"]');
        if(invalid&&this.project()){
            for(let details=invalid.closest('details');details;details=details.parentElement.closest('details'))details.open=true;
            invalid.focus();return false;
        }
        if(!this.pending)return true;
        const {project,before}=this.pending;this.pending=null;
        if(!this.app.projects.includes(project))return true;
        const after=clone(project.titleData);
        if(JSON.stringify(before)!==JSON.stringify(after)){
            if(!this.safeApply(project,after)){project.titleData=before;this.safeApply(project,before);this.sync();return false;}
            const command={name:'Изменить надпись',icon:'text_fields',before,after,execute:()=>this.restoreSnapshot(project,after,{command,undo:false}),undo:()=>this.restoreSnapshot(project,before,{command,undo:true})};
            this.app.history.push(command);
            this.app.saveProjectState();this.syncScene();
        }
        return true;
    }
    sync(force=false){
        const project=this.project();if(!project)return;
        const value=normalizeTitleDocument(this.loading?.project===project?this.loading.next:project.titleData);
        if(this.currentRow>=value.text.split('\n').length)this.currentRow=-1;
        const settings=titleRowSettings(value,this.currentRow);
        this.syncAvailability();
        const a=settings.appearance,defaultAppearance=JSON.stringify(a)===JSON.stringify(normalizeTitleAppearance({},settings.font));
        const materialFont=settings.font+':'+settings.language;
        if(this.materialFont!==materialFont){
            this.materialFont=materialFont;
            const options=(select,items)=>{select.replaceChildren(...items.map(([id,name])=>{const option=new Option(name,id);bindText(option,name);return option;}));};
            const catalog=titleMaterialCatalog(settings.font);
            options(this.panel.querySelector('[data-title-field="font"]'),titleFontsForLanguage(settings.language).map(id=>[id,TITLE_FONT_CATALOG[id].name]));
            options(this.panel.querySelector('[data-title-field="texture"]'),catalog.textures.map(item=>[item.id,item.name]));
            options(this.panel.querySelector('[data-title-field="subtitleTexture"]'),[['same','Как основной текст'],...catalog.textures.map(item=>[item.id,item.name])]);
            options(this.panel.querySelector('[data-title-appearance="overlay"]'),[['none','Нет'],...catalog.overlays.map(item=>[item.id,item.name])]);
        }
        const catalog=titleMaterialCatalog(settings.font),fontRecord=TITLE_FONT_CATALOG[settings.font],texture=catalog.textures.find(item=>item.id===settings.texture)||catalog.textures[0];
        for(const [kind,record] of [['font',catalog.textures[0]],['texture',texture]]){
            const image=this.panel.querySelector('[data-title-choice="'+kind+'"]'),url=new URL('../../assets/title_generator/'+(record.preview||record.asset),import.meta.url).href;
            if(image.src!==url)image.src=url;
            bindAttribute(image.parentElement,'title',kind==='font'?'Библиотека шрифтов · {0}':'Библиотека материалов · {0}',{0:kind==='font'?fontRecord.name:translate(texture.name)});
        }
        const description=this.panel.querySelector('[data-title-scope-description]'),overrides=value.rows.some(row=>row!==null);
        description.hidden=this.currentRow<0?!overrides:!value.rows[this.currentRow];
        bindText(description,this.currentRow<0?'У некоторых строк свои настройки. Выберите строку, чтобы изменить их.':'У этой строки свои настройки шрифта и оформления.');
        for(const input of this.panel.querySelectorAll('[data-title-field]'))if((force||document.activeElement!==input||input.dataset.titleField==='text'&&input.value.normalize('NFC').replace(/\r/g,'')!==value.text)&&!input.hasAttribute('aria-invalid')){
            const key=input.dataset.titleField,local=['font','texture','spacing','lineGap','kerning','terminators','role','originalColors','top','bottom','side'].includes(key),current=key==='role'?value.rows[this.currentRow]?.role||'auto':(local?settings:value)[key];
            if(input.type==='checkbox')input.checked=Boolean(current);else input.value=current;
        }
        for(const input of this.panel.querySelectorAll('[data-title-appearance]'))if((force||document.activeElement!==input)&&!input.hasAttribute('aria-invalid')){const current=a[input.dataset.titleAppearance];if(input.type==='checkbox')input.checked=Boolean(current);else input.value=current;}
        const textInput=this.panel.querySelector('[data-title-field="text"]'),invalidText=textInput.hasAttribute('aria-invalid');
        for(const select of this.panel.querySelectorAll('[data-title-language]')){
            const index=Number(select.dataset.titleLanguage);if(!invalidText&&document.activeElement!==select)select.value=value.rowLanguages[index];
            select.closest('label').hidden=index>=(invalidText?textInput.value:value.text).split('\n').length;
        }
        const languageIssues=titleLanguageIssues(invalidText?textInput.value:value.text,invalidText?[...this.panel.querySelectorAll('[data-title-language]')].map(select=>select.value):value.rowLanguages);
        if(languageIssues.length){textInput.setAttribute('aria-invalid','true');const issue=languageIssues[0];bindText(this.panel.querySelector('.title-warning'),'Строка {0}: используйте один язык — {1}.',{0:issue.index+1,1:uiLabel(TITLE_TEXT_LANGUAGES[issue.language].name)});}
        this.panel.querySelector('[data-title-field="role"]').closest('label').hidden=this.currentRow<0;
        const available=titleControlAvailability(value,this.currentRow);
        for(const key of ['kerning','terminators','creeperA'])this.panel.querySelector('[data-title-field="'+key+'"]').closest('label').hidden=!available[key];
        this.panel.querySelector('[data-title-row-reset]').hidden=this.currentRow<0||!value.rows[this.currentRow];
        this.panel.querySelector('[data-title-field="subtitleTexture"]').closest('label').hidden=!available.subtitleTexture;
        for(const button of this.panel.querySelectorAll('[data-title-preset]')){
            const preset=PRESETS[Number(button.dataset.titlePreset)];button.hidden=!catalog.textures.some(item=>item.id===preset.texture||item.sourceId===preset.texture);
            const selected=!button.hidden&&defaultAppearance&&texture.sourceId===preset.texture&&settings.originalColors===preset.originalColors&&(preset.originalColors||['top','bottom','side'].every(key=>settings[key].toUpperCase()===preset[key].toUpperCase()));
            button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
        }
        const scope=this.panel.querySelector('[data-title-row]'),lines=value.text.split('\n');
        this.panel.querySelector('.title-scope').hidden=lines.length<2&&!overrides;
        this.panel.querySelector('.title-layout-options').hidden=lines.length<2;
        const fontDetails=this.panel.querySelector('[data-title-field="kerning"]').closest('details');fontDetails.hidden=!available.kerning&&!available.terminators&&!available.creeperA;
        for(const option of scope.options){const index=Number(option.value);option.disabled=index>=lines.length;if(index>=0)bindText(option,'Строка {0}: {1}',{0:index+1,1:lines[index]?.slice(0,20)||'—'});}
        scope.value=String(this.currentRow);
        for(const group of this.panel.querySelectorAll('[data-title-source]'))group.hidden=group.dataset.titleSource!==a.source;
        this.panel.querySelector('[data-title-material-library]').closest('.title-choice-row').hidden=a.source!=='texture';
        const tiled=a.source==='tileable'||a.source==='file'&&a.fileMode==='tileable';
        this.panel.querySelector('.title-tile-options').hidden=!tiled;this.panel.querySelector('.title-tile-options').closest('details').hidden=!(tiled||a.source==='gradient');
        this.panel.querySelector('.title-overlay-options').hidden=a.overlay==='none'&&!a.overlayImage;
        this.panel.querySelector('[data-title-clear-overlay]').hidden=!a.overlayImage;
        this.panel.querySelector('[data-title-appearance="borderColor"]').closest('label').hidden=!a.customBorder;
        this.panel.querySelector('[data-title-appearance="edgeColor"]').closest('label').hidden=!a.customEdge;
        this.panel.querySelector('[data-title-custom-colors]').hidden=settings.originalColors;
        bindText(this.panel.querySelector('[data-title-file-info]'),a.image?'Изображение загружено':'PNG, JPEG или WebP · до 6 МБ');
        const stops=this.panel.querySelector('.title-gradient-stops');
        if(!stops.contains(document.activeElement)||stops.children.length!==a.stops.length){
            stops.replaceChildren();
            a.stops.forEach((stop,index)=>{
                const row=document.createElement('div');row.className='title-gradient-stop';
                const swatch=document.createElement('input');swatch.type='color';swatch.value=stop.color;swatch.dataset.titleStop=String(index);swatch.dataset.stopProperty='color';bindAttribute(swatch,'aria-label','Цвет {0}',{0:index+1});
                swatch.addEventListener('dragover',event=>event.preventDefault());swatch.addEventListener('drop',event=>{const color=event.dataTransfer.getData('text/plain');if(/^#[a-f0-9]{6}$/i.test(color)){event.preventDefault();swatch.value=color;swatch.dispatchEvent(new Event('input',{bubbles:true}));swatch.dispatchEvent(new Event('change',{bubbles:true}));}});
                const at=document.createElement('input');at.type='number';at.min='0';at.max='100';at.step='1';at.value=String(Math.round(stop.at*100));at.dataset.titleStop=String(index);at.dataset.stopProperty='at';bindAttribute(at,'aria-label','Положение цвета, %');
                const remove=document.createElement('button');remove.type='button';remove.className='md-icon-btn-micro';remove.dataset.titleRemoveStop=String(index);remove.disabled=a.stops.length<=2;remove.innerHTML='<i class="material-symbols-rounded">close</i>';bindAttribute(remove,'aria-label','Удалить цвет');
                row.append(swatch,at,remove);stops.append(row);
            });
        }
        this.panel.querySelector('[data-title-add-stop]').disabled=a.stops.length>=5;
        this.syncScene();
    }
    openMaterialLibrary(kind='textures'){
        if(this.commitPendingEdit()===false)return;
        const project=this.project();if(!project)return;
        for(const existing of document.querySelectorAll('.title-material-library')){if(existing.open){existing.querySelector('input')?.focus();return;}existing.remove();}
        const settings=titleRowSettings(project.titleData,this.currentRow);
        const items=kind==='fonts'?titleFontsForLanguage(settings.language).map(id=>{const font=TITLE_FONT_CATALOG[id];return {id,name:font.name,category:'',author:font.author,asset:TITLE_MATERIAL_CATALOG.fonts[id].textures.find(item=>item.id==='none').asset,preview:TITLE_MATERIAL_CATALOG.fonts[id].textures.find(item=>item.id==='none').preview};}):kind==='tileables'?Object.entries(TITLE_MATERIAL_CATALOG.tileables).map(([id,item])=>({id,...item})):titleMaterialCatalog(settings.font)[kind];
        const dialog=document.createElement('dialog');dialog.className='title-material-library';
        const heading=document.createElement('h2');bindText(heading,kind==='fonts'?'Шрифты надписи':kind==='overlays'?'Наложения':kind==='tileables'?'Текстуры':'Материалы надписи');
        const search=document.createElement('input');search.type='search';search.className='md-input';bindAttribute(search,'placeholder','Найти материал…');
        bindAttribute(search,'aria-label','Поиск в библиотеке');
        const category=document.createElement('select');category.className='md-select';bindAttribute(category,'aria-label','Категория');const all=new Option('','');bindText(all,'Все категории');category.append(all);
        for(const name of [...new Set(items.map(item=>item.category||'').filter(Boolean))].sort()){const option=new Option(name,name);category.append(option);}category.hidden=category.options.length===1;
        const grid=document.createElement('div');grid.className='title-material-grid';const status=document.createElement('p');status.className='field-hint';
        const close=document.createElement('button');close.type='button';close.className='md-btn outlined';bindText(close,'Закрыть');close.onclick=()=>dialog.close();
        const fill=()=>{const query=search.value.trim().toLocaleLowerCase(),matches=items.filter(item=>(!category.value||item.category===category.value)&&(item.id+' '+item.name+' '+translate(item.name)+' '+(item.category||'')+' '+item.author).toLocaleLowerCase().includes(query));grid.replaceChildren();status.textContent=String(matches.length)+' / '+items.length;
            for(const item of matches){
                const button=document.createElement('button');button.type='button';button.className='title-material-card';button.classList.toggle('active',item.id===(kind==='fonts'?settings.font:kind==='tileables'?settings.appearance.tileable:kind==='overlays'?settings.appearance.overlay:settings.texture));
                button.dataset.titleLibraryItem=item.id;button.setAttribute('aria-pressed',String(button.classList.contains('active')));
                const image=document.createElement('img');image.loading='lazy';image.alt='';if(kind==='tileables')image.className='title-tile-preview';
                image.src=new URL('../../assets/title_generator/'+(item.preview||item.asset),import.meta.url).href;
                const name=document.createElement('span');bindText(name,item.name);button.title=item.author;button.append(image,name);
                button.onclick=()=>{if(this.project()!==project){dialog.close();return;}this.changeSettings(value=>{if(kind==='fonts'){value.font=item.id;value.spacing=TITLE_FONT_CATALOG[item.id].characterSpacing||0;}else if(kind==='tileables'){value.appearance={...value.appearance,source:'tileable',tileable:item.id};}else if(kind==='overlays'){value.appearance={...value.appearance,overlay:item.id,overlayImage:null};}else{value.texture=item.id;value.appearance={...value.appearance,source:'texture'};}});dialog.close();};grid.append(button);
            }
        };search.addEventListener('input',fill);category.addEventListener('change',fill);
        grid.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...grid.querySelectorAll('button')],index=buttons.indexOf(event.target.closest('button'));if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowRight'?1:-1)));buttons[next]?.focus();});
        dialog.append(heading,search,category,status,grid,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});fill();dialog.showModal();search.focus();
    }
    importArtwork(key){
        if(this.commitPendingEdit()===false)return;
        const project=this.project(),row=this.currentRow;
        const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';
        input.addEventListener('change',async()=>{
            const file=input.files?.[0];if(!file)return;
            if(!['image/png','image/jpeg','image/webp'].includes(file.type)){this.app.showToast('Поддерживаются PNG, JPEG и WebP.','error');return;}
            if(file.size>6*1024*1024){this.app.showToast('Изображение должно быть меньше 6 МБ.','error');return;}
            const reader=new FileReader();reader.onerror=()=>this.app.showToast('Не удалось прочитать изображение.','error');
            reader.onload=()=>{if(this.project()!==project||this.currentRow!==row)return;this.changeSettings(settings=>{settings.appearance={...settings.appearance,[key]:reader.result,...(key==='image'?{source:'file'}:{overlay:'none'})};});};reader.readAsDataURL(file);
        },{once:true});input.click();
    }
    syncTransform(force=false){
        const state=this.viewport.state;if(!state)return;
        const node=this.viewport.node(),value=normalizeTitleTransform(this.project().titleData.transforms[state.selection]);
        this.panel.querySelector('.title-transform-fields').disabled=!node||this.viewport.isLocked(node);this.panel.querySelector('.title-transform-fields').hidden=!node;
        this.panel.querySelector('[data-title-edit-selection]').hidden=!node;
        bindText(this.panel.querySelector('.title-selection-hint'),node?(node.type==='row'?'Строка: {0}':node.type==='glyph'?'Буква: {0}':node.part==='source'?'Куб: {0}':node.part==='outline'?'Контур буквы':'Основа буквы'):'Щёлкните букву в 3D-виде, чтобы изменить её положение, поворот или размер.',{0:node?.label||''});
        for(const input of this.panel.querySelectorAll('[data-title-transform]'))if((force||document.activeElement!==input)&&!input.hasAttribute('aria-invalid'))input.value=value[input.dataset.titleTransform][Number(input.dataset.axis)];
    }
    syncScene(){
        const project=this.project(),state=this.viewport.state;if(!project||!state||!this.renderer.gl||this.renderer.lost||this.loading||this.opening?.project===project||!this.renderer.hasResources(project.titleData))return;
        this.renderer.prepare(project.titleData);
        const tree=this.panel.querySelector('.title-outliner'),nodes=this.renderer.mesh.nodes,children=new Map();
        const focused=tree.contains(document.activeElement)?{id:document.activeElement.closest('[data-scene-node]')?.dataset.sceneNode,action:document.activeElement.dataset.nodeAction,row:document.activeElement.matches('[data-scene-node]')}:null;
        for(const node of nodes){if(!children.has(node.parent))children.set(node.parent,[]);children.get(node.parent).push(node);}
        if(state.selection&&!nodes.some(node=>node.id===state.selection))state.selection=null;
        tree.replaceChildren();
        const makeButton=(icon,label,action)=>{const button=document.createElement('button');button.type='button';button.className='md-icon-btn-micro';button.dataset.nodeAction=action;bindAttribute(button,'aria-label',label);bindAttribute(button,'title',label);const i=document.createElement('i');i.className='material-symbols-rounded';i.textContent=icon;button.append(i);return button;};
        const append=(parent,depth)=>{
            for(const node of children.get(parent)||[]){
                const row=document.createElement('div');row.className='title-scene-node';row.dataset.sceneNode=node.id;row.style.setProperty('--tree-depth',String(depth));row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.setAttribute('aria-selected',String(state.selection===node.id));row.tabIndex=state.selection===node.id||!state.selection&&!tree.children.length?0:-1;
                const nested=children.has(node.id),expanded=state.expanded.has(node.id);
                if(nested){row.setAttribute('aria-expanded',String(expanded));row.append(makeButton(expanded?'expand_more':'chevron_right',expanded?'Свернуть':'Развернуть','expand'));}
                else row.append(Object.assign(document.createElement('span'),{className:'title-tree-spacer'}));
                const icon=document.createElement('i');icon.className='material-symbols-rounded';icon.textContent=node.type==='cube'?'deployed_code':node.type==='glyph'?'text_fields':'folder';
                const label=document.createElement('button');label.type='button';label.className='title-node-label';
                if(node.type==='cube')bindText(label,node.part==='source'?'Куб {0}':node.part==='outline'?'Контур':'Основа',{0:node.label});else label.textContent=node.label;
                bindAttribute(label,'title',node.type==='row'?'Строка: {0}':node.type==='glyph'?'Буква: {0}':node.part==='source'?'Куб: {0}':node.part==='outline'?'Контур':'Основа',{0:node.label});
                row.append(icon,label,makeButton(node.visible?'visibility':'visibility_off',node.visible?'Скрыть':'Показать','visible'),makeButton(node.locked?'lock':'lock_open',node.locked?'Разблокировать':'Заблокировать','locked'));
                for(const button of row.querySelectorAll('button'))button.tabIndex=state.selection===node.id&&button!==label?0:-1;
                row.classList.toggle('is-hidden',!node.visible);tree.append(row);
                if(nested&&expanded)append(node.id,depth+1);
            }
        };
        append(null,0);this.syncTransform();
        if(!tree.querySelector('[role="treeitem"][tabindex="0"]')){
            let node=this.viewport.node(state.selection),entry;
            while(node&&!entry){entry=[...tree.children].find(row=>row.dataset.sceneNode===node.id);node=this.viewport.node(node.parent);}
            if(entry||tree.firstElementChild)(entry||tree.firstElementChild).tabIndex=0;
        }
        if(focused){const row=[...tree.children].find(row=>row.dataset.sceneNode===focused.id)||tree.querySelector('[tabindex="0"]');const target=focused.row?row:focused.action?row?.querySelector('[data-node-action="'+focused.action+'"]'):row?.querySelector('.title-node-label');target?.focus({preventScroll:true});}
    }
    navigateScene(event){
        if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;
        const row=event.target.closest('[data-scene-node]');if(!row||(['Enter',' '].includes(event.key)&&event.target!==row))return;
        event.preventDefault();event.stopPropagation();if(this.commitPendingEdit()===false)return;
        const tree=this.panel.querySelector('.title-outliner'),rows=[...tree.children],id=row.dataset.sceneNode,index=rows.findIndex(row=>row.dataset.sceneNode===id),node=this.viewport.node(id),expanded=this.viewport.state.expanded;if(index<0||!node)return;
        let next=id;
        if(event.key==='ArrowDown')next=rows[Math.min(rows.length-1,index+1)].dataset.sceneNode;
        else if(event.key==='ArrowUp')next=rows[Math.max(0,index-1)].dataset.sceneNode;
        else if(event.key==='Home')next=rows[0].dataset.sceneNode;
        else if(event.key==='End')next=rows.at(-1).dataset.sceneNode;
        else if(event.key==='ArrowLeft'){if(expanded.has(id))expanded.delete(id);else if(node.parent)next=node.parent;}
        else if(event.key==='ArrowRight'&&row.hasAttribute('aria-expanded')){if(!expanded.has(id))expanded.add(id);else next=rows[index+1]?.dataset.sceneNode||id;}
        this.viewport.select(next);
        const target=[...tree.children].find(row=>row.dataset.sceneNode===next);target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',inline:'nearest'});
    }

    exportModel(){return exportTitleModel(this);}
}
