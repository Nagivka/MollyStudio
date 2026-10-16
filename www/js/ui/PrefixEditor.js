import PrefixRenderer from '../graphics/PrefixRenderer.js';
import Layer from '../graphics/Layer.js';
import { normalizePrefixDocument, normalizePrefixBlock, applyPrefixPreset, PREFIX_PRESETS, PREFIX_LIMITS } from '../core/PrefixDocument.mjs';

const clone = value => structuredClone(value);
const field = (label, key, input) => `<label class="prefix-field"><span>${label}</span>${input.replace('>', ` data-prefix-field="${key}">`)}</label>`;
const number = (label,key,min,max) => field(label,key,`<input class="md-input" type="number" min="${min}" max="${max}" step="1">`);
const select = (label,key,options) => field(label,key,`<select class="md-select">${options.map(([value,name])=>`<option value="${value}">${name}</option>`).join('')}</select>`);
const toggle = (label,key) => `<label class="prefix-toggle"><input type="checkbox" data-prefix-field="${key}"><span>${label}</span></label>`;
const button = (action,label,icon) => {
    const iconOnly=icon&&['add','duplicate','left','right','delete'].includes(action);
    return `<button type="button" class="md-btn ${iconOnly?'prefix-icon-action':'flat'}" data-prefix-action="${action}"${iconOnly?` aria-label="${label}" title="${label}"`:''}>${icon?`<i class="material-symbols-rounded" aria-hidden="true">${icon}</i>`:''}${iconOnly?'':label}</button>`;
};

