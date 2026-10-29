import { preparePngExport } from '../graphics/ExportImage.js';
import { estimateCommandBytes, estimateHistoryBytes } from '../core/History.js';
import { DrawCommand, TextDataCommand, ResizeCanvasCommand, TemplateCommand } from '../core/Commands.js';
import Layer from '../graphics/Layer.js';
import { editLayerPixels, restoreLayerSnapshot } from '../graphics/LayerEdit.mjs';

/** App-facing controller methods; document serialization lives in core. */
export default class CanvasDocumentController {
    resizeCanvas(newWidth, newHeight, anchorX = 'center', anchorY = 'center', isScale = false) {
        newWidth = Math.max(1, Math.min(4096, parseInt(newWidth, 10) || 256));
        newHeight = Math.max(1, Math.min(4096, parseInt(newHeight, 10) || 256));

        if (newWidth === this.config.width && newHeight === this.config.height) {
            return;
        }

        if (this.tools.finishDocument() === false) return;
        const masterPixels = this.layerManager.layers.reduce((sum, layer) => sum + (layer.sourceCanvas
            ? layer.sourceCanvas.width * layer.sourceCanvas.height
            : isScale && layer.type === 'bitmap' ? layer.width * layer.height : 0), 0);
        if (newWidth * newHeight * Math.max(1, this.layerManager.layers.length) + masterPixels > 64 * 1024 * 1024) {
            this.showToast('Слишком большой холст для этого числа слоёв.', 'error'); return;
        }
        const beforeSize = { width: this.config.width, height: this.config.height };
        const beforeLayers = this.layerManager.layers.map(layer => ({ layer, data: layer.getImageData() }));
        const proj = this.getActiveProject();
        let afterLayers;
        try {
            afterLayers=this.layerManager.resizeCanvas(newWidth, newHeight, anchorX, anchorY, isScale, proj?.bg, beforeLayers, false);
        } catch (error) {
            this.showToast(error.message || 'Не удалось изменить размер холста.', 'error');
            return false;
        }
        this.config.width = newWidth;
        this.config.height = newHeight;
        if (proj) { proj.config.width = newWidth; proj.config.height = newHeight; }
        this.renderer.resize(newWidth, newHeight);
        this.history.push(new ResizeCanvasCommand(this, beforeSize, { width: newWidth, height: newHeight },
            beforeLayers.map(({ layer, data },index) => new DrawCommand(layer, data, afterLayers[index].data))));

        this.updateProjectTypeUI(proj);

        this.layerPanel?.render();
        this.bus.emit('CANVAS_UPDATED');
        this.workspace.updateTransform();
        this.workspace.fitToScreen();

        this.showToast(`Размер холста: ${newWidth} × ${newHeight} px`, 'aspect_ratio');
        this.updateDiscordPresence();
    }

