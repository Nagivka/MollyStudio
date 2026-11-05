import {normalizeButtonData,renderButtonData} from '../core/ButtonDocument.mjs';
import {DrawCommand} from '../core/Commands.js';
import {labelHTML,bindAttribute} from '../core/Locale.mjs';
import {numberFieldHTML,switchHTML,createGradientRow,createColorPreview,createHexInput} from './Controls.mjs';
import {captureGradientFocus,restoreGradientFocus} from './GradientFocus.js';

/** Generated buttons retain their recipe alongside the pristine pixel source. */
export default class ButtonProperties{
    constructor(app){
        this.app=app;this.element=document.createElement('section');this.element.className='prop-group-box';this.element.id='prop-group-button';
        this.element.addEventListener('change',event=>{
            const input=event.target,key=input.dataset.buttonField;if(!key)return;
            if(input.type==='number'&&(!input.checkValidity()||input.value==='')){this.signature=null;this.sync(this.layer);return;}
            this.edit({[key]:input.type==='checkbox'?input.checked:input.type==='number'?input.valueAsNumber:input.value});
        });
    }
    sync(layer){
        this.layer=layer;const data=normalizeButtonData(layer?.buttonData);
        this.element.hidden=!data;if(!data)return;
        const signature=JSON.stringify([layer.id,data,this.app.layerManager.isEditable(layer)]);if(signature===this.signature)return;this.signature=signature;
        const active=document.activeElement?.dataset.buttonField,gradientFocus=captureGradientFocus(this.element);
        const field=(key,label,min,max)=>numberFieldHTML({label,attribute:'data-button-field',attributeValue:key,min,max,value:data[key]});
        this.element.innerHTML=`<div class="prop-section-label">${labelHTML('Параметры кнопки')}</div>
            <label class="prop-field-block"><span>${labelHTML('Стиль')}</span><select class="md-select" data-button-field="style">${[['default','Java'],['ten','Bedrock'],['flat','Flat'],['outline','Outline'],['double','Double']].map(([id,label])=>`<option value="${id}">${label}</option>`).join('')}</select></label>
            <div class="prop-coord-grid">${field('width','Ширина, px',1,4096)}${field('height','Высота, px',1,4096)}</div>
            <label class="prop-field-block"><span>${labelHTML('Цвет кнопки')}</span><select class="md-select" data-button-field="colorMode"><option value="solid">${labelHTML('Сплошной')}</option><option value="gradient">${labelHTML('Градиент')}</option></select></label>
            <div data-button-colors></div>
            ${data.colorMode==='gradient'?field('gradientAngle','Угол градиента',0,360):''}
            <div class="prop-section-label">${labelHTML('Обводка и фаски')}</div>
            <div class="prop-coord-grid">${field('bevel',['outline','double'].includes(data.style)?'Толщина контура, px':'Толщина фаски, px',1,5)}${data.style==='ten'?field('chin','Подбородок, px',1,5):''}</div>
            ${switchHTML('data-button-field','Автошейдинг',data.autoShade,'autoShade')}
            <div data-button-manual-colors></div>
            ${switchHTML('data-button-field','Цветная обводка',data.tintedBorder,'tintedBorder')}
            ${field('opacity','Непрозрачность заливки, %',0,100)}
            ${switchHTML('data-button-field','Прозрачная обводка',data.transparentBorder,'transparentBorder')}`;
        for(const key of ['style','colorMode'])this.element.querySelector(`[data-button-field="${key}"]`).value=data[key];
        const colors=this.element.querySelector('[data-button-colors]');
        const addColor=(color,label,change,container=colors,key=null)=>{
            const index=container.querySelectorAll('.grad-stop-row').length;
            const row=createGradientRow(index),preview=createColorPreview(color),hex=createHexInput(color);row.dataset.gradientKey=key||`fill-${index}`;
            preview.input.dataset.gradientRole='color';hex.dataset.gradientRole='hex';
            bindAttribute(preview.input,'aria-label',label);bindAttribute(hex,'aria-label',label);
            const commit=value=>{if(/^#[\da-f]{6}$/i.test(value))change(value.toUpperCase());else hex.value=color;};
            preview.input.addEventListener('change',()=>commit(preview.input.value));hex.addEventListener('change',()=>commit(hex.value));row.append(preview.circle,hex);container.append(row);return row;
        };
        if(data.colorMode==='solid')addColor(data.baseColor,'Цвет кнопки',baseColor=>this.edit({baseColor}));
        else{
            data.gradientColors.forEach((color,index)=>{
                const row=addColor(color,'Цвет градиента',value=>{const gradientColors=[...data.gradientColors];gradientColors[index]=value;this.edit({gradientColors});});
                if(data.gradientColors.length>2){const remove=document.createElement('button');remove.type='button';remove.className='md-icon-btn';bindAttribute(remove,'aria-label','Удалить цвет');remove.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">remove</i>';remove.onclick=()=>this.edit({gradientColors:data.gradientColors.filter((_,i)=>i!==index)});row.append(remove);}
            });
            if(data.gradientColors.length<8){const add=document.createElement('button');add.type='button';add.className='md-btn outlined';add.innerHTML=`<i class="material-symbols-rounded" aria-hidden="true">add</i>${labelHTML('Добавить цвет')}`;add.onclick=()=>this.edit({gradientColors:[...data.gradientColors,data.gradientColors.at(-1)]});colors.append(add);}
        }
        const manual=this.element.querySelector('[data-button-manual-colors]');manual.hidden=data.autoShade;
        const shades=data.style==='outline'?[['highlight','Цвет контура']]:[['border','Цвет обводки'],['highlight','Цвет блика'],...(['default','ten'].includes(data.style)?[['shadow','Цвет тени фаски']]:[])];
        if(!data.autoShade)for(const [key,label] of shades){
            const heading=document.createElement('span');heading.className='prop-field-label';heading.innerHTML=labelHTML(label);manual.append(heading);
            addColor(data.colors[key],label,value=>this.edit({colors:{...data.colors,[key]:value}}),manual,`edge-${key}`);
        }
        this.element.querySelector('[data-button-field="tintedBorder"]').closest('label').hidden=!data.autoShade||data.style==='outline';
        for(const input of this.element.querySelectorAll('input,select,button'))input.disabled=!this.app.layerManager.isEditable(layer);
        if(active)this.element.querySelector(`[data-button-field="${active}"]`)?.focus({preventScroll:true});
        else restoreGradientFocus(this.element,gradientFocus);
    }
    edit(patch){
        const app=this.app,layer=this.layer;if(app.layerManager.getActiveLayer()!==layer||!app.layerManager.isEditable(layer)||!layer.buttonData)return false;
        if(app.tools.finishDocument({preserveSelection:true})===false)return false;
        const before=layer.getImageData(),old=normalizeButtonData(layer.buttonData),data=normalizeButtonData({...old,...patch});
        if(JSON.stringify(old)===JSON.stringify(data))return false;
        let source;
        try{
            if(old.sourceMap&&(patch.width!==undefined||patch.height!==undefined)){
                const matrix=[...old.sourceMap.matrix],sx=data.width/old.width,sy=data.height/old.height;
                matrix[0]*=sx;matrix[1]*=sx;matrix[2]*=sy;matrix[3]*=sy;
                const xs=[matrix[4],matrix[4]+matrix[0],matrix[4]+matrix[2],matrix[4]+matrix[0]+matrix[2]],ys=[matrix[5],matrix[5]+matrix[1],matrix[5]+matrix[3],matrix[5]+matrix[1]+matrix[3]];
                const minX=Math.min(...xs),minY=Math.min(...ys);matrix[4]-=minX;matrix[5]-=minY;
                data.sourceMap={matrix,width:Math.max(1,Math.ceil(Math.max(...xs)-minX-1e-8)),height:Math.max(1,Math.ceil(Math.max(...ys)-minY-1e-8))};
                if(data.sourceMap.width>4096||data.sourceMap.height>4096)throw Error('Размер преобразованной кнопки превышает 4096 px.');
            }
            const pixels=data.width*data.height+(data.sourceMap?data.sourceMap.width*data.sourceMap.height:0);
            if(app.layerManager.canAllocateLayers?.(0,pixels)===false)return false;
            source=renderButtonData(data);
            const previous=layer.sourceRect||app.tools.tools.move.getLayerBoundingBox(layer)||{x:0,y:0,w:old.width,h:old.height};
            const rect={...previous};
            if(patch.width!==undefined||patch.height!==undefined){rect.w*=source.width/(layer.sourceCanvas?.width||old.width);rect.h*=source.height/(layer.sourceCanvas?.height||old.height);}
            layer.clear(false);app.tools.tools.move.drawResampled(layer.ctx,source,rect.x,rect.y,rect.w,rect.h,0,'pixel');
            layer.buttonData=data;layer.setMasterSource(source,rect);
            app.history.push(new DrawCommand(layer,before,layer.getImageData(),'Параметры кнопки','smart_button'));
            app.bus.emit('CANVAS_UPDATED');app.bus.emit('LAYER_ACTIVE_CHANGED',layer);return true;
        }catch(error){layer.putImageData(before);if(source&&source!==layer.sourceCanvas)source.width=source.height=1;app.showToast('Не удалось изменить кнопку.','error');console.error(error);return false;}
    }
}
