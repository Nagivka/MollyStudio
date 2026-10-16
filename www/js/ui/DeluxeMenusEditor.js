import { parseConfigYaml, stringifyConfigYaml, menuSize, itemSlots, setItemSlots, uniqueItemId, legacyTextRuns, INVENTORIES, CLICK_TYPES, ACTION_TYPES } from '../core/DeluxeMenuDocument.mjs';
import { MENU_PLUGINS, ZMENU_BUTTON_TYPES, ZMENU_ACTIONS, createMenuConfig, validateMenuConfig, menuEditorView, menuConfigFromView, importMenuYaml, exportMenuYaml, resizeMenuView, indexMenuItemsBySlot } from '../core/MenuDocument.mjs';
import { MENU_MATERIALS, findMenuMaterial } from '../utils/MinecraftCatalog.js';

const copy = value => structuredClone(value);
const field = (label, scope, key, control) => `<label class="dm-field"><span>${label}</span>${control.replace('>',` data-dm-scope="${scope}" data-dm-key="${key}">`)}</label>`;
const input = (label,scope,key,type='text',attrs='') => field(label,scope,key,`<input class="md-input" type="${type}" ${attrs}>`);
const area = (label,scope,key,rows=3) => field(label,scope,key,`<textarea class="md-input" rows="${rows}" maxlength="65536" spellcheck="false"></textarea>`);
const select = (label,scope,key,options) => field(label,scope,key,`<select class="md-select">${options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select>`);
const check = (label,key) => `<label class="dm-check"><input type="checkbox" data-dm-scope="item" data-dm-key="${key}">${label}</label>`;
const button = (action,label,icon='') => `<button type="button" class="md-btn flat" data-dm-action="${action}" aria-label="${label}" title="${label}">${icon?`<i class="material-symbols-rounded" aria-hidden="true">${icon}</i>`:''}<span class="dm-action-label">${label}</span></button>`;

