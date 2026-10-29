import {createGradientRow,createColorPreview,createHexInput} from './Controls.mjs';
import {instrumentMethods} from '../core/Performance.mjs';
import {bindAttribute, bindText, uiLabel, localeValue} from '../core/Locale.mjs';
import {removeColorStop} from '../core/GradientStops.mjs';
import PrefixRenderer from '../graphics/PrefixRenderer.js';
import { prefixInspectorMarkup } from './PrefixInspector.js';
import Layer from '../graphics/Layer.js';
import { Palettes } from '../utils/Palettes.js';
import { prefixShadePreview, prefixTextShadowPreview } from '../graphics/PrefixShading.mjs';
import { normalizePrefixDocument, normalizePrefixBlock, PREFIX_LIMITS } from '../core/PrefixDocument.mjs';
import InspectorTabs from './InspectorTabs.js';

const clone = value => structuredClone(value);
const colorSettings = [
    { key: 'textColors', id: 'prefix-text-colors', mode: 'textMode', angle: 'textAngle', name: 'Текст' },
    { key: 'backgroundColors', id: 'prefix-background-colors', mode: 'background', angle: 'backgroundAngle', name: 'Фон' },
    { key: 'textShadowColors', id: 'prefix-text-shadow-colors', mode: 'textShadowMode', angle: 'textShadowAngle', name: 'Тень текста' }
];
export default class PrefixEditor {
    constructor(app) {
        this.app=app;this.renderer=new PrefixRenderer();this.selected=0;this.pending=null;this.activeId=null;this.pendingRenders=new WeakSet();this.selectedBlocks=new Map();this.invalidFields=new Map();
        this.scrollPositions=new Map();this.activeStops={backgroundColors:0,textColors:0,textShadowColors:0};this.backgroundModes=new Map();
        this.panel=document.createElement('aside');this.panel.id='prefix-editor';this.panel.hidden=true;bindAttribute(this.panel, "aria-label", 'Редактор префиксов');
        this.panel.innerHTML=prefixInspectorMarkup();
        document.getElementById('workspace')?.after(this.panel);
        this.error=this.panel.querySelector('.prefix-error');
        this.activeTabs=new Map();this.tabScrollPositions=new Map();
        const scroll=this.panel.querySelector('.prefix-scroll');
        this.tabs=new InspectorTabs(scroll,[
            {key:'text',label:'Текст',icon:'text_fields',nodes:[this.panel.querySelector('#prefix-section-text')]},
            {key:'background',label:'Фон',icon:'format_color_fill',nodes:[this.panel.querySelector('#prefix-section-background')]}
        ],{id:'prefix',canSwitch:()=>this.commitPendingEdit()});
        this.renderPalette();
        this.panel.addEventListener('input',event=>this.editField(event));
        this.panel.addEventListener('change',event=>{
            if(event.target.matches('[data-prefix-existing-block]')){if(this.commitPendingEdit()!==false){this.selected=Number(event.target.value);this.sync();}return;}
            const target=event.target.dataset.prefixPaletteSelect;
            if(target){this.renderPalette(target);return;}
            if(this.commitPendingEdit(false)!==false)this.sync();
        });
        this.panel.addEventListener('focusout',()=>this.commitPendingEdit(false));
        this.panel.addEventListener('click',event=>this.click(event));
        app.bus.on('HISTORY_CHANGED',()=>{if(!this.updating&&this.project()?.type==='prefix')this.sync();});
    }

