import { bindAttribute, uiLabel, labelHTML } from '../core/Locale.mjs';
import { normalizePrefixDocument } from '../core/PrefixDocument.mjs';
import { confirmDialog } from '../ui/ConfirmDialog.js';
import Layer from '../graphics/Layer.js';
import { normalizeProjectData } from '../core/ProjectFactory.mjs';
import { releaseProjectRenderCaches } from '../core/RenderCache.mjs';
import {attachProjectState} from '../core/typed/ProjectState.mjs';

/** App-facing controller methods; document serialization lives in core. */
export default class ProjectTabsController {
    saveProjectState() {
        if (!this.activeProjectId) return;
        const proj = this.projects.find(p => p.id === this.activeProjectId);
        if (!proj) return;

        proj.zoom = this.workspace.zoom;
        proj.autoFitOnResize = this.workspace.autoFitOnResize !== false;
        proj.panX = this.workspace.panX;
        proj.panY = this.workspace.panY;
        proj.guides = { horizontal: [...this.workspace.guides.horizontal], vertical: [...this.workspace.guides.vertical] };
        proj.guidesVisible = this.workspace.guidesVisible;
        proj.tilingMode = this.workspace.tilingMode;
        proj.referenceSrc = this.workspace.referenceImg?.getAttribute('src') || null;
        proj.referenceOpacity = this.workspace.referenceOpacity;
        proj.config = { ...this.config };
        proj.layers = this.layerManager.layers;
        proj.activeLayerId = this.layerManager.activeLayerId;
        proj.selectedLayerIds = [...this.layerManager.selectedLayerIds];
        proj.layerCounter = this.layerManager.counter;
        proj.undoStack = this.history.undoStack;
        proj.redoStack = this.history.redoStack;
    }