export default class DeluxeMenusEditor {
    constructor(app) {
        this.app=app; this.selectedSlots=new Set([0]); this.activeSlot=0; this.itemId=null; this.pending=null; this.invalidField=null; this.clipboard=null;
        this.libraryLimit=80; this.search=''; this.activeId=null; this.codeTarget=null; this.invalidFields=new Map();this.previewPage=1;
        this.root=document.createElement('section'); this.root.id='deluxe-editor'; this.root.hidden=true;
        this.root.setAttribute('role','tabpanel'); this.root.setAttribute('aria-label','Конструктор меню');
        this.root.innerHTML=`
            <header class="dm-toolbar"><div class="dm-heading"><i class="material-symbols-rounded" aria-hidden="true">dashboard_customize</i><strong>Конструктор меню</strong><span id="dm-plugin" class="dm-plugin"></span></div><div class="dm-actions"><label id="dm-preview-page-label" class="dm-preview-page" hidden>Страница <input id="dm-preview-page" class="md-input" type="number" min="1" max="100000" step="1" value="1" aria-label="Страница предпросмотра"></label>${button('undo','Отменить','undo')}${button('redo','Повторить','redo')}${button('import','Импорт YAML','file_open')}${button('menu-extra','YAML','code')}</div></header>
            <div class="dm-layout">
                <aside class="dm-library" aria-label="Библиотека материалов"><h3 class="dm-panel-title"><i class="material-symbols-rounded" aria-hidden="true">category</i>Предметы Minecraft</h3><label class="dm-field"><span>Поиск по названию или ID</span><input class="md-input" id="dm-search" type="search" placeholder="Камень, DIAMOND…"></label><p class="dm-hint">Выберите слоты, затем нажмите на материал. Можно перетащить материал в ячейку.</p><div id="dm-materials" class="dm-materials"></div>${button('more','Показать ещё')}</aside>
                <main class="dm-center">
                    <details class="dm-settings" open><summary>Настройки меню</summary>
                        ${input('Заголовок меню','menu','menu_title','text','maxlength="4096"')}
                        <div class="dm-columns">${select('Тип меню','menu','inventory_type',Object.entries(INVENTORIES).map(([id,data])=>[id,data.name]))}${select('Размер меню','menu','size',[9,18,27,36,45,54].map(size=>[size,`${size} слотов`]))}</div>
                        ${area('Команды открытия: по одной в строке, без /','menu','open_command',2)}
                        ${input('Обновление плейсхолдеров, секунд','menu','update_interval','number','min="1" step="1" placeholder="Не задано"')}
                        <div id="dm-fill-settings" hidden>${input('Предмет в пустых слотах','menu','fill_material','text','placeholder="Например: BLACK_STAINED_GLASS_PANE" maxlength="512"')}${input('Название предмета заполнения','menu','fill_name','text','maxlength="4096"')}</div>
                        <div class="dm-actions">${button('menu-extra','Дополнительные настройки YAML','tune')}</div>
                    </details>
                    <div class="dm-inventory"><div id="dm-menu-title" class="dm-menu-title"></div><div id="dm-grid" role="group" aria-label="Ячейки меню" class="dm-grid"></div></div>
                    <p class="dm-hint">Выберите слоты и нажмите на предмет слева. Ctrl — несколько слотов, Shift — диапазон. Перетаскивание перемещает кнопку, Alt создаёт копию.</p>
                    <div class="dm-actions">${button('select-all','Всё меню')}${button('select-border','Рамка')}${button('copy','Копировать','content_copy')}${button('paste','Вставить','content_paste')}${button('remove','Очистить слоты','delete')}</div>
                    <div id="dm-tooltip" class="dm-tooltip"></div><p id="dm-layout-note" class="dm-hint"></p>
                    <details class="dm-definitions"><summary>Кнопки меню</summary><div id="dm-definitions"></div></details>
                </main>
                <aside class="dm-properties" aria-label="Свойства кнопки"><h3 class="dm-panel-title"><i class="material-symbols-rounded" aria-hidden="true">tune</i>Свойства кнопки</h3><p id="dm-selection" class="dm-hint"></p>
                    <label class="dm-field"><span>Кнопка в выбранном слоте</span><select class="md-select" id="dm-variant"></select></label>
                    <p id="dm-empty" class="dm-hint">Пустой слот. Добавьте предмет из библиотеки.</p>
                    <div id="dm-item-fields" hidden>
                        ${input('Идентификатор кнопки','item','id','text','maxlength="128"')}
                        ${input('Материал или ID предмета','item','material','text','maxlength="512"')}
                        ${input('ID модели предмета (CustomModelData)','item','model_data','number','min="0" max="2147483647" step="1" placeholder="Не задано"')}
                        ${input('Название предмета в игре','item','display_name','text','maxlength="4096"')}
                        ${area('Описание предмета (lore)','item','lore')}
                        <div class="dm-columns">${input('Количество','item','amount','number','min="1" max="64" step="1"')}${input('Приоритет показа (0 — первый)','item','priority','number','min="0" max="2147483647" step="1"')}</div>
                        ${input('Номера слотов · например 0, 2, 9-17','item','slots','text','maxlength="256"')}
                        <div class="dm-checks">${check('Блеск зачарования','enchantment_glint_override')}${check('Автообновление предмета','update')}${check('Скрыть подсказку','hide_tooltip')}</div>
                        <div id="dm-zmenu-settings" hidden>${select('Поведение кнопки','item','button_type',ZMENU_BUTTON_TYPES)}${input('Открываемое меню','item','button_inventory','text','maxlength="512"')}${input('Номер страницы','item','button_page','number','min="1" max="2147483647" step="1"')}</div><div class="dm-item-section"><h3>Действия при нажатии</h3>${select('Тип нажатия','ui','click',CLICK_TYPES)}
                        ${area('Список действий','item','actions',5)}
                        <div class="dm-columns">${select('Добавить действие','ui','action',ACTION_TYPES.map(type=>[type,`[${type}]`]))}${button('add-action','Добавить','add')}</div>${input('Текст или параметр действия','ui','action_value','text','placeholder="Например: spawn" maxlength="4096"')}
                        <p class="dm-hint" id="dm-action-hint"></p></div>
                        <div class="dm-actions">${button('item-extra','Настройки кнопки YAML','code')}${button('variant','Добавить вариант','add')}${button('delete-definition','Удалить кнопку','delete')}</div>
                    </div>
                </aside>
            </div><div class="dm-error" id="dm-error" hidden><span id="dm-error-text" role="alert"></span>${button('discard-invalid','Отменить неверный ввод','undo')}</div><footer class="dm-status" id="dm-status" role="status" aria-live="polite"></footer>`;
        document.getElementById('workspace').append(this.root);
        const inspector=this.root.querySelector('.dm-properties');
        const itemPanel=document.createElement('div');itemPanel.id='dm-panel-button';itemPanel.setAttribute('role','tabpanel');itemPanel.setAttribute('aria-labelledby','dm-tab-button');
        itemPanel.append(...inspector.childNodes);
        const menuPanel=document.createElement('div');menuPanel.id='dm-panel-menu';menuPanel.setAttribute('role','tabpanel');menuPanel.setAttribute('aria-labelledby','dm-tab-menu');
        menuPanel.append(this.root.querySelector('.dm-settings'));
        const tabs=document.createElement('div');tabs.className='dm-inspector-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Настройки конструктора');
        tabs.innerHTML=['menu','button'].map((id,index)=>`<button type="button" class="md-btn flat" id="dm-tab-${id}" role="tab" data-dm-inspector="${id}" aria-controls="dm-panel-${id}" aria-selected="${index===0}">${index===0?'Меню':'Кнопка'}</button>`).join('');
        inspector.append(tabs,menuPanel,itemPanel);this.setInspector('menu');
        this.root.addEventListener('input',event=>this.input(event));
        this.root.addEventListener('change',event=>{
            if(event.target.id==='dm-preview-page'){if(this.commitPendingEdit()===false)return;if(!event.target.checkValidity()||!event.target.value){event.target.value=this.previewPage;return;}this.previewPage=Number(event.target.value);this.itemId=null;this.sync();}
            else if(event.target.id==='dm-variant') { if(this.commitPendingEdit()===false)return;this.itemId=event.target.value;this.sync(); }
            else if(event.target.dataset.dmScope==='ui' && event.target.dataset.dmKey==='click'){if(this.commitPendingEdit()!==false)this.syncFields();}
            else if(event.target.dataset.dmKey){if(this.commitPendingEdit()!==false)this.syncFields();}
        });
        this.root.addEventListener('click',event=>this.click(event));
        this.root.addEventListener('keydown',event=>this.keydown(event));
        this.root.addEventListener('dragstart',event=>this.dragStart(event));
        this.root.addEventListener('dragover',event=>{if(event.target.closest('[data-dm-slot]')&&[...event.dataTransfer.types].includes('application/molly-dm'))event.preventDefault();});
        this.root.addEventListener('drop',event=>this.drop(event));
        this.app.bus.on('HISTORY_CHANGED',()=>{if(this.project()?.type==='deluxemenu'&&!this.pending)this.sync();});
        this.renderLibrary();
    }

    project(){return this.app.getActiveProject();}
    plugin(project=this.project()){return project?.menuPlugin || 'deluxemenus';}
    config(project=this.project()){
        if(this.cachedData!==project.deluxeData || this.cachedPlugin!==this.plugin(project)){
            this.cachedData=project.deluxeData;this.cachedPlugin=this.plugin(project);
            this.cachedView=menuEditorView(project.deluxeData,this.cachedPlugin);
        }
        return this.cachedView;
    }
    snapshot(project=this.project()){return {plugin:this.plugin(project),config:copy(project.deluxeData)};}
    slotIndex(config=this.config()){return indexMenuItemsBySlot(config,this.plugin(),this.previewPage);}
    restore(project,state){
        project.deluxeData=validateMenuConfig(state.config,state.plugin);project.menuPlugin=state.plugin;
        if(project===this.project()){this.sync();this.app.bus.emit('CANVAS_UPDATED');}
    }
    get(id){return this.root.querySelector('#dm-'+id);}
    setInspector(tab){
        this.inspectorTab=tab;
        for(const name of ['menu','button']){
            this.get('panel-'+name).hidden=name!==tab;
            const button=this.get('tab-'+name);button.setAttribute('aria-selected',String(name===tab));button.tabIndex=name===tab?0:-1;
        }
    }
    control(scope,key){return this.root.querySelector(`[data-dm-scope="${scope}"][data-dm-key="${key}"]`);}
    status(message){this.get('status').textContent=message;}
    showError(message){this.get('error-text').textContent=message;this.get('error').hidden=!message;}
    clearInvalid(){this.invalidFields.clear();this.invalidField=null;this.showError('');this.syncFields();}
    show(project){
        const visible=project.type==='deluxemenu';this.root.hidden=!visible;document.body.classList.toggle('deluxe-project',visible);
        if(!visible)return;
        project.deluxeData ??= createMenuConfig(this.plugin(project));
        if(this.activeId!==project.id){this.activeId=project.id;this.selectedSlots=new Set([0]);this.activeSlot=0;this.itemId=null;this.previewPage=1;this.invalidFields.clear();this.invalidField=null;this.showError('');}
        this.app.tools.setTool('hand');this.sync();
    }

    apply(project,value){
        const next=menuConfigFromView(value,this.plugin(project));
        if(JSON.stringify(project.deluxeData)===JSON.stringify(next)){if(project===this.project())this.sync(false);return;}
        project.deluxeData=next;
        if(project===this.project()) { this.sync(false);this.app.bus.emit('CANVAS_UPDATED'); }
    }
    commitPendingEdit(){
        if(this.invalidFields.size&&this.project()?.type==='deluxemenu'){const [field,message]=this.invalidFields.entries().next().value;this.showError(message);field.focus();return false;}
        const pending=this.pending;this.pending=null;if(!pending)return true;
        const after=this.snapshot(pending.project);if(JSON.stringify(after)===JSON.stringify(pending.before))return true;
        this.app.history.push({name:'Изменить меню',icon:'dashboard_customize',before:pending.before,after,
            undo:()=>{this.restore(pending.project,pending.before);this.sync();},execute:()=>{this.restore(pending.project,after);this.sync();}});
        this.app.saveProjectState();return true;
    }
    change(mutator){
        if(this.commitPendingEdit()===false)return false;
        const project=this.project();if(project?.type!=='deluxemenu')return false;
        const before=this.snapshot(project),next=copy(this.config(project));
        try{const replacement=mutator(next)||next;this.apply(project,replacement);this.pending={project,before};this.commitPendingEdit();this.sync();return true;}
        catch(error){this.showError(error.message);return false;}
    }

    input(event){
        const control=event.target;
        if(control.id==='dm-search'){this.search=control.value.toLowerCase().trim();this.libraryLimit=80;this.renderLibrary();return;}
        const scope=control.dataset.dmScope,key=control.dataset.dmKey;
        if(!key||scope==='ui'||this.project()?.type!=='deluxemenu')return;
        const project=this.project();let next=copy(this.config(project));const item=next.items[this.itemId];
        try{
            if(control.type==='number'&&control.value&&!control.checkValidity())throw new Error('Проверьте диапазон и целочисленное значение поля.');
            let value=control.type==='checkbox'?control.checked:control.type==='number'?(control.value===''?null:Number(control.value)):control.value;
            if(key==='amount'&&this.plugin()==='zmenu'&&/^\d+$/.test(value))value=Number(value);
            if(scope==='menu'){
                if(key==='size'||key==='inventory_type')next=resizeMenuView(next,this.plugin(),key==='inventory_type'?value:next.inventory_type||'CHEST',key==='size'?Number(value):next.size||54);
                else if(key==='open_command'){value=value.split('\n').map(line=>line.trim()).filter(Boolean);if(value.length)next[key]=value;else delete next[key];}
                else if(value===null)delete next[key];else next[key]=value;
            }else if(item){
                if(key==='id'){
                    if(!value.trim()||Object.hasOwn(next.items,value)&&value!==this.itemId)throw new Error('ID должен быть непустым и уникальным.');
                    const entries=Object.entries(next.items).map(([id,data])=>[id===this.itemId?value:id,data]);next.items=Object.fromEntries(entries);
                }else if(key==='slots'){setItemSlots(item,itemSlots({slots:value.split(',').map(part=>part.trim()).filter(Boolean)},menuSize(next)));}
                else if(key.startsWith('button_')&&this.plugin()==='zmenu'){
                    item._native??={type:'NONE'};
                    const target={button_type:'type',button_inventory:'inventory',button_page:'to-page'}[key];
                    if(value===null||value==='')delete item._native[target];else item._native[target]=value;
                    if(key==='button_type'&&value==='JUMP')item._native['to-page']??=1;
                }
                else if(key==='actions'&&this.plugin()==='zmenu'){
                    item._native??={type:'NONE'};
                    if(!value.trim())delete item._native.actions;else item._native.actions=parseConfigYaml(value);
                }
                else if(key==='lore'||key==='actions'){
                    const target=key==='actions'?this.control('ui','click').value:key;
                    if(value==='')delete item[target];else item[target]=value.split('\n');
                }else if(value===null)delete item[key];else item[key]=value;
            }
            menuConfigFromView(next,this.plugin());
            if(!this.pending)this.pending={project,before:this.snapshot(project)};
            if(scope==='item'&&key==='id')this.itemId=value;
            this.invalidFields.delete(control);this.invalidField=this.invalidFields.keys().next().value||null;
            control.removeAttribute('aria-invalid');this.showError(this.invalidFields.values().next().value||'');this.apply(project,next);
        }catch(error){this.invalidFields.set(control,error.message);this.invalidField=control;control.setAttribute('aria-invalid','true');this.showError(error.message);}
    }

    selectSlot(slot,event={}){
        if(this.commitPendingEdit()===false)return;
        if(event.shiftKey){const from=Math.min(slot,this.activeSlot),to=Math.max(slot,this.activeSlot);for(let i=from;i<=to;i++)this.selectedSlots.add(i);}
        else if(event.ctrlKey||event.metaKey){if(this.selectedSlots.has(slot)&&this.selectedSlots.size>1)this.selectedSlots.delete(slot);else this.selectedSlots.add(slot);}
        else this.selectedSlots=new Set([slot]);
        this.activeSlot=slot;this.itemId=this.slotIndex()[slot][0]?.[0]||null;
        this.setInspector('button');
        this.sync();this.root.querySelector(`[data-dm-slot="${slot}"]`)?.focus();
    }

    addMaterial(material,slots=[...this.selectedSlots]){
        const added=this.change(config=>{
            const groups=new Map();
            const index=this.slotIndex(config);
            for(const slot of slots){const entries=index[slot];const entry=entries.find(([id])=>id===this.itemId)||entries[0];const key=entry?.[0]||null;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(slot);}
            for(const [original,selected]of groups){
                const entry=original?config.items[original]:null,all=entry?itemSlots(entry,menuSize(config)):[];
                const rest=all.filter(slot=>!selected.includes(slot));
                if(entry&&!rest.length){entry.material=material;this.itemId=original;continue;}
                const id=uniqueItemId(config,original?original+'_copy':'item_'+Math.min(...selected));
                config.items[id]=entry?copy(entry):{};config.items[id].material=material;setItemSlots(config.items[id],selected);
                if(!entry&&this.plugin()==='zmenu')config.items[id]._native={type:'NONE',page:this.previewPage};
                if(entry)setItemSlots(entry,rest);
                this.itemId=id;
            }
        });
        if(added)this.setInspector('button');
    }

    click(event){
        const inspector=event.target.closest('[data-dm-inspector]');
        if(inspector){if(this.commitPendingEdit()!==false)this.setInspector(inspector.dataset.dmInspector);return;}
        const slot=event.target.closest('[data-dm-slot]');if(slot){this.selectSlot(Number(slot.dataset.dmSlot),event);return;}
        const material=event.target.closest('[data-dm-material]');if(material){this.addMaterial(material.dataset.dmMaterial);return;}
        const definition=event.target.closest('[data-dm-definition]');if(definition){if(this.commitPendingEdit()===false)return;this.itemId=definition.dataset.dmDefinition;const slots=itemSlots(this.config().items[this.itemId],menuSize(this.config()));this.selectedSlots=new Set(slots);this.activeSlot=slots[0]??0;if(this.plugin()==='zmenu'){const page=this.config().items[this.itemId]._native?.page;this.previewPage=Number.isInteger(page)?page:Number(String(page||'1').split('-')[0])||1;}this.setInspector('button');this.sync();return;}
        const action=event.target.closest('[data-dm-action]')?.dataset.dmAction;if(!action)return;
        if(action==='more'){this.libraryLimit+=80;this.renderLibrary();return;}
        if(action==='discard-invalid'){this.clearInvalid();this.commitPendingEdit();return;}
        if(this.commitPendingEdit()===false)return;
        this.showError('');
        const config=this.config(),item=config.items[this.itemId];
        switch(action){
            case 'undo':this.app.history.undo();this.sync();break;
            case 'redo':this.app.history.redo();this.sync();break;
            case 'select-all':this.selectedSlots=new Set(Array.from({length:menuSize(config)},(_,i)=>i));this.sync();break;
            case 'select-border':{const columns=INVENTORIES[config.inventory_type||'CHEST'].columns,size=menuSize(config);this.selectedSlots=new Set(Array.from({length:size},(_,i)=>i).filter(i=>i<columns||i>=size-columns||i%columns===0||i%columns===columns-1));this.sync();break;}
            case 'copy':if(item){this.clipboard=copy(item);this.clipboardPlugin=this.plugin();delete this.clipboard.slot;delete this.clipboard.slots;this.sync();this.status('Кнопка скопирована вместе с действиями и требованиями.');}break;
            case 'paste':if(this.clipboard&&this.clipboardPlugin===this.plugin())this.change(next=>{const index=this.slotIndex(next);for(const slot of this.selectedSlots)if(index[slot].length)throw new Error('Для вставки выберите свободные ячейки.');const id=uniqueItemId(next,'copy');next.items[id]=copy(this.clipboard);if(this.plugin()==='zmenu'){next.items[id]._native??={};next.items[id]._native.page=this.previewPage;}setItemSlots(next.items[id],[...this.selectedSlots]);this.itemId=id;});break;
            case 'remove':this.change(next=>{const visible=new Set(this.slotIndex(next).flat().map(([id])=>id));for(const [id,entry]of Object.entries(next.items)){if(!visible.has(id))continue;const slots=itemSlots(entry,menuSize(next));if(!slots.some(slot=>this.selectedSlots.has(slot)))continue;const rest=slots.filter(slot=>!this.selectedSlots.has(slot));if(rest.length)setItemSlots(entry,rest);else delete next.items[id];}this.itemId=null;});break;
            case 'delete-definition':if(item)this.change(next=>{delete next.items[this.itemId];this.itemId=null;});break;
            case 'variant':if(item)this.change(next=>{const id=uniqueItemId(next,this.itemId+'_variant');next.items[id]=copy(item);next.items[id].priority=Math.max(0,(item.priority??1)-1);this.itemId=id;});break;
            case 'add-action':if(item)this.addAction();break;
            case 'menu-extra':this.openCode('menu');break;
            case 'item-extra':if(item)this.openCode(this.itemId);break;
            case 'import':void this.importFile();break;
            case 'export':void this.exportFile();break;
        }
    }

    keydown(event){
        if(event.key==='Escape'&&this.invalidFields.size){event.preventDefault();event.stopPropagation();this.clearInvalid();return;}
        if(event.target.matches('input,textarea,select'))return;
        if(event.target.dataset.dmSlot!==undefined){
            if((event.ctrlKey||event.metaKey)&&['a','c','v'].includes(event.key.toLowerCase())){
                event.preventDefault();event.stopPropagation();const action={a:'select-all',c:'copy',v:'paste'}[event.key.toLowerCase()];this.root.querySelector(`[data-dm-action="${action}"]`).click();return;
            }
            const columns=INVENTORIES[this.config().inventory_type||'CHEST'].columns,size=menuSize(this.config());
            const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key];
            const next=event.key==='Home'?0:event.key==='End'?size-1:delta!=null?Math.max(0,Math.min(size-1,this.activeSlot+delta)):null;
            if(next!==null){event.preventDefault();event.stopPropagation();this.selectSlot(next,event);}
            else if(event.key==='Delete'){event.preventDefault();event.stopPropagation();this.root.querySelector('[data-dm-action="remove"]').click();}
        }
    }

    addAction(){
        const type=this.control('ui','action').value,value=this.control('ui','action_value').value.trim();
        if(this.plugin()==='zmenu'){
            this.change(next=>{const item=next.items[this.itemId];item._native??={type:'NONE'};item._native.actions??=[];
                const action={type,...copy(ZMENU_ACTIONS[type][1])};
                if(value){if(action.commands)action.commands=[value];else if(action.messages)action.messages=[value];else if(action.inventory!=null)action.inventory=value;else if(action.sound!=null)action.sound=value;}
                item._native.actions.push(action);});
        }else{
            if(!value&&!['close','refresh'].includes(type)){this.showError('Введите текст, команду или параметр действия.');this.control('ui','action_value').focus();return;}
            this.change(next=>{const key=this.control('ui','click').value;next.items[this.itemId][key]??=[];next.items[this.itemId][key].push(`[${type}]${value?' '+value:''}`);});
        }
    }

    dragStart(event){
        const material=event.target.closest('[data-dm-material]'),slot=event.target.closest('[data-dm-slot]');
        let data;
        if(material)data={material:material.dataset.dmMaterial};
            else if(slot){const index=Number(slot.dataset.dmSlot),entries=this.slotIndex()[index],entry=entries.find(([id])=>id===this.itemId)||entries[0];if(!entry)return;data={project:this.project().id,item:entry[0],slot:index};}
        if(data){event.dataTransfer.setData('application/molly-dm',JSON.stringify(data));event.dataTransfer.effectAllowed='copyMove';}
    }
    drop(event){
        const target=event.target.closest('[data-dm-slot]');if(!target)return;event.preventDefault();event.stopPropagation();
        const slot=Number(target.dataset.dmSlot);
        try{
            const data=JSON.parse(event.dataTransfer.getData('application/molly-dm'));
            if(data.material&&findMenuMaterial(data.material)){this.selectedSlots=new Set([slot]);this.activeSlot=slot;this.addMaterial(data.material,[slot]);}
            else if(data.project===this.project().id&&this.config().items[data.item]&&data.slot!==slot){
                this.change(config=>{if(this.slotIndex(config)[slot].length)throw new Error('Перемещайте предмет в свободный слот.');const item=config.items[data.item],slots=itemSlots(item,menuSize(config));if(!slots.includes(data.slot))throw new Error('Исходный слот изменился.');
                    if(event.altKey){const id=uniqueItemId(config,data.item+'_copy');config.items[id]=copy(item);setItemSlots(config.items[id],[slot]);this.itemId=id;}
                    else{setItemSlots(item,slots.map(index=>index===data.slot?slot:index));this.itemId=data.item;}
                    this.selectedSlots=new Set([slot]);this.activeSlot=slot;});
            }
        }catch(error){this.status(error.message||'Не удалось переместить предмет.');}
    }

    renderLibrary(){
        const entries=MENU_MATERIALS.filter(item=>`${item.name} ${item.en} ${item.material}`.toLowerCase().includes(this.search));
        const list=this.get('materials');list.replaceChildren();
        for(const item of entries.slice(0,this.libraryLimit)){
            const element=document.createElement('button');element.type='button';element.className='dm-material';element.dataset.dmMaterial=item.material;element.draggable=true;element.title=`${item.name} · ${item.material}`;element.setAttribute('aria-label',element.title);
            const image=document.createElement('img');image.src=item.path;image.alt='';image.loading='lazy';image.draggable=false;image.width=32;image.height=32;element.append(image);list.append(element);
        }
        this.root.querySelector('[data-dm-action="more"]').hidden=entries.length<=this.libraryLimit;
        if(!entries.length){const empty=document.createElement('p');empty.className='dm-hint';empty.textContent='Материал не найден. Custom ID можно задать в свойствах предмета.';list.append(empty);}
    }
    paintText(container,text){
        container.replaceChildren();
        for(const run of legacyTextRuns(text)){const span=document.createElement('span');span.textContent=run.text;if(run.color)span.style.color=run.color;if(run.bold)span.style.fontWeight='700';if(run.italic)span.style.fontStyle='italic';span.style.textDecoration=[run.underlined?'underline':'',run.strikethrough?'line-through':''].filter(Boolean).join(' ');container.append(span);}
    }

    sync(fields=true){
        const project=this.project();if(project?.type!=='deluxemenu')return;
        this.configurePlugin();
        const config=this.config(project),size=menuSize(config),type=config.inventory_type||'CHEST',slotIndex=this.slotIndex(config);
        this.selectedSlots=new Set([...this.selectedSlots].filter(slot=>slot<size));if(!this.selectedSlots.size)this.selectedSlots.add(0);
        this.activeSlot=Math.max(0,Math.min(this.activeSlot||0,size-1));
        const variants=slotIndex[this.activeSlot];
        if(!config.items[this.itemId])this.itemId=variants[0]?.[0]||null;
        this.paintText(this.get('menu-title'),config.menu_title);
        const grid=this.get('grid');grid.style.setProperty('--dm-columns',INVENTORIES[type].columns);grid.replaceChildren();
        for(let slot=0;slot<size;slot++){
            const entries=slotIndex[slot],entry=entries.find(([id])=>id===this.itemId)||entries[0];
            const cell=document.createElement('button');cell.type='button';cell.className='dm-slot';cell.dataset.dmSlot=slot;cell.tabIndex=slot===this.activeSlot?0:-1;cell.draggable=Boolean(entry);cell.setAttribute('aria-pressed',String(this.selectedSlots.has(slot)));
            const number=document.createElement('span');number.className='dm-slot-number';number.textContent=slot;cell.append(number);
            if(!entry&&config.fill_material){const fill=findMenuMaterial(config.fill_material);if(fill){const image=document.createElement('img');image.src=fill.path;image.alt='';image.draggable=false;cell.append(image);}else{const icon=document.createElement('i');icon.className='material-symbols-rounded';icon.setAttribute('aria-hidden','true');icon.textContent='help_outline';cell.append(icon);}cell.title='Предмет заполнения · '+config.fill_material;}
            if(entry){const material=findMenuMaterial(entry[1].material);if(material){const image=document.createElement('img');image.src=material.path;image.alt='';image.draggable=false;cell.append(image);}else{const icon=document.createElement('i');icon.className='material-symbols-rounded';icon.textContent='help_outline';cell.append(icon);}
                const materialLabel=String(entry[1].material).slice(0,96)+(String(entry[1].material).length>96?'…':'');
                cell.title=`${entry[0]} · ${materialLabel}${entries.length>1?` · ${entries.length} вариантов`:''}`;
                if(entry[1].enchantment_glint_override)cell.classList.add('dm-glint');
                if((entry[1].amount||1)>1){const count=document.createElement('span');count.className='dm-item-count';count.textContent=entry[1].amount;cell.append(count);}
                if(entries.length>1){const badge=document.createElement('span');badge.className='dm-variant-count';badge.textContent='+'+(entries.length-1);cell.append(badge);}
            }
            cell.setAttribute('aria-label',`Слот ${slot}${entry?`: ${entry[0]}, ${String(entry[1].material).slice(0,96)}`:', пусто'}`);grid.append(cell);
        }
        this.get('selection').textContent=`Слот ${this.activeSlot} · выбрано ${this.selectedSlots.size}`;
        this.get('layout-note').textContent=(type==='CHEST'?'Предпросмотр показывает выбранную кнопку. Условия и плейсхолдеры обрабатываются сервером.':'Показана схема номеров слотов. Их расположение в игре отличается. Условия обрабатываются сервером.')+(this.plugin()==='zmenu'?' Сохраните YAML в plugins/zMenu/inventories. Для открытия: /zm open <имя файла без .yml>. Команды-алиасы задаются отдельно в zMenu.':' Зарегистрируйте YAML в gui_menus файла plugins/DeluxeMenus/config.yml и выполните /dm reload.');
        this.get('item-fields').hidden=!config.items[this.itemId];this.get('empty').hidden=Boolean(config.items[this.itemId]);
        const chooser=this.get('variant');chooser.replaceChildren();
        for(const [id,item]of variants){const option=document.createElement('option');option.value=id;option.textContent=this.plugin()==='zmenu'?id:`${id} · приоритет ${item.priority??'не задан'}`;chooser.append(option);}chooser.value=this.itemId||'';chooser.disabled=!variants.length;chooser.closest('label').hidden=variants.length<2;
        const definitions=this.get('definitions');definitions.replaceChildren();
        for(const [id,item]of Object.entries(config.items)){const element=document.createElement('button');element.type='button';element.className='md-btn flat';element.dataset.dmDefinition=id;element.textContent=`${id} · ${itemSlots(item,size).join(', ')||'без слотов'}`;element.title=element.textContent;element.setAttribute('aria-current',String(id===this.itemId));definitions.append(element);}
        const tooltip=this.get('tooltip');tooltip.replaceChildren();const item=config.items[this.itemId];
        if(item){for(const text of [item.display_name||findMenuMaterial(item.material)?.name||item.material,...(item.lore||[])]){const line=document.createElement('div');this.paintText(line,text);tooltip.append(line);}}
        tooltip.hidden=!item;
        if(fields)this.syncFields();
        this.root.querySelector('[data-dm-action="undo"]').disabled=!this.app.history.undoStack.length;
        this.root.querySelector('[data-dm-action="redo"]').disabled=!this.app.history.redoStack.length;
        this.root.querySelector('[data-dm-action="copy"]').disabled=!item;this.root.querySelector('[data-dm-action="paste"]').disabled=!this.clipboard||this.clipboardPlugin!==this.plugin();
        this.root.querySelector('[data-dm-action="remove"]').disabled=![...this.selectedSlots].some(slot=>slotIndex[slot]?.length);
        this.status(`${MENU_PLUGINS[this.plugin()]} · ${Object.keys(config.items).length} кнопок · ${size} слотов · Ctrl+S — сохранить .mlst`);
    }

    configurePlugin(){
        const plugin=this.plugin(),zmenu=plugin==='zmenu';
        this.get('plugin').textContent=MENU_PLUGINS[plugin];this.get('preview-page-label').hidden=!zmenu;this.get('preview-page').value=this.previewPage;
        this.control('menu','open_command').closest('label').hidden=zmenu;
        this.control('menu','update_interval').closest('label').querySelector('span').textContent=zmenu?'Интервал обновления, мс':'Интервал обновления, секунд';
        this.control('item','priority').closest('label').hidden=zmenu;
        this.control('item','amount').type=zmenu?'text':'number';
        this.root.querySelector('[data-dm-action="variant"]').hidden=zmenu;
        this.control('ui','click').closest('label').hidden=zmenu;
        this.get('zmenu-settings').hidden=!zmenu;
        this.get('fill-settings').hidden=!zmenu;
        this.get('action-hint').textContent=zmenu?'Действия zMenu — список YAML с полем type. Можно добавить готовое действие и изменить его параметры.':'Одна команда на строку: [player] spawn, [message] &aПривет! Действия выполняются только на сервере.';
        for(const option of this.control('menu','inventory_type').options)option.disabled=zmenu&&option.value==='PLAYER';
        if(this.actionPlugin!==plugin){
            this.actionPlugin=plugin;
            this.control('ui','action').replaceChildren(...(zmenu?Object.entries(ZMENU_ACTIONS).map(([type,[label]])=>new Option(label,type)):ACTION_TYPES.map(type=>new Option(`[${type}]`,type))));
        }
    }

    syncFields(){
        const config=this.config(),item=config.items[this.itemId];
        this.root.querySelectorAll('[data-dm-scope]').forEach(control=>{
            const scope=control.dataset.dmScope,key=control.dataset.dmKey;if(scope==='ui')return;
            if(this.invalidFields.has(control))return;
            let value=scope==='menu'?config[key]:item?.[key];
            if(scope==='menu'&&key==='inventory_type')value??='CHEST';
            if(scope==='menu'&&key==='size'){value=config.size||54;control.disabled=(config.inventory_type||'CHEST')!=='CHEST';}
            if(item&&scope==='item'){
                if(key==='id')value=this.itemId;
                if(key==='slots')value=itemSlots(item,menuSize(config)).join(', ');
                if(key==='actions')value=this.plugin()==='zmenu'?(item._native?.actions?.length?stringifyConfigYaml(item._native.actions):''):item[this.control('ui','click').value]||[];
                if(key.startsWith('button_'))value=item._native?.[{button_type:'type',button_inventory:'inventory',button_page:'to-page'}[key]]??(key==='button_type'?'NONE':'');
                if(key==='amount')value??=1;
            }
            if(control.type==='checkbox')control.checked=Boolean(value);else control.value=Array.isArray(value)?value.join('\n'):value??'';
            control.removeAttribute('aria-invalid');
        });
        if(this.plugin()==='zmenu'){
            const type=item?._native?.type||'NONE';
            this.control('item','button_inventory').closest('label').hidden=type!=='INVENTORY';
            this.control('item','button_page').closest('label').hidden=type!=='JUMP';
        }
    }

    openCode(target){
        if(!this.codeDialog){
            const dialog=document.createElement('dialog');dialog.className='dm-code-dialog';dialog.setAttribute('aria-label','Редактор YAML');
            dialog.innerHTML=`<h2 id="dm-code-heading">Редактор YAML</h2><p class="dm-hint">Полная конфигурация выбранного плагина. Неизвестные визуальному редактору поля сохраняются. Комментарии YAML не сохраняются.</p><textarea id="dm-code" class="md-input" spellcheck="false" aria-label="Конфигурация YAML" maxlength="1048576"></textarea><p id="dm-code-error" role="status"></p><div class="dm-actions">${button('cancel-code','Отмена')}${button('apply-code','Применить')}</div>`;
            dialog.setAttribute('aria-labelledby','dm-code-heading');
            dialog.querySelector('[data-dm-action="apply-code"]').className='md-btn primary';
            document.body.append(dialog);this.codeDialog=dialog;
            dialog.addEventListener('keydown',event=>event.stopPropagation());
            dialog.addEventListener('click',event=>{
                const action=event.target.closest('[data-dm-action]')?.dataset.dmAction;
                if(action==='cancel-code')dialog.close();
                if(action==='apply-code'){
                    try{
                        if(this.project()?.id!==this.codeProjectId)throw new Error('Активный проект изменился.');
                        const value=parseConfigYaml(dialog.querySelector('textarea').value);
                        const config=copy(this.project().deluxeData);
                        if(this.codeTarget!=='menu'&&!Object.hasOwn(config.items,this.codeTarget))throw new Error('Кнопка уже удалена. Закройте окно и выберите другую.');
                        if(this.codeTarget!=='menu')config.items[this.codeTarget]=value;
                        const changed=this.replaceNative(this.codeTarget==='menu'?value:config,this.plugin());
                        if(changed)dialog.close();else throw new Error(this.get('status').textContent);
                    }catch(error){dialog.querySelector('#dm-code-error').textContent=error.message;}
                }
            });
        }
        this.codeTarget=target;this.codeProjectId=this.project().id;
        this.codeDialog.querySelector('h2').textContent=`${target==='menu'?'Конфигурация меню':'Настройки кнопки'} · ${MENU_PLUGINS[this.plugin()]}`;
        if(target==='menu')this.codeDialog.querySelector('textarea').value=exportMenuYaml(this.project().deluxeData,this.plugin());
        else this.codeDialog.querySelector('textarea').value=stringifyConfigYaml(this.project().deluxeData.items[target]);
        this.codeDialog.querySelector('#dm-code-error').textContent='';this.codeDialog.showModal();this.codeDialog.querySelector('textarea').focus();
    }

    replaceNative(config,plugin){
        if(this.commitPendingEdit()===false)return false;
        const project=this.project(),before=this.snapshot(project);
        const validated=validateMenuConfig(config,plugin);
        if(plugin===before.plugin&&JSON.stringify(validated)===JSON.stringify(before.config))return true;
        const previousItem=this.itemId;
        this.itemId=Object.hasOwn(validated.items,previousItem)?previousItem:null;
        const view=menuEditorView(validated,plugin),slots=this.itemId?itemSlots(view.items[this.itemId],menuSize(view)):[];
        this.selectedSlots=new Set(slots.length?slots:[0]);this.activeSlot=slots[0]??0;
        if(plugin!==this.plugin())this.previewPage=1;
        this.restore(project,{plugin,config:validated});
        this.pending={project,before};this.commitPendingEdit();this.sync();
        return true;
    }

    async importFile(){
        const input=document.createElement('input');input.type='file';input.accept='.yml,.yaml';const projectId=this.project().id;
        input.onchange=async()=>{
            const file=input.files[0];if(!file)return;
            try{if(file.size>1024*1024)throw new Error('YAML должен быть не больше 1 МБ.');const {config,plugin}=importMenuYaml(await file.text());if(this.project().id!==projectId)throw new Error('Вернитесь в исходную вкладку и повторите импорт.');this.replaceNative(config,plugin);}
            catch(error){this.showError(error.message);}
        };input.click();
    }
    async exportFile(){
        if(this.commitPendingEdit()===false)return false;
        const project=this.project();if(project?.type!=='deluxemenu')return false;
        try{
            const plugin=this.plugin(project),yaml=exportMenuYaml(project.deluxeData,plugin),name=(project.name||'menu').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')+'.yml';
            if(window.electronAPI){const result=await window.electronAPI.showSaveDialog({defaultPath:name,filters:[{name:`${MENU_PLUGINS[plugin]} YAML`,extensions:['yml','yaml']}]});if(result.canceled||!result.filePath)return false;await window.electronAPI.writeFile(result.filePath,yaml,'utf8');}
            else{const url=URL.createObjectURL(new Blob([yaml],{type:'text/yaml;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
            this.app.showToast(`Конфигурация ${MENU_PLUGINS[plugin]} экспортирована`,'check_circle');return true;
        }catch(error){this.app.showToast(error.message,'error');return false;}
    }
}
