import {
    deleteRecoveryDraft,
    readRecoveryDraft,
    writeRecoveryDraft
} from './RecoveryDraftStore.mjs';
import { MAX_PROJECT_DIMENSION, MAX_PROJECT_PIXEL_COUNT, validateProjectDocument } from './ProjectValidation.mjs';
import { createProjectThumbnail } from '../ui/ProjectThumbnail.js';
import { writeProjectThumbnail } from './ProjectThumbnailCache.mjs';
import Layer from '../graphics/Layer.js';
import { normalizeWorkspaceState, readWorkspaceState } from './WorkspaceState.mjs';

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
        this.layerImageCache = new WeakMap();
        this.autosaveFailures = new Map();
    }

    saveProject() {
        if (this.app.tools?.finishDocument?.() === false) return Promise.resolve(false);
        const projectId = this.app.activeProjectId;
        return this.enqueueSave(() => this.saveProjectInternal(projectId));
    }

    async saveProjectInternal(projectId) {
        const activeProj = this.app.projects.find(p => p.id === projectId);
        if (!activeProj) return false;
        await activeProj.templateLoadPromise;
        if (activeProj && activeProj.filePath && window.electronAPI) {
            const projectData = this.serializeProject(activeProj.id);
            const json = JSON.stringify(projectData);
            const savedRevision = this.getRevision(activeProj.id);
            try {
                await window.electronAPI.writeFile(activeProj.filePath, json);
                const previewRevision = this.createPreviewRevision();
                this.recordRecentSafely(activeProj.filePath, projectData, previewRevision);
                await this.refreshSavedProjectPreview(activeProj.filePath, previewRevision, projectData);
                await this.finishSave(activeProj.id, savedRevision);
                this.app.showToast?.(`Проект сохранён: ${projectData.name}`, 'check_circle');
                return true;
            } catch (err) {
                console.error('Ошибка быстрого сохранения, пробуем сохранить как...', err);
            }
        }
        return this.saveProjectAsInternal(projectId);
    }

    saveProjectAs() {
        if (this.app.tools?.finishDocument?.() === false) return Promise.resolve(false);
        const projectId = this.app.activeProjectId;
        return this.enqueueSave(() => this.saveProjectAsInternal(projectId));
    }

    async saveProjectAsInternal(projectId) {
        await this.app.projects.find(project => project.id === projectId)?.templateLoadPromise;
        const projectData = this.serializeProject(projectId);
        if (!projectData) return false;
        const json = JSON.stringify(projectData);
        const savedRevision = this.getRevision(projectId);
        const safeDefaultName = (projectData.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.mlst';
        
        if (window.electronAPI) {
            try {
                const result = await window.electronAPI.showSaveDialog({
                    title: 'Сохранить проект MollyStudio',
                    defaultPath: safeDefaultName,
                    filters: [
                        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ]
                });
                if (!result.canceled && result.filePath) {
                    await window.electronAPI.writeFile(result.filePath, json);
                    const activeProj = this.app.projects.find(p => p.id === projectId);
                    if (activeProj) {
                        activeProj.filePath = result.filePath;
                    }
                    const previewRevision = this.createPreviewRevision();
                    this.recordRecentSafely(result.filePath, projectData, previewRevision);
                    await this.refreshSavedProjectPreview(result.filePath, previewRevision, projectData);
                    await this.finishSave(projectId, savedRevision);
                    this.app.showToast?.(`Сохранено в: ${result.filePath.split(/[\\/]/).pop()}`, 'check_circle');
                    return true;
                }
            } catch (err) {
                console.error('Ошибка сохранения:', err);
                this.app.showToast?.('Ошибка при сохранении файла!', 'error');
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

    enqueueSave(operation) {
        const pending = this.saveQueue.then(operation, operation);
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
        if (window.electronAPI) {
            try {
                const result = await window.electronAPI.showOpenDialog({
                    title: 'Открыть проект MollyStudio',
                    filters: [
                        { name: 'MollyStudio Project (*.mlst)', extensions: ['mlst'] },
                        { name: 'All Files (*.*)', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                });
                if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                    const filePath = result.filePaths[0];
                    const json = await window.electronAPI.readFile(filePath);
                    const parsed = JSON.parse(json);
                    await this.deserializeProject(parsed, filePath);
                    this.addToRecent(filePath, parsed.name, parsed.type);
                    this.app.showToast?.(`Открыт проект: ${parsed.name || 'Без названия'}`, 'folder_open');
                }
            } catch (err) {
                console.error('Ошибка открытия:', err);
                this.app.showToast?.('Не удалось открыть файл проекта!', 'error');
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
                        const parsed = JSON.parse(ev.target.result);
                        await this.deserializeProject(parsed, file.name);
                        this.addToRecent(file.name, parsed.name, parsed.type);
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

    async openRecentProject(path) {
        if (!window.electronAPI) {
            const pending = sessionStorage.getItem('molly_pending_project');
            if (pending) {
                try {
                    const data = JSON.parse(pending);
                    sessionStorage.removeItem('molly_pending_project');
                    await this.deserializeProject(data, path);
                    this.addToRecent(path, data.name, data.type);
                    this.app.showToast?.(`Открыт проект: ${data.name || 'Без названия'}`, 'folder_open');
                    return;
                } catch (e) {
                    sessionStorage.removeItem('molly_pending_project');
                    this.app.showToast?.('Не удалось прочитать файл проекта.', 'error');
                }
            }
            return;
        }
        try {
            const json = await window.electronAPI.readFile(path);
            const data = JSON.parse(json);
            await this.deserializeProject(data, path);
            this.addToRecent(path, data.name, data.type);
            this.app.showToast?.(`Открыт недавний проект: ${data.name || 'Без названия'}`, 'folder_open');
        } catch (err) {
            this.app.showToast?.('Не удалось открыть проект. Возможно, файл был удалён.', 'error');
            this.removeFromRecent(path);
            if (this.app.projects.length === 0) {
                this.app.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false);
            }
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
                    sourceDataUrl: layer.sourceCanvas ? layer.sourceCanvas.toDataURL('image/png') : null
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
                isBase: layer.isBase,
                groupId: layer.groupId || null,
                isGroup: !!layer.isGroup,
                expanded: layer.expanded !== false,
                textData: layer.textData ? { ...layer.textData } : null,
                shapeData: layer.shapeData ? { ...layer.shapeData } : null,
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
            type: project.type || 'gui',
            ...(project.type === 'prefix' ? { prefixData: structuredClone(project.prefixData) } : {}),
            ...(project.type === 'deluxemenu' ? { menuPlugin: project.menuPlugin || 'deluxemenus', deluxeData: structuredClone(project.deluxeData) } : {}),
            bg: project.bg || null,
            name: project.name || 'Новый проект',
            templateName: project.templateName || 'container_54',
            templatePath: project.templatePath || null,
            hasFrame: !!project.hasFrame,
            workspace: readWorkspaceState(this.app, project),
            config: isActiveProject ? { ...this.app.config } : { ...(project.config || {}) },
            layers: layers
        };
    }

    async deserializeProject(data, filePath = '', { recoveryDraftId = null } = {}) {
        const dimensions = validateProjectDocument(data);
        const stagedLayers = [];
        // Decode everything before changing the active document. A bad image or a tab
        // switch during decoding must not leave a partially imported project behind.
        for (const entry of data.layers) {
            const width = Number(entry.width) || dimensions.width;
            const height = Number(entry.height) || dimensions.height;
            const id = entry.id == null ? `layer_${this.createDraftId()}` : String(entry.id);
            const layer = new Layer(id, String(entry.name || 'Слой'), width, height, entry.type || 'bitmap');
            Object.assign(layer, {
                isBase: !!entry.isBase, visible: entry.visible !== false, locked: !!entry.locked,
                alphaLocked: !!entry.alphaLocked, opacity: entry.opacity == null ? 1 : Number(entry.opacity),
                blendMode: entry.blendMode || 'source-over',
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
            if (entry.sourceDataUrl && entry.sourceRect) {
                const image = await decodeProjectImage(entry.sourceDataUrl);
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                context.imageSmoothingEnabled = false;
                context.drawImage(image, 0, 0);
                layer.setMasterSource(canvas, entry.sourceRect);
            }
            stagedLayers.push(layer);
        }
        if (await this.flushAutosaves() === false) throw new Error('Не удалось сохранить открытые черновики.');
        const wasSuppressed = this.autosaveSuppressed;
        this.autosaveSuppressed = true;
        try {
            const fallbackName = filePath ? filePath.split(/[\\/]/).pop().replace(/\.mlst$/i, '') : 'Проект';
            const name = String(data.name || fallbackName);
            const type = ['canvas', 'prefix', 'deluxemenu'].includes(data.type) ? data.type : 'gui';
            const bg = ['white', 'black', 'transparent'].includes(data.bg) ? data.bg : null;
            const previousId = this.app.activeProjectId;
            this.app.addProject(name, 'none', dimensions.width, dimensions.height, false, type, bg);
            const project = this.app.projects.find(item => item.id === this.app.activeProjectId);
            if (!project || project.id === previousId) throw new Error('Не удалось создать вкладку проекта. Сначала исправьте или отмените незавершённый ввод.');
            // Files opened as documents receive their own recovery identity, even when copied.
            const importedDraftId = typeof recoveryDraftId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(recoveryDraftId)
                && !/^index$/i.test(recoveryDraftId) ? recoveryDraftId : null;
            const duplicateDraft = importedDraftId && this.app.projects.some(item => item !== project
                && item.draftId?.toLowerCase() === importedDraftId.toLowerCase());
            Object.assign(project, {
                filePath, type, bg,
                ...(type === 'prefix' ? { prefixData: structuredClone(data.prefixData) } : {}),
                ...(type === 'deluxemenu' ? { menuPlugin: data.menuPlugin || 'deluxemenus', deluxeData: structuredClone(data.deluxeData) } : {}),
                draftId: importedDraftId && !duplicateDraft ? importedDraftId : project.draftId,
                templateName: String(data.templateName || 'container_54'),
                templatePath: typeof data.templatePath === 'string' ? data.templatePath : null,
                hasFrame: !!data.hasFrame
            });
            this.app.layerManager.setLayers(stagedLayers);
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
        } finally {
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
        recent = recent.filter(r => r.path !== path);
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
        recent = recent.filter(r => r.path !== path);
        localStorage.setItem('molly_recent', JSON.stringify(recent));
        if (this.app?.renderRecentProjects) {
            this.app.renderRecentProjects();
        }
    }

    initAutosave() {
        const triggerAutosave = () => {
            if (this.autosaveSuppressed) return;
            if (this.app.tools?.pointerSession) return;
            const projectId = this.app.activeProjectId;
            const fingerprint = this.getDocumentFingerprint(projectId);
            if (this.documentFingerprints.get(projectId) === fingerprint) return;
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
        window.electronAPI?.onFlushRecoveryDrafts?.(async () => {
            if (this.app.tools?.finishDocument?.() === false) return false;
            await this.waitForPendingSaves();
            this.app.saveProjectState?.();
            if (await this.flushAutosaves() === false) return false;
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
        return JSON.stringify([config, project.name, project.bg, project.templatePath, project.prefixData, project.menuPlugin, project.deluxeData, readWorkspaceState(this.app, project), layers.map(layer =>
            [layer.id, layer.contentRevision || 0, layer.name, layer.visible, layer.locked, layer.alphaLocked,
                layer.opacity, layer.blendMode, layer.groupId, layer.textData, layer.shapeData, layer.fx])]);
    }

    markSaved(projectId, revision = this.getRevision(projectId)) {
        this.savedRevisions.set(projectId, revision);
    }

    hasUnsavedChanges(projectId) {
        return this.getRevision(projectId) !== (this.savedRevisions.get(projectId) || 0);
    }

    getDraftId(projectId = this.app.activeProjectId) {
        const project = this.app.projects.find(item => item.id === projectId);
        return project ? (project.draftId || project.id) : null;
    }

    getRevision(projectId) {
        return this.projectRevisions.get(projectId) || 0;
    }

    async finishSave(projectId, savedRevision) {
        this.markSaved(projectId, savedRevision);
        await this.autosaveInFlight.get(projectId);
        if (this.getRevision(projectId) === savedRevision) {
            return this.clearDraft(projectId, savedRevision);
        }
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

    markClean(projectId = this.app.activeProjectId) {
        if (projectId) {
            this.documentFingerprints.set(projectId, this.getDocumentFingerprint(projectId));
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
            await project.templateLoadPromise;
            if (projectId === this.app.activeProjectId) {
                if (this.app.tools?.pointerSession || this.app.tools?.tools?.marquee?.hasFloating?.()) return false;
                this.app.saveProjectState?.();
            }

            const serialized = this.serializeProject(projectId);
            if (!Array.isArray(serialized?.layers)) return false;
            const serializedRevision = this.getRevision(projectId);
            await writeRecoveryDraft(localStorage, this.getDraftId(projectId), serialized);
            this.autosaveFailures.delete(projectId);
            if (this.getRevision(projectId) !== serializedRevision) return false;
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

    async clearDraft(projectId = this.app.activeProjectId, savedRevision = this.getRevision(projectId)) {
        try {
            const draftId = this.getDraftId(projectId);
            if (draftId) await deleteRecoveryDraft(localStorage, draftId);
        } catch (error) {
            console.warn('[Autosave] Could not remove the recovery copy after saving.', error);
        }
        if (this.getRevision(projectId) !== savedRevision) {
            this.autosaveDirtyIds.add(projectId);
            this.scheduleAutosave(projectId, 250);
            return false;
        }
        this.markClean(projectId);
        return true;
    }

    async restoreCrashDraft(token = 'true') {
        try {
            const entry = await readRecoveryDraft(localStorage, token);
            if (!entry) return false;
            const { draft } = entry;
            const projName = draft.project.name || 'Безымянный проект';
            // Recovery drafts do not have a file on disk; keep this empty so Save opens Save As.
            await this.deserializeProject(draft.project, '', { recoveryDraftId: entry.draftId });
            const activeProject = this.app.projects.find(item => item.id === this.app.activeProjectId);
            this.markClean(activeProject?.id);
            if (activeProject) {
                this.queueAutosave(activeProject.id);
                const written = await this.performAutosave(activeProject.id);
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