    loadProjectState(id) {
        const proj = this.projects.find(p => p.id === id);
        if (!proj) return;
        const state = attachProjectState(proj);

        const autosaveWasSuppressed = this.projectManager?.autosaveSuppressed ?? false;
        if (this.projectManager) this.projectManager.autosaveSuppressed = true;
        try {
            this.activeProjectId = id;
            const infoEl = document.getElementById('doc-info');
            const titleEl = document.getElementById('titlebar-doc-title');

            if (titleEl) {
                titleEl.innerText = `${proj.name} — MollyStudio`;
            }
            document.title = `${proj.name} — MollyStudio`;

            this.config.width = proj.config.width || 256;
            this.config.height = proj.config.height || 256;
            this.renderer.resize(this.config.width, this.config.height);

            this.layerManager.detachDocument?.();
            this.layerManager.clearLayers();
            if (proj.layers && proj.layers.length > 0) {
                if (proj.layers[0] instanceof Layer) {
                    this.layerManager.setLayers([...proj.layers]);
                } else {
                    this.layerManager.layers = [];
                    this.layerManager.activeLayerId = null;
                    proj.layers.forEach(lData => {
                        const layer = this.layerManager.addLayer(lData.name, null, lData.isBase, lData.type || 'bitmap');
                        if(!layer)return;
                        layer.id = lData.id;
                        layer.width = lData.width;
                        layer.height = lData.height;
                        layer.visible = lData.visible !== false;
                        layer.locked = !!lData.locked;
                        layer.alphaLocked = !!lData.alphaLocked;
                        layer.opacity = lData.opacity ?? 1.0;
                        layer.blendMode = lData.blendMode || 'source-over';
                        if (lData.textData) {
                            layer.textData = { ...lData.textData };
                        }
                        if (lData.dataUrl) {
                            const img = new Image();
                            img.src = lData.dataUrl;
                            img.onload = () => {
                                layer.ctx.imageSmoothingEnabled = false;
                                layer.ctx.clearRect(0, 0, layer.width, layer.height);
                                layer.ctx.drawImage(img, 0, 0);
                                layer.invalidateSource();
                                if (this.activeProjectId === id) this.renderer.render();
                            };
                        }
                    });
                }
            }

            this.layerManager.bindDocument?.(state.document);
            this.layerManager.counter = proj.layerCounter || 1;
            if (proj.activeLayerId) {
                this.layerManager.activeLayerId = proj.activeLayerId;
            }

            this.layerManager.selectedLayerIds = new Set(proj.selectedLayerIds || (proj.activeLayerId ? [proj.activeLayerId] : []));
            this.history.bindState?.(state.editor);
            this.history.undoStack = proj.undoStack || [];
            this.history.redoStack = proj.redoStack || [];
            this.history.notifyChanged();

            this.workspace.guides = proj.guides || { horizontal: [], vertical: [] };
            this.workspace.guidesVisible = proj.guidesVisible !== false;
            this.workspace.tilingMode = proj.tilingMode === true;
            this.workspace.referenceOpacity = proj.referenceOpacity ?? .4;
            document.getElementById('btn-toggle-guides')?.classList.toggle('active', this.workspace.guidesVisible);
            document.getElementById('btn-toggle-tiling')?.classList.toggle('active', this.workspace.tilingMode);
            if (this.workspace.referenceImg) {
                if (proj.referenceSrc) this.workspace.referenceImg.setAttribute('src', proj.referenceSrc);
                else this.workspace.referenceImg.removeAttribute('src');
                this.workspace.referenceImg.style.display = proj.referenceSrc ? 'block' : 'none';
                this.workspace.referenceImg.style.opacity = String(this.workspace.referenceOpacity);
                this.workspace.referenceImg.style.width = `${this.config.width}px`;
                this.workspace.referenceImg.style.height = `${this.config.height}px`;
            }
            const referenceBadge = document.getElementById('status-ref-badge');
            if (referenceBadge) referenceBadge.style.display = proj.referenceSrc ? 'inline-flex' : 'none';
            this.workspace.zoom = proj.zoom || 2;
            this.workspace.panX = proj.panX || 0;
            this.workspace.panY = proj.panY || 0;
            this.workspace.autoFitOnResize = proj.autoFitOnResize !== false;
            if (this.workspace.autoFitOnResize) this.workspace.fitToScreen();
            else this.workspace.updateTransform();

            if (infoEl) infoEl.innerText = `${this.config.width} × ${this.config.height} px`;

            this.renderer.render();
            this.bus.emit('CANVAS_UPDATED');
            this.layerPanel.closeLayerContextMenu?.();
            this.layerPanel.render();
            const active = this.layerManager.getActiveLayer();
            if (active) {
                this.bus.emit('LAYER_ACTIVE_CHANGED', active);
            }

            this.updateProjectTypeUI(proj);
            this.renderTabs();
            this.bus.emit('PROJECT_SWITCHED', proj.id);
        } finally {
            if (this.projectManager) this.projectManager.autosaveSuppressed = autosaveWasSuppressed;
        }
    }