    project(){return this.app.projects.find(project=>project.id===this.app.activeProjectId);}
    releaseProject(id){this.selectedBlocks.delete(id);this.scrollPositions.delete(id);this.activeTabs.delete(id);this.tabScrollPositions.delete(id);for(const key of this.backgroundModes.keys())if(key.startsWith(`${id}:`))this.backgroundModes.delete(key);if(this.activeId===id)this.activeId=null;}
    async show(project) {
        if(this.activeId){this.selectedBlocks.set(this.activeId,this.selected);this.scrollPositions.set(this.activeId,this.panel.querySelector('.prefix-scroll').scrollTop);this.activeTabs.set(this.activeId,this.tabs.active);this.tabs.scroll.set(this.tabs.active,this.panel.querySelector('.prefix-scroll').scrollTop);this.tabScrollPositions.set(this.activeId,new Map(this.tabs.scroll));}
        const visible=project.type==='prefix';this.panel.hidden=!visible;document.body.classList.toggle('prefix-project',visible);
        if(!visible){this.activeId=null;return;}
        const changed=this.activeId!==project.id;
        if(changed){this.activeId=project.id;this.selected=this.selectedBlocks.get(project.id)||0;this.invalidFields.clear();this.error.hidden=true;this.panel.querySelector('#prefix-warning').textContent='';}
        this.app.tools.setTool('hand');
        if(project.prefixData?.blocks?.some(block=>block && Object.hasOwn(block,'icon')))this.pendingRenders.add(project);
        project.prefixData=normalizePrefixDocument(project.prefixData);
        this.sync();
        if(changed){this.tabs.scroll=new Map(this.tabScrollPositions.get(project.id)||[]);this.tabs.select(this.activeTabs.get(project.id)||'text',{force:true,remember:false});this.panel.querySelector('.prefix-scroll').scrollTop=this.scrollPositions.get(project.id)||0;}
        try {
            await this.renderer.load();
            if(!this.app.projects.includes(project))return;
            // Imported projects retain their pixels until all bundled font atlases are ready.
            if(this.pendingRenders.has(project)||!project.layers.some(layer=>layer.objectType==='prefix')) {
                this.apply(project,project.prefixData);
                this.pendingRenders.delete(project);
                if(this.project()===project)this.app.workspace.fitToScreen();
            }
            if(this.project()===project)this.sync();
            return true;
        }catch(error){this.app.showToast(error.message,'error');return false;}
    }

    apply(project,value) {
        const result=this.renderer.render(value),isActive=this.project()===project;
        let layer;
        try {
            const previous=project.layers?.find(item=>item.objectType==='prefix');
            layer=previous||new Layer(`prefix_${project.id}`,'Префикс',result.canvas.width,result.canvas.height);
            let before;
            try{
                before=previous?.getImageData?.();
                if(layer.width!==result.canvas.width||layer.height!==result.canvas.height){layer.width=layer.canvas.width=result.canvas.width;layer.height=layer.canvas.height=result.canvas.height;}
                else layer.ctx.clearRect(0,0,layer.width,layer.height);
                layer.ctx.imageSmoothingEnabled=false;
                layer.ctx.drawImage(result.canvas,0,0);
            }catch(error){
                if(before){layer.putImageData(before);layer.contentRevision=before.mollySnapshot?.contentRevision??layer.contentRevision;}
                else if(!previous){layer.canvas.width=layer.canvas.height=layer.thumbCanvas.width=layer.thumbCanvas.height=1;}
                this.app.bus.emit('CANVAS_UPDATED');throw error;
            }
            layer.locked=true;layer.objectType='prefix';layer.invalidateSource();
            project.prefixData=result.data;project.layers=[layer];project.config={...project.config,width:layer.width,height:layer.height};project.activeLayerId=layer.id;project.selectedLayerIds=[layer.id];
            if(isActive){
                const previousWidth=this.app.config.width,previousHeight=this.app.config.height;
                Object.assign(this.app.config,project.config);if(!previous)this.app.layerManager.setLayers([layer]);
                if(previousWidth!==layer.width||previousHeight!==layer.height)this.app.renderer.resize(layer.width,layer.height);
                if(!previous)this.app.bus.emit('LAYER_ORDER_CHANGED');this.app.bus.emit('LAYER_ACTIVE_CHANGED',layer);this.app.bus.emit('CANVAS_UPDATED');
                if(this.app.workspace.autoFitOnResize&&(previousWidth!==layer.width||previousHeight!==layer.height))this.app.workspace.fitToScreen();
                const info=document.getElementById('doc-info');if(info){bindText(info, "{0} × {1} px · Префиксы", {0: layer.width, 1: layer.height});bindAttribute(info, "title", "Префикс: {0} × {1} px. Размер определяется настройками текста и фона.", {0: layer.width, 1: layer.height});}
                this.updatePreview({canvas:layer.canvas,missing:result.missing});
            }
            return {...result,canvas:layer.canvas};
        } finally {
            if(result.canvas!==layer?.canvas)result.canvas.width=result.canvas.height=1;
        }
    }

