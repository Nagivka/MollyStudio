import {numberFieldHTML,switchHTML,numberValue} from './Controls.mjs';
import {fileErrorMessage} from '../core/FileErrors.mjs';
import {recordFailure} from '../core/Performance.mjs';
import {bindAttribute, bindText} from '../core/Locale.mjs';
import {drawLayers} from '../graphics/LayerCompositing.js';
import {getExportRegion,prepareExportCanvas} from '../graphics/ExportImage.js';
import {safeFileStem,uniqueExportNames,parsePrefixList,planSpriteSheet} from '../graphics/ExportPlan.mjs';
import {createExportArchive} from '../graphics/ExportArchive.mjs';
import {inspectExportLayers} from '../graphics/ExportDiagnostics.mjs';
import {paintFittedPixelPreview,alignPixelPreview,watchPixelRatio} from '../graphics/PixelPreview.mjs';

const frame=()=>new Promise(resolve=>setTimeout(resolve,0));
const blobOf=canvas=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не удалось закодировать PNG.')),'image/png'));
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=24576)text+=String.fromCharCode(...bytes.subarray(i,i+24576));return btoa(text);};

export default class ExportPanel {
    constructor(app){this.app=app;this.options=null;this.busy=false;this.previewGeneration=0;this.titleOptions=new WeakMap();}