    updateProjectTypeUI(proj) {
        if (!proj) proj = this.getActiveProject();
        if (!proj) return;

        const isCanvas = proj.type !== 'gui', isPrefix = proj.type === 'prefix';
        proj.prefixLoadPromise = this.prefixEditor.show(proj);
        this.guiPreviewPanel?.syncButton();

        // 1. Doc Info badge in status bar
        const infoEl = document.getElementById('doc-info');
        if (infoEl) {
            infoEl.innerHTML = `<i class="material-symbols-rounded" style="font-size: 13px; margin-right: 4px; vertical-align: middle;">${isPrefix ? 'badge' : isCanvas ? 'palette' : 'grid_view'}</i> ${this.config.width} × ${this.config.height} px${isPrefix ? ' · ' + labelHTML('Префиксы') : ''}`;
            bindAttribute(infoEl, 'title', isPrefix ? 'Префикс: {0} × {1} px. Размер определяется настройками текста и фона.'
                : 'Размер холста: {0} × {1} px — {2}. Кликните или нажмите Ctrl+Alt+C для изменения', {0:this.config.width,1:this.config.height,2:uiLabel(isCanvas?'Обычный холст':'Minecraft GUI')});
        }

        const itemsSection = document.getElementById('items-panel-section');
        itemsSection?.classList.toggle('expanded', !isCanvas);
        itemsSection?.querySelector('.md-panel-header')?.setAttribute('aria-expanded', String(!isCanvas));

        // 3. GUI Template Menu Item in File Menu
        const tplMenuItem = document.querySelector('[data-action="file-template"]');
        if (tplMenuItem) {
            if (isCanvas) {
                tplMenuItem.classList.add('disabled-action');
                tplMenuItem.style.opacity = '0.45';
                bindAttribute(tplMenuItem, "title", 'Шаблоны контейнеров доступны только для проектов типа Minecraft GUI');
            } else {
                tplMenuItem.classList.remove('disabled-action');
                tplMenuItem.style.opacity = '';
                tplMenuItem.title = '';
            }
        }

    }

    addProjectData(data) {
        let project;
        try { project = normalizeProjectData(data); }
        catch (error) { this.showToast(error.message, 'error');return false; }
        const previousId = this.activeProjectId;
        this.addProject(
            project.name,
            project.template,
            project.width,
            project.height,
            project.hasFrame,
            project.type,
            project.bg,project
        );
        return this.activeProjectId !== previousId;
    }

    addProject(name, template, w = 256, h = 256, hasFrame = false, type = 'gui', bg = 'transparent',options={}) {
        if (!['gui', 'canvas', 'prefix'].includes(type)) { this.showToast('Этот тип проекта больше не поддерживается.', 'error');return; }
        if (this.tools?.finishDocument() === false) return;
        this.saveProjectState();
        this.projectManager?.performAutosave(this.activeProjectId);

        const id = 'proj_' + Date.now() + Math.random().toString(36).substr(2, 5);
        const match = template ? template.match(/container_\d+/) : null;
        const isCanvasType = type !== 'gui';
        
        let tplName = 'generic_54';
        if (isCanvasType) {
            tplName = null;
        } else if (match) {
            tplName = match[0];
        } else if (template && template !== 'none') {
            tplName = template.replace(/\.png$/, '').split('/').pop() || 'gui';
        }

        const newProj = {
            id,
            draftId: globalThis.crypto?.randomUUID?.() || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
            type,
            ...(type === 'prefix' ? { prefixData: normalizePrefixDocument() } : {}),
            name: name || (isCanvasType ? 'Холст' : 'GUI Меню'),
            templateName: tplName,
            templatePath: isCanvasType ? null : (template && template !== 'none' ? template : null),
            hasFrame: isCanvasType ? false : (hasFrame || (template ? template.includes('_frame') : false)),
            bg: isCanvasType ? bg : null,
            config: { width: parseInt(w, 10) || (isCanvasType ? 32 : 256), height: parseInt(h, 10) || (isCanvasType ? 32 : 256) },
            layers: [],
            activeLayerId: null,
            layerCounter: 1,
            undoStack: [],
            redoStack: [],
            zoom: 2,
            panX: 0,
            panY: 0,
            autoFitOnResize: true
        };
        this.workspace.guides = { horizontal: [], vertical: [] };
        this.workspace.tilingMode = false;
        if (this.workspace.referenceImg) {
            this.workspace.referenceImg.removeAttribute('src');
            this.workspace.referenceImg.style.display = 'none';
        }
        const state = attachProjectState(newProj);
        this.projects.push(newProj);
        
        this.activeProjectId = id;

        this.config.width = newProj.config.width;
        this.config.height = newProj.config.height;
        this.renderer.resize(this.config.width, this.config.height);
        this.history.bindState?.(state.editor);
        this.history.clear();
        this.layerManager.detachDocument?.();
        this.layerManager.clearLayers();
        this.layerManager.bindDocument?.(state.document);
        this.layerPanel?.closeLayerContextMenu?.();
        this.layerPanel?.render();
        this.bus.emit('LAYER_ACTIVE_CHANGED', null);

        if (isCanvasType) {
            // Clean pixel art workspace (Aseprite style)
            if (bg === 'white' || bg === 'black') {
                const bgLayer = this.layerManager.addLayer('Фон', 0, false);
                if (bgLayer) {
                    bgLayer.ctx.fillStyle = bg === 'white' ? '#FFFFFF' : '#000000';
                    bgLayer.ctx.fillRect(0, 0, this.config.width, this.config.height);
                    bgLayer.invalidateSource();
                }
            }
            this.bus.emit('CANVAS_UPDATED');
        } else {
            // Minecraft GUI mode
            if (template && template !== 'none') {
                this.loadTemplate(template, newProj.name);
            } else {
                this.layerManager.addLayer('Заготовка GUI', 0, true);
                const base = this.layerManager.getBaseLayer();
                if (base) {
                    base.width = this.config.width;
                    base.height = this.config.height;
                    base.canvas.width = this.config.width;
                    base.canvas.height = this.config.height;
                    base.ctx.imageSmoothingEnabled = false;
                    base.clear();
                }
                this.bus.emit('CANVAS_UPDATED');
            }
        }
        this.workspace.fitToScreen();
        this.saveProjectState();
        this.projectManager?.markClean(newProj.id);
        this.projectManager?.markSaved(newProj.id);
        this.updateProjectTypeUI(newProj);
        const titleEl = document.getElementById('titlebar-doc-title');
        if (titleEl) titleEl.innerText = `${newProj.name} — MollyStudio`;
        this.renderTabs();
        this.updateDiscordPresence();
    }

