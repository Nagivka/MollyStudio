import {bindAttribute, labelHTML, bindText, uiLabel, getLabelSource} from '../core/Locale.mjs';

import InspectorTabs from './InspectorTabs.js';
import {describeObject,isObjectLocked} from '../core/ObjectProperties.mjs';
import {LayerPropertyCommand,CompoundCommand} from '../core/Commands.js';
import ButtonProperties from './ButtonProperties.js';
import {topLevelSelected} from '../core/LayerOrganization.mjs';
import {isControlFocused} from './ControlFocus.js';

const visible=(node,value)=>{if(node){node.hidden=!value;node.style.display=value?'block':'none';}};
const BLENDS=[['source-over','Обычное'],['multiply','Умножение'],['screen','Экран'],['overlay','Перекрытие'],['darken','Затемнение'],['lighten','Осветление'],['color-dodge','Осветление основы'],['color-burn','Затемнение основы'],['hard-light','Жёсткий свет'],['soft-light','Мягкий свет'],['difference','Разница'],['exclusion','Исключение'],['hue','Цветовой тон'],['saturation','Насыщенность'],['color','Цветность'],['luminosity','Яркость'],['lighter','Сложение']];

/** Controls are derived from actual editable data, never from a layer's name. */
export default class PropertiesInspector {
    constructor(app) {
        this.app=app;
        this.get=id=>document.getElementById(id);
        const get=this.get,container=document.querySelector('.md-panel-props');
        if(!container)return;
        this.container=container;
        const text=get('prop-group-text');
        text.querySelector('.prop-field-block').after(get('font-select').closest('.prop-field-block'),get('text-spacing').closest('.prop-row'));
        const colors=get('textSegColorSolid').closest('.prop-sub-section'),shadow=get('text-shadow-toggle').closest('.prop-sub-section');
        shadow.firstElementChild.classList.add('text-shadow-header');shadow.before(colors);
        this.textLayout=document.createElement('section');this.textLayout.className='prop-group-box';this.textLayout.id='prop-group-text-layout';
        this.textLayout.innerHTML="<div class=\"prop-section-label\"><!--i18n-->Компоновка текста</div>";
        const grids=[...text.querySelectorAll('.text-layout-fields')];
        const typography=document.createElement('div');typography.className='prop-coord-grid text-layout-fields';
        typography.append(get('text-font-size').closest('label'),get('text-line-height').closest('label'));
        get('font-select').closest('.prop-field-block').after(typography,get('text-auto-leading').closest('label'),get('text-align').closest('label'));
        this.textLayout.append(grids[0],get('text-frame-overflow'),grids[1],get('text-rotation').closest('label'));
        const help=text.querySelector('[data-text-wrap-help]');
        if(help)this.textLayout.append(help);
        this.common=document.createElement('section');this.common.className='prop-group-box';this.common.id='prop-group-appearance';
        this.common.innerHTML=`<div class="prop-common-heading"><span class="prop-section-label"><!--i18n-->Отображение</span><button class="md-icon-btn" id="prop-visible" type="button" aria-label="Видимость объекта" data-i18n-aria-label="%D0%92%D0%B8%D0%B4%D0%B8%D0%BC%D0%BE%D1%81%D1%82%D1%8C%20%D0%BE%D0%B1%D1%8A%D0%B5%D0%BA%D1%82%D0%B0" aria-pressed="true"><i class="material-symbols-rounded" aria-hidden="true">visibility</i></button><button class="md-icon-btn" id="prop-locked" type="button" aria-label="Блокировка объекта" data-i18n-aria-label="%D0%91%D0%BB%D0%BE%D0%BA%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0%20%D0%BE%D0%B1%D1%8A%D0%B5%D0%BA%D1%82%D0%B0" aria-pressed="false"><i class="material-symbols-rounded" aria-hidden="true">lock_open</i></button></div><div class="prop-coord-grid"><label class="prop-field-block"><span class="prop-field-label"><!--i18n-->Непрозрачность, %</span><input id="prop-opacity" class="md-input" type="number" min="0" max="100" step="1" value="100"></label><label class="prop-field-block"><span class="prop-field-label"><!--i18n-->Наложение</span><select class="md-select" id="prop-blend">${BLENDS.map(([value,label])=>`<option value="${value}">${labelHTML(label)}</option>`).join('')}</select></label></div>`;
        this.template=document.createElement('section');this.template.id='prop-group-template';this.template.className='prop-group-box';
        this.template.innerHTML="<button id=\"prop-change-template\" class=\"md-btn outlined\" type=\"button\"><i class=\"material-symbols-rounded\" aria-hidden=\"true\">dashboard_customize</i><!--i18n-->Заменить шаблон GUI</button>";
        this.notice=document.createElement('p');this.notice.className='prop-object-notice';this.notice.setAttribute('role','status');
        get('prop-title-row').after(this.notice);
        const shown=node=>node&&!node.hidden&&node.style.display!=='none';
        this.buttonProperties=new ButtonProperties(app);
        this.tabs=new InspectorTabs(container,[
            {key:'object',label:'Объект',icon:'tune',nodes:[this.buttonProperties.element,get('prop-group-text'),get('prop-group-shape'),get('prop-group-selection'),get('prop-group-color'),this.template,this.common],available:()=>[get('prop-group-text'),get('prop-group-shape'),get('prop-group-selection'),get('prop-group-color'),this.template,this.common].some(shown)},
            {key:'geometry',label:'Геометрия',icon:'transform',nodes:[get('prop-group-coords'),this.textLayout,get('prop-group-align'),get('prop-group-transform')],available:()=>[get('prop-group-coords'),this.textLayout,get('prop-group-align'),get('prop-group-transform')].some(shown)}
        ],{id:'properties',canSwitch:()=>app.tools.tools.text.commitStyleEdit?.()});
        const scopeLabel=document.createElement('label');scopeLabel.className='prop-field-block';
        scopeLabel.innerHTML="<span><!--i18n-->Применять отображение к</span><select class=\"md-select\" id=\"prop-appearance-target\"><option value=\"active\"><!--i18n-->Активному объекту</option><option value=\"selected\"><!--i18n-->Выбранным объектам</option></select>";
        this.common.prepend(scopeLabel);this.appearanceScope=scopeLabel;
        this.resetButtons=new Map();
        const defaults={'prop-opacity':100,'prop-shape-radius-num':0,'prop-shape-stroke':1,'text-scale-x':1,'text-scale-y':1,'text-line-height':10};
        for(const [id,value] of Object.entries(defaults)){
            const input=get(id),label=input?.closest('label');if(!label)continue;
            const fieldName=getLabelSource(label.querySelector('span'))||id;
            if(!input.hasAttribute('aria-label'))bindAttribute(input,'aria-label',fieldName);
            const button=document.createElement('button');button.className='md-icon-btn prop-reset-button';button.type='button';
            bindAttribute(button, "aria-label", "Сбросить: {0}", {0: uiLabel(fieldName)});bindAttribute(button, "title", "Исходное значение: {0}", {0: value});
            button.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">restart_alt</i>';
            button.addEventListener('click',()=>{if(input.disabled)return;input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
            const field=document.createElement('div');field.className='prop-resettable';
            label.before(field);field.append(label,button);
            this.resetButtons.set(input,button);
        }
        this.bind();this.sync();
    }

    bind() {
        const get=this.get;
        get('prop-appearance-target').addEventListener('change',()=>this.sync());
        for(const [id,property] of [['prop-visible','visible'],['prop-locked','locked']])get(id).addEventListener('click',()=>{
            const layer=this.app.layerManager.getActiveLayer();if(!layer||layer.isBase)return;
            this.setProperty(layer,property,!layer[property]);
        });
        get('prop-opacity').addEventListener('change',event=>{
            const input=event.target,layer=this.app.layerManager.getActiveLayer();
            if(!layer)return;
            if(!input.checkValidity()||input.value===''){input.value=Math.round((layer.opacity??1)*100);this.app.showToast('Непрозрачность: целое число от 0 до 100.','warning');return;}
            this.setProperty(layer,'opacity',Number(input.value)/100);
        });
        get('prop-blend').addEventListener('change',event=>{const layer=this.app.layerManager.getActiveLayer();if(layer&&BLENDS.some(([id])=>id===event.target.value))this.setProperty(layer,'blendMode',event.target.value);});
        get('prop-change-template').addEventListener('click',()=>this.app.menuBar.handleAction('file-template'));
        const designs=document.createElement('button');designs.type='button';designs.className='md-btn outlined';designs.innerHTML="<i class=\"material-symbols-rounded\" aria-hidden=\"true\">palette</i><span><!--i18n-->Готовые оформления</span>";designs.addEventListener('click',()=>this.app.designGallery.open());this.template.append(designs);
        this.textureButtons=[this.common,this.template].map(section=>{
            const button=document.createElement('button');button.type='button';button.className='md-btn outlined';
            button.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">texture</i><!--i18n-->Фактура слоя';
            button.addEventListener('click',()=>this.app.texturePanel.open());section.append(button);return button;
        });
        const shapeChange=(id,field)=>get(id).addEventListener('change',event=>{
            const layer=this.app.layerManager.getActiveLayer(),input=event.target;if(!layer?.shapeData)return;
            if(!input.checkValidity()||input.value===''){input.value=layer.shapeData[field]??0;this.app.showToast(`Допустимо целое число от ${input.min} до ${input.max}.`,'warning');return;}
            this.app.editShapeLayer(layer,{[field]:Number(input.value)});
        });
        shapeChange('prop-shape-radius-num','radius');shapeChange('prop-shape-stroke','stroke');
        for(const id of ['prop-shape-color','prop-shape-hex'])get(id).addEventListener('change',event=>{
            let color=event.target.value.trim();if(!color.startsWith('#'))color='#'+color;
            if(!/^#[0-9a-f]{6}$/i.test(color)){event.target.value=this.app.layerManager.getActiveLayer()?.shapeData?.color||'#FFFFFF';this.app.showToast('Цвет должен содержать 6 символов HEX.','warning');return;}
            this.app.editShapeLayer(this.app.layerManager.getActiveLayer(),{color:color.toUpperCase()});
        });
        get('prop-shape-fill').addEventListener('change',event=>{
            const layer=this.app.layerManager.getActiveLayer(),spec=describeObject(layer);if(!spec.fill)return;
            const filled=event.target.value==='filled',prefix=spec.kind==='rectangle'?'rect':'circle';
            this.app.editShapeLayer(layer,{filled,type:prefix+(filled?'-filled':'-empty')});
        });
        this.container.addEventListener('focusin',event=>{if(event.target.type==='number')event.target.dataset.focusValue=event.target.value;});
        this.container.addEventListener('keydown',event=>{
            const input=event.target;if(input.type!=='number'||!['Enter','Escape'].includes(event.key))return;
            event.preventDefault();event.stopPropagation();
            if(event.key==='Escape'){input.value=input.dataset.focusValue??input.dataset.committedValue??input.value;input.dispatchEvent(new Event('input',{bubbles:true}));}
            input.blur();input.focus({preventScroll:true});input.dataset.focusValue=input.value;input.select();
        });
    }

    setProperty(layer,key,value) {
        if (this.app.tools?.finishDocument?.({preserveSelection:true}) === false) { this.sync();return false; }
        const manager=this.app.layerManager;
        const targets=this.get('prop-appearance-target')?.value==='selected'?topLevelSelected(manager.getLayers(),manager.getSelectedLayers().map(item=>item.id)):[layer];
        const commands=targets.filter(item=>!item.isBase&&manager.isInIsolation?.(item.id)!==false&&item[key]!==value&&(['locked','visible'].includes(key)||!isObjectLocked(item,manager.getLayers())))
            .map(item=>new LayerPropertyCommand(item,key,item[key],value,this.app.bus));
        if(!commands.length)return;
        const command=commands.length===1?commands[0]:new CompoundCommand(commands);
        if(commands.length>1)command.name=`Изменить отображение: ${commands.length} объектов`;
        command.execute();this.app.history.push(command);this.sync();
    }

    setValue(id,value) {const input=this.get(id);if(input){input.dataset.committedValue=String(value);if(!isControlFocused(input))input.value=value;}}
    hideControl(id,hide) {const node=this.get(id);if(node)node.hidden=hide;}
    readOnly(node,disabled) {
        if(!node)return;
        if(disabled)for(const input of node.querySelectorAll('input,select,textarea,button'))if(!input.disabled){input.dataset.objectReadonly='true';input.disabled=true;}
    }

    sync() {
        if(!this.tabs)return;
        for(const input of this.container.querySelectorAll('[data-object-readonly]')){input.disabled=false;delete input.dataset.objectReadonly;}
        const app=this.app,get=this.get,manager=app.layerManager,layer=manager.getActiveLayer(),move=app.tools.tools.move,m=app.tools.tools.marquee;
        const selection=Boolean(m?.selection&&(['marquee','lasso','wand'].includes(app.tools.currentToolId)||m.hasFloating()||m.isSelecting));
        const spec=describeObject(layer),text=spec.kind==='text',group=spec.kind==='group',base=spec.kind==='template';
        bindText(this.tabs.tabs[0].button.querySelector('span'),selection?'Выделение':base?'Шаблон':text?'Текст':layer?.buttonData?'Кнопка':spec.shape?'Фигура':'Объект');
        const editable=manager.isEditable(layer),locked=isObjectLocked(layer,manager.getLayers());
        if(layer&&!base&&!selection){
            const panel=this.tabs.tabs[0].panel;
            if(locked||!editable){if(panel.firstElementChild!==this.common)panel.prepend(this.common);}
            else if(panel.lastElementChild!==this.common)panel.append(this.common);
        }
        const raster=Boolean(layer&&!base&&!text&&!group),pixelEdit=raster&&editable;
        const units=layer?move.getAlignmentUnits(layer):[];
        const selected=manager.getSelectedLayers().length>1;
        this.appearanceScope.hidden=!selected;
        if(!selected)this.get('prop-appearance-target').value='active';
        if(!selected&&!group)get('prop-transform-target').value='active';
        const box=layer?move.getNumericBox(layer):null;
        const geometry=Boolean(selection||!base&&layer&&(text||box));
        const canTransform=selection?pixelEdit&&!layer.alphaLocked:geometry&&(!text||move.isBatchTarget(layer));
        const objectName=selection?(m.hasFloating()?'Плавающее выделение':'Область выделения'):layer?.name||'';
        get('prop-layer-name').textContent=String(objectName).replace(/\s+/g,' ');get('prop-layer-name').title=objectName;
        bindText(get('prop-target-type-badge'), selection?'Выделение':spec.label);
        get('prop-target-type-badge').hidden=!layer&&!selection;
        visible(get('prop-title-row'),Boolean(layer||selection));get('prop-title-row').style.display=layer||selection?'flex':'none';
        visible(get('prop-empty-state'),!layer&&!selection);
        visible(get('prop-group-text'),!selection&&text);
        visible(get('prop-group-shape'),!selection&&Boolean(spec.shape));
        visible(get('prop-group-selection'),selection);
        visible(get('prop-group-color'),selection?pixelEdit:raster&&Boolean(box)&&!spec.shape&&!layer.buttonData);
        visible(get('prop-group-coords'),geometry);
        visible(get('prop-group-align'),geometry);
        visible(get('prop-group-transform'),canTransform);
        visible(this.textLayout,!selection&&text);
        visible(this.common,Boolean(layer&&!base&&!selection));
        this.buttonProperties.sync(selection?null:layer);
        visible(this.template,base&&!selection);
        this.textureButtons.forEach(button=>{button.hidden=group;button.disabled=!base&&locked;});
        for(const id of ['prop-field-w','prop-field-h','prop-field-lock']){visible(get(id),geometry&&(!text||move.isBatchTarget(layer)));if(id!=='prop-field-lock'&&!get(id).hidden)get(id).style.display='flex';}
        get('prop-transform-target').closest('label').hidden=selection||!selected;
        get('prop-align-reference').closest('label').hidden=selection||units.length<2;
        for(const axis of ['x','y'])this.hideControl('btn-prop-distribute-'+axis,selection||units.length<3);
        const hasMaster=selection?m.hasFloating():raster&&layer.sourceCanvas;
        this.hideControl('btn-prop-original-size',!hasMaster);this.hideControl('btn-prop-apply-transform',selection||!hasMaster);
        if(hasMaster)get('btn-prop-original-size').disabled=false;
        if(!selection&&hasMaster)get('btn-prop-apply-transform').disabled=false;
        if(selection){
            for(const id of ['cut','delete','fill','stroke','fliph','flipv']){this.hideControl('btn-prop-sel-'+id,!raster);get('btn-prop-sel-'+id).disabled=!pixelEdit||(['cut','delete','fliph','flipv'].includes(id)&&layer?.alphaLocked);}
            this.hideControl('btn-prop-sel-copy',!layer||group);this.hideControl('btn-prop-sel-content',!layer||group);
            get('btn-prop-sel-copy').disabled=!layer||group;get('btn-prop-sel-content').disabled=!layer||group;
            get('btn-prop-sel-paste').disabled=!m.clipboard||group&&locked;
        }
        if(text&&!selection)app.tools.tools.text.syncUIWithLayer(layer);
        if(spec.shape&&!selection){
            visible(get('prop-shape-radius-row'),Boolean(spec.radius));visible(get('prop-shape-fill-row'),Boolean(spec.fill));visible(get('prop-shape-stroke-row'),Boolean(spec.stroke));
            this.setValue('prop-shape-color',layer.shapeData.color);this.setValue('prop-shape-hex',layer.shapeData.color);
            this.setValue('prop-shape-fill',spec.filled?'filled':'outline');this.setValue('prop-shape-stroke',layer.shapeData.stroke||1);
            const radius=Math.floor(Math.min(Math.abs(layer.shapeData.x1-layer.shapeData.x0)+1,Math.abs(layer.shapeData.y1-layer.shapeData.y0)+1)/2);
            get('prop-shape-radius-num').max=radius;this.setValue('prop-shape-radius-num',Math.min(radius,layer.shapeData.radius||0));
        }
        if(layer&&!selection&&!base){
            this.setValue('prop-opacity',Math.round((layer.opacity??1)*100));
            const blend=get('prop-blend');for(const option of blend.querySelectorAll('[data-file-blend]'))option.remove();
            if(!BLENDS.some(([id])=>id===layer.blendMode)){const option=document.createElement('option');option.dataset.fileBlend='true';option.value=layer.blendMode;bindText(option, 'Режим из файла');blend.append(option);}
            this.setValue('prop-blend',layer.blendMode||'source-over');
            for(const [id,key,on,off] of [['prop-visible','visible','visibility','visibility_off'],['prop-locked','locked','lock','lock_open']]){const button=get(id);button.setAttribute('aria-pressed',String(Boolean(layer[key])));button.querySelector('i').textContent=layer[key]?on:off;}
            const appearanceTargets=(get('prop-appearance-target').value==='selected'
                ? topLevelSelected(manager.getLayers(),manager.getSelectedLayers().map(item=>item.id)):[layer])
                .filter(item=>!item.isBase&&manager.isInIsolation?.(item.id)!==false);
            const appearanceLocked=!appearanceTargets.some(item=>!isObjectLocked(item,manager.getLayers()));
            get('prop-opacity').disabled=appearanceLocked;get('prop-blend').disabled=appearanceLocked;
            get('prop-visible').disabled=!appearanceTargets.length;get('prop-locked').disabled=!appearanceTargets.length;
        }
        bindText(this.notice, base?'Фон GUI не растягивается как обычный объект.':!layer?'':manager.isInIsolation?.(layer.id)===false?'Объект вне изоляции. Нажмите «Показать всё» в панели слоёв, чтобы редактировать его.':locked?'Объект заблокирован. Снимите блокировку здесь или у родительской группы.':!editable?'Объект скрыт или полностью прозрачен. Настройки отображения остаются доступны.':!box&&!text?(group?'В группе пока нет видимого содержимого.':'На слое пока нет пикселей.') :'');
        this.notice.hidden=base||!this.notice.textContent;
        if(selection){
            const area=m.selection;this.setValue('prop-pos-x',area.x);this.setValue('prop-pos-y',area.y);this.setValue('prop-size-w',area.width);this.setValue('prop-size-h',area.height);get('prop-dimension-badge').textContent=`${area.width} × ${area.height} px`;
        }else if(layer){
            get('prop-dimension-badge').textContent=box?`${Math.round(box.w)} × ${Math.round(box.h)} px`:base?`${layer.width} × ${layer.height} px`:'—';
            if(!move.isMoving&&!move.isTransforming&&box){
                this.setValue('prop-pos-x',text&&!move.isBatchTarget(layer)?layer.textData.x:Math.round(box.x));this.setValue('prop-pos-y',text&&!move.isBatchTarget(layer)?layer.textData.y:Math.round(box.y));
                this.setValue('prop-size-w',Math.round(box.w));this.setValue('prop-size-h',Math.round(box.h));
            }
        }
        for(const id of ['prop-group-text','prop-group-shape','prop-group-color','prop-group-transform'])this.readOnly(get(id),!editable);
        this.readOnly(get('prop-group-align'),selection?get('marquee-transform-mode').value==='pixels'&&!pixelEdit:!editable);
        this.readOnly(this.textLayout,!editable);
        this.readOnly(get('prop-group-coords'),selection?get('marquee-transform-mode').value==='pixels'&&!pixelEdit:!editable);
        for(const [input,button] of this.resetButtons||[])button.disabled=input.disabled;
        this.tabs.sync();
        const context=selection?'selection':layer?.buttonData?'button':spec.kind;
        if(context!==this.context){this.context=context;this.tabs.select('object',{force:true});this.container.scrollTop=0;}
    }
}