    create(){
        if(this.dialog)return;
        const dialog=document.createElement('dialog');dialog.className='export-dialog';dialog.setAttribute('aria-labelledby','export-heading');
        dialog.innerHTML=`<header><h2 id="export-heading"><!--i18n-->Экспорт изображений</h2><button type="button" class="md-icon-btn" data-export="close" aria-label="Закрыть экспорт" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C%20%D1%8D%D0%BA%D1%81%D0%BF%D0%BE%D1%80%D1%82"><i class="material-symbols-rounded" aria-hidden="true">close</i></button></header>
        <div class="export-body"><section class="export-controls" aria-label="Параметры экспорта" data-i18n-aria-label="%D0%9F%D0%B0%D1%80%D0%B0%D0%BC%D0%B5%D1%82%D1%80%D1%8B%20%D1%8D%D0%BA%D1%81%D0%BF%D0%BE%D1%80%D1%82%D0%B0">
        <label class="prop-field-block"><span><!--i18n-->Что экспортировать</span><select class="md-select" data-export="source"><option value="project"><!--i18n-->Весь проект</option><option value="active"><!--i18n-->Активный слой или группа</option><option value="selected"><!--i18n-->Выбранные слои отдельными PNG</option><option value="prefixes"><!--i18n-->Список префиксов</option></select></label>
        <div data-export="prefix-fields"><label class="prop-field-block"><span><!--i18n-->Блок, в котором менять текст</span><select class="md-select" data-export="block"></select></label><label class="prop-field-block"><span><!--i18n-->Названия — по одному в строке</span><textarea class="md-input" data-export="names" maxlength="13000" rows="5" placeholder="VIP&#10;PREMIUM&#10;ADMIN"></textarea></label><p class="prop-help-text"><!--i18n-->До 200 вариантов. Остальные блоки и оформление сохраняются.</p></div>
        <div data-export="title-fields" hidden>
            <div class="export-fields">${numberFieldHTML({label:'Ширина PNG',attribute:'data-export',attributeValue:'titleResolution',min:1,max:16384,value:2048})}
            <label class="prop-field-block"><span><!--i18n-->Форма изображения</span><select class="md-select" data-export="titleOutput"><option value="auto"><!--i18n-->По надписи</option><option value="square"><!--i18n-->Квадрат</option><option value="custom"><!--i18n-->Свой размер</option></select></label></div>
            <div data-export="title-height" hidden>${numberFieldHTML({label:'Высота PNG',attribute:'data-export',attributeValue:'titleHeight',min:1,max:16384,value:1152})}</div>
        </div>
        <div class="export-fields" data-export="format-fields"><label class="prop-field-block"><span><!--i18n-->Масштаб PNG</span><select class="md-select" data-export="scale">${[1,2,3,4,8,16].map(n=>`<option value="${n}">${n}×</option>`).join('')}</select></label><select hidden aria-hidden="true" data-export="format"><option value="png"><!--i18n-->Одно изображение PNG</option><option value="zip"><!--i18n-->Архив с PNG</option><option value="sheet"><!--i18n-->Спрайт-лист в архиве</option></select></div>
        ${switchHTML("data-export","Обрезать прозрачные поля",false,"trim")}
        <div class="export-fields" data-export="sheet-fields">${numberFieldHTML({label:"Столбцы",attribute:"data-export",attributeValue:"columns",min:1,max:32,value:4})}${numberFieldHTML({label:"Промежуток, px",attribute:"data-export",attributeValue:"gap",min:0,max:64,value:1})}</div>
        <input type="hidden" data-export="prefix" value="">
        ${switchHTML("data-export","Добавлять порядковый номер",false,"numbered")}
        </section><section class="export-preview" aria-label="Предпросмотр результата" data-i18n-aria-label="%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D1%81%D0%BC%D0%BE%D1%82%D1%80%20%D1%80%D0%B5%D0%B7%D1%83%D0%BB%D1%8C%D1%82%D0%B0%D1%82%D0%B0"><div class="export-image-box"><canvas data-export="canvas"></canvas></div><output data-export="dimensions" role="status"></output><p class="prop-help-text" data-export="description"></p><ol data-export="files" aria-label="Примеры имён файлов" data-i18n-aria-label="%D0%9F%D1%80%D0%B8%D0%BC%D0%B5%D1%80%D1%8B%20%D0%B8%D0%BC%D1%91%D0%BD%20%D1%84%D0%B0%D0%B9%D0%BB%D0%BE%D0%B2"></ol></section></div>
        <p data-export="error" class="export-error" role="alert" hidden></p><div data-export="progress-panel" hidden><progress data-export="progress" max="1" value="0"></progress><p data-export="status" role="status"></p></div>
        <footer><button type="button" class="md-btn outlined" data-export="cancel"><!--i18n-->Закрыть</button><button type="button" class="md-btn primary" data-export="save"><i class="material-symbols-rounded" aria-hidden="true">download</i><!--i18n--> Сохранить</button></footer>`;
        document.body.append(dialog);this.dialog=dialog;
        const imageBox=dialog.querySelector('.export-image-box');let layoutKey='';
        const resized=()=>{
            const key=[imageBox.clientWidth,devicePixelRatio,innerWidth<=640].join(':');
            if(key===layoutKey)return;layoutKey=key;
            if(dialog.open&&this.context&&!this.busy){clearTimeout(this.previewTimer);this.previewTimer=setTimeout(()=>this.preview(),80);}
        };
        this.previewObserver=new ResizeObserver(resized);this.previewObserver.observe(imageBox);watchPixelRatio(resized);
        dialog.addEventListener('scroll',()=>alignPixelPreview(this.get('canvas')),{capture:true,passive:true});
        this.warnings=document.createElement('ul');this.warnings.className='export-warnings';bindAttribute(this.warnings, "aria-label", 'Проверка перед экспортом');this.warnings.hidden=true;
        this.get('error').before(this.warnings);
        this.get('close').addEventListener('click',()=>this.close());this.get('cancel').addEventListener('click',()=>this.close());
        this.get('save').addEventListener('click',()=>this.run());
        dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
        dialog.addEventListener('close',()=>{if(dialog.open)return;clearTimeout(this.previewTimer);this.previewGeneration++;this.context=null;const canvas=this.get('canvas');canvas.width=canvas.height=1;this.returnFocus?.isConnected&&this.returnFocus.focus({preventScroll:true});});
        dialog.addEventListener('input',()=>{clearTimeout(this.previewTimer);this.previewTimer=setTimeout(()=>this.preview(),90);});
        dialog.addEventListener('change',()=>{clearTimeout(this.previewTimer);this.preview();});
    }

    get(key){return this.dialog.querySelector(`[data-export="${key}"]`);}