    getActiveProject() {
        if (!this.projects || this.projects.length === 0) return null;
        return this.projects.find(p => p.id === this.activeProjectId) || this.projects[0];
    }

    switchProject(id) {
        if (this.activeProjectId === id || !this.projects.some(project => project.id === id)) return;
        if (this.tools?.finishDocument() === false) return;
        this.saveProjectState();
        this.projectManager?.performAutosave(this.activeProjectId);
        this.loadProjectState(id);
        this.updateDiscordPresence();
    }

async closeProject(id, event) {
        if (event) event.stopPropagation();

        const p = this.projects.find(x => x.id === id);
        if (!p) return;

        if (p.closing) return;
        if (this.activeProjectId === id && this.tools.finishDocument() === false) return;
        p.closing = true;
        try {
            if (this.settingsManager?.get('confirmClose') && this.projectManager?.hasUnsavedChanges(id)) {
                const confirmed = await confirmDialog({ title: 'Закрыть проект?', message: `Изменения в «${p.name}» не сохранены в файл. Они останутся в автокопии на главном экране.`, confirmLabel: 'Закрыть с автокопией' });
                if (!confirmed) return false;
            }
            await this.projectManager?.waitForPendingSaves();
            if (await this.projectManager?.flushProject(id) === false) {
                this.showToast('Не удалось завершить редактирование или сохранить черновик. Вкладка оставлена открытой.', 'error');
                return false;
            }

            const index = this.projects.findIndex(p => p.id === id);
            if (index === -1) return false;

            releaseProjectRenderCaches(p);
            this.projects.splice(index, 1);
            this.projectManager?.releaseProject(id);
            this.prefixEditor?.releaseProject(id);

            if (this.projects.length === 0) {
                this.activeProjectId = null;
                window.location.href = 'index.html';
                return true;
            }

            const targetIndex = Math.min(index, this.projects.length - 1);
            const focusProjectId = this.activeProjectId === id
                ? this.projects[targetIndex].id
                : this.activeProjectId;
            if (this.activeProjectId === id) {
                this.loadProjectState(focusProjectId);
            } else {
                this.renderTabs();
            }
            requestAnimationFrame(() => document.getElementById(`doc-tab-${focusProjectId}`)?.focus());
            this.updateDiscordPresence();
            return true;
        } catch(error) {
            console.error('Не удалось закрыть проект:',error);
            this.showToast('Закрытие проекта прервано. Повторите попытку после сохранения.', 'error');
            return false;
        } finally {
            p.closing = false;
        }
    }