    loadTemplate(filename, projectName = null) {
        const project = this.getActiveProject();
        if (!project || project.type !== 'gui' || this.tools.finishDocument() === false) return Promise.resolve(false);
        const token = Symbol('template-load');
        project.templateLoadToken = token;
        project.templateLoadPromise = (async () => {
            try {
                let image = null;
                if (filename !== 'none') {
                    image = new Image();
                    await new Promise((resolve, reject) => {
                        image.onload = resolve;
                        image.onerror = () => reject(new Error('Не удалось загрузить шаблон.'));
                        image.src = filename.startsWith('assets/') ? filename
                            : filename.startsWith('gui_container/') ? `assets/${filename}` : `assets/images/${filename}`;
                    });
                }
                if (!this.projects.includes(project) || project.templateLoadToken !== token) return false;
                const active = this.activeProjectId === project.id;
                if (active && this.tools.finishDocument() === false) return false;
                const width = image?.naturalWidth || project.config.width, height = image?.naturalHeight || project.config.height;
                const oldLayers = [...(active ? this.layerManager.layers : project.layers)];
                if (!width || !height || width > 4096 || height > 4096 || width * height * Math.max(1, oldLayers.length) > 64 * 1024 * 1024) throw new Error('Шаблон слишком велик для этого проекта.');
                const metadata = () => ({ config: {...project.config}, templateName: project.templateName, templatePath: project.templatePath, hasFrame: project.hasFrame });
                const before = metadata();
                const snapshots = oldLayers.map(layer => ({layer, data: layer.getImageData()}));
                let base = oldLayers.find(layer => layer.isBase);
                const newLayers = [...oldLayers];
                if (!base) {
                    base = new Layer(`base_${crypto.randomUUID()}`, 'Заготовка GUI', width, height);
                    base.isBase = true; newLayers.unshift(base);
                }
                let edits;
                try {
                    for (const layer of newLayers) layer.resize(width, height);
                    base.ctx.clearRect(0, 0, width, height);
                    if (image) base.ctx.drawImage(image, 0, 0);
                    base.invalidateSource();
                    edits = snapshots.map(({layer, data}) => new DrawCommand(layer, data, layer.getImageData()));
                } catch (error) {
                    const failures = [];
                    for (const {layer, data} of snapshots) {
                        try { restoreLayerSnapshot(layer, data); } catch (failure) { failures.push(failure); }
                    }
                    if (!oldLayers.includes(base)) {
                        base.releaseRenderCache();
                        base.canvas.width = base.canvas.height = base.thumbCanvas.width = base.thumbCanvas.height = 1;
                    }
                    if (failures.length) throw new AggregateError([error, ...failures], 'Не удалось восстановить слои после ошибки шаблона.', {cause: error});
                    throw error;
                }
                project.config = {width, height};
                if (projectName) project.name = projectName;
                project.templatePath = filename === 'none' ? null : filename;
                const match = filename.match(/container_\d+/);
                project.templateName = filename === 'none' ? null : match ? match[0] : filename.replace(/\.png$/, '').split('/').pop();
                project.hasFrame = filename.includes('_frame');
                project.layers = newLayers;
                const command = new TemplateCommand(this, project, before, metadata(), oldLayers, newLayers, edits);
                command.restore(command.after, newLayers);
                if (projectName === null) {
                    if (active) this.history.push(command);
                    else {
                        command.historyMemoryBytes = estimateCommandBytes(command);
                        project.redoStack = [];
                        if (command.historyMemoryBytes > this.history.memoryBudgetBytes) project.undoStack = [];
                        else {
                            project.undoStack.push(command);
                            while (project.undoStack.length > this.history.limit || estimateHistoryBytes(project.undoStack) > this.history.memoryBudgetBytes) project.undoStack.shift();
                        }
                    }
                }
                if (active) this.saveProjectState();
                else this.projectManager?.queueAutosave(project.id);
                this.renderTabs();
                return true;
            } catch (error) {
                this.showToast(error.message || 'Не удалось применить шаблон.', 'error');
                return false;
            }
        })();
        return project.templateLoadPromise;
    }