    async open(source='project',repeat=false){
        if(this.busy)return false;
        if(this.app.tools.finishDocument({preserveSelection:true})===false||this.app.prefixEditor?.commitPendingEdit?.()===false)return false;
        this.create();const project=this.app.getActiveProject();if(!project)return false;
        try {
            // Export composites the live layers, so it does not need MLST PNG caches.
            await this.app.projectManager.prepareProject(project, {encodeImages: false});
        } catch (error) {
            this.app.showToast(error.message, 'error');
            return false;
        }
        if (this.app.getActiveProject() !== project || this.busy) return false;
        // The user can start another gesture while the template or fonts load.
        if (this.app.tools.finishDocument({preserveSelection: true}) === false ||
            this.app.prefixEditor?.commitPendingEdit?.() === false) return false;
        this.context={id:project.id,revision:this.app.projectManager.getRevision(project.id),name:project.name,type:project.type,layers:[...this.app.layerManager.getLayers()],config:{...this.app.config},prefixData:project.type==='prefix'?structuredClone(project.prefixData):null,titleData:project.type==='title'?structuredClone(project.titleData):null,selected:[...this.app.layerManager.selectedLayerIds],active:this.app.layerManager.activeLayerId};
        const controls=this.get('source');controls.querySelector('[value="prefixes"]').hidden=project.type!=='prefix';
        for(const key of ['active','selected'])controls.querySelector(`[value="${key}"]`).hidden=['prefix','title'].includes(project.type);
        const defaults={source,scale:project.type==='title'?1:this.app.settingsManager.get('exportScale')||1,trim:this.app.settingsManager.get('exportTrim')===true,format:source==='selected'?'zip':'png',columns:4,gap:1,prefix:'',numbered:false,names:'',block:this.app.prefixEditor?.selected||0,
            titleResolution:project.titleData?.resolution||2048,titleHeight:project.titleData?.outputHeight||1152,titleOutput:project.titleData?.output||'auto',titlePadding:project.titleData?.padding??24,...this.titleOptions.get(project)};
        const options=repeat&&this.last?{...defaults,...this.last}:defaults;
        options.source='project';options.format='png';options.prefix='';options.numbered=false;
        if(project.type==='title'){options.scale=1;options.trim=false;}
        if(project.type!=='prefix'&&options.source==='prefixes')options.source='project';
        if(['prefix','title'].includes(project.type)&&['active','selected'].includes(options.source))options.source='project';
        const block=this.get('block');block.replaceChildren();
        project.prefixData?.blocks.forEach((item,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=`${index+1}. ${item.text||'Без текста'}`;block.append(option);});
        for(const [key,value] of Object.entries(options)){const control=this.get(key);if(control)control.type==='checkbox'?control.checked=value:control.value=String(value);}
        this.dialog.classList.toggle('title-export',project.type==='title');
        this.get('title-fields').hidden=project.type!=='title';
        this.get('scale').closest('label').hidden=project.type==='title';
        this.get('source').closest('label').hidden=true;
        this.get('trim').closest('label').hidden=project.type==='title';
        this.returnFocus=document.activeElement;this.get('error').hidden=true;this.get('progress-panel').hidden=true;
        if(!this.dialog.open)this.dialog.showModal();this.get(project.type==='title'?'titleResolution':'source').focus();await this.preview();return true;
    }

    read(){
        this.get('source').value='project';
        this.get('numbered').checked=false;
        this.get('format').value=['selected','prefixes'].includes(this.get('source').value)?'zip':'png';
        this.get('prefix').value='';
        if(this.get('format').value==='sheet')for(const key of ['columns','gap'])if(numberValue(this.get(key))===null)throw Error('Проверьте числовые параметры экспорта.');
        this.get('numbered').closest('label').hidden=!['selected','prefixes'].includes(this.get('source').value);
        const result={};for(const key of ['source','scale','trim','format','columns','gap','prefix','numbered','names','block']){const input=this.get(key);result[key]=input.type==='checkbox'?input.checked:input.value;}
        for(const key of ['scale','columns','gap','block'])result[key]=Number(result[key]);
        if(this.context?.type==='title'){
            result.source='project';result.scale=1;result.trim=false;
            result.titleResolution=numberValue(this.get('titleResolution'));result.titleOutput=this.get('titleOutput').value;
            result.titleHeight=result.titleOutput==='custom'?numberValue(this.get('titleHeight')):1152;
            result.titlePadding=24;
            if(result.titleResolution===null||result.titleHeight===null||!['auto','square','custom'].includes(result.titleOutput))throw Error('Проверьте числовые параметры экспорта.');
        }
        return result;
    }

    entries(options){
        const context=this.context;
        if(options.source==='prefixes'){
            if(context.type!=='prefix')throw Error('Откройте проект префикса.');
            const list=parsePrefixList(options.names);if(!context.prefixData.blocks[options.block])throw Error('Выберите блок префикса.');
            return list.map(text=>({name:text,text}));
        }
        if(options.source==='project')return [{name:context.name}];
        const selected=new Set(options.source==='active'?[context.active]:context.selected),byId=new Map(context.layers.map(l=>[l.id,l]));
        const result=context.layers.filter(layer=>selected.has(layer.id)).filter(layer=>{
            if(options.source==='active')return true;
            const visited=new Set();let parent=layer.groupId;
            while(parent&&!visited.has(parent)){if(selected.has(parent))return false;visited.add(parent);parent=byId.get(parent)?.groupId;}return true;
        }).map(layer=>({name:layer.name,id:layer.id}));
        if(!result.length)throw Error('Нет выбранных слоёв для экспорта.');return result;
    }

