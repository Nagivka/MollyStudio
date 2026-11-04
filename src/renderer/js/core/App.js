import TitleEditor from '../ui/TitleEditor.js';
import ProjectTabsController from '../controllers/ProjectTabsController.js';
import WindowLayoutController from '../controllers/WindowLayoutController.js';
import CanvasDocumentController from '../controllers/CanvasDocumentController.js';
import SessionController from '../controllers/SessionController.js';
import { bindAttribute } from './Locale.mjs';
import PrefixEditor from '../ui/PrefixEditor.js';
import { installProjectOpenRequests } from './ProjectOpenRequests.js';
import { importGeneratedButton } from './GeneratedButtonImport.js';
import { DocumentTasks } from './DocumentTasks.mjs';
import { importImage } from './ImageImport.js';
import EventBus from './EventBus.js';
import History from './History.js';
import SettingsManager from './SettingsManager.js';
import { DrawCommand } from './Commands.js';
import LayerManager from '../graphics/LayerManager.js';
import Renderer from '../graphics/Renderer.js';
import ToolManager from '../tools/ToolManager.js';
import ColorPicker from '../ui/ColorPicker.js';
import LayerPanel from '../ui/LayerPanel.js';
import ItemsPanel from '../ui/ItemsPanel.js';
import Workspace from '../ui/Workspace.js';
import MenuBar from '../ui/MenuBar.js';
import SettingsModal from '../ui/SettingsModal.js';
import ButtonGeneratorModal from '../ui/ButtonGeneratorModal.js';
import ProjectManager from './ProjectManager.mjs';
import AutoLayoutManager from './AutoLayoutManager.js';
import HistoryPanel from '../ui/HistoryPanel.js';
import ExportPanel from '../ui/ExportPanel.js';
import GuiPreviewPanel from '../ui/GuiPreviewPanel.js';
import PropertiesInspector from '../ui/PropertiesInspector.js';
import ToolOptionsBar from '../ui/ToolOptionsBar.js';
import ShortcutManager from '../ui/ShortcutManager.js';
import DesignGallery from '../ui/DesignGallery.js';
import TexturePanel from '../ui/TexturePanel.js';
import { getRussianItemName } from '../utils/MinecraftItems.js';
import { installKeyboardNavigation, isShortcutTarget } from '../ui/KeyboardNavigation.js';

export default class App {
    constructor() {
        this.mode = 'gui';
        
        this.config = {
            width: 256,
            height: 256
        };

        this.projects = [];
        this.documentTasks = new DocumentTasks();
        this.activeProjectId = null;
        this.projectStartTimestamp = Date.now();

        this.bus = new EventBus();
        this.settingsManager = new SettingsManager(this.bus);
        this.history = new History(this.bus);
        this.history.limit = this.settingsManager.get('undoLimit') || 50;
        this.bus.on('HISTORY_CHANGED', () => {
            const project = this.projects.find(item => item.id === this.activeProjectId);
            if (!project) return;
            project.undoStack = [...this.history.undoStack];
            project.redoStack = [...this.history.redoStack];
        });

        this.layerManager = new LayerManager(this.bus, this.config);
        this.renderer = new Renderer(this.bus, this.layerManager);
        this.tools = new ToolManager(this.bus, this.layerManager, this.history);
        this.colorPicker = new ColorPicker(this.bus);
        this.layerPanel = new LayerPanel(this.bus, this.layerManager, this.history);
        this.itemsPanel = new ItemsPanel(this.bus, this.layerManager, this.tools, this.history);
        this.workspace = new Workspace(this.bus, this.tools, this.config);
        this.menuBar = new MenuBar(this);
        this.settingsModal = new SettingsModal(this.bus, this.settingsManager);
        this.buttonGeneratorModal = new ButtonGeneratorModal(this);
        this.projectManager = new ProjectManager(this);
        this.bus.on('DOCUMENT_STATUS_CHANGED',()=>this.updateDocumentStatus());
        this.historyPanel = new HistoryPanel(this);
        this.prefixEditor = new PrefixEditor(this);
        this.titleEditor = new TitleEditor(this);
        this.exportPanel = new ExportPanel(this);
        this.designGallery = new DesignGallery(this);
        this.texturePanel = new TexturePanel(this);
        this.guiPreviewPanel = new GuiPreviewPanel(this);
        this.propertiesInspector = new PropertiesInspector(this);
        this.toolOptions = new ToolOptionsBar(this);
        this.autoLayout = new AutoLayoutManager(this.bus);
        this.shortcuts = new ShortcutManager(this);

        this.bus.on('SETTINGS_CHANGED', ({ key, value, settings }) => {
            if (settings?.undoLimit) {
                this.history.limit = settings.undoLimit;
            }
        });

        window.mollyEditor = this;
        this.init();
    }