export default class PrefixEditor {
    constructor(app) {
        this.app=app;this.renderer=new PrefixRenderer();this.selected=0;this.pending=null;this.activeId=null;this.selectedBlocks=new Map();
        this.panel=document.createElement('aside');this.panel.id='prefix-editor';this.panel.hidden=true;this.panel.setAttribute('aria-label','Генератор префиксов');
        this.panel.innerHTML=`<div class="prefix-heading"><i class="material-symbols-rounded">badge</i><strong>Префиксы</strong></div>
            <p class="prefix-hint">Соберите плашку из блоков. Каждый блок имеет свой текст и оформление.</p>
            <div id="prefix-block-list" class="prefix-block-list" role="group" aria-label="Блоки префикса"></div>
            <div class="prefix-actions">${button('add','Добавить блок','add')}${button('duplicate','Дублировать блок','content_copy')}${button('left','Блок влево','arrow_back')}${button('right','Блок вправо','arrow_forward')}${button('delete','Удалить блок','delete')}</div>
            <section class="prefix-section"><h3>Содержимое блока</h3>
            ${field('Текст','text','<input class="md-input" type="text" maxlength="64" autocomplete="off">')}
            ${select('Начертание текста','font',[['smallcaps','Small Caps'],['minecraft','Minecraft'],['minecraft-ten','Minecraft Ten']])}
            <div class="prefix-grid">${select('Значок','icon',[['none','Без значка'],['crown','Корона'],['star','Звезда'],['heart','Сердце'],['bolt','Молния'],['shield','Щит'],['check','Галочка']])}${select('Положение','iconSide',[['left','Слева'],['right','Справа']])}</div>
            ${number('Межбуквенный интервал, px','letterSpacing',0,8)}</section>
            <details class="prefix-section" open><summary>Цвета и стиль</summary><div class="prefix-presets">${Object.entries(PREFIX_PRESETS).map(([id,preset])=>`<button type="button" class="md-btn" data-prefix-preset="${id}">${preset.name}</button>`).join('')}</div>
            ${select('Заливка плашки','background',[['gradient','Градиент'],['solid','Сплошной цвет'],['none','Прозрачная']])}<div id="prefix-background-colors"></div>
            ${number('Угол фона, °','backgroundAngle',0,360)}
            ${select('Заливка текста','textMode',[['solid','Сплошной цвет'],['gradient','Градиент']])}<div id="prefix-text-colors"></div>
            ${number('Угол текста, °','textAngle',0,360)}</details>
            <details class="prefix-section"><summary>Геометрия</summary><div class="prefix-grid">
            ${number('Отступ X, px','paddingX',0,32)}${number('Отступ Y, px','paddingY',0,16)}
            ${number('Срез углов, px','radius',0,12)}${number('Обводка, px','borderWidth',0,4)}</div>
            ${field('Цвет обводки','borderColor','<input type="color">')}${toggle('Светлая и тёмная фаски','bevel')}
            <div class="prefix-grid">${number('Между блоками, px','document.gap',0,16)}${number('Внешнее поле, px','document.margin',0,16)}</div></details>
            <details class="prefix-section"><summary>Тени</summary>${toggle('Тень текста · 1 px','textShadow')}${field('Цвет тени текста','textShadowColor','<input type="color">')}
            ${toggle('Тень плашки','shadow')}<div class="prefix-grid">${number('Смещение X, px','shadowX',-8,8)}${number('Смещение Y, px','shadowY',-8,8)}</div>
            ${field('Цвет тени плашки','shadowColor','<input type="color">')}${number('Непрозрачность, %','shadowOpacity',0,100)}</details>
            <section class="prefix-section"><h3>Результат</h3><div id="prefix-dimensions" role="status"></div><p id="prefix-warning" class="prefix-hint" role="status"></p>
            <div class="prefix-natural-preview"><span>В масштабе 1:1</span><img id="prefix-native-image" alt="Префикс в исходном размере"></div>
            <div class="prefix-actions">${button('fit','Вписать','fit_screen')}${button('export','Экспорт PNG','download')}${button('copy','Копировать PNG','content_copy')}</div>
            ${button('raster-copy','Создать копию на холсте')}
            <p class="prefix-hint">Ctrl+S сохраняет редактируемый проект .mlst. PNG экспортируется с прозрачностью.</p></section>`;
        document.getElementById('workspace')?.before(this.panel);
        this.panel.addEventListener('input',event=>this.editField(event));
        this.panel.addEventListener('change',()=>{this.commitPendingEdit();this.sync();});
        this.panel.addEventListener('focusout',()=>this.commitPendingEdit());
        this.panel.addEventListener('click',event=>this.click(event));
        this.panel.addEventListener('keydown',event=>{
            if(!event.target.matches('[data-prefix-block]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
            event.preventDefault();event.stopPropagation();this.commitPendingEdit();
            const count=this.project().prefixData.blocks.length;
            this.selected=event.key==='Home'?0:event.key==='End'?count-1:(this.selected+(event.key==='ArrowRight'?1:count-1))%count;
            this.sync();this.panel.querySelector(`[data-prefix-block="${this.selected}"]`)?.focus();
        });
        app.bus.on('HISTORY_CHANGED',()=>{if(!this.updating&&this.project()?.type==='prefix')this.sync();});
    }

    project(){return this.app.projects.find(project=>project.id===this.app.activeProjectId);}
    async show(project) {
        const visible=project.type==='prefix';this.panel.hidden=!visible;document.body.classList.toggle('prefix-project',visible);
        if(this.activeId)this.selectedBlocks.set(this.activeId,this.selected);
        if(!visible){this.activeId=null;return;}
        if(this.activeId!==project.id){this.activeId=project.id;this.selected=this.selectedBlocks.get(project.id)||0;}
        this.app.tools.setTool('hand');
        project.prefixData=normalizePrefixDocument(project.prefixData);
        this.sync();
        try {
            await this.renderer.load();
            if(!this.app.projects.includes(project))return;
            // Imported projects retain their pixels until all bundled font atlases are ready.
            if(!project.layers.some(layer=>layer.objectType==='prefix')) {
                this.apply(project,project.prefixData);
                if(this.project()===project)this.app.workspace.fitToScreen();
            }
            if(this.project()===project)this.sync();
        }catch(error){this.app.showToast(error.message,'error');}
    }

    apply(project,value) {
        const result=this.renderer.render(value),isActive=this.project()===project;
        const layer=new Layer(`prefix_${project.id}`,'Префикс',result.canvas.width,result.canvas.height);
        layer.ctx.drawImage(result.canvas,0,0);layer.locked=true;layer.objectType='prefix';layer.invalidateSource();
        project.prefixData=result.data;project.layers=[layer];project.config={...project.config,width:layer.width,height:layer.height};project.activeLayerId=layer.id;project.selectedLayerIds=[layer.id];
        if(isActive){
            const previousWidth=this.app.config.width,previousHeight=this.app.config.height;
            Object.assign(this.app.config,project.config);this.app.layerManager.setLayers([layer]);
            if(previousWidth!==layer.width||previousHeight!==layer.height)this.app.renderer.resize(layer.width,layer.height);
            this.app.bus.emit('LAYER_ORDER_CHANGED');this.app.bus.emit('LAYER_ACTIVE_CHANGED',layer);this.app.bus.emit('CANVAS_UPDATED');
            if(this.app.workspace.autoFitOnResize)this.app.workspace.fitToScreen();
            const info=document.getElementById('doc-info');if(info)info.textContent=`${layer.width} × ${layer.height} px · Префиксы`;
            this.updatePreview(result);
        }
        return result;
    }

    editField(event) {
        const input=event.target,field=input.dataset.prefixField,stop=input.dataset.prefixStop;
        const project=this.project();if(!project||project.type!=='prefix'||(!field&&!stop))return;
        if(input.type==='number'&&(!input.value||!input.checkValidity())){input.setAttribute('aria-invalid','true');return;}
        input.removeAttribute('aria-invalid');
        const next=clone(project.prefixData),block=next.blocks[this.selected];if(!block)return;
        if(!this.pending)this.pending={project,before:clone(project.prefixData)};
        if(stop){const [key,index]=stop.split(':');block[key][Number(index)]=input.value;}
        else {const value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
            if(field.startsWith('document.'))next[field.slice(9)]=value;else block[field]=value;}
        try{this.apply(project,next);this.sync(false);}catch(error){this.app.showToast(error.message,'error');}
    }

    commitPendingEdit() {
        const pending=this.pending;this.pending=null;if(!pending)return;
        const after=clone(pending.project.prefixData);if(JSON.stringify(pending.before)===JSON.stringify(after))return;
        const command={name:'Изменить префикс',icon:'badge',before:pending.before,after,
            undo:()=>{this.apply(pending.project,pending.before);this.sync();},execute:()=>{this.apply(pending.project,after);this.sync();}};
        this.updating=true;this.app.history.push(command);this.updating=false;
        this.app.saveProjectState();
    }

    change(mutator) {
        this.commitPendingEdit();const project=this.project();if(!project||project.type!=='prefix')return;
        const next=clone(project.prefixData);mutator(next);this.pending={project,before:clone(project.prefixData)};
        try{this.apply(project,next);this.commitPendingEdit();this.sync();}catch(error){this.pending=null;this.app.showToast(error.message,'error');}
    }

    click(event) {
        const blockButton=event.target.closest('[data-prefix-block]');
        if(blockButton){this.commitPendingEdit();this.selected=Number(blockButton.dataset.prefixBlock);this.sync();return;}
        const preset=event.target.closest('[data-prefix-preset]');if(preset){this.change(data=>{data.blocks[this.selected]=applyPrefixPreset(data.blocks[this.selected],preset.dataset.prefixPreset);});return;}
        const colorAction=event.target.closest('[data-prefix-color-action]');
        if(colorAction){const [action,key,index]=colorAction.dataset.prefixColorAction.split(':');this.change(data=>{const colors=data.blocks[this.selected][key];if(action==='add'&&colors.length<PREFIX_LIMITS.colors)colors.push(colors.at(-1));if(action==='remove'&&colors.length>1)colors.splice(Number(index),1);});return;}
        const action=event.target.closest('[data-prefix-action]')?.dataset.prefixAction;if(!action)return;
        this.commitPendingEdit();
        if(action==='fit'){this.app.workspace.fitToScreen();return;}
        if(action==='export'){this.app.menuBar.handleAction('file-export-png');return;}
        if(action==='copy'){void this.copyImage();return;}
        if(action==='raster-copy'){this.rasterCopy();return;}
        this.change(data=>{
            const blocks=data.blocks,index=Math.min(this.selected,blocks.length-1);
            if((action==='add'||action==='duplicate')&&blocks.length<PREFIX_LIMITS.blocks){const block=action==='duplicate'?clone(blocks[index]):normalizePrefixBlock({text:'PLUS'});block.id=crypto.randomUUID();blocks.splice(index+1,0,block);this.selected=index+1;}
            if(action==='delete'&&blocks.length>1){blocks.splice(index,1);this.selected=Math.min(index,blocks.length-1);}
            const target=action==='left'?index-1:action==='right'?index+1:index;
            if(target>=0&&target<blocks.length&&target!==index){[blocks[index],blocks[target]]=[blocks[target],blocks[index]];this.selected=target;}
        });
    }

    sync(fields=true) {
        const project=this.project();if(project?.type!=='prefix')return;
        const data=normalizePrefixDocument(project.prefixData);this.selected=Math.min(this.selected,data.blocks.length-1);
        const block=data.blocks[this.selected],list=this.panel.querySelector('#prefix-block-list');
        const restoreBlockFocus=list.contains(document.activeElement);
        if(fields){list.replaceChildren();data.blocks.forEach((item,index)=>{const button=document.createElement('button');button.type='button';button.className='md-btn';button.dataset.prefixBlock=String(index);button.textContent=item.text||`Блок ${index+1}`;button.title=`Блок ${index+1}: ${item.text||'без текста'}`;button.tabIndex=index===this.selected?0:-1;button.setAttribute('aria-pressed',String(index===this.selected));list.append(button);});
            this.panel.querySelectorAll('[data-prefix-field]').forEach(input=>{const key=input.dataset.prefixField,value=key.startsWith('document.')?data[key.slice(9)]:block[key];input.removeAttribute('aria-invalid');if(input.type==='checkbox')input.checked=value;else input.value=String(value);});
            this.colorFields('backgroundColors','prefix-background-colors',block.background==='gradient'?block.backgroundColors:[block.backgroundColors[0]],block.background==='gradient');
            this.colorFields('textColors','prefix-text-colors',block.textMode==='gradient'?block.textColors:[block.textColors[0]],block.textMode==='gradient');
        }
        for(const action of ['add','duplicate','delete','left','right']){const button=this.panel.querySelector(`[data-prefix-action="${action}"]`);button.disabled=action==='delete'?data.blocks.length===1:action==='left'?this.selected===0:action==='right'?this.selected===data.blocks.length-1:data.blocks.length>=PREFIX_LIMITS.blocks;}
        this.panel.querySelector('#prefix-background-colors').hidden=block.background==='none';
        this.panel.querySelector('[data-prefix-field="backgroundAngle"]').closest('label').hidden=block.background!=='gradient';
        this.panel.querySelector('[data-prefix-field="textAngle"]').closest('label').hidden=block.textMode!=='gradient';
        this.panel.querySelector('[data-prefix-field="iconSide"]').disabled=block.icon==='none';
        this.panel.querySelector('[data-prefix-field="borderColor"]').disabled=!block.borderWidth;
        for(const key of ['shadowColor','shadowX','shadowY','shadowOpacity'])this.panel.querySelector(`[data-prefix-field="${key}"]`).disabled=!block.shadow;
        this.panel.querySelector('[data-prefix-field="textShadowColor"]').disabled=!block.textShadow;
        if(restoreBlockFocus)this.panel.querySelector(`[data-prefix-block="${this.selected}"]`)?.focus();
        if(project.layers[0]?.objectType==='prefix')this.updatePreview({canvas:project.layers[0].canvas});
    }

    colorFields(key,id,colors,gradient) {
        const container=this.panel.querySelector(`#${id}`);container.replaceChildren();
        colors.forEach((color,index)=>{const row=document.createElement('div');row.className='prefix-color-row';
            const input=document.createElement('input');input.type='color';input.value=color;input.dataset.prefixStop=`${key}:${index}`;input.setAttribute('aria-label',`${key==='textColors'?'Текст':'Фон'}: цвет ${index+1}`);
            const hex=document.createElement('span');hex.textContent=color;row.append(input,hex);
            if(gradient){const remove=document.createElement('button');remove.type='button';remove.className='md-btn';remove.textContent='−';remove.setAttribute('aria-label',`Удалить цвет ${index+1}`);remove.dataset.prefixColorAction=`remove:${key}:${index}`;remove.disabled=colors.length<=1;row.append(remove);}container.append(row);});
        if(gradient){const add=document.createElement('button');add.type='button';add.className='md-btn';add.textContent='Добавить цвет';add.dataset.prefixColorAction=`add:${key}`;add.disabled=colors.length>=PREFIX_LIMITS.colors;container.append(add);}
    }

    updatePreview(result) {
        this.panel.querySelector('#prefix-dimensions').textContent=`${result.canvas.width} × ${result.canvas.height} px · ${this.project().prefixData.blocks.length} блок(ов)`;
        this.panel.querySelector('#prefix-native-image').src=result.canvas.toDataURL('image/png');
        if(result.missing)this.panel.querySelector('#prefix-warning').textContent=result.missing.length?`В этом шрифте нет символов: ${result.missing.join(' ')}. Они показаны знаком «?».`:'';
    }

    async copyImage() {
        const project=this.project(),source=project?.layers[0]?.canvas;if(!source)return;
        try {const blob=await new Promise((resolve,reject)=>source.toBlob(value=>value?resolve(value):reject(new Error('Не удалось подготовить PNG.')),'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);this.app.showToast('PNG скопирован','check_circle');}
        catch(error){this.app.showToast('Буфер обмена недоступен. Используйте экспорт PNG.','error');}
    }

    rasterCopy() {
        const project=this.project(),source=project?.layers[0]?.canvas;if(!source)return;
        this.app.addProject(`${project.name} — холст`,'none',source.width,source.height,false,'canvas');
        if(this.project()===project)return;
        const layer=this.app.layerManager.addLayer('Префикс');layer.ctx.drawImage(source,0,0);layer.invalidateSource();
        this.app.bus.emit('CANVAS_UPDATED');this.app.tools.setTool('move');
    }
}