    editField(event) {
        const input=event.target,field=input.dataset.prefixField,stop=input.dataset.prefixStop;
        const project=this.project();if(!project||project.type!=='prefix'||(!field&&!stop))return;
        if(input.type==='number'&&(!input.value||!input.checkValidity())){this.markInvalid(input,`Введите целое число от ${input.min} до ${input.max}.`);return;}
        let hex;
        if(stop||input.dataset.prefixHex){hex=input.value.trim();if(!hex.startsWith('#'))hex='#'+hex;if(!/^#[\da-f]{6}$/i.test(hex)){this.markInvalid(input,'Цвет должен содержать 6 символов HEX, например #A1B2C3.');return;}hex=hex.toUpperCase();}
        this.invalidFields.delete(input);this.error.hidden=!this.invalidFields.size;
        input.removeAttribute('aria-invalid');
        const next=clone(project.prefixData),block=next.blocks[this.selected];if(!block)return;
        if(!this.pending)this.pending={project,before:clone(project.prefixData)};
        if(stop){const [key,index]=stop.split(':');block[key][Number(index)]=hex;this.activeStops[key]=Number(index);}
        else {const value=input.dataset.prefixHex?hex:input.type==='checkbox'?input.checked:['number','range'].includes(input.type)?Number(input.value):input.value;
            if(field==='transparent')block.background=value?'none':this.backgroundModes.get(`${project.id}:${block.id}`)||(block.backgroundColors.length>1?'gradient':'solid');
            else if(field.startsWith('document.'))next[field.slice(9)]=value;
            else if(field.startsWith('texture.'))block.texture[field.slice(8)]=value;
            else {
                if(field==='autoShade'&&!value){const shades=prefixShadePreview(block);block.highlightColor??=shades.highlight;block.bevelShadowColor??=shades.shadow;}
                block[field]=value;
                if(/^radius(?:Top|Bottom)(?:Left|Right)$/.test(field)&&this.panel.querySelector('[data-prefix-link-corners]').checked)
                    for(const key of ['radiusTopLeft','radiusTopRight','radiusBottomLeft','radiusBottomRight'])block[key]=value;
            }}
        try{this.apply(project,next);this.sync(false);}catch(error){this.markInvalid(input,error.message);}
    }

    markInvalid(input,message){this.invalidFields.set(input,message);input.setAttribute('aria-invalid','true');bindText(this.error.querySelector('span'),message);this.error.hidden=false;}

    commitPendingEdit(focus=true) {
        if(this.invalidFields.size){if(focus){const input=this.invalidFields.keys().next().value;input.focus();input.scrollIntoView({block:'center',behavior:'instant'});}return false;}
        const pending=this.pending;this.pending=null;if(!pending)return true;
        const after=clone(pending.project.prefixData);if(JSON.stringify(pending.before)===JSON.stringify(after))return true;
        const command={name:'Изменить префикс',icon:'badge',before:pending.before,after,
            undo:()=>{this.apply(pending.project,pending.before);this.sync();},execute:()=>{this.apply(pending.project,after);this.sync();}};
        this.updating=true;
        try{this.app.history.push(command);}finally{this.updating=false;}
        this.app.saveProjectState();
        return true;
    }

    change(mutator) {
        if(this.commitPendingEdit()===false)return false;const project=this.project();if(!project||project.type!=='prefix')return false;
        try{
            const next=clone(project.prefixData);mutator(next);this.pending={project,before:clone(project.prefixData)};
            this.apply(project,next);this.commitPendingEdit();this.sync();return true;
        }catch(error){this.pending=null;this.app.showToast(error.message,'error');return false;}
    }

    click(event) {
        if(event.target.closest('[data-prefix-designs]')){this.app.designGallery.open();return;}
        if(event.target.closest('[data-prefix-action="discard-invalid"]')){for(const input of this.invalidFields.keys())input.removeAttribute('aria-invalid');this.invalidFields.clear();this.error.hidden=true;this.commitPendingEdit();this.sync();return;}
        if(this.invalidFields.size){this.commitPendingEdit();return;}
        const mode=event.target.closest('[data-prefix-mode]');if(mode){const [key,value]=mode.dataset.prefixMode.split(':');this.change(data=>{const block=data.blocks[this.selected];block[key]=value;const colors=block[colorSettings.find(item=>item.mode===key).key];if(value==='gradient'&&colors.length<2)colors.push(colors[0]);});return;}
        const shade=event.target.closest('[data-prefix-shade-mode]');if(shade){this.change(data=>{const block=data.blocks[this.selected];if(shade.dataset.prefixShadeMode==='manual'){const colors=prefixShadePreview(block);block.highlightColor??=colors.highlight;block.bevelShadowColor??=colors.shadow;}block.autoShade=shade.dataset.prefixShadeMode==='auto';});return;}
        const angle=event.target.closest('[data-prefix-angle-preset]');if(angle){const [key,value]=angle.dataset.prefixAnglePreset.split(':');this.change(data=>{data.blocks[this.selected][key]=Number(value);});return;}
        const stop=event.target.closest('[data-prefix-select-stop]');if(stop){const [key,index]=stop.dataset.prefixSelectStop.split(':');this.activeStops[key]=Number(index);this.syncColorState(this.project().prefixData.blocks[this.selected]);return;}
        const swatch=event.target.closest('[data-prefix-swatch]');if(swatch){this.change(data=>{const block=data.blocks[this.selected],key=swatch.dataset.prefixPaletteTarget,gradient=block[colorSettings.find(item=>item.key===key).mode]==='gradient';block[key][gradient?Math.min(this.activeStops[key],block[key].length-1):0]=swatch.dataset.prefixSwatch;});return;}
        const colorAction=event.target.closest('[data-prefix-color-action]');
        if(colorAction){const [action,key,index]=colorAction.dataset.prefixColorAction.split(':');this.change(data=>{const colors=data.blocks[this.selected][key];if(action==='add'&&colors.length<PREFIX_LIMITS.colors){colors.push(colors.at(-1));this.activeStops[key]=colors.length-1;}if(action==='remove'&&colors.length>2){this.activeStops[key]=removeColorStop(colors,Number(index),this.activeStops[key])??this.activeStops[key];}});if(action==='add')this.panel.querySelector(`[data-prefix-select-stop="${key}:${this.activeStops[key]}"]`)?.focus();else if(action==='remove')this.panel.querySelector(`[data-prefix-color-action="add:${key}"]`)?.focus();return;}
        const action=event.target.closest('[data-prefix-action]')?.dataset.prefixAction;if(!action)return;
        this.commitPendingEdit();
        if(action.startsWith('reset-')){
            this.change(data=>{
                const block=data.blocks[this.selected],defaults=normalizePrefixBlock({autoShade:true,textShadowMode:'auto'});
                const textKeys=new Set(['font','letterSpacing',...Object.keys(defaults).filter(key=>key.startsWith('text')&&key!=='text')]);
                for(const key of Object.keys(defaults))if(!['id','text'].includes(key)&&(action==='reset-text'?textKeys.has(key):!textKeys.has(key)))block[key]=clone(defaults[key]);
            });return;
        }
    }

    sync(fields=true) {
        const project=this.project();if(project?.type!=='prefix')return;
        if(this.invalidFields.size)fields=false;
        const data=normalizePrefixDocument(project.prefixData);this.selected=Math.max(0,Math.min(this.selected,data.blocks.length-1));
        const block=data.blocks[this.selected],list=this.panel.querySelector('[data-prefix-existing-block]');
        const focused=document.activeElement;
        const focusedStop=this.panel.contains(focused)?focused.dataset?.prefixStop:null;
        const selection=focusedStop&&focused.type==='text'?[focused.selectionStart,focused.selectionEnd]:null;
        this.panel.querySelector('[data-prefix-existing-blocks]').hidden=data.blocks.length<2;
        if(fields){list.replaceChildren();data.blocks.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}. ${item.text||'Без текста'}`;list.append(option);});list.value=String(this.selected);
            this.panel.querySelectorAll('[data-prefix-field]').forEach(input=>{const key=input.dataset.prefixField,value=key.startsWith('document.')?data[key.slice(9)]:key.startsWith('texture.')?block.texture[key.slice(8)]:block[key];input.removeAttribute('aria-invalid');if(input.type==='checkbox')input.checked=value;else if(value!=null)input.value=String(value);});
            for(const {key,id,mode} of colorSettings)this.colorFields(key,id,block[mode]==='gradient'?block[key]:[block[key][0]],block[mode]==='gradient');
        }
        this.syncColorState(block);
        this.panel.querySelector('[data-prefix-texture-options]').hidden=block.texture.type==='none'||block.background==='none';
        syncFontPreview(this.panel.querySelector('[data-prefix-field="font"]'));
        this.panel.querySelectorAll('[data-prefix-field^="texture."]').forEach(input=>{input.disabled=block.background==='none';});
        this.syncShadingState(block);
        for(const key of ['shadowColor','shadowX','shadowY','shadowOpacity'])this.panel.querySelectorAll(`[data-prefix-field="${key}"]`).forEach(input=>{input.disabled=!block.shadow;});
        this.panel.querySelector('[data-prefix-background-shadow-options]').hidden=!block.shadow;
        this.syncTextShadowState(block);
        // Hidden/disabled controls retain their last valid model value, not a blocking draft.
        for(const input of this.invalidFields.keys())if(!input.isConnected||input.disabled||input.closest('[hidden]')){
            this.invalidFields.delete(input);input.removeAttribute('aria-invalid');
            const stop=input.dataset.prefixStop?.split(':'),key=input.dataset.prefixField;
            const value=stop?block[stop[0]][Number(stop[1])]:key?.startsWith('document.')?data[key.slice(9)]:key?.startsWith('texture.')?block.texture[key.slice(8)]:block[key];
            if(value!=null)input.value=String(value);
        }
        this.error.hidden=!this.invalidFields.size;
        if(this.panel.querySelector('[data-prefix-link-corners]').checked)for(const key of ['radiusTopLeft','radiusTopRight','radiusBottomLeft','radiusBottomRight']){
            const input=this.panel.querySelector(`[data-prefix-field="${key}"]`);if(!this.invalidFields.has(input))input.value=block[key];
        }
        if(focusedStop&&!focused.isConnected){
            const replacement=this.panel.querySelector(`[data-prefix-stop="${focusedStop}"][type="${focused.type}"]`);
            replacement?.focus({preventScroll:true});
            if(replacement&&selection)replacement.setSelectionRange(...selection);
        }
        if(project.layers[0]?.objectType==='prefix')this.updatePreview({canvas:project.layers[0].canvas});
    }

    colorFields(key,id,colors,gradient) {
        const container=this.panel.querySelector(`#${id}`);container.replaceChildren();
        const name=colorSettings.find(item=>item.key===key).name;
        colors.forEach((color,index)=>{const row=createGradientRow(index);row.classList.add('prefix-color-row');row.dataset.prefixColorRow=`${key}:${index}`;
            if(gradient){const select=document.createElement('button');select.type='button';select.className='md-icon-btn gradient-stop-select';select.textContent=String(index+1);select.dataset.prefixSelectStop=`${key}:${index}`;bindAttribute(select, "aria-label", "{0}: выбрать цвет {1}", {0: uiLabel(name), 1: index+1});row.append(select);}
            const {circle,input}=createColorPreview(color);input.dataset.prefixStop=`${key}:${index}`;bindAttribute(input, "aria-label", "{0}: цвет {1}", {0: uiLabel(name), 1: index+1});circle.append(input);
            const hex=createHexInput(color);hex.dataset.prefixStop=`${key}:${index}`;bindAttribute(hex, "aria-label", "{0}: HEX цвета {1}", {0: uiLabel(name), 1: index+1});row.append(circle,hex);
            if(gradient){const remove=document.createElement('button');remove.type='button';remove.className='md-icon-btn';remove.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">close</i>';bindAttribute(remove, "aria-label", "{0}: удалить цвет {1}", {0: uiLabel(name), 1: index+1});remove.dataset.prefixColorAction=`remove:${key}:${index}`;remove.disabled=colors.length<=2;row.append(remove);}container.append(row);});
        if(gradient){const add=document.createElement('button');add.type='button';add.className='m3-btn m3-btn-outlined prefix-add-color';add.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">add</i><!--i18n-->Добавить цвет';add.dataset.prefixColorAction=`add:${key}`;add.disabled=colors.length>=PREFIX_LIMITS.colors;container.append(add);}
    }

    syncColorState(block) {
        if(block.background!=='none')this.backgroundModes.set(`${this.project().id}:${block.id}`,block.background);
        for(const {key,mode:modeKey,angle:angleKey} of colorSettings){
            const mode=block[modeKey],gradient=mode==='gradient';
            this.activeStops[key]=Math.max(0,Math.min(this.activeStops[key],block[key].length-1));
            this.panel.querySelector(`[data-prefix-color-controls="${key}"]`).hidden=mode==='none';
            const bar=this.panel.querySelector(`[data-prefix-gradient-preview="${key}"]`);bar.hidden=!gradient;bar.style.background=`linear-gradient(to right, ${block[key].join(', ')})`;
            this.panel.querySelector(`[data-prefix-angle="${key}"]`).hidden=!gradient;
            this.panel.querySelector(`[data-prefix-angle-value="${angleKey}"]`).textContent=`${block[angleKey]}°`;
            this.panel.querySelectorAll(`[data-prefix-angle-preset^="${angleKey}:"]`).forEach(button=>{const active=Number(button.dataset.prefixAnglePreset.split(':')[1])===block[angleKey];button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);});
            this.panel.querySelectorAll(`[data-prefix-color-row^="${key}:"]`).forEach(row=>{const index=Number(row.dataset.prefixColorRow.split(':')[1]),active=index===this.activeStops[key];row.classList.toggle('active',active&&gradient);row.querySelector('[data-prefix-select-stop]')?.setAttribute('aria-pressed',String(active));row.querySelectorAll('[data-prefix-stop]').forEach(input=>{if(input!==document.activeElement&&!this.invalidFields.has(input))input.value=block[key][index];});});
        }
        this.panel.querySelector('[data-prefix-field="transparent"]').checked=block.background==='none';
        this.panel.querySelectorAll('[data-prefix-mode]').forEach(button=>{const [key,value]=button.dataset.prefixMode.split(':');const active=block[key]===value;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);});
    }

    renderPalette(target) {
        for(const key of target?[target]:colorSettings.map(item=>item.key)){
            const container=this.panel.querySelector(`[data-prefix-palette-swatches="${key}"]`);
            const selected=this.panel.querySelector(`[data-prefix-palette-select="${key}"]`).value;
            container.replaceChildren();
            for(const color of Palettes[selected]||Palettes.minecraft){
                const button=document.createElement('button');button.type='button';button.className='swatch-btn';button.style.backgroundColor=color;
                button.dataset.prefixSwatch=color;button.dataset.prefixPaletteTarget=key;button.title=color;
                bindAttribute(button, "aria-label", "{0}: применить цвет {1}", {0: uiLabel(colorSettings.find(item=>item.key===key).name), 1: color});container.append(button);
            }
        }
    }

    syncShadingState(block) {
        const shades=prefixShadePreview(block),hasBackground=block.background!=='none',automatic=block.autoShade&&hasBackground;
        const displayColors={borderColor:shades.border,highlightColor:shades.highlight,bevelShadowColor:shades.shadow,textShadowColor:block.textShadowColor,shadowColor:block.shadowColor};
        for(const [key,value] of Object.entries(displayColors))this.panel.querySelectorAll(`[data-prefix-field="${key}"]`).forEach(input=>{
            if(input!==document.activeElement&&!this.invalidFields.has(input))input.value=value;
            if(['borderColor','highlightColor','bevelShadowColor'].includes(key))input.disabled=automatic||(key==='borderColor'?!block.borderWidth:!block.bevel||!hasBackground);
        });
        this.panel.querySelectorAll('[data-prefix-shade-mode]').forEach(button=>{const selected=(button.dataset.prefixShadeMode==='auto')===automatic;button.setAttribute('aria-pressed',String(selected));button.classList.toggle('active',selected);button.disabled=button.dataset.prefixShadeMode==='auto'&&!hasBackground;});
        this.panel.querySelector('[data-prefix-field="bevel"]').disabled=!hasBackground;
        this.panel.querySelector('[data-prefix-field="tintedBorder"]').disabled=!automatic||!block.borderWidth;
        this.panel.querySelector('[data-prefix-manual-border]').hidden=automatic||!block.borderWidth;
        this.panel.querySelector('[data-prefix-edge-colors]').hidden=!block.borderWidth&&(!block.bevel||!hasBackground);
        this.panel.querySelector('[data-prefix-transparent-edges]').hidden=hasBackground;
        this.panel.querySelector('[data-prefix-auto-edges]').hidden=!automatic;
        for(const [key,value] of Object.entries(shades)){
            const preview=this.panel.querySelector(`[data-prefix-edge-preview="${key}"]`);if(!preview)continue;
            preview.hidden=key==='border'?!block.borderWidth:!block.bevel||!hasBackground;
            const colors=block.background==='gradient'?block.backgroundColors.map(color=>prefixShadePreview({...block,background:'solid',backgroundColors:[color]})[key]):[value];
            preview.querySelector('span').style.background=colors.length>1?`linear-gradient(to right, ${colors.join(', ')})`:value;
        }
        this.panel.querySelector('[data-prefix-manual-bevel]').hidden=automatic||!block.bevel||!hasBackground;
        this.panel.querySelector('[data-prefix-field="tintedBorder"]').closest('label').hidden=!automatic||!block.borderWidth;
    }

    syncTextShadowState(block) {
        const enabled=block.textShadow,mode=block.textShadowMode;
        this.panel.querySelector('[data-prefix-text-shadow-options]').hidden=!enabled;
        this.panel.querySelector('[data-prefix-text-shadow-auto]').hidden=mode!=='auto';
        this.panel.querySelector('[data-prefix-text-shadow-solid]').hidden=mode!=='solid';
        this.panel.querySelector('[data-prefix-text-shadow-gradient]').hidden=mode!=='gradient';
        this.panel.querySelectorAll('[data-prefix-field="textShadowColor"]').forEach(input=>{input.disabled=!enabled||mode!=='solid';});
        for(const key of ['textShadowX','textShadowY','textShadowOpacity','textShadowDarkness','textShadowAngle'])this.panel.querySelector(`[data-prefix-field="${key}"]`).disabled=!enabled;
        const preview=this.panel.querySelector('[data-prefix-text-shadow-preview]');
        preview.style.background=`linear-gradient(to right, ${prefixTextShadowPreview(block).join(', ')})`;
        this.panel.querySelector('[data-prefix-text-shadow-darkness]').textContent=block.textShadowDarkness+'%';
        bindText(this.panel.querySelector('[data-prefix-text-shadow-hint]'), block.background==='none'
            ? 'Фон прозрачный — тень подбирается по цвету или градиенту текста.'
            : block.background==='gradient'?'Тень повторяет цвета и направление градиента фона.':'Тень подбирается по сплошному цвету фона.');
    }

    updatePreview(result) {
        if(result.missing)this.panel.querySelector('#prefix-warning').textContent=result.missing.length?`В этом шрифте нет символов: ${result.missing.join(' ')}. Они показаны знаком «?».`:'';
    }


}

instrumentMethods(PrefixEditor.prototype,["updatePreview"],"prefix");
import {syncFontPreview} from './FontPreview.js';
