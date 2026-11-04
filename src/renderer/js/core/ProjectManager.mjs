import {normalizeButtonData} from './ButtonDocument.mjs';
import {captureSaveSnapshot,matchesSaveSnapshot} from './typed/SaveSnapshot.mjs';
import {instrumentMethods} from './Performance.mjs';
import {migrateProjectDocument} from './ProjectMigrations.mjs';
import {readDocumentState} from './typed/DocumentState.mjs';
import {encodeProject,decodeProject,encodeCanvasPNG} from './ProjectCodec.mjs';
import {recordFailure} from './Performance.mjs';
import {
    deleteRecoveryDraft,
    readRecoveryDraft,
    writeRecoveryDraft
} from './RecoveryDraftStore.mjs';
import { MAX_PROJECT_DIMENSION, MAX_PROJECT_PIXEL_COUNT, validateProjectDocument, parseProjectJSON } from './ProjectValidation.mjs';
import { createProjectThumbnail } from '../ui/ProjectThumbnail.js';
import { writeProjectThumbnail } from './ProjectThumbnailCache.mjs';
import Layer from '../graphics/Layer.js';
import { normalizeWorkspaceState, readWorkspaceState } from './WorkspaceState.mjs';
import { projectFileRevision } from './FileRevision.mjs';
import { normalizeLayerLabel } from './LayerOrganization.mjs';
import { fileErrorMessage, fileErrorInfo } from './FileErrors.mjs';
import { normalizePrefixDocument } from './PrefixDocument.mjs';
import { safeFileStem } from './FileNames.mjs';
import {uiLabel} from './Locale.mjs';
import {normalizeSavedGuiTemplatePath} from './ProjectFactory.mjs';
import {projectPathKey} from './Platform.mjs';

const fileKey = projectPathKey;
const deferredOpenError = () => Object.assign(new Error('Завершите или отмените незавершённый ввод. Открытие проекта отложено.'), { code: 'PROJECT_OPEN_DEFERRED' });

export default class ProjectManager {
    constructor(app) {
        this.app = app;
        this.autosaveTimers = new Map();
        this.autosaveDirtyIds = new Set();
        this.projectRevisions = new Map();
        this.autosaveSuppressed = false;
        this.autosaveInFlight = new Map();
        this.pendingSaves = new Set();
        this.saveQueue = Promise.resolve();
        this.documentFingerprints = new Map();
        this.savedRevisions = new Map();
        this.savedFingerprints = new Map();
        this.saveStatusFingerprints = new Map();
        this.layerImageCache = new WeakMap();
        this.masterImageCache = new WeakMap();
        this.autosaveFailures = new Map();
        this.saveStates = new Map();
        this.openFilesInFlight = new Map();
        this.liveSaveRecoveries = new Set();
    }

    saveProject() {
        if (this.app.tools?.finishDocument?.({ preserveSelection: true }) === false) return Promise.resolve(false);
        const projectId = this.app.activeProjectId;
        return this.enqueueSave(() => this.saveProjectInternal(projectId), projectId);
    }

    async saveProjectInternal(projectId) {
        const activeProj = this.app.projects.find(p => p.id === projectId);
        if (!activeProj) return false;
        if (!await this.prepareProjectForSave(activeProj)) return false;
        if (activeProj && activeProj.filePath && window.desktopAPI) {
            const snapshot = captureSaveSnapshot(()=>this.serializeProject(activeProj.id),()=>this.getRevision(activeProj.id),()=>this.getDocumentFingerprint(activeProj.id));
            const projectData = snapshot.document;
            validateProjectDocument(projectData);
            const jsonPromise = encodeProject(projectData);
            const {revision:savedRevision,fingerprint:savedFingerprint}=snapshot;
            const json = await jsonPromise;
            try {
                if (window.desktopAPI.writeProjectFile) {
                    if (!activeProj.fileRevision) throw new Error('FILE_CHANGED: Версия файла на диске неизвестна. Сохраните проект отдельным файлом.');
                    activeProj.fileRevision = await window.desktopAPI.writeProjectFile(activeProj.filePath, json, activeProj.fileRevision);
                } else await window.desktopAPI.writeFile(activeProj.filePath, json);
                const previewRevision = this.createPreviewRevision();
                this.recordRecentSafely(activeProj.filePath, projectData, previewRevision);
                await this.refreshSavedProjectPreview(activeProj.filePath, previewRevision, projectData);
                await this.finishSave(activeProj.id, savedRevision, savedFingerprint);
                this.app.showToast?.(`Проект сохранён: ${projectData.name}`, 'check_circle');
                return true;
            } catch (err) {
                console.error('Ошибка быстрого сохранения:', err);
                if(fileErrorInfo(err).kind!=='changed'){this.setSaveState(projectId,'error');this.reportSaveError(err,projectId);return false;}
                this.app.showToast?.(fileErrorMessage(err), 'warning');
            }
        }
        return this.saveProjectAsInternal(projectId);
    }

    saveProjectAs() {
        if (this.app.tools?.finishDocument?.({ preserveSelection: true }) === false) return Promise.resolve(false);
        const projectId = this.app.activeProjectId;
        return this.enqueueSave(() => this.saveProjectAsInternal(projectId), projectId);
    }