    source(entry,options,preview=false){
        this.assertContext();
        const c=this.context;
        if(c.type==='title'){
            const result=this.app.titleEditor.renderer.render({...c.titleData,
                resolution:options.titleResolution??c.titleData.resolution,outputHeight:options.titleHeight??c.titleData.outputHeight,output:options.titleOutput??c.titleData.output,padding:options.titlePadding??c.titleData.padding},{maxSize:preview?640:null});
            result.canvas.dataset.exportWidth=String(result.width);result.canvas.dataset.exportHeight=String(result.height);return result.canvas;
        }
        if(options.source==='prefixes'){
            const data=structuredClone(c.prefixData);data.blocks[options.block].text=entry.text;
            return this.app.prefixEditor.renderer.render(data).canvas;
        }
        const canvas=document.createElement('canvas');canvas.width=c.config.width;canvas.height=c.config.height;
        let exclude=new Set();
        if(entry.id){
            const included=new Set([entry.id]),children=new Map();for(const layer of c.layers){if(!children.has(layer.groupId))children.set(layer.groupId,[]);children.get(layer.groupId).push(layer);}
            const stack=[entry.id];while(stack.length){const id=stack.pop();for(const child of children.get(id)||[])if(!included.has(child.id)){included.add(child.id);stack.push(child.id);}}
            exclude=new Set(c.layers.filter(layer=>!included.has(layer.id)).map(layer=>layer.id));
        }
        try { drawLayers(canvas.getContext('2d',{willReadFrequently:true}),c.layers,{exclude});return canvas; }
        catch (error) { canvas.width=canvas.height=1;throw error; }
    }

    assertContext(){
        if(!this.context||this.app.activeProjectId!==this.context.id||this.app.projectManager.getRevision(this.context.id)!==this.context.revision)throw Error('Проект изменился. Закройте и откройте экспорт заново.');
    }