    prepareTemplateModal() {
        const curProj = this.getActiveProject();
        if (!curProj) return;

        const tplSelect = document.getElementById('proj-template');
        const tplFrameSelect = document.getElementById('proj-frame');
        const tplStyleSelect = document.getElementById('proj-style');

        const path = curProj.templatePath || '';
        if (tplStyleSelect) tplStyleSelect.value = path.includes('container/bedrock/') ? 'bedrock' : 'default';
        if (path.includes('gui_container/')) {
            const clean = path.startsWith('assets/') ? path.replace('assets/', '') : path;
            if (tplSelect) tplSelect.value = clean;
        } else {
            if (tplSelect && curProj.templateName) {
                tplSelect.value = curProj.templateName;
            }

            if (tplFrameSelect) {
                tplFrameSelect.value = curProj.hasFrame ? 'yes' : 'no';
            }
        }

        tplSelect?.dispatchEvent(new Event('change'));
    }

async exportPNG() {
        if (this.tools?.finishDocument({ preserveSelection: true }) === false) return;
        let dataUrl = this.renderer.exportToPNG();
        if (!dataUrl) return;

        const activeProj = this.projects.find(project => project.id === this.activeProjectId);
        try {
            dataUrl = await preparePngExport(dataUrl, { scale: this.settingsManager?.get('exportScale') || 1, trim: this.settingsManager?.get('exportTrim') === true });
        } catch (error) { this.showToast(error.message, 'error'); return; }

        const safeName = (activeProj ? activeProj.name : 'molly_gui').replace(/[\\/:*?"<>|]/g, '_') + '.png';

        if (window.desktopAPI) {
            const bridge = window.DesktopBridge || window.desktopAPI;
            try {
                const result = await bridge.showSaveDialog({
                    title: 'Экспорт в PNG',
                    defaultPath: safeName,
                    filters: [
                        { name: 'PNG Image (*.png)', extensions: ['png'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ]
                });
                if (!result.canceled && result.filePath) {
                    if (window.DesktopBridge?.exportPng) {
                        await window.DesktopBridge.exportPng(result.filePath, dataUrl);
                    } else if (window.desktopAPI?.writeFile) {
                        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                        await window.desktopAPI.writeFile(result.filePath, base64Data, 'base64');
                    }
                    this.showToast(`Экспортировано: ${result.filePath.split(/[\\/]/).pop()}`, 'image');
                    return;
                }
                return;
            } catch (err) {
                console.error('Ошибка экспорта в PNG:', err);
                this.showToast('Ошибка при экспорте PNG!', 'error');
                return;
            }
        }

        // Web fallback
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = safeName;
        a.click();
        this.showToast(`Экспорт: ${safeName}`, 'image');
    }

async exportActiveLayerPNG() {
        if (this.tools?.finishDocument({ preserveSelection: true }) === false) return;
        const active = this.layerManager.getActiveLayer();
        if (!active) return;
        let dataUrl = this.renderer.exportLayerToPNG(active.id);
        if (!dataUrl) return;
        try {
            dataUrl = await preparePngExport(dataUrl, { scale: this.settingsManager?.get('exportScale') || 1, trim: this.settingsManager?.get('exportTrim') === true });
        } catch (error) { this.showToast(error.message, 'error'); return; }

        const safeName = (active.name || 'layer').replace(/[\\/:*?"<>|]/g, '_') + '.png';

        if (window.desktopAPI) {
            const bridge = window.DesktopBridge || window.desktopAPI;
            try {
                const result = await bridge.showSaveDialog({
                    title: 'Экспорт активного слоя в PNG',
                    defaultPath: safeName,
                    filters: [
                        { name: 'PNG Image (*.png)', extensions: ['png'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ]
                });
                if (!result.canceled && result.filePath) {
                    if (window.DesktopBridge?.exportPng) {
                        await window.DesktopBridge.exportPng(result.filePath, dataUrl);
                    } else if (window.desktopAPI?.writeFile) {
                        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                        await window.desktopAPI.writeFile(result.filePath, base64Data, 'base64');
                    }
                    this.showToast(`Экспортирован слой: ${safeName}`, 'image');
                    return;
                }
                return;
            } catch (err) {
                console.error('Ошибка экспорта слоя в PNG:', err);
                this.showToast('Ошибка при экспорте слоя!', 'error');
                return;
            }
        }

        // Web fallback
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = safeName;
        a.click();
        this.showToast(`Экспорт слоя: ${safeName}`, 'image');
    }

    clearActiveLayer() {
        if(this.tools.finishDocument({preserveSelection:true})===false)return false;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.layerManager.isEditable(layer) || layer.isBase || layer.isGroup || layer.alphaLocked) return;
        try{
            if(layer.type==='text'&&layer.textData){
                if(!layer.textData.text)return false;
                const command=new TextDataCommand(layer,layer.textData,{...layer.textData,text:''},this.bus);
                command.name='Очистить текст';command.execute();this.history.push(command);
            }else{
                const {before,after}=editLayerPixels(layer,()=>{layer.clear(true);layer.shapeData=null;});
                this.history.push(new DrawCommand(layer,before,after,'Очистить слой','delete_sweep'));
            }
            this.bus.emit('CANVAS_UPDATED');return true;
        }catch(error){
            console.error('Failed to clear layer:',error);this.showToast('Не удалось очистить слой.','error');this.bus.emit('CANVAS_UPDATED');return false;
        }
    }

    recolorActiveLayer(hexColor) {
        const color = hexColor || this.tools?.color || '#3B82F6';
        if(typeof color!=='string'||!/^#[\da-f]{6}$/i.test(color))return false;
        if(this.tools.finishDocument({preserveSelection:true})===false)return false;
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.layerManager.isEditable(layer) || layer.isBase || layer.isGroup) return;
        if (layer.shapeData) return this.editShapeLayer(layer, { color });

        if (layer.type === 'text' && layer.textData) {
            try{
                const next={...layer.textData,colorMode:'solid',color:color.toUpperCase()};
                if(next.shadowMode!=='custom')next.shadowColor=this.tools.tools.text.computeShadowColor(color);
                const command=new TextDataCommand(layer,layer.textData,next,this.bus);
                command.name='Перекрасить текст';command.execute();this.history.push(command);
                this.tools.tools.text.syncUIWithLayer(layer);return true;
            }catch(error){console.error('Failed to recolor text:',error);this.showToast('Не удалось перекрасить текст.','error');return false;}
        }
        try{
            const {before,after}=editLayerPixels(layer,()=>{
                layer.ctx.save();
                try{layer.ctx.globalCompositeOperation='source-in';layer.ctx.fillStyle=color;layer.ctx.fillRect(0,0,layer.width,layer.height);}
                finally{layer.ctx.restore();}
                layer.invalidateSource();
            });
            this.history.push(new DrawCommand(layer,before,after,'Перекрасить объект','format_color_fill'));
            this.bus.emit('CANVAS_UPDATED');return true;
        }catch(error){console.error('Failed to recolor layer:',error);this.showToast('Не удалось перекрасить объект.','error');this.bus.emit('CANVAS_UPDATED');return false;}
    }
}