    async saveProjectAsInternal(projectId) {
        const project = this.app.projects.find(item => item.id === projectId);
        if (!project) return false;
        if (!await this.prepareProjectForSave(project)) return false;
        const snapshot = captureSaveSnapshot(()=>this.serializeProject(projectId),()=>this.getRevision(projectId),()=>this.getDocumentFingerprint(projectId));
        const projectData = snapshot.document;
        if (!projectData) return false;
        validateProjectDocument(projectData);
        const jsonPromise = encodeProject(projectData);
        const {revision:savedRevision,fingerprint:savedFingerprint}=snapshot;
        const json = await jsonPromise;
        const safeDefaultName = safeFileStem(projectData.name, 'project') + '.mlst';
        
        if (window.desktopAPI) {
            try {
                const result = await window.desktopAPI.showSaveDialog({
                    title: 'Сохранить проект MollyStudio',
                    defaultPath: safeDefaultName,
                    filters: [
                        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ]
                });
                if (!result.canceled && result.filePath) {
                    const alreadyOpen=this.app.projects.find(item=>item.id!==projectId&&item.filePath&&fileKey(item.filePath)===fileKey(result.filePath));
                    if(alreadyOpen)throw new Error(`Файл уже открыт в проекте «${alreadyOpen.name}». Выберите другое имя.`);
                    const fileRevision = window.desktopAPI.writeProjectFile
                        ? await window.desktopAPI.writeProjectFile(result.filePath, json)
                        : (await window.desktopAPI.writeFile(result.filePath, json), null);
                    const activeProj = this.app.projects.find(p => p.id === projectId);
                    if (activeProj) {
                        activeProj.filePath = result.filePath;
                        activeProj.fileRevision = fileRevision;
                    }
                    const previewRevision = this.createPreviewRevision();
                    this.recordRecentSafely(result.filePath, projectData, previewRevision);
                    await this.refreshSavedProjectPreview(result.filePath, previewRevision, projectData);
                    await this.finishSave(projectId, savedRevision, savedFingerprint);
                    this.app.showToast?.(`Сохранено в: ${result.filePath.split(/[\\/]/).pop()}`, 'check_circle');
                    return true;
                }
            } catch (err) {
                console.error('Ошибка сохранения:', err);
                this.setSaveState(projectId,'error');
                this.reportSaveError(err,projectId);
            }
        } else {
            // Web fallback
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = safeDefaultName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            this.app.showToast?.(`Скачивание: ${safeDefaultName}`, 'download');
            return true;
        }
        return false;
    }

    enqueueSave(operation, projectId = this.app.activeProjectId) {
        const guarded = async () => {
            this.setSaveState(projectId,'saving');
            try {
                const result=await operation();
                if(this.saveStates.get(projectId)!=='error')this.setSaveState(projectId,null);
                return result;
            }
            catch (error) {
                this.setSaveState(projectId,'error');
                console.error('[Save] Could not prepare or save the project:', error);
                this.reportSaveError(error,projectId);
                return false;
            }
        };
        const pending = this.saveQueue.then(guarded, guarded);
        this.saveQueue = pending.catch(() => {});
        return this.trackPendingSave(pending);
    }

    recordRecentSafely(path, project, revision) {
        try {
            this.addToRecent(path, project.name, project.type, revision);
        } catch (error) {
            console.warn('[Recent projects] File saved, but history could not be updated:', error);
        }
    }

    reportSaveError(error,projectId) {
        recordFailure('save',error);
        const message=error?.message?.startsWith('Файл уже открыт')?error.message:fileErrorMessage(error);
        this.saveErrorNotice?.remove?.();
        this.saveErrorNotice=this.app.showToast?.('Не удалось сохранить «{0}». {1}','error',0,[
            {label:'Повторить сохранение',run:()=>this.retrySave(projectId)},
            {label:'Сохранить отдельно',run:()=>this.retrySave(projectId,true)}
        ],{0:this.app.projects?.find(project=>project.id===projectId)?.name||'',1:uiLabel(message)});
        if(this.saveErrorNotice?.dataset)this.saveErrorNotice.dataset.projectId=projectId;
    }

    retrySave(projectId,separate=false) {
        if(!this.app.projects.some(project=>project.id===projectId))return Promise.resolve(true);
        if(this.app.activeProjectId===projectId&&this.app.tools?.finishDocument?.({preserveSelection:true})===false)return Promise.resolve(false);
        return this.enqueueSave(()=>separate?this.saveProjectAsInternal(projectId):this.saveProjectInternal(projectId),projectId);
    }

    trackPendingSave(operation) {
        const tracked = Promise.resolve(operation);
        this.pendingSaves.add(tracked);
        tracked.then(
            () => this.pendingSaves.delete(tracked),
            () => this.pendingSaves.delete(tracked)
        );
        return tracked;
    }

    async waitForPendingSaves() {
        while (this.pendingSaves.size > 0) {
            await Promise.allSettled([...this.pendingSaves]);
        }
    }