    updateDocumentStatus() {
        const labels={new:'Не сохранён в файл',modified:'Есть изменения',saving:'Сохраняется',saved:'Сохранён',error:'Ошибка сохранения'};
        for(const project of this.projects){
            const tab=document.getElementById(`doc-tab-${project.id}`),dot=tab?.querySelector('.doc-state');if(!dot)continue;
            const state=this.projectManager.getSaveState(project.id);dot.dataset.state=state;bindAttribute(dot,'title',labels[state]);
            bindAttribute(tab, "aria-label", "{0}. {1}. Нажмите Delete, чтобы закрыть", {0: project.name, 1: uiLabel(labels[state])});
        }
    }

    renderTabs() {
        const tabBar = document.getElementById('doc-tab-container');
        if (!tabBar) return;

        tabBar.innerHTML = '';
        this.projects.forEach(p => {
            const isActive = p.id === this.activeProjectId;
            const isCanvas = p.type === 'canvas';
            const isPrefix = p.type === 'prefix';
            const tab = document.createElement('div');
            tab.className = `doc-tab ${isCanvas || isPrefix ? 'tab-canvas' : 'tab-gui'} ${isActive ? 'active' : ''}`;
            tab.title = `${p.name} (${isPrefix ? 'Префиксы' : isCanvas ? 'Обычный холст' : 'Minecraft GUI'})`;
            tab.id = `doc-tab-${p.id}`;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(isActive));
            tab.setAttribute('aria-controls', 'canvas-wrapper');
            bindAttribute(tab, "aria-label", "{0}{1}. Нажмите Delete, чтобы закрыть", {0: p.name, 1: isActive ? ', активный проект' : ''});
            tab.setAttribute('aria-keyshortcuts', 'Delete Backspace');
            tab.tabIndex = isActive ? 0 : -1;
            const zoomText = `@ ${Math.round((isActive ? this.workspace.zoom : p.zoom) * 100)}%`;
            const iconName = isPrefix ? 'badge' : isCanvas ? 'palette' : 'grid_view';
            tab.innerHTML = `
                <i class="material-symbols-rounded doc-tab-icon">${iconName}</i>
                <span class="doc-tab-title"></span>
                <span class="doc-state" aria-hidden="true"></span>
                <span class="doc-tab-zoom md-badge">${zoomText}</span>
                <span class="doc-tab-close md-icon-btn-micro" title="Закрыть проект" data-i18n-title="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82" aria-hidden="true"><i class="material-symbols-rounded">close</i></span>
            `;

            tab.querySelector('.doc-tab-title').textContent = p.name;
            tab.addEventListener('click', (event) => {
                if (event.target.closest('.doc-tab-close')) this.closeProject(p.id, event);
                else this.switchProject(p.id);
            });
            tab.addEventListener('keydown', event => {
                if (event.target === tab && (event.key === 'Delete' || event.key === 'Backspace')) {
                    event.preventDefault();
                    this.closeProject(p.id, event);
                }
            });

            tabBar.appendChild(tab);
        });
        const activeTab = tabBar.querySelector('[aria-selected="true"]');
        this.updateDocumentStatus();
        if (activeTab) requestAnimationFrame(() => activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
        const workspace = document.getElementById('canvas-wrapper');
        if (workspace && activeTab) workspace.setAttribute('aria-labelledby', activeTab.id);
        this.updateDiscordPresence();
    }
}