    async preview(){
        if(!this.context||this.busy)return;
        const generation=++this.previewGeneration;this.get('error').hidden=true;this.get('save').disabled=true;
        // Reveal the fields before validating them, so an invalid hidden value
        // can be corrected immediately after switching export formats.
        this.get('prefix-fields').hidden=this.get('source').value!=='prefixes';
        this.get('title-height').hidden=this.context.type!=='title'||this.get('titleOutput').value!=='custom';
        this.get('sheet-fields').hidden=true;
        let previewSource=null;
        try{
            let options=this.read();
            this.get('prefix-fields').hidden=options.source!=='prefixes';
            this.get('sheet-fields').hidden=options.format!=='sheet';
            const entries=this.entries(options),multiple=entries.length>1||['selected','prefixes'].includes(options.source);
            const diagnostics=this.context.type==='title'?[]:inspectExportLayers(this.context.layers,this.context.config,
                ['active','selected'].includes(options.source)?entries.map(entry=>entry.id):null);
            if(this.context.type!=='title'&&this.app.layerManager.isolatedLayerId)diagnostics.unshift('Включена изоляция. Экспорт учитывает обычную видимость всех слоёв проекта.');
            this.warnings.replaceChildren(...diagnostics.map(message=>{const li=document.createElement('li');bindText(li,message);return li;}));
            this.warnings.hidden=!diagnostics.length;
            this.get('format').querySelector('[value="png"]').disabled=multiple;
            if(multiple&&options.format==='png'){this.get('format').value='zip';options=this.read();}
            if(options.source==='prefixes'){await this.app.prefixEditor.renderer.load();}
            if(generation!==this.previewGeneration||!this.context)return;
            const source=previewSource=this.source(entries[0],options,true),region=getExportRegion(source,options.trim),width=(Number(source.dataset.exportWidth)||region.width)*options.scale,height=(Number(source.dataset.exportHeight)||region.height)*options.scale;
            if(width>16384||height>16384||width*height>64*1024*1024)throw Error('Результат слишком велик. Уменьшите масштаб.');
            const preview=this.get('canvas'),box=this.dialog.querySelector('.export-image-box'),boxStyle=getComputedStyle(box);
            const maxWidth=Math.max(1,Math.min(parseFloat(boxStyle.getPropertyValue('--layout-preview-width'))||400,box.clientWidth-parseFloat(boxStyle.paddingLeft)-parseFloat(boxStyle.paddingRight))),maxHeight=parseFloat(boxStyle.getPropertyValue('--layout-preview-height'))||270;
            if(this.context.type==='title'){
                const fit=Math.min(maxWidth/source.width,maxHeight/source.height),ratio=devicePixelRatio||1;
                preview.width=Math.max(1,Math.round(source.width*fit*ratio));preview.height=Math.max(1,Math.round(source.height*fit*ratio));
                const ctx=preview.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,preview.width,preview.height);
                preview.style.width=preview.width/ratio+'px';preview.style.height=preview.height/ratio+'px';alignPixelPreview(preview);
            }else paintFittedPixelPreview(preview,source,{region,maxWidth,maxHeight});
            source.width=source.height=1;preview.style.aspectRatio=preview.width+'/'+preview.height;
            Promise.allSettled(this.dialog.getAnimations().map(animation=>animation.finished)).then(()=>{if(this.dialog.open)alignPixelPreview(preview);});
            let resultWidth=width,resultHeight=height;
            if(options.format==='sheet'){
                const sizes=[{width,height}];
                for(const entry of entries.slice(1)){
                    await frame();if(generation!==this.previewGeneration||!this.context)return;
                    const image=previewSource=this.source(entry,options),bounds=getExportRegion(image,options.trim);image.width=image.height=1;
                    sizes.push({width:bounds.width*options.scale,height:bounds.height*options.scale});
                }
                const plan=planSpriteSheet(sizes,options);resultWidth=plan.width;resultHeight=plan.height;
            }
            this.get('dimensions').textContent=`${resultWidth} × ${resultHeight} px${entries.length>1?` · ${entries.length} изображений`:''}`;
            bindText(this.get('description'), options.format==='sheet'?'На превью — первый элемент; выше — полный размер спрайт-листа. Архив содержит PNG и JSON с координатами.':options.format==='zip'?'Архив содержит PNG и JSON с размерами. Для каждого изображения обрезка рассчитывается отдельно.':'PNG сохраняет прозрачность; шахматный фон в файл не входит.');
            const names=uniqueExportNames(entries.map(e=>e.name),options),list=this.get('files');list.replaceChildren();
            for(const name of (options.format==='sheet'?['sprites.png','manifest.json']:names.slice(0,5))){const li=document.createElement('li');li.textContent=name;list.append(li);}
            this.get('sheet-fields').hidden=options.format!=='sheet';this.get('save').disabled=false;
            if(this.context.type==='title')this.titleOptions.set(this.app.getActiveProject(),{titleResolution:options.titleResolution,titleHeight:this.get('titleHeight').value,titleOutput:options.titleOutput,titlePadding:options.titlePadding});
        }catch(error){if(generation===this.previewGeneration){bindText(this.get('error'), error.message);this.get('error').hidden=false;}}
        finally{if(previewSource)previewSource.width=previewSource.height=1;}
    }

    close(){if(this.writing)return;if(this.busy){this.cancelled=true;bindText(this.get('status'), 'Отмена после текущего изображения…');return;}this.dialog.close();}

    assertRunning(){
        if(this.cancelled)throw new DOMException('Экспорт отменён.','AbortError');
        this.assertContext();
    }

    async run(){
        if(this.busy||!this.context)return false;
        this.busy=true;this.cancelled=false;this.previewGeneration++;this.get('error').hidden=true;
        const controls=[...this.dialog.querySelectorAll('input,select,textarea,[data-export="save"]')],disabled=controls.map(c=>c.disabled);controls.forEach(c=>c.disabled=true);
        bindText(this.get('cancel'), 'Отменить');this.get('progress-panel').hidden=false;
        let sheet=null;
        try{
            const options=this.read(),entries=this.entries(options),names=uniqueExportNames(entries.map(e=>e.name),options),files=[],manifest={version:1,images:[]};
            let payloadBytes=0,sheetItems=[];
            for(let index=0;index<entries.length;index++){
                this.assertRunning();
                bindText(this.get('status'), "Подготовка {0} из {1}: {2}", {0: index+1, 1: entries.length, 2: names[index]});this.get('progress').value=index/entries.length;await frame();
                this.assertRunning();
                const source=this.source(entries[index],options);let output;
                try{
                    const region=getExportRegion(source,options.trim);output=prepareExportCanvas(source,{scale:options.scale,region});
                    source.width=source.height=1;
                    const blob=await blobOf(output);this.assertRunning();payloadBytes+=blob.size;
                    if(payloadBytes>96*1024*1024)throw Error('Набор превышает 96 МБ. Экспортируйте меньшими частями.');
                    manifest.images.push({file:names[index],width:output.width,height:output.height,sourceX:region.x,sourceY:region.y});
                    if(options.format==='sheet')sheetItems.push({width:output.width,height:output.height,blob});
                    else files.push({name:names[index],data:new Uint8Array(await blob.arrayBuffer())});
                }finally{source.width=source.height=1;if(output)output.width=output.height=1;}
            }
            let bytes,extension;
            if(options.format==='sheet'){
                const plan=planSpriteSheet(sheetItems,options);sheet=document.createElement('canvas');sheet.width=plan.width;sheet.height=plan.height;const ctx=sheet.getContext('2d');ctx.imageSmoothingEnabled=false;
                for(let index=0;index<sheetItems.length;index++){
                    this.assertRunning();
                    bindText(this.get('status'), "Компоновка спрайт-листа: {0} из {1}", {0: index+1, 1: sheetItems.length});await frame();
                    this.assertRunning();
                    const bitmap=await createImageBitmap(sheetItems[index].blob);
                    try{this.assertRunning();ctx.drawImage(bitmap,plan.frames[index].x,plan.frames[index].y);}finally{bitmap.close();sheetItems[index].blob=null;}
                    Object.assign(manifest.images[index],plan.frames[index]);
                }
                manifest.sheet={file:'sprites.png',width:plan.width,height:plan.height,columns:plan.columns,gap:plan.gap};
                bytes=createExportArchive([{name:'sprites.png',data:new Uint8Array(await (await blobOf(sheet)).arrayBuffer())},{name:'manifest.json',data:JSON.stringify(manifest,null,2)}]);extension='zip';
            }else if(options.format==='zip'||entries.length>1){bytes=createExportArchive([...files,{name:'manifest.json',data:JSON.stringify(manifest,null,2)}]);extension='zip';}
            else{bytes=files[0].data;extension='png';}
            this.assertRunning();
            bindText(this.get('status'), 'Выберите место сохранения');this.get('progress').value=1;
            const filename=extension==='png'?names[0]:safeFileStem(this.context.name)+'_export.zip';
            const saved=await this.saveBytes(bytes,filename,extension);
            if(!saved){bindText(this.get('status'), 'Сохранение отменено. Файл не записан.');return false;}
            this.last={...options};bindText(this.get('status'), "Сохранено {0} изображений: {1}", {0: entries.length, 1: saved});this.app.showToast('Экспорт завершён','check_circle');return {file:saved,count:entries.length,manifest};
        }catch(error){bindText(this.get('status'), error.name==='AbortError'?'Экспорт отменён.': 'Экспорт не завершён.');if(error.name!=='AbortError'){bindText(this.get('error'), error.message);this.get('error').hidden=false;}return false;}
        finally{if(sheet)sheet.width=sheet.height=1;this.busy=false;this.writing=false;controls.forEach((c,index)=>c.disabled=disabled[index]);bindText(this.get('cancel'), 'Закрыть');}
    }

    async saveBytes(bytes,name,extension){
        const api=window.desktopAPI;
        if(api){
            const result=await api.showSaveDialog({title:'Экспорт изображений',defaultPath:name,filters:[{name:extension==='png'?'Изображение PNG':'Архив ZIP',extensions:[extension]}]});
            if(result.canceled||!result.filePath||this.cancelled)return false;
            this.writing=true;
            try{bindText(this.get('status'), 'Запись файла…');await api.writeFile(result.filePath,base64(bytes),'base64');return result.filePath.split(/[\\/]/).pop();}
            catch(error){recordFailure('export',error);throw new Error(fileErrorMessage(error,'export'));}
            finally{this.writing=false;}
        }
        const url=URL.createObjectURL(new Blob([bytes],{type:extension==='png'?'image/png':'application/zip'}));
        try{const a=document.createElement('a');a.href=url;a.download=name;a.click();return name;}
        finally{setTimeout(()=>URL.revokeObjectURL(url),30000);}
    }
}