    init() {
        installKeyboardNavigation();
        this.setupEventListeners();
        this.setupModals();
        this.setupCanvasSizeModal();
        this.setupM3Sliders();
        this.setupResizablePanels();
        this.setupPropertiesPanel();
        this.setupDiscordPresence();
        this.projectManager.initAutosave();
        this.setupAutosave();

        const syncToolSettings = () => {
            const lockEl = document.getElementById('move-lock-aspect');
            if (lockEl) lockEl.checked = Boolean(this.settingsManager.get('moveLockAspect'));
            const propLock=document.getElementById('prop-lock-aspect');if(propLock)propLock.checked=Boolean(this.settingsManager.get('moveLockAspect'));
        };
        syncToolSettings();
        this.bus.on('SETTINGS_CHANGED', () => {
            this.setupAutosave();
            syncToolSettings();
        });

        const mainCanvas = document.getElementById('main-canvas');
        const previewCanvas = document.getElementById('preview-canvas');
        const canvasWrapper = document.getElementById('canvas-wrapper');

        if (this.renderer && mainCanvas) this.renderer.init(mainCanvas, previewCanvas);
        if (this.workspace && canvasWrapper) this.workspace.init(canvasWrapper, mainCanvas);

        // Parse query parameters from Launcher (index.html)
        const urlParams = new URLSearchParams(window.location.search);
        const file = urlParams.get('file');
        const isNew = urlParams.get('new') === 'true';
        const restoreDraft = urlParams.get('restoreDraft');

        if (restoreDraft) {
            this.projectManager.restoreCrashDraft(restoreDraft).then(restored => {
                if (!restored && !this.projects.length) {
                    this.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false, 'gui');
                    this.projectManager.markClean();
                }
            });
        } else if (file) {
            this.projectManager.openRecentProject(file, { fromSession: urlParams.get('source') === 'session' });
        } else if (isNew) {
            this.addProjectData({
                type: urlParams.get('type') || 'gui',
                name: urlParams.get('name'),
                template: urlParams.get('template') || 'container/default/container_54.png',
                width: urlParams.get('width') || undefined,
                height: urlParams.get('height') || undefined,
                bg: urlParams.get('bg') || 'transparent',
            });
            if (!this.projects.length) this.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false, 'gui');
            this.projectManager.markClean();
        } else if (!urlParams.has('external')) {
            this.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false, 'gui');
            this.projectManager.markClean();
        }

        installProjectOpenRequests({ manager: this.projectManager });
        // Listen for new projects created in the separate New Project window
        window.desktopAPI?.onProjectCreated?.((projectData) => {
            if (projectData) {
                if (this.addProjectData(projectData)) this.showToast(`Проект "${projectData.name}" создан!`, 'add_circle');
            }
        });

        // Listen for buttons generated from the standalone Button Generator window
        window.desktopAPI?.onButtonGenerated?.((buttonData) => {
            if (buttonData) {
                return this.insertGeneratedButton(buttonData);
            }
            return false;
        });

        // BroadcastChannel listener for button generator imports across tabs or windows
        try {
            const btnBc = new BroadcastChannel('molly_button_generator');
            btnBc.onmessage = (e) => {
                if (e.data?.action === 'insert_button' && e.data.data) {
                    void this.insertGeneratedButton(e.data.data).catch(error => this.showToast(error.message, 'error'));
                }
            };
        } catch (_) {}
    }

    setupPropertiesPanel() {
        // Property Recolor Buttons
        document.getElementById('btn-prop-text-recolor')?.addEventListener('click', () => {
            const color = this.tools?.color || '#3B82F6';
            this.bus.emit('RECOLOR_ACTIVE_LAYER', color);
        });

        document.getElementById('btn-prop-shape-recolor')?.addEventListener('click', () => {
            const color = this.tools?.color || '#3B82F6';
            const active = this.layerManager?.getActiveLayer();
            if (active && active.shapeData) {
                this.editShapeLayer(active, { color });
            } else {
                this.bus.emit('RECOLOR_ACTIVE_LAYER', color);
            }
        });

        // Marquee selection buttons in Properties
        const bindMarqueeBtn = (propId, actionFn) => {
            document.getElementById(propId)?.addEventListener('click', () => {
                const marquee = this.tools?.tools?.['marquee'];
                if (marquee) {actionFn(marquee);this.syncPropertiesPanel();}
            });
        };

        bindMarqueeBtn('btn-prop-sel-copy', (m) => m.copy());
        bindMarqueeBtn('btn-prop-sel-cut', (m) => m.cut());
        bindMarqueeBtn('btn-prop-sel-paste', (m) => m.paste());
        bindMarqueeBtn('btn-prop-sel-fill', (m) => m.fillSelection());
        bindMarqueeBtn('btn-prop-sel-stroke', (m) => m.strokeSelection());
        bindMarqueeBtn('btn-prop-sel-delete', (m) => m.deleteSelection());
        bindMarqueeBtn('btn-prop-sel-fliph', (m) => m.flipFloating(true, false));
        bindMarqueeBtn('btn-prop-sel-flipv', (m) => m.flipFloating(false, true));
        bindMarqueeBtn('btn-prop-sel-deselect', (m) => m.clearSelection());

        this.bus.on('LAYER_ACTIVE_CHANGED', () => this.syncPropertiesPanel());
        this.bus.on('LAYER_NAME_CHANGED', () => this.syncPropertiesPanel());
        this.bus.on('LAYER_SELECTION_CHANGED', () => this.syncPropertiesPanel());
        this.bus.on('SELECTION_CLIPBOARD_CHANGED', () => this.syncPropertiesPanel());
        let propertiesScheduled = false;
        this.bus.on('CANVAS_UPDATED', () => {
            if (propertiesScheduled) return;
            propertiesScheduled = true;
            requestAnimationFrame(() => {
                propertiesScheduled = false;
                this.syncPropertiesPanel();
            });
        });
        this.bus.on('PROJECT_SWITCHED', () => this.syncPropertiesPanel());
        this.bus.on('TOOL_CHANGED', () => this.syncPropertiesPanel());
    }

    editShapeLayer(active, changes) {
        if (!active?.shapeData || !this.layerManager.isEditable(active)) return;
        const next={...active.shapeData,...changes};
        if(JSON.stringify(next)===JSON.stringify(active.shapeData))return;
        const before = active.getImageData();
        try {
            active.shapeData = next;active.objectType=next.type;
            this.redrawShapeLayer(active);
        } catch (error) {
            active.putImageData(before);
            active.contentRevision=before.mollySnapshot?.contentRevision??active.contentRevision;
            this.bus.emit('CANVAS_UPDATED');
            this.showToast('Не удалось изменить фигуру. Исходное состояние восстановлено.','error');
            return false;
        }
        this.history.push(new DrawCommand(active, before, active.getImageData(), 'Свойства фигуры', 'category'));
    }

    redrawShapeLayer(active) {
        if (!active || !active.shapeData) return;
        active.clear();
        const d = active.shapeData;
        if (d.type && d.type.startsWith('rect')) {
            const rectTool = this.tools?.tools?.['rect-empty'] || this.tools?.tools?.['rect-filled'];
            if (rectTool) {
                rectTool.drawRect(active.ctx, d.x0, d.y0, d.x1, d.y1, d.color, d.stroke || 1, d.filled??d.type.endsWith('-filled'), d.radius || 0);
            }
        } else if (d.type && d.type.startsWith('circle')) {
            const circleTool = this.tools?.tools?.['circle-empty'] || this.tools?.tools?.['circle-filled'];
            if (circleTool) {
                circleTool.drawEllipse(active.ctx, d.x0, d.y0, d.x1, d.y1, d.color, d.stroke || 1, d.filled??d.type.endsWith('-filled'));
            }
        } else if (d.type === 'line') {
            const lineTool = this.tools?.tools?.['line'];
            if (lineTool) {
                lineTool.drawLine(active.ctx, d.x0, d.y0, d.x1, d.y1, d.color, d.stroke || 1);
            }
        }
        active.invalidateSource();
        this.bus.emit('CANVAS_UPDATED');
    }

    syncPropertiesPanel() {
        this.propertiesInspector?.sync();
    }

    setupEventListeners() {
        // Quick Settings Button Trigger
        document.getElementById('btn-top-settings')?.addEventListener('click', () => {
            if (window.desktopAPI?.openSettingsWindow) {
                window.desktopAPI.openSettingsWindow();
            } else {
                this.settingsModal.open();
            }
        });

        // Button Generator Triggers
        document.getElementById('btn-toolbar-btn-gen')?.addEventListener('click', () => {
            this.openButtonGenerator();
        });
        document.getElementById('btn-layer-btn-gen')?.addEventListener('click', () => {
            this.openButtonGenerator();
        });

        // Quick Recolor / Color Swap (Shift+R)
        document.getElementById('btn-quick-recolor')?.addEventListener('click', () => {
            this.openQuickRecolor();
        });

        document.addEventListener('keydown', (e) => {
            if (isShortcutTarget(e.target, e)) return;
            if (e.shiftKey && (e.key === 'R' || e.key === 'r' || e.key === 'к' || e.key === 'К') && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                this.openQuickRecolor();
            }
        });

        // Horizontal mouse wheel scrolling for Options Bar & Tabs
        const optBar = document.querySelector('.options-bar');
        optBar?.addEventListener('wheel', (e) => {
            if (e.deltaY && !e.shiftKey) {
                optBar.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        }, { passive: false });

        const tabBar = document.getElementById('doc-tab-container') || document.querySelector('.doc-tab-bar');
        tabBar?.addEventListener('wheel', (e) => {
            if (e.deltaY && !e.shiftKey) {
                tabBar.scrollLeft += e.deltaY;
                e.preventDefault();
            }
        }, { passive: false });

        // Template selector in GUI
        const btnTopTemplate = document.getElementById('btn-top-template');
        if (btnTopTemplate) {
            btnTopTemplate.addEventListener('click', () => {
                const modal = document.getElementById('template-modal');
                if (modal) modal.classList.add('show');
            });
        }

        // Texture import in GUI
        const btnImportTexture = document.getElementById('btn-import-texture');
        const inputImportTexture = document.getElementById('input-import-texture');
        if (btnImportTexture && inputImportTexture) {
            btnImportTexture.addEventListener('click', () => inputImportTexture.click());
            inputImportTexture.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                void this.importImage(file, {name: getRussianItemName(file.name), position: 'origin'});
                e.target.value = '';
            });
        }

        // Export button
        const btnExport = document.getElementById('btn-export-png');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportPanel.open());
        }

        // Recolor active layer
        this.bus.on('RECOLOR_ACTIVE_LAYER', (hex) => {
            this.recolorActiveLayer(hex);
        });

        // Add Tab button
        const btnAddTab = document.getElementById('btn-add-tab');
        if (btnAddTab) {
            btnAddTab.addEventListener('click', () => {
                if (window.desktopAPI?.openNewProjectWindow) {
                    window.desktopAPI.openNewProjectWindow();
                } else {
                    const modal = document.getElementById('new-project-modal');
                    if (modal) {
                        modal.classList.add('show');
                        document.getElementById('new-proj-name')?.focus();
                    }
                }
            });
        }

        // Frameless titlebar controls (Electron and browser preview)
        const btnWinMin = document.getElementById('btn-win-min');
        const btnWinMax = document.getElementById('btn-win-max');
        const btnWinClose = document.getElementById('btn-win-close');
        const iconWinMax = document.getElementById('icon-win-max');

        const maxSvg = `<rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="0.5"/>`;
        const restoreSvg = `<rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1" rx="0.5"/><path d="M3 1h5.5a.5.5 0 0 1 .5.5V7" fill="none" stroke="currentColor" stroke-width="1.1"/>`;

        const updateMaxUI = (isMax) => {
            if (iconWinMax) iconWinMax.innerHTML = isMax ? restoreSvg : maxSvg;
            if (btnWinMax) {
                bindAttribute(btnWinMax, "title", isMax ? 'Восстановить окно' : 'Развернуть');
                bindAttribute(btnWinMax, 'aria-label', isMax ? 'Восстановить' : 'Развернуть');
            }
        };

        const handleWinMin = (e) => {
            e?.stopPropagation?.();
            if (window.desktopAPI?.minimize) window.desktopAPI.minimize();
            else if (window.DesktopBridge?.minimize) window.DesktopBridge.minimize();
        };

        const handleWinMax = async (e) => {
            e?.stopPropagation?.();
            let isMax = false;
            if (window.desktopAPI?.maximize) {
                isMax = await window.desktopAPI.maximize();
            } else if (window.DesktopBridge?.maximize) {
                isMax = await window.DesktopBridge.maximize();
            } else {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen?.();
                    isMax = true;
                } else {
                    await document.exitFullscreen?.();
                    isMax = false;
                }
            }
            updateMaxUI(isMax);
        };

        const handleWinClose = (e) => {
            e?.stopPropagation?.();
            if (window.desktopAPI?.close) window.desktopAPI.close();
            else if (window.DesktopBridge?.close) window.DesktopBridge.close();
            else this.confirmAndGoHome();
        };

        btnWinMin?.addEventListener('click', handleWinMin);
        btnWinMax?.addEventListener('click', handleWinMax);
        btnWinClose?.addEventListener('click', handleWinClose);

        // Titlebar double-click to maximize/restore
        const customTitlebar = document.querySelector('.custom-titlebar');
        customTitlebar?.addEventListener('dblclick', (e) => {
            if (!e.target.closest('.titlebar-controls') && !e.target.closest('button')) {
                handleWinMax(e);
            }
        });

        if (window.desktopAPI?.onWindowStateChange) {
            window.desktopAPI.onWindowStateChange((isMax) => {
                updateMaxUI(isMax);
            });
        }
        window.desktopAPI?.isMaximized?.()?.then?.((isMax) => {
            updateMaxUI(!!isMax);
        })?.catch?.(() => {});

        document.addEventListener('fullscreenchange', () => {
            if (!window.desktopAPI) {
                updateMaxUI(!!document.fullscreenElement);
            }
        });
    }

    openButtonGenerator() {
        if (window.desktopAPI?.openButtonGeneratorWindow) {
            window.desktopAPI.openButtonGeneratorWindow();
        } else {
            this.buttonGeneratorModal?.open();
        }
    }

    async insertGeneratedButton(buttonData) {
        const project = this.getActiveProject();
        return this.documentTasks.run(() => {
            if (this.getActiveProject() !== project) throw new Error('Вкладка изменилась. Повторите вставку в нужном проекте.');
            return importGeneratedButton(this, buttonData);
        });
    }

    async importImage(source, options) {
        const project = this.getActiveProject();
        try { return await this.documentTasks.run(() => {
            if (this.getActiveProject() !== project) throw new Error('Вкладка изменилась. Повторите импорт в нужном проекте.');
            return importImage(this, source, options);
        }); }
        catch (error) { this.showToast(error.message || 'Не удалось импортировать изображение.', 'error'); return false; }
    }

    async confirmAndGoHome() {
        if (await this.projectManager.flushDocumentsForClose() === false) {
            this.showToast('Не удалось сохранить черновики. Переход отменён.', 'error');
            return;
        }
        window.location.href = 'index.html';
    }
}

// Preserve the public App API while each responsibility has a focused owner.
for(const Controller of [ProjectTabsController,WindowLayoutController,CanvasDocumentController,SessionController]) {
    const descriptors=Object.getOwnPropertyDescriptors(Controller.prototype);delete descriptors.constructor;Object.defineProperties(App.prototype,descriptors);
}