    async openProject() {
        if(this.app.tools?.finishDocument?.({preserveSelection:true})===false)return false;
        if (window.desktopAPI) {
            try {
                const result = await window.desktopAPI.showOpenDialog({
                    title: 'Открыть проект MollyStudio',
                    filters: [
                        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                });
                if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                    return await this.openRecentProject(result.filePaths[0]);
                }
            } catch (err) {
                console.error('Ошибка открытия:', err);
                this.app.showToast?.(fileErrorMessage(err,'open'), 'error');
            }
        } else {
            // Web fallback
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.mlst';
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async ev => {
                    try {
                        const parsed = parseProjectJSON(ev.target.result);
                        await this.deserializeProject(parsed, file.name);
                        this.recordRecentSafely(file.name, parsed);
                        this.app.showToast?.(`Открыт проект: ${parsed.name || 'Без названия'}`, 'folder_open');
                    } catch (err) {
                        this.app.showToast?.('Не удалось прочитать файл проекта.', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }
    }

    openRecentProject(path, { fromSession = false } = {}) {
        if (this.app.documentTasks?.closing) return Promise.resolve({deferred: true});
        const key = fromSession || !window.desktopAPI ? 'session' : fileKey(path);
        const existing = this.openFilesInFlight.get(key);
        if (existing) return existing;
        const pending = this.openRecentProjectInternal(path, { fromSession });
        this.openFilesInFlight.set(key, pending);
        const release = () => { if (this.openFilesInFlight.get(key) === pending) this.openFilesInFlight.delete(key); };
        pending.then(release, release);
        return pending;
    }

    async openRecentProjectInternal(path, { fromSession }) {
        const existing=this.app.projects.find(project=>project.filePath&&fileKey(project.filePath)===fileKey(path));
        if(existing?.id!==this.app.activeProjectId && this.app.tools?.finishDocument?.()===false){
            this.app.showToast?.('Завершите или отмените незавершённый ввод. Открытие проекта отложено.','info');
            return {deferred:true};
        }
        if(this.focusOpenFile(path))return true;
        if (!window.desktopAPI || fromSession) {
            const pending = sessionStorage.getItem('molly_pending_project');
            if (pending) {
                try {
                    const data = JSON.parse(pending);
                    await this.deserializeProject(data);
                    sessionStorage.removeItem('molly_pending_project');
                    this.app.showToast?.(`Открыт проект: ${data.name || 'Без названия'}`, 'folder_open');
                    return true;
                } catch (e) {
                    if (e?.code === 'PROJECT_OPEN_DEFERRED') { this.app.showToast?.(e.message,'info');return { deferred: true }; }
                    sessionStorage.removeItem('molly_pending_project');
                    this.app.showToast?.('Не удалось прочитать файл проекта.', 'error');
                }
            }
            return;
        }
        try {
            const json = await window.desktopAPI.readFile(path);
            const data = migrateProjectDocument(await decodeProject(json)).document;
            await this.deserializeProject(data, path, { fileRevision: await projectFileRevision(json) });
            this.recordRecentSafely(path, data);
            this.app.showToast?.(`Открыт недавний проект: ${data.name || 'Без названия'}`, 'folder_open');
            return true;
        } catch (err) {
            if (err?.code === 'PROJECT_OPEN_DEFERRED') { this.app.showToast?.(err.message,'info');return { deferred: true }; }
            this.app.showToast?.('Не удалось открыть проект: ' + (err.message || 'файл недоступен'), 'error');
            if (this.app.projects.length === 0) {
                this.app.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false);
            }
            return false;
        }
    }

    serializeProject(projectId = this.app.activeProjectId) {
        const project = this.app.projects.find(item => item.id === projectId);
        if (!project) return null;
        const isActiveProject = project.id === this.app.activeProjectId;

        const sourceLayers = isActiveProject ? this.app.layerManager.getLayers() : (project.layers || []);
        const layers = sourceLayers.map(layer => {
            let images = this.layerImageCache.get(layer);
            if (!images || !Number.isFinite(layer.contentRevision) || images.revision !== layer.contentRevision || images.source !== layer.sourceCanvas) {
                images = {
                    revision: layer.contentRevision, source: layer.sourceCanvas,
                    dataUrl: layer.canvas ? layer.canvas.toDataURL('image/png') : null,
                    sourceDataUrl: layer.sourceCanvas ? this.encodeMaster(layer.sourceCanvas) : null
                };
                this.layerImageCache.set(layer, images);
            }
            return {
                id: layer.id,
                name: layer.name,
                width: layer.width,
                height: layer.height,
                type: layer.type,
                visible: layer.visible,
                locked: layer.locked,
                alphaLocked: !!layer.alphaLocked,
                opacity: layer.opacity,
                blendMode: layer.blendMode,
                colorLabel: layer.colorLabel || 'none',
                isBase: layer.isBase,
                groupId: layer.groupId || null,
                isGroup: !!layer.isGroup,
                expanded: layer.expanded !== false,
                textData: layer.textData ? structuredClone(layer.textData) : null,
                shapeData: layer.shapeData ? { ...layer.shapeData } : null,
                buttonData: layer.buttonData ? structuredClone(layer.buttonData) : null,
                objectType: layer.objectType || null,
                fx: layer.fx ? JSON.parse(JSON.stringify(layer.fx)) : null,
                sourceRect: layer.sourceRect ? { ...layer.sourceRect } : null,
                sourceDataUrl: images.sourceDataUrl,
                dataUrl: images.dataUrl
            };
        });

        return {
            mollyVersion: 2,
            draftId: project.draftId || project.id,
            ...readDocumentState(project.type==='prefix'?{...project,prefixData:normalizePrefixDocument(project.prefixData)}:project,isActiveProject?this.app.config:project.config),
            workspace: readWorkspaceState(this.app, project),
            layers: layers
        };
    }

    encodeMaster(canvas) {
        let encoded = this.masterImageCache.get(canvas);
        if (!encoded) { encoded = canvas.toDataURL('image/png'); this.masterImageCache.set(canvas, encoded); }
        return encoded;
    }

    async prepareLayerImages(project) {
        if(typeof Worker==='undefined')return;
        const layers=project.id===this.app.activeProjectId?this.app.layerManager.getLayers():project.layers||[];
        for(const layer of layers){
            const revision=layer.contentRevision,source=layer.sourceCanvas,cached=this.layerImageCache.get(layer);
            if(!layer.canvas||Math.max(layer.canvas.width*layer.canvas.height,(source?.width||0)*(source?.height||0))<65536)continue;
            if(cached?.revision===revision&&cached.source===source)continue;
            try{
                const dataUrl=await encodeCanvasPNG(layer.canvas);if(!dataUrl)break;
                let sourceDataUrl=source?this.masterImageCache.get(source):null;
                if(source&&!sourceDataUrl){
                    sourceDataUrl=await encodeCanvasPNG(source);
                    // A worker can become unavailable between the layer and its
                    // master. Never cache an otherwise valid layer without its original.
                    if(!sourceDataUrl)sourceDataUrl=this.encodeMaster(source);
                    this.masterImageCache.set(source,sourceDataUrl);
                }
                if(layer.contentRevision===revision&&layer.sourceCanvas===source)this.layerImageCache.set(layer,{revision,source,dataUrl,sourceDataUrl});
            }catch(error){recordFailure('png-encoding',error);break;}
        }
    }

    async prepareProject(project) {
        await project.templateLoadPromise;
        if (await project.prefixLoadPromise === false) {
            throw new Error('Не удалось подготовить префикс. Откройте его снова перед сохранением.');
        }
        await this.prepareLayerImages(project);
    }

    async prepareProjectForSave(project) {
        await this.prepareProject(project);
        if (!this.app.projects.includes(project)) return false;
        // Queued saves and font/template preparation can yield while another
        // gesture starts. Never serialize a temporary cut or half-finished stroke.
        return this.app.activeProjectId !== project.id
            || this.app.tools?.finishDocument?.({ preserveSelection: true }) !== false;
    }

    focusOpenFile(path) {
        if(!path)return false;
        const key=fileKey(path);
        const project=this.app.projects.find(item=>item.filePath&&fileKey(item.filePath)===key);
        if(!project)return false;
        this.app.switchProject(project.id);
        return this.app.activeProjectId===project.id;
    }

    async deserializeProject(data, filePath = '', { recoveryDraftId = null, fileRevision = null } = {}) {
        data=migrateProjectDocument(data).document;
        const dimensions = validateProjectDocument(data);
        const stagedLayers = [];
        const releaseStaged = () => {
            for (const layer of stagedLayers) {
                const canvases = new Set([layer.canvas,layer.thumbCanvas,layer.sourceCanvas,layer.fxCanvas,...Object.values(layer.fxScratch)]);
                for (const canvas of canvases) if (canvas) canvas.width = canvas.height = 1;
            }
        };
        // Decode everything before changing the active document. A bad image or a tab
        // switch during decoding must not leave a partially imported project behind.
        try {
            for (const entry of data.layers) {
                const width = Number(entry.width) || dimensions.width;
                const height = Number(entry.height) || dimensions.height;
                const id = entry.id == null ? `layer_${this.createDraftId()}` : String(entry.id);
                const layer = new Layer(id, String(entry.name || 'Слой'), width, height, entry.type || 'bitmap');
                stagedLayers.push(layer);
                Object.assign(layer, {
                    isBase: !!entry.isBase, visible: entry.visible !== false, locked: !!entry.locked,
                    alphaLocked: !!entry.alphaLocked, opacity: entry.opacity == null ? 1 : Number(entry.opacity),
                    blendMode: entry.blendMode || 'source-over',
                    colorLabel: normalizeLayerLabel(entry.colorLabel),
                    textData: entry.textData ? JSON.parse(JSON.stringify(entry.textData)) : null,
                    shapeData: entry.shapeData ? { ...entry.shapeData } : null,
                    objectType: entry.objectType || null, groupId: entry.groupId == null ? null : String(entry.groupId),
                    isGroup: !!entry.isGroup || entry.type === 'group', expanded: entry.expanded !== false
                });
                if (entry.fx) layer.setFX(entry.fx);
                if (entry.dataUrl) {
                    const image = await decodeProjectImage(entry.dataUrl);
                    if (image.naturalWidth !== width || image.naturalHeight !== height) {
                        throw new Error(`Изображение слоя «${layer.name}» имеет неверный размер.`);
                    }
                    layer.ctx.drawImage(image, 0, 0);
                }
                layer.invalidateSource();
                layer.buttonData=normalizeButtonData(entry.buttonData);
                if (entry.sourceDataUrl && entry.sourceRect) {
                    const image = await decodeProjectImage(entry.sourceDataUrl);
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    context.imageSmoothingEnabled = false;
                    try {
                        context.drawImage(image, 0, 0);
                        layer.setMasterSource(canvas, entry.sourceRect);
                    } catch (error) { canvas.width = canvas.height = 1; throw error; }
                }
            }
            if (this.app.tools?.finishDocument?.() === false) throw deferredOpenError();
            if (await this.flushAutosaves() === false) throw new Error('Не удалось сохранить открытые черновики.');
            if (this.app.tools?.finishDocument?.() === false) throw deferredOpenError();
            // A gesture may finish while decoding or flushing. Capture it before
            // suppressing events during installation of the imported document.
            const activeId = this.app.activeProjectId;
            if (activeId && this.app.layerManager) {
                const fingerprint = this.getDocumentFingerprint(activeId);
                if (this.documentFingerprints.get(activeId) !== fingerprint) {
                    this.documentFingerprints.set(activeId, fingerprint);
                    this.queueAutosave(activeId);
                }
            }
        } catch(error) {
            releaseStaged();
            throw error;
        }
        const wasSuppressed = this.autosaveSuppressed;
        const previousId = this.app.activeProjectId;
        const previousProjects = new Set(this.app.projects);
        let installed = false;
        this.autosaveSuppressed = true;
        try {
            const fallbackName = filePath ? filePath.split(/[\\/]/).pop().replace(/\.mlst$/i, '') : 'Проект';
            const name = String(data.name || fallbackName);
            const type = ['canvas', 'prefix', 'title'].includes(data.type) ? data.type : 'gui';
            const bg = ['white', 'black', 'transparent'].includes(data.bg) ? data.bg : null;
            this.app.addProject(name, 'none', dimensions.width, dimensions.height, false, type, bg);
            const project = this.app.projects.find(item => item.id === this.app.activeProjectId);
            if (!project || project.id === previousId) throw deferredOpenError();
            // Files opened as documents receive their own recovery identity, even when copied.
            const importedDraftId = typeof recoveryDraftId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(recoveryDraftId)
                && !/^index$/i.test(recoveryDraftId) ? recoveryDraftId : null;
            const duplicateDraft = importedDraftId && this.app.projects.some(item => item !== project
                && item.draftId?.toLowerCase() === importedDraftId.toLowerCase());
            Object.assign(project, {
                filePath, fileRevision, type, bg,
                ...(type === 'prefix' ? { prefixData: structuredClone(data.prefixData) } : {}),
                ...(type === 'title'?{titleData:structuredClone(data.titleData)}:{}),
                draftId: importedDraftId && !duplicateDraft ? importedDraftId : project.draftId,
                templateName: String(data.templateName || 'container_54'),
                templatePath: normalizeSavedGuiTemplatePath(data.templatePath),
                hasFrame: !!data.hasFrame
            });
            this.app.layerManager.setLayers(stagedLayers);
            installed = true;
            const top = stagedLayers.at(-1);
            if (top) this.app.layerManager.setActive(top.id);
            this.app.saveProjectState();
            Object.assign(project, normalizeWorkspaceState(data.workspace));
            this.app.loadProjectState(project.id);
            this.app.bus.emit('LAYER_ORDER_CHANGED');
            this.app.bus.emit('CANVAS_UPDATED');
            this.app.updateProjectTypeUI?.(project);
            this.app.renderTabs();
            this.app.updateDiscordPresence?.();
            this.markClean(project.id);
            this.markSaved(project.id);
            return project;
        } catch (error) {
            // addProject itself can fail after inserting a tab. Installation is
            // synchronous, so every newly inserted project belongs to this open.
            installed = false;
            for (const project of this.app.projects) if (!previousProjects.has(project)) this.releaseProject(project.id);
            this.app.projects = this.app.projects.filter(project => previousProjects.has(project));
            try {
                if (previousId && this.app.projects.some(project => project.id === previousId)) this.app.loadProjectState(previousId);
                else {
                    this.app.activeProjectId = null;
                    this.app.layerManager.clearLayers();
                }
                this.app.renderTabs?.();
            } catch (restoreError) {
                throw new AggregateError([error,restoreError], 'Не удалось восстановить интерфейс после ошибки открытия.', {cause:error});
            }
            throw error;
        } finally {
            if (!installed) releaseStaged();
            this.autosaveSuppressed = wasSuppressed;
            if (!wasSuppressed) [...this.autosaveDirtyIds].forEach(id => this.scheduleAutosave(id, 250));
        }
    }

    getRecentProjects() {
        try {
            const recent = JSON.parse(localStorage.getItem('molly_recent') || '[]');
            return Array.isArray(recent)
                ? recent.filter(item => item && typeof item.path === 'string' && item.path.length > 0)
                : [];
        } catch (e) {
            return [];
        }
    }

    createPreviewRevision() {
        return globalThis.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async refreshSavedProjectPreview(path, revision, projectData) {
        try {
            const preview = await createProjectThumbnail(projectData);
            await writeProjectThumbnail(path, revision, preview);
        } catch (error) {
            // The project file is already saved; preview generation is an optional enhancement.
            console.warn('[Project preview] Could not refresh the saved preview:', error);
        }
    }

    addToRecent(path, name, type = 'gui', previewRevision = null) {
        let recent = this.getRecentProjects();
        recent = recent.filter(r => fileKey(r.path) !== fileKey(path));
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        recent.unshift({ 
            path, 
            name: name || 'Без названия',
            type: type || 'gui',
            modifiedAt: Date.now(),
            updatedAt: `Сегодня, ${timeStr}`,
            // Opening a file invalidates a cached preview in case it changed outside the editor.
            previewRevision: typeof previewRevision === 'string' ? previewRevision : ''
        });
        if (recent.length > 12) recent.pop();
        localStorage.setItem('molly_recent', JSON.stringify(recent));
        if (this.app?.renderRecentProjects) {
            this.app.renderRecentProjects();
        }
    }

    removeFromRecent(path) {
        let recent = this.getRecentProjects();
        recent = recent.filter(r => fileKey(r.path) !== fileKey(path));
        localStorage.setItem('molly_recent', JSON.stringify(recent));
        if (this.app?.renderRecentProjects) {
            this.app.renderRecentProjects();
        }
    }

    initAutosave() {
        window.desktopAPI?.onCloseStateChange?.(closing => { if (this.app.documentTasks) this.app.documentTasks.closing = closing; });
        const triggerAutosave = () => {
            if (this.autosaveSuppressed) return;
            if (this.app.tools?.pointerSession || this.app.tools?.settlingGesture || this.app.tools?.tools?.marquee?.hasFloating?.()) return;
            const projectId = this.app.activeProjectId;
            const fingerprint = this.getDocumentFingerprint(projectId);
            if (this.documentFingerprints.get(projectId) === fingerprint) {
                // Cancel may restore the state captured before a save raced
                // with a live gesture. Its provisional recovery flag is stale.
                if(this.liveSaveRecoveries.has(projectId)&&this.autosaveDirtyIds.has(projectId)&&this.savedFingerprints.get(projectId)===fingerprint&&this.app.projects.find(project=>project.id===projectId)?.filePath){
                    this.markClean(projectId,fingerprint);
                    void this.clearDraft(projectId,this.getRevision(projectId),fingerprint);
                }
                return;
            }
            this.documentFingerprints.set(projectId, fingerprint);
            this.queueAutosave();
        };

        this.app.bus.on('CANVAS_UPDATED', triggerAutosave);
        this.app.bus.on('LAYER_CHANGED', triggerAutosave);
        this.app.bus.on('HISTORY_CHANGED', triggerAutosave);

        window.addEventListener('beforeunload', () => {
            this.app.saveProjectState?.();
            void this.flushAutosaves();
        });
        window.desktopAPI?.onFlushRecoveryDrafts?.(async () => {
            if (await this.flushDocumentsForClose() === false) return false;
            return { confirmClose: this.app.settingsManager?.get('confirmClose') === true && this.app.projects.some(project => this.hasUnsavedChanges(project.id)) };
        });
        window.addEventListener('recovery-flush-failed', () => {
            this.app.showToast?.('Черновик не удалось сохранить. Освободите место на диске и повторите закрытие.', 'error');
        });
    }

    getDocumentFingerprint(projectId) {
        const project = this.app.projects.find(item => item.id === projectId);
        if (!project) return '';
        const layers = projectId === this.app.activeProjectId ? this.app.layerManager.getLayers() : project.layers || [];
        const config = projectId === this.app.activeProjectId ? this.app.config : project.config;
        return JSON.stringify([config, project.name, project.bg, project.templatePath, project.templateName, project.hasFrame, project.prefixData, project.titleData, readWorkspaceState(this.app, project), layers.map(layer =>
            [layer.id, layer.type === 'text' && layer.textData || ((project.type === 'prefix' && layer.objectType === 'prefix')||(project.type==='title'&&layer.objectType==='title')) ? null : (layer.contentIdentity ?? layer.contentRevision ?? 0), layer.width, layer.height, layer.name, layer.visible, layer.locked, layer.alphaLocked,
                layer.opacity, layer.blendMode, layer.groupId, layer.textData, layer.shapeData, layer.buttonData, layer.fx, layer.colorLabel])]);
    }

    markSaved(projectId, revision = this.getRevision(projectId), fingerprint = this.getDocumentFingerprint(projectId)) {
        this.savedRevisions.set(projectId, revision);
        this.savedFingerprints.set(projectId, fingerprint);
        this.saveStatusFingerprints.delete(projectId);
        this.setSaveState(projectId,null);
    }

    setSaveState(projectId,state) {
        if(!projectId)return;
        if(state)this.saveStates.set(projectId,state);else this.saveStates.delete(projectId);
        this.app.bus?.emit('DOCUMENT_STATUS_CHANGED',projectId);
    }

    getSaveState(projectId) {
        const project=this.app.projects.find(item=>item.id===projectId);
        return this.saveStates.get(projectId)||(!project?.filePath?'new':this.hasUnsavedChanges(projectId)?'modified':'saved');
    }

    hasUnsavedChanges(projectId) {
        const revision = this.getRevision(projectId);
        if (revision === (this.savedRevisions.get(projectId) || 0)) return false;
        if (!this.savedFingerprints.has(projectId)) return true;
        let current = this.saveStatusFingerprints.get(projectId);
        if (current?.revision !== revision) {
            current = {revision, fingerprint:this.getDocumentFingerprint(projectId)};
            this.saveStatusFingerprints.set(projectId,current);
        }
        return current.fingerprint !== this.savedFingerprints.get(projectId);
    }

    getDraftId(projectId = this.app.activeProjectId) {
        const project = this.app.projects.find(item => item.id === projectId);
        return project ? (project.draftId || project.id) : null;
    }

    getRevision(projectId) {
        return this.projectRevisions.get(projectId) || 0;
    }

    releaseProject(projectId) {
        this.liveSaveRecoveries.delete(projectId);
        if(this.saveErrorNotice?.dataset?.projectId===projectId){this.saveErrorNotice.remove();this.saveErrorNotice=null;}
        clearTimeout(this.autosaveTimers.get(projectId));
        this.autosaveTimers.delete(projectId);
        this.autosaveDirtyIds.delete(projectId);
        for (const map of [this.projectRevisions, this.savedRevisions, this.savedFingerprints, this.saveStatusFingerprints, this.documentFingerprints, this.autosaveFailures]) map.delete(projectId);
        this.saveStates.delete(projectId);
    }

    async finishSave(projectId, savedRevision, savedFingerprint = this.getDocumentFingerprint(projectId)) {
        if(this.saveErrorNotice?.dataset?.projectId===projectId){this.saveErrorNotice.remove();this.saveErrorNotice=null;}
        this.markSaved(projectId, savedRevision, savedFingerprint);
        await this.autosaveInFlight.get(projectId);
        const unchanged=this.getRevision(projectId)===savedRevision&&this.getDocumentFingerprint(projectId)===savedFingerprint;
        if (unchanged) {
            const clean=await this.clearDraft(projectId, savedRevision, savedFingerprint);
            if(clean&&typeof globalThis.CustomEvent==='function')globalThis.document?.dispatchEvent?.(new CustomEvent('molly-project-saved',{detail:{id:projectId}}));
            return clean;
        }
        // A stroke can change pixels before its history event advances the
        // document revision. Keep that newer content dirty and recoverable.
        if(this.getRevision(projectId)===savedRevision){this.queueAutosave(projectId);this.liveSaveRecoveries.add(projectId);}
        else this.autosaveDirtyIds.add(projectId);
        this.scheduleAutosave(projectId, 250);
        return false;
    }

    createDraftId() {
        return globalThis.crypto?.randomUUID?.()
            || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    }

    queueAutosave(projectId = this.app.activeProjectId) {
        if (!projectId || !this.app.projects.some(item => item.id === projectId)) return;
        this.projectRevisions.set(projectId, this.getRevision(projectId) + 1);
        this.saveStatusFingerprints.delete(projectId);
        if(this.saveStates.get(projectId)!=='saving')this.saveStates.delete(projectId);
        this.app.bus?.emit('DOCUMENT_STATUS_CHANGED',projectId);
        if (this.autosaveSuppressed) {
            this.autosaveDirtyIds.add(projectId);
            return;
        }
        this.autosaveDirtyIds.add(projectId);
        this.scheduleAutosave(projectId);
    }

    scheduleAutosave(projectId, delay = 3000) {
        if (!projectId || !this.app.projects.some(item => item.id === projectId)) return;
        const previousTimer = this.autosaveTimers.get(projectId);
        if (previousTimer) clearTimeout(previousTimer);
        const timer = setTimeout(() => {
            this.autosaveTimers.delete(projectId);
            void this.performAutosave(projectId);
        }, delay);
        this.autosaveTimers.set(projectId, timer);
    }

    markClean(projectId = this.app.activeProjectId, fingerprint = projectId ? this.getDocumentFingerprint(projectId) : '') {
        if (projectId) {
            this.liveSaveRecoveries.delete(projectId);
            this.documentFingerprints.set(projectId, fingerprint);
            this.autosaveDirtyIds.delete(projectId);
            const timer = this.autosaveTimers.get(projectId);
            if (timer) clearTimeout(timer);
            this.autosaveTimers.delete(projectId);
            return;
        }
        this.autosaveDirtyIds.clear();
        this.autosaveTimers.forEach(clearTimeout);
        this.autosaveTimers.clear();
    }

    async performAutosave(projectId = this.app.activeProjectId) {
        if (this.autosaveInFlight.has(projectId)) return this.autosaveInFlight.get(projectId);
        const task = this.performAutosaveOnce(projectId);
        this.autosaveInFlight.set(projectId, task);
        try {
            return await task;
        } finally {
            this.autosaveInFlight.delete(projectId);
            if (this.autosaveDirtyIds.has(projectId) && !this.autosaveSuppressed) {
                const delay = this.autosaveFailures.has(projectId) ? 15000
                    : this.app.tools?.pointerSession || this.app.tools?.tools?.marquee?.hasFloating?.() ? 3000 : 250;
                this.scheduleAutosave(projectId, delay);
            }
        }
    }

    async performAutosaveOnce(projectId) {
        try {
            if (!projectId || !this.autosaveDirtyIds.has(projectId) || this.autosaveSuppressed) return false;
            const project = this.app.projects.find(item => item.id === projectId);
            if (!project) return false;
            await this.prepareProject(project);
            if (projectId === this.app.activeProjectId) {
                if (this.app.tools?.pointerSession || this.app.tools?.tools?.marquee?.hasFloating?.()) return false;
                this.app.saveProjectState?.();
            }

            if (project.filePath && this.savedFingerprints.has(projectId) && !this.hasUnsavedChanges(projectId)) {
                // Undo can return exactly to the file on disk. Do not replace
                // an obsolete edited draft with another needless full PNG copy.
                const clean = await this.clearDraft(projectId);
                if (clean) this.autosaveFailures.delete(projectId);
                return clean;
            }

            const snapshot = captureSaveSnapshot(()=>this.serializeProject(projectId),()=>this.getRevision(projectId),()=>this.getDocumentFingerprint(projectId));
            const serialized = snapshot.document;
            if (!Array.isArray(serialized?.layers)) return false;
            validateProjectDocument(serialized);
            
            await writeRecoveryDraft(localStorage, this.getDraftId(projectId), serialized);
            this.autosaveFailures.delete(projectId);
            // A live stroke changes raster revisions before it commits a
            // history action. Do not mark that newer preview as durably saved.
            if (!matchesSaveSnapshot(snapshot,this.getRevision(projectId),this.getDocumentFingerprint(projectId))) return false;
            this.markClean(projectId);
            return true;
        } catch (e) {
            console.warn('[Autosave] Failed to create crash recovery draft:', e);
            if (!this.autosaveFailures.has(projectId)) this.app.showToast?.('Не удалось создать резервную копию. Проверьте свободное место.', 'error');
            this.autosaveFailures.set(projectId, true);
            return false;
        }
    }

    async flushAutosaves() {
        for (let attempt = 0; attempt < 4; attempt += 1) {
            this.autosaveTimers.forEach(clearTimeout);
            this.autosaveTimers.clear();
            const projectIds = [...this.autosaveDirtyIds];
            if (!projectIds.length) return true;
            const revisions = new Map(projectIds.map(projectId => [projectId, this.getRevision(projectId)]));
            const results = await Promise.all(projectIds.map(projectId => this.performAutosave(projectId)));
            if (!this.autosaveDirtyIds.size) return true;

            const failedWithoutNewEdits = projectIds.some((projectId, index) =>
                !results[index]
                && this.autosaveDirtyIds.has(projectId)
                && this.getRevision(projectId) === revisions.get(projectId)
            );
            if (failedWithoutNewEdits) return false;
        }
        return this.autosaveDirtyIds.size === 0;
    }

    async flushProject(projectId) {
        const project=this.app.projects.find(item=>item.id===projectId);
        if(!project)return false;
        await this.prepareProject(project);
        const finishActive=()=>{
            if(this.app.activeProjectId!==projectId)return true;
            if(this.app.tools?.finishDocument?.()===false)return false;
            this.app.saveProjectState?.();return true;
        };
        const captureChanges=()=>{
            const fingerprint=this.getDocumentFingerprint(projectId);
            if(this.documentFingerprints.get(projectId)!==fingerprint){
                this.documentFingerprints.set(projectId,fingerprint);this.queueAutosave(projectId);
            }
        };
        for(let attempt=0;attempt<4;attempt++){
            if(!finishActive())return false;
            captureChanges();
            await this.performAutosave(projectId);
            // The user may start a new stroke while disk I/O is pending.
            if(!finishActive())return false;
            captureChanges();
            if(!this.autosaveDirtyIds.has(projectId))return true;
            if(this.autosaveFailures.has(projectId))return false;
        }
        return false;
    }

    async flushDocumentsForClose() {
        const finishAndCapture = () => {
            if (this.app.tools?.finishDocument?.() === false) return false;
            this.app.saveProjectState?.();
            for (const project of this.app.projects) {
                const fingerprint = this.getDocumentFingerprint(project.id);
                if (this.documentFingerprints.get(project.id) !== fingerprint) {
                    this.documentFingerprints.set(project.id, fingerprint);
                    this.queueAutosave(project.id);
                }
            }
            return true;
        };
        if (!finishAndCapture()) return false;
        for (let attempt = 0; attempt < 4; attempt++) {
            await this.app.documentTasks?.idle();
            await Promise.allSettled([...this.openFilesInFlight.values()]);
            await Promise.all(this.app.projects.map(project => this.prepareProject(project)));
            if (!finishAndCapture()) return false;
            await this.waitForPendingSaves();
            if (!finishAndCapture()) return false;
            await this.flushAutosaves();
            // Disk I/O can overlap a new gesture, tab switch or manual save.
            // Capture once more before telling the native window it may close.
            if (!finishAndCapture()) return false;
            if (!this.pendingSaves.size && !this.autosaveDirtyIds.size && !this.openFilesInFlight.size && !this.app.documentTasks?.pending.size) return true;
            if ([...this.autosaveDirtyIds].some(id => this.autosaveFailures.has(id))) return false;
        }
        return false;
    }

    async clearDraft(projectId = this.app.activeProjectId, savedRevision = this.getRevision(projectId), savedFingerprint = this.getDocumentFingerprint(projectId)) {
        const changed=()=>this.getRevision(projectId)!==savedRevision||this.getDocumentFingerprint(projectId)!==savedFingerprint;
        const keepDirty=()=>{
            if(!this.app.projects.some(project=>project.id===projectId))return false;
            if(this.getRevision(projectId)===savedRevision){this.queueAutosave(projectId);this.liveSaveRecoveries.add(projectId);}
            else this.autosaveDirtyIds.add(projectId);
            this.scheduleAutosave(projectId,250);return false;
        };
        if(changed())return keepDirty();
        try {
            const draftId = this.getDraftId(projectId);
            if (draftId) await deleteRecoveryDraft(localStorage, draftId);
        } catch (error) {
            console.warn('[Autosave] Could not remove the recovery copy after saving.', error);
        }
        if(changed())return keepDirty();
        this.markClean(projectId, savedFingerprint);
        return true;
    }

    async restoreCrashDraft(token = 'true') {
        try {
            const entry = await readRecoveryDraft(localStorage, token);
            if (!entry) return false;
            const { draft } = entry;
            const projName = draft.project.name || 'Безымянный проект';
            // Recovery drafts do not have a file on disk; keep this empty so Save opens Save As.
            const restoredProject = await this.deserializeProject(draft.project, '', { recoveryDraftId: entry.draftId });
            this.markClean(restoredProject?.id);
            if (restoredProject) {
                this.savedFingerprints.delete(restoredProject.id);
                this.queueAutosave(restoredProject.id);
                const written = await this.performAutosave(restoredProject.id);
                if (written && entry.key === 'molly_crash_recovery_draft') {
                    await deleteRecoveryDraft(localStorage, null, entry.key).catch(() => {});
                }
            }
            this.app.showToast?.(`Проект «${projName}» успешно восстановлен!`, 'history');
            return true;
        } catch (e) {
            console.warn('[CrashRecovery] Error restoring draft:', e);
            return false;
        }
    }

}

function decodeProjectImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const width = image.naturalWidth || image.width;
            const height = image.naturalHeight || image.height;
            if (!width || !height || width > MAX_PROJECT_DIMENSION || height > MAX_PROJECT_DIMENSION) {
                reject(new Error('Изображение слоя превышает размер 4096 × 4096 пикселей.'));
                return;
            }
            resolve(image);
        };
        image.onerror = () => reject(new Error('Не удалось декодировать изображение слоя проекта.'));
        image.src = dataUrl;
    });
}


instrumentMethods(ProjectManager.prototype,["serializeProject","deserializeProject","saveProjectInternal","saveProjectAsInternal","performAutosave"],"project");
