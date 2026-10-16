import PrefixEditor from '../ui/PrefixEditor.js';
import DeluxeMenusEditor from '../ui/DeluxeMenusEditor.js';
import { normalizePrefixDocument } from './PrefixDocument.mjs';
import { isControlFocused } from '../ui/ControlFocus.js';
import { confirmDialog } from '../ui/ConfirmDialog.js';
import { preparePngExport } from '../graphics/ExportImage.js';
import EventBus from './EventBus.js';
import History, { estimateCommandBytes } from './History.js';
import SettingsManager from './SettingsManager.js';
import { DrawCommand, AddLayerCommand, CompoundCommand, LayerPropertyCommand, TextDataCommand, ResizeCanvasCommand, TemplateCommand } from './Commands.js';
import Layer from '../graphics/Layer.js';
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
import { getRussianItemName } from '../utils/MinecraftItems.js';
import { installKeyboardNavigation, isShortcutTarget } from '../ui/KeyboardNavigation.js';
import { createProjectFromForm, normalizeProjectData, resolveGuiTemplate } from './ProjectFactory.mjs';

export default class App {
    constructor() {
        this.mode = 'gui';
        
        this.config = {
            width: 256,
            height: 256
        };

        this.projects = [];
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
        this.prefixEditor = new PrefixEditor(this);
        this.deluxeMenusEditor = new DeluxeMenusEditor(this);
        this.autoLayout = new AutoLayoutManager(this.bus);

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
            this.projectManager.openRecentProject(file);
        } else if (isNew) {
            this.addProjectData({
                type: urlParams.get('type') || 'gui',
                menuPlugin: urlParams.get('menuPlugin') || 'deluxemenus',
                name: urlParams.get('name'),
                template: urlParams.get('template') || 'container/default/container_54.png',
                width: urlParams.get('width') || undefined,
                height: urlParams.get('height') || undefined,
                bg: urlParams.get('bg') || 'transparent'
            });
            this.projectManager.markClean();
        } else {
            this.addProject('GUI Меню', 'container/default/container_54.png', 256, 256, false, 'gui');
            this.projectManager.markClean();
        }

        // Listen for new projects created in the separate New Project window
        window.electronAPI?.onProjectCreated?.((projectData) => {
            if (projectData) {
                this.addProjectData(projectData);
                this.showToast(`Проект "${projectData.name}" создан!`, 'add_circle');
            }
        });

        // Listen for buttons generated from the standalone Button Generator window
        window.electronAPI?.onButtonGenerated?.((buttonData) => {
            if (buttonData) {
                this.insertGeneratedButton(buttonData);
            }
        });

        // BroadcastChannel listener for button generator imports across tabs or windows
        try {
            const btnBc = new BroadcastChannel('molly_button_generator');
            btnBc.onmessage = (e) => {
                if (e.data?.action === 'insert_button' && e.data.data) {
                    this.insertGeneratedButton(e.data.data);
                }
            };
        } catch (_) {}
    }

    setupResizablePanels() {
        // 1. Right Inspector Width Resizer
        const vResizer = document.getElementById('right-panel-resizer');
        const savedPanelWidth = localStorage.getItem('molly_panel_width');
        if (savedPanelWidth) {
            document.documentElement.style.setProperty('--md-panel-width', `${savedPanelWidth}px`);
        }

        if (vResizer) {
            let isDraggingV = false;
            let startX = 0;
            let startWidth = 250;

            vResizer.addEventListener('pointerdown', (e) => {
                isDraggingV = true;
                startX = e.clientX;
                const panel = document.getElementById('main-right-panel');
                startWidth = panel ? panel.getBoundingClientRect().width : 250;
                document.body.classList.add('resizing-v');
                vResizer.setPointerCapture(e.pointerId);
            });

            window.addEventListener('pointermove', (e) => {
                if (!isDraggingV) return;
                const dx = startX - e.clientX;
                const maxAllowed = Math.min(520, Math.floor(window.innerWidth * 0.45));
                const newWidth = Math.max(180, Math.min(maxAllowed, startWidth + dx));
                document.documentElement.style.setProperty('--md-panel-width', `${newWidth}px`);
                localStorage.setItem('molly_panel_width', newWidth);
                this.colorPicker?.resizeSB();
            });

            const stopDragV = (e) => {
                if (isDraggingV) {
                    isDraggingV = false;
                    document.body.classList.remove('resizing-v');
                    this.colorPicker?.resizeSB();
                    if (e.pointerId != null) {
                        try { vResizer.releasePointerCapture(e.pointerId); } catch (_) {}
                    }
                }
            };

            window.addEventListener('pointerup', stopDragV);
            window.addEventListener('pointercancel', stopDragV);

            const panel = document.getElementById('main-right-panel');
            if (panel && window.ResizeObserver) {
                const ro = new ResizeObserver(() => {
                    this.colorPicker?.resizeSB();
                });
                ro.observe(panel);
            }
        }

        // 2. Auto-sizing Layer Manager Panel (Content & Flex-aware, no manual dragging needed)
        try {
            localStorage.removeItem('molly_layers_height');
        } catch (_) {}
        const layersBody = document.getElementById('layers-list-scroll-body');
        if (layersBody) {
            layersBody.style.height = '';
            layersBody.style.maxHeight = '';
        }
    }

    setupPropertiesPanel() {
        const blendSelect = document.getElementById('prop-layer-blend');
        const opSlider = document.getElementById('prop-layer-opacity-slider');
        const opVal = document.getElementById('prop-layer-opacity-val');

        let beforeOp = 1;

        if (blendSelect) {
            blendSelect.addEventListener('change', (e) => {
                const active = this.layerManager?.getActiveLayer();
                if (!active) return;
                const oldMode = active.blendMode || 'source-over';
                const newMode = e.target.value;
                if (this.history) {
                    this.history.push(new LayerPropertyCommand(active, 'blendMode', oldMode, newMode, this.bus));
                }
                active.blendMode = newMode;
                this.bus.emit('CANVAS_UPDATED');
            });
        }

        // Shape radius control in Properties panel
        const shapeRadiusNum = document.getElementById('prop-shape-radius-num');
        if (shapeRadiusNum) {
            shapeRadiusNum.addEventListener('change', (e) => {
                const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                shapeRadiusNum.value = val;
                const active = this.layerManager?.getActiveLayer();
                if (active && active.shapeData) {
                    this.editShapeLayer(active, { radius: val });
                }
            });
        }

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
                if (marquee) actionFn(marquee);
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
        const before = active.getImageData();
        active.shapeData = { ...active.shapeData, ...changes };
        this.redrawShapeLayer(active);
        this.history.push(new DrawCommand(active, before, active.getImageData(), 'Свойства фигуры', 'category'));
    }

    redrawShapeLayer(active) {
        if (!active || !active.shapeData) return;
        active.clear();
        const d = active.shapeData;
        if (d.type && d.type.startsWith('rect')) {
            const rectTool = this.tools?.tools?.['rect-empty'] || this.tools?.tools?.['rect-filled'];
            if (rectTool) {
                rectTool.drawRect(active.ctx, d.x0, d.y0, d.x1, d.y1, d.color, d.stroke || 1, d.filled, d.radius || 0);
            }
        } else if (d.type && d.type.startsWith('circle')) {
            const circleTool = this.tools?.tools?.['circle-empty'] || this.tools?.tools?.['circle-filled'];
            if (circleTool) {
                circleTool.drawEllipse(active.ctx, d.x0, d.y0, d.x1, d.y1, d.color, d.stroke || 1, d.filled);
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
        const active = this.layerManager?.getActiveLayer();
        const activeTool = this.tools?.currentToolId;
        const marquee = this.tools?.tools?.['marquee'];

        const titleRow = document.getElementById('prop-title-row');
        const nameEl = document.getElementById('prop-layer-name');
        const badgeEl = document.getElementById('prop-target-type-badge');
        const dimBadge = document.getElementById('prop-dimension-badge');
        const emptyState = document.getElementById('prop-empty-state');

        const posX = document.getElementById('prop-pos-x');
        const posY = document.getElementById('prop-pos-y');
        const sizeW = document.getElementById('prop-size-w');
        const sizeH = document.getElementById('prop-size-h');
        const fieldW = document.getElementById('prop-field-w');
        const fieldH = document.getElementById('prop-field-h');
        const fieldLock = document.getElementById('prop-field-lock');

        const groupText = document.getElementById('prop-group-text');
        const groupShape = document.getElementById('prop-group-shape');
        const shapeRadiusRow = document.getElementById('prop-shape-radius-row');
        const shapeRadiusNum = document.getElementById('prop-shape-radius-num');

        const groupSel = document.getElementById('prop-group-selection');
        const groupCoords = document.getElementById('prop-group-coords');
        const groupAlign = document.getElementById('prop-group-align');
        const groupTransform = document.getElementById('prop-group-transform');
        const groupColor = document.getElementById('prop-group-color');

        const show = (el, visible) => {
            if (el) el.style.display = visible ? 'block' : 'none';
        };

        const hasMarquee = marquee && marquee.selection && (marquee.isSelecting || marquee.hasFloating?.() || activeTool === 'marquee');

        if (hasMarquee) {
            show(emptyState, false);
            if (titleRow) titleRow.style.display = 'flex';
            if (badgeEl) badgeEl.style.display = 'inline-flex';
            show(groupSel, true);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, true);
            show(groupText, false);
            show(groupShape, false);

            if (fieldW) fieldW.style.display = 'flex';
            if (fieldH) fieldH.style.display = 'flex';
            if (fieldLock) fieldLock.style.display = 'block';

            if (nameEl) nameEl.innerText = marquee.hasFloating?.() ? 'Плавающее выделение' : 'Область выделения';
            if (badgeEl) badgeEl.innerText = 'Выделение';
            const selW = Math.round(marquee.selection.width || 0);
            const selH = Math.round(marquee.selection.height || 0);
            if (dimBadge) dimBadge.innerText = `${selW} × ${selH} px`;
            if (posX && !isControlFocused(posX)) posX.value = Math.round(marquee.selection.x || 0);
            if (posY && !isControlFocused(posY)) posY.value = Math.round(marquee.selection.y || 0);
            if (sizeW && !isControlFocused(sizeW)) sizeW.value = selW;
            if (sizeH && !isControlFocused(sizeH)) sizeH.value = selH;
            return;
        }

        if (!active) {
            show(emptyState, true);
            if (titleRow) titleRow.style.display = 'none';
            if (badgeEl) badgeEl.style.display = 'none';
            show(groupText, false);
            show(groupShape, false);
            show(groupSel, false);
            show(groupCoords, false);
            show(groupAlign, false);
            show(groupTransform, false);
            show(groupColor, false);
            return;
        }

        show(emptyState, false);
        if (titleRow) titleRow.style.display = 'flex';
        if (badgeEl) badgeEl.style.display = 'inline-flex';
        show(groupSel, false);

        // Detect kind of the selected active object
        let kind = 'bitmap';
        if (active.type === 'text') {
            kind = 'text';
        } else if (active.isBase) {
            kind = 'base';
        } else if (active.isGroup || active.type === 'group') {
            kind = 'group';
        } else if (active.shapeData?.type) {
            kind = active.shapeData.type;
        } else if (active.objectType) {
            kind = active.objectType;
        } else if (active.name) {
            const n = active.name.toLowerCase();
            if (n.startsWith('контур прямоугольника') || n.startsWith('контур квадрата')) {
                kind = 'rect-empty';
            } else if (n.startsWith('прямоугольник') || n.startsWith('квадрат')) {
                kind = 'rect-filled';
            } else if (n.startsWith('контур круга') || n.startsWith('контур эллипса')) {
                kind = 'circle-empty';
            } else if (n.startsWith('круг') || n.startsWith('эллипс')) {
                kind = 'circle-filled';
            } else if (n.startsWith('линия')) {
                kind = 'line';
            } else if (n.startsWith('кнопка')) {
                kind = 'button';
            } else if (active.masterSource) {
                kind = 'item';
            }
        }

        if (kind === 'text') {
            show(groupText, true);
            show(groupCoords, true);
            show(groupAlign, false);
            show(groupTransform, false);
            show(groupColor, false);
            show(groupShape, false);

            if (fieldW) fieldW.style.display = 'none';
            if (fieldH) fieldH.style.display = 'none';
            if (fieldLock) fieldLock.style.display = 'none';

            if (badgeEl) badgeEl.innerText = 'Текст';
        } else if (kind === 'base') {
            show(groupText, false);
            show(groupShape, false);
            show(groupCoords, false);
            show(groupAlign, false);
            show(groupTransform, false);
            show(groupColor, true);

            if (badgeEl) badgeEl.innerText = 'Фон';
        } else if (kind === 'group') {
            show(groupText, false);
            show(groupShape, false);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, false);

            if (fieldW) fieldW.style.display = 'none';
            if (fieldH) fieldH.style.display = 'none';
            if (fieldLock) fieldLock.style.display = 'none';

            if (badgeEl) badgeEl.innerText = 'Папка';
        } else if (kind === 'rect-empty' || kind === 'rect-filled') {
            show(groupText, false);
            show(groupShape, true);
            show(shapeRadiusRow, true);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, true);

            if (fieldW) fieldW.style.display = 'flex';
            if (fieldH) fieldH.style.display = 'flex';
            if (fieldLock) fieldLock.style.display = 'block';

            if (active.shapeData && shapeRadiusNum) {
                shapeRadiusNum.value = active.shapeData.radius || 0;
            }

            if (badgeEl) badgeEl.innerText = (kind === 'rect-empty') ? 'Контур' : 'Фигура';
        } else if (kind === 'circle-empty' || kind === 'circle-filled') {
            show(groupText, false);
            show(groupShape, false);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, true);

            if (fieldW) fieldW.style.display = 'flex';
            if (fieldH) fieldH.style.display = 'flex';
            if (fieldLock) fieldLock.style.display = 'block';

            if (badgeEl) badgeEl.innerText = (kind === 'circle-empty') ? 'Контур' : 'Фигура';
        } else if (kind === 'line') {
            show(groupText, false);
            show(groupShape, false);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, true);

            if (fieldW) fieldW.style.display = 'flex';
            if (fieldH) fieldH.style.display = 'flex';
            if (fieldLock) fieldLock.style.display = 'block';

            if (badgeEl) badgeEl.innerText = 'Линия';
        } else {
            show(groupText, false);
            show(groupShape, false);
            show(groupCoords, true);
            show(groupAlign, true);
            show(groupTransform, true);
            show(groupColor, true);

            if (fieldW) fieldW.style.display = 'flex';
            if (fieldH) fieldH.style.display = 'flex';
            if (fieldLock) fieldLock.style.display = 'block';

            if (badgeEl) {
                if (kind === 'button') {
                    badgeEl.innerText = 'Кнопка';
                } else if (kind === 'item' || active.masterSource) {
                    badgeEl.innerText = 'Объект';
                } else {
                    badgeEl.innerText = 'Слой';
                }
            }
        }

        if (nameEl) nameEl.innerText = active.name || 'Слой';

        // If MoveTool is actively transforming/moving, MoveTool updates coordinates directly
        const moveTool = this.tools?.tools?.['move'];
        if (moveTool && moveTool.currentBox && (moveTool.isMoving || moveTool.isTransforming)) {
            return;
        }

        if (active.type === 'text' && active.textData) {
            if (posX && !isControlFocused(posX)) posX.value = Math.round(active.textData.x || 0);
            if (posY && !isControlFocused(posY)) posY.value = Math.round(active.textData.y || 0);
            if (dimBadge) dimBadge.innerText = `Текст: "${active.textData.text || ''}"`;
            this.tools?.tools?.['text']?.syncUIWithLayer?.(active);
        } else {
            const b = (moveTool && moveTool.getLayerBoundingBox) ? moveTool.getLayerBoundingBox(active) : null;
            if (b) {
                if (posX && !isControlFocused(posX)) posX.value = b.x;
                if (posY && !isControlFocused(posY)) posY.value = b.y;
                if (sizeW && !isControlFocused(sizeW)) sizeW.value = b.w;
                if (sizeH && !isControlFocused(sizeH)) sizeH.value = b.h;
                if (dimBadge) dimBadge.innerText = `${b.w} × ${b.h} px`;
            } else {
                if (posX && !isControlFocused(posX)) posX.value = 0;
                if (posY && !isControlFocused(posY)) posY.value = 0;
                if (sizeW && !isControlFocused(sizeW)) sizeW.value = active.width;
                if (sizeH && !isControlFocused(sizeH)) sizeH.value = active.height;
                if (dimBadge) dimBadge.innerText = `${active.width} × ${active.height} px`;
            }
        }
    }

    setupM3Sliders() {
        const updateSlider = (s) => {
            if (!s) return;
            const min = parseFloat(s.min) || 0;
            const max = parseFloat(s.max) || 100;
            const val = parseFloat(s.value) || 0;
            const pct = Math.max(0, Math.min(100, ((val - min) / (max - min || 1)) * 100));
            s.style.setProperty('--progress', `${pct}%`);
        };

        const updateAll = () => {
            document.querySelectorAll('input[type="range"]').forEach(updateSlider);
        };

        updateAll();
        document.addEventListener('input', (e) => {
            if (e.target && e.target.type === 'range') {
                updateSlider(e.target);
            }
        });
        document.addEventListener('change', (e) => {
            if (e.target && e.target.type === 'range') {
                updateSlider(e.target);
            }
        });
        this.bus.on('CANVAS_UPDATED', updateAll);
        this.bus.on('LAYER_ACTIVE_CHANGED', updateAll);
    }

    openQuickRecolor() {
        const modal = document.getElementById('recolor-modal');
        if (!modal) return;
        const curFg = this.colorPicker?.getColor() || '#3B82F6';
        const curBg = this.colorPicker?.getBgColor() || '#000000';
        const fromColor = document.getElementById('recolor-from-color');
        const fromHex = document.getElementById('recolor-from-hex');
        const toColor = document.getElementById('recolor-to-color');
        const toHex = document.getElementById('recolor-to-hex');

        if (fromColor) fromColor.value = curFg;
        if (fromHex) fromHex.value = curFg.toUpperCase();
        if (toColor) toColor.value = curBg;
        if (toHex) toHex.value = curBg.toUpperCase();

        modal.classList.add('show');
    }

    setupEventListeners() {
        // Quick Settings Button Trigger
        document.getElementById('btn-top-settings')?.addEventListener('click', () => {
            if (window.electronAPI?.openSettingsWindow) {
                window.electronAPI.openSettingsWindow();
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
                
                const targetProjectId = this.activeProjectId;
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        if (this.activeProjectId !== targetProjectId) {
                            this.showToast('Вкладка изменилась. Повторите импорт текстуры.', 'info');
                            return;
                        }
                        if (img.naturalWidth > 4096 || img.naturalHeight > 4096) {
                            this.showToast('Размер текстуры должен быть не больше 4096 × 4096.', 'error');
                            return;
                        }
                        const layerTitle = getRussianItemName(file.name);
                        const layer = this.layerManager.addLayer(layerTitle);
                        layer.ctx.imageSmoothingEnabled = false;
                        layer.ctx.drawImage(img, 0, 0);

                        const srcC = document.createElement('canvas');
                        const natW = img.naturalWidth || img.width;
                        const natH = img.naturalHeight || img.height;
                        srcC.width = natW;
                        srcC.height = natH;
                        const sCtx = srcC.getContext('2d');
                        sCtx.imageSmoothingEnabled = false;
                        sCtx.drawImage(img, 0, 0, natW, natH);
                        layer.setMasterSource(srcC, { x: 0, y: 0, w: img.width, h: img.height });

                        if (this.history) {
                            this.history.push(new AddLayerCommand(this.layerManager, layer));
                        }
                        this.bus.emit('CANVAS_UPDATED');
                        this.bus.emit('REQUEST_TOOL_CHANGE', 'move');
                    };
                    img.onerror = () => this.showToast('Не удалось прочитать текстуру.', 'error');
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
                e.target.value = '';
            });
        }

        // Export button
        const btnExport = document.getElementById('btn-export-png');
        if (btnExport) {
            btnExport.addEventListener('click', () => this.exportPNG());
        }

        // Recolor active layer
        this.bus.on('RECOLOR_ACTIVE_LAYER', (hex) => {
            this.recolorActiveLayer(hex);
        });

        // Add Tab button
        const btnAddTab = document.getElementById('btn-add-tab');
        if (btnAddTab) {
            btnAddTab.addEventListener('click', () => {
                if (window.electronAPI?.openNewProjectWindow) {
                    window.electronAPI.openNewProjectWindow();
                } else {
                    const modal = document.getElementById('new-project-modal');
                    if (modal) {
                        modal.classList.add('show');
                        document.getElementById('new-proj-name')?.focus();
                    }
                }
            });
        }

        // Frameless Titlebar controls (Electron IPC + Fallback)
        const btnWinMin = document.getElementById('btn-win-min');
        const btnWinMax = document.getElementById('btn-win-max');
        const btnWinClose = document.getElementById('btn-win-close');
        const iconWinMax = document.getElementById('icon-win-max');

        const maxSvg = `<rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="0.5"/>`;
        const restoreSvg = `<rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1" rx="0.5"/><path d="M3 1h5.5a.5.5 0 0 1 .5.5V7" fill="none" stroke="currentColor" stroke-width="1.1"/>`;

        const updateMaxUI = (isMax) => {
            if (iconWinMax) iconWinMax.innerHTML = isMax ? restoreSvg : maxSvg;
            if (btnWinMax) {
                btnWinMax.title = isMax ? 'Восстановить окно' : 'Развернуть';
                btnWinMax.setAttribute('aria-label', isMax ? 'Восстановить' : 'Развернуть');
            }
        };

        const handleWinMin = (e) => {
            e?.stopPropagation?.();
            if (window.electronAPI?.minimize) window.electronAPI.minimize();
            else if (window.DesktopBridge?.minimize) window.DesktopBridge.minimize();
        };

        const handleWinMax = async (e) => {
            e?.stopPropagation?.();
            let isMax = false;
            if (window.electronAPI?.maximize) {
                isMax = await window.electronAPI.maximize();
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
            if (window.electronAPI?.close) window.electronAPI.close();
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

        if (window.electronAPI?.onWindowStateChange) {
            window.electronAPI.onWindowStateChange((isMax) => {
                updateMaxUI(isMax);
            });
        }
        window.electronAPI?.isMaximized?.()?.then?.((isMax) => {
            updateMaxUI(!!isMax);
        })?.catch?.(() => {});

        document.addEventListener('fullscreenchange', () => {
            if (!window.electronAPI) {
                updateMaxUI(!!document.fullscreenElement);
            }
        });
    }

    openButtonGenerator() {
        if (window.electronAPI?.openButtonGeneratorWindow) {
            window.electronAPI.openButtonGeneratorWindow();
        } else {
            this.buttonGeneratorModal?.open();
        }
    }

    async insertGeneratedButton(buttonData) {
        if (['prefix', 'deluxemenu'].includes(this.getActiveProject()?.type)) {
            this.showToast('Откройте GUI-проект или обычный холст для вставки кнопки.', 'info');
            return;
        }
        if (!buttonData) return;
        const targetProjectId = this.activeProjectId;
        const ensureTarget = () => {
            if (this.activeProjectId !== targetProjectId) throw new Error("Вкладка изменилась во время загрузки кнопки. Повторите вставку.");
        };

        const w = Number(buttonData.w), h = Number(buttonData.h);
        if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) {
            this.showToast('Некорректный размер кнопки.', 'error'); return;
        }
        this.buttonImports ||= new Set();
        const importId = typeof buttonData.importId === 'string' ? buttonData.importId.slice(0, 128) : null;
        if (importId && this.buttonImports.has(importId)) return;
        if (importId) this.buttonImports.add(importId);
        if (this.buttonImports.size > 256) this.buttonImports.delete(this.buttonImports.values().next().value);
        const canvasW = this.config.width || 256;
        const canvasH = this.config.height || 256;

        let posX = 0;
        let posY = 0;

        if (buttonData.guiCol !== undefined && buttonData.guiRow !== undefined) {
            posX = (buttonData.slotMode === 'full' ? 7 : 8) + buttonData.guiCol * 18;
            posY = (buttonData.slotMode === 'full' ? 17 : 18) + buttonData.guiRow * 18;
        } else {
            posX = Math.max(0, Math.round((canvasW - w) / 2));
            posY = Math.max(0, Math.round((canvasH - h) / 2));
        }

        if (posX + w > canvasW) {
            posX = Math.max(0, Math.round((canvasW - w) / 2));
        }
        if (posY + h > canvasH) {
            posY = Math.max(0, Math.round((canvasH - h) / 2));
        }

        const loadImage = (url) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            if (typeof url !== 'string' || !url.startsWith('data:image/png;base64,')) { reject(new Error('Invalid button image')); return; }
            img.src = url;
        });

        const imageToCanvas = (img, width, height) => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0);
            return c;
        };

        const btnTitle = `${buttonData.cols}x${buttonData.rows} [${w}×${h} px]`;
        const mode = buttonData.mode || 'both';

        try {
            if (mode === 'both') {
                const [normImg, pressImg] = await Promise.all([
                    loadImage(buttonData.normalDataUrl),
                    loadImage(buttonData.pressedDataUrl)
                ]);

                ensureTarget();
                const normalCanvas = imageToCanvas(normImg, w, h);
                const pressedCanvas = imageToCanvas(pressImg, w, h);

                const groupName = `Кнопка ${btnTitle} ${buttonData.style ? buttonData.style.toUpperCase() : 'DEFAULT'}`;
                const group = this.layerManager.addGroup(groupName);

                // Normal state layer
                const normalLayer = this.layerManager.addLayer(`Кнопка ${btnTitle} Normal`);
                normalLayer.groupId = group.id;
                normalLayer.visible = true;
                normalLayer.ctx.drawImage(normalCanvas, posX, posY);
                normalLayer.setMasterSource(normalCanvas, { x: posX, y: posY, w, h });

                // Pressed state layer
                const pressedLayer = this.layerManager.addLayer(`Кнопка ${btnTitle} Pressed`);
                pressedLayer.groupId = group.id;
                pressedLayer.visible = false;
                pressedLayer.ctx.drawImage(pressedCanvas, posX, posY);
                pressedLayer.setMasterSource(pressedCanvas, { x: posX, y: posY, w, h });

                if (this.history) {
                    const compound = new CompoundCommand([
                        new AddLayerCommand(this.layerManager, group),
                        new AddLayerCommand(this.layerManager, normalLayer),
                        new AddLayerCommand(this.layerManager, pressedLayer)
                    ]);
                    compound.name = `Создание кнопки GUI ${btnTitle}`;
                    this.history.push(compound);
                }

                this.layerManager.setActive(normalLayer.id);
            } else {
                const isNormal = (mode === 'normal');
                const imgUrl = isNormal ? buttonData.normalDataUrl : buttonData.pressedDataUrl;
                const img = await loadImage(imgUrl);
                ensureTarget();
                const btnCanvas = imageToCanvas(img, w, h);

                const stateName = isNormal ? 'Normal' : 'Pressed';
                const layer = this.layerManager.addLayer(`Кнопка ${btnTitle} ${stateName}`);
                layer.visible = true;
                layer.ctx.drawImage(btnCanvas, posX, posY);
                layer.setMasterSource(btnCanvas, { x: posX, y: posY, w, h });

                if (this.history) {
                    this.history.push(new AddLayerCommand(this.layerManager, layer));
                }
                this.layerManager.setActive(layer.id);
            }

            this.bus.emit('CANVAS_UPDATED');
            this.bus.emit('LAYER_ORDER_CHANGED');

            this.bus.emit('REQUEST_TOOL_CHANGE', 'move');

            this.showToast(`Кнопка ${btnTitle} успешно добавлена на холст!`, 'smart_button');
        } catch (err) {
            if (importId) this.buttonImports.delete(importId);
            console.error('Failed to insert generated button:', err);
            this.showToast('Ошибка при вставке кнопки на холст', 'error');
        }
    }

    showToast(message, icon = 'info', duration = 2800) {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }

        const toast = document.createElement('div');
        toast.className = 'md-toast';
        const iconElement = document.createElement('i');
        iconElement.className = 'material-symbols-rounded toast-icon';
        iconElement.textContent = icon;
        const messageElement = document.createElement('span');
        messageElement.className = 'toast-message';
        messageElement.textContent = message;
        toast.append(iconElement, messageElement);

        toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, duration);
    }

    async confirmAndGoHome() {
        if (this.tools.finishDocument() === false) return;
        this.saveProjectState();
        await this.projectManager?.waitForPendingSaves?.();
        if (await this.projectManager?.flushAutosaves() === false) {
            this.showToast('Не удалось сохранить черновики. Переход отменён.', 'error');
            return;
        }
        window.location.href = 'index.html';
    }

    setupModals() {
        const newProjModal = document.getElementById('new-project-modal');
        const tplModal = document.getElementById('template-modal');
        const canvasSizeModal = document.getElementById('canvas-size-modal');
        
        const closeModals = () => {
            newProjModal?.classList.remove('show');
            tplModal?.classList.remove('show');
            canvasSizeModal?.classList.remove('show');
        };

        document.querySelectorAll('.btn-close-modal, .btn-cancel-modal').forEach(btn => {
            btn.addEventListener('click', closeModals);
        });

        newProjModal?.addEventListener('click', (e) => {
            if (e.target === newProjModal) closeModals();
        });
        tplModal?.addEventListener('click', (e) => {
            if (e.target === tplModal) closeModals();
        });
        canvasSizeModal?.addEventListener('click', (e) => {
            if (e.target === canvasSizeModal) closeModals();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeModals();
            }
        });

        // Shared project type switcher for GUI, canvas, prefixes, and DeluxeMenus.
        let activeProjectType = 'gui';
        const typeButtons = document.querySelectorAll('#new-proj-type-selector .type-option');
        const secGui = document.getElementById('new-proj-section-gui');
        const secCanvas = document.getElementById('new-proj-section-canvas');
        const newProjName = document.getElementById('new-proj-name');
        const newCanvasName = document.getElementById('new-canvas-name');

        typeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                activeProjectType = type;
                typeButtons.forEach(b => {
                    const isSelected = b === btn;
                    b.classList.toggle('active', isSelected);
                    b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                });
                if (secGui) secGui.style.display = type === 'gui' ? 'block' : 'none';
                if (secCanvas) secCanvas.style.display = type === 'canvas' ? 'block' : 'none';
                for (const [projectType, section] of [['prefix','new-proj-section-prefix'],['deluxemenu','new-proj-section-deluxemenu']]) {
                    const element = document.getElementById(section);
                    if (element) element.style.display = type === projectType ? 'block' : 'none';
                }
                if (type === 'gui') {
                    newProjName?.focus();
                } else if (type === 'deluxemenu') {
                    document.getElementById('new-deluxemenu-name')?.focus();
                } else {
                    if (type === 'prefix') document.getElementById('new-prefix-name')?.focus();
                    else newCanvasName?.focus();
                }
            });
        });

        // Built-in template controls remain available for Vanilla and Bedrock sets.
        const newProjTplSelect = document.getElementById('new-proj-template');
        const updateNewProjTplVisibility = () => {
            const val = newProjTplSelect?.value || '';
            const isVanillaContainer = val.startsWith('gui_container/');
            const frameGroup = document.getElementById('new-proj-frame-group');
            if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : 'block';
        };
        newProjTplSelect?.addEventListener('change', updateNewProjTplVisibility);
        updateNewProjTplVisibility();

        const tplModalSelect = document.getElementById('proj-template');
        const updateTplModalVisibility = () => {
            const val = tplModalSelect?.value || '';
            const isVanillaContainer = val.startsWith('gui_container/');
            const frameGroup = document.getElementById('proj-frame-group');
            if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : 'block';
        };
        tplModalSelect?.addEventListener('change', updateTplModalVisibility);
        updateTplModalVisibility();

        // 4. Canvas presets in New Project modal
        const newCanvasW = document.getElementById('new-canvas-w');
        const newCanvasH = document.getElementById('new-canvas-h');
        const btnNewCanvasLock = document.getElementById('btn-new-canvas-lock-aspect');
        let newCanvasAspectLocked = true;
        let newCanvasAspect = 1;

        btnNewCanvasLock?.addEventListener('click', () => {
            newCanvasAspectLocked = !newCanvasAspectLocked;
            btnNewCanvasLock.classList.toggle('active', newCanvasAspectLocked);
            btnNewCanvasLock.setAttribute('aria-pressed', String(newCanvasAspectLocked));
            if (newCanvasAspectLocked) {
                const w = parseInt(newCanvasW?.value, 10) || 32;
                const h = parseInt(newCanvasH?.value, 10) || 32;
                newCanvasAspect = w / Math.max(1, h);
            }
        });

        newCanvasW?.addEventListener('input', () => {
            if (newCanvasAspectLocked && newCanvasAspect) {
                const w = parseInt(newCanvasW.value, 10);
                if (w > 0) newCanvasH.value = Math.min(4096, Math.max(1, Math.round(w / newCanvasAspect)));
            }
            syncNewCanvasPresets();
        });

        newCanvasH?.addEventListener('input', () => {
            if (newCanvasAspectLocked && newCanvasAspect) {
                const h = parseInt(newCanvasH.value, 10);
                if (h > 0) newCanvasW.value = Math.min(4096, Math.max(1, Math.round(h * newCanvasAspect)));
            }
            syncNewCanvasPresets();
        });

        const syncNewCanvasPresets = () => {
            document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
                const selected = Number(chip.dataset.w) === Number(newCanvasW?.value)
                    && Number(chip.dataset.h) === Number(newCanvasH?.value);
                chip.classList.toggle('active', selected);
                chip.setAttribute('aria-pressed', String(selected));
            });
        };

        document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const w = chip.dataset.w;
                const h = chip.dataset.h;
                if (w && h) {
                    if (newCanvasW) newCanvasW.value = w;
                    if (newCanvasH) newCanvasH.value = h;
                    newCanvasAspect = parseInt(w, 10) / parseInt(h, 10);
                    syncNewCanvasPresets();
                }
            });
        });

        const newProjInputs = [newProjName, newCanvasName, newCanvasW, newCanvasH, document.getElementById('new-prefix-name'), document.getElementById('new-deluxemenu-name')];
        newProjInputs.forEach(input => {
            input?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('btn-create-project')?.click();
                }
            });
        });

        // 5. Submit new project button
        const btnCreate = document.getElementById('btn-create-project');
        if (btnCreate) {
            btnCreate.addEventListener('click', () => {
                let projectData;
                try {
                    projectData = createProjectFromForm(document, activeProjectType);
                } catch (_) {
                    newCanvasW?.reportValidity();
                    newCanvasH?.reportValidity();
                    if (!newCanvasW?.checkValidity()) newCanvasW?.focus();
                    else newCanvasH?.focus();
                    return;
                }
                closeModals();
                this.addProjectData(projectData);
            });
        }
        
        // 6. Template selector modal button
        const btnApplyTemplate = document.getElementById('btn-apply-template');
        if (btnApplyTemplate) {
            btnApplyTemplate.addEventListener('click', () => {
                const tpl = document.getElementById('proj-template')?.value || 'none';

                if (tpl === 'none') {
                    this.loadTemplate('none');
                } else {
                    const { template } = resolveGuiTemplate({
                        template: tpl,
                        frame: document.getElementById('proj-frame')?.value === 'yes'
                    });
                    this.loadTemplate(template);
                }
                closeModals();
            });
        }
    }

    setupCanvasSizeModal() {
        const modal = document.getElementById('canvas-size-modal');
        if (!modal) return;

        const wInput = document.getElementById('canvas-resize-w');
        const hInput = document.getElementById('canvas-resize-h');
        const btnLock = document.getElementById('btn-canvas-size-lock-aspect');
        const anchorGrid = document.getElementById('canvas-anchor-grid');
        const anchorGroup = document.getElementById('canvas-anchor-group');
        const btnApply = document.getElementById('btn-apply-canvas-size');

        let isAspectLocked = true;
        let selectedAnchorX = 'center';
        let selectedAnchorY = 'center';

        btnLock?.addEventListener('click', () => {
            isAspectLocked = !isAspectLocked;
            btnLock.classList.toggle('active', isAspectLocked);
            if (isAspectLocked) {
                const w = parseInt(wInput?.value, 10) || 256;
                const h = parseInt(hInput?.value, 10) || 256;
                this._canvasAspect = w / Math.max(1, h);
            }
        });

        wInput?.addEventListener('input', () => {
            if (isAspectLocked && this._canvasAspect) {
                const w = parseInt(wInput.value, 10);
                if (w > 0) {
                    hInput.value = Math.max(1, Math.round(w / this._canvasAspect));
                }
            }
        });

        hInput?.addEventListener('input', () => {
            if (isAspectLocked && this._canvasAspect) {
                const h = parseInt(hInput.value, 10);
                if (h > 0) {
                    wInput.value = Math.max(1, Math.round(h * this._canvasAspect));
                }
            }
        });

        // Preset chips
        document.querySelectorAll('#canvas-resize-presets .preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const w = chip.dataset.w;
                const h = chip.dataset.h;
                const mult = chip.dataset.mult;
                if (w && h) {
                    if (wInput) wInput.value = w;
                    if (hInput) hInput.value = h;
                    this._canvasAspect = parseInt(w, 10) / parseInt(h, 10);
                } else if (mult) {
                    const factor = parseFloat(mult);
                    const newW = Math.max(1, Math.round(this.config.width * factor));
                    const newH = Math.max(1, Math.round(this.config.height * factor));
                    if (wInput) wInput.value = newW;
                    if (hInput) hInput.value = newH;
                    this._canvasAspect = newW / newH;
                }
            });
        });

        // Mode radio change (crop vs scale)
        document.querySelectorAll('input[name="canvas-resize-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (anchorGroup) {
                    anchorGroup.style.display = e.target.value === 'crop' ? 'block' : 'none';
                }
            });
        });

        // Anchor buttons
        anchorGrid?.querySelectorAll('.anchor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                anchorGrid.querySelectorAll('.anchor-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedAnchorX = btn.dataset.x || 'center';
                selectedAnchorY = btn.dataset.y || 'center';
            });
        });

        btnApply?.addEventListener('click', () => {
            const newW = parseInt(wInput?.value, 10) || this.config.width;
            const newH = parseInt(hInput?.value, 10) || this.config.height;
            const mode = document.querySelector('input[name="canvas-resize-mode"]:checked')?.value || 'crop';
            const isScale = mode === 'scale';

            modal.classList.remove('show');
            this.resizeCanvas(newW, newH, selectedAnchorX, selectedAnchorY, isScale);
        });

        // doc-info click opens canvas size modal
        const docInfo = document.getElementById('doc-info');
        if (docInfo) {
            docInfo.title = 'Изменить размер холста — Ctrl+Alt+C';
            docInfo.addEventListener('click', () => {
                this.openCanvasSizeModal();
            });
        }
    }

    openCanvasSizeModal() {
        const projectType = this.getActiveProject()?.type;
        if (projectType === 'prefix') { this.showToast('Размер префикса определяется текстом и отступами.', 'info'); return; }
        if (projectType === 'deluxemenu') { this.showToast('Размер макета задаётся типом и размером инвентаря.', 'info'); return; }
        const modal = document.getElementById('canvas-size-modal');
        if (!modal) return;

        const currLabel = document.getElementById('canvas-size-curr-label');
        if (currLabel) currLabel.innerText = `${this.config.width} × ${this.config.height} px`;

        const wInput = document.getElementById('canvas-resize-w');
        const hInput = document.getElementById('canvas-resize-h');
        if (wInput) wInput.value = this.config.width;
        if (hInput) hInput.value = this.config.height;

        this._canvasAspect = this.config.width / Math.max(1, this.config.height);

        modal.classList.add('show');
        wInput?.focus();
        wInput?.select();
    }

    resizeCanvas(newWidth, newHeight, anchorX = 'center', anchorY = 'center', isScale = false) {
        newWidth = Math.max(1, Math.min(4096, parseInt(newWidth, 10) || 256));
        newHeight = Math.max(1, Math.min(4096, parseInt(newHeight, 10) || 256));

        if (newWidth === this.config.width && newHeight === this.config.height) {
            return;
        }

        if (this.tools.finishDocument() === false) return;
        if (newWidth * newHeight * Math.max(1, this.layerManager.layers.length) > 64 * 1024 * 1024) {
            this.showToast('Слишком большой холст для этого числа слоёв.', 'error'); return;
        }
        const beforeSize = { width: this.config.width, height: this.config.height };
        const beforeLayers = this.layerManager.layers.map(layer => ({ layer, data: layer.getImageData() }));
        this.config.width = newWidth;
        this.config.height = newHeight;

        const proj = this.getActiveProject();
        if (proj) {
            proj.config.width = newWidth;
            proj.config.height = newHeight;
        }

        this.layerManager.resizeCanvas(newWidth, newHeight, anchorX, anchorY, isScale, proj?.bg);
        this.renderer.resize(newWidth, newHeight);
        this.history.push(new ResizeCanvasCommand(this, beforeSize, { width: newWidth, height: newHeight },
            beforeLayers.map(({ layer, data }) => new DrawCommand(layer, data, layer.getImageData()))));

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
                for (const layer of newLayers) layer.resize(width, height);
                base.ctx.clearRect(0, 0, width, height);
                if (image) base.ctx.drawImage(image, 0, 0);
                base.invalidateSource();
                project.config = {width, height};
                if (projectName) project.name = projectName;
                project.templatePath = filename === 'none' ? null : filename;
                const match = filename.match(/container_\d+/);
                project.templateName = filename === 'none' ? null : match ? match[0] : filename.replace(/\.png$/, '').split('/').pop();
                project.hasFrame = filename.includes('_frame');
                project.layers = newLayers;
                const command = new TemplateCommand(this, project, before, metadata(), oldLayers, newLayers,
                    snapshots.map(({layer, data}) => new DrawCommand(layer, data, layer.getImageData())));
                command.restore(command.after, newLayers);
                if (projectName === null) {
                    if (active) this.history.push(command);
                    else {
                        command.historyMemoryBytes = estimateCommandBytes(command);
                        project.redoStack = [];
                        if (command.historyMemoryBytes > this.history.memoryBudgetBytes) project.undoStack = [];
                        else {
                            project.undoStack.push(command);
                            while (project.undoStack.length > this.history.limit || project.undoStack.reduce((sum, item) => sum + (item.historyMemoryBytes || estimateCommandBytes(item)), 0) > this.history.memoryBudgetBytes) project.undoStack.shift();
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

        const path = curProj.templatePath || '';
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
        if (this.getActiveProject()?.type === 'deluxemenu') return this.deluxeMenusEditor?.exportFile();
        if (this.tools?.finishDocument() === false) return;
        let dataUrl = this.renderer.exportToPNG();
        if (!dataUrl) return;

        const activeProj = this.projects.find(project => project.id === this.activeProjectId);
        try {
            dataUrl = await preparePngExport(dataUrl, { scale: this.settingsManager?.get('exportScale') || 1, trim: this.settingsManager?.get('exportTrim') === true });
        } catch (error) { this.showToast(error.message, 'error'); return; }

        const safeName = (activeProj ? activeProj.name : 'molly_gui').replace(/[\\/:*?"<>|]/g, '_') + '.png';

        if (window.electronAPI) {
            const bridge = window.DesktopBridge || window.electronAPI;
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
                    } else if (window.electronAPI?.writeFile) {
                        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                        await window.electronAPI.writeFile(result.filePath, base64Data, 'base64');
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
        if (this.tools?.finishDocument() === false) return;
        const active = this.layerManager.getActiveLayer();
        if (!active) return;
        let dataUrl = this.renderer.exportLayerToPNG(active.id);
        if (!dataUrl) return;
        try {
            dataUrl = await preparePngExport(dataUrl, { scale: this.settingsManager?.get('exportScale') || 1, trim: this.settingsManager?.get('exportTrim') === true });
        } catch (error) { this.showToast(error.message, 'error'); return; }

        const safeName = (active.name || 'layer').replace(/[\\/:*?"<>|]/g, '_') + '.png';

        if (window.electronAPI) {
            const bridge = window.DesktopBridge || window.electronAPI;
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
                    } else if (window.electronAPI?.writeFile) {
                        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                        await window.electronAPI.writeFile(result.filePath, base64Data, 'base64');
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
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.layerManager.isEditable(layer) || layer.isBase || layer.isGroup || layer.alphaLocked) return;

        const beforeData = layer.getImageData();
        layer.clear(true);
        layer.shapeData = null;
        if (layer.textData) layer.textData.text = '';
        const afterData = layer.getImageData();

        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.bus.emit('CANVAS_UPDATED');
    }

    recolorActiveLayer(hexColor) {
        const color = hexColor || this.tools?.color || '#3B82F6';
        const layer = this.layerManager.getActiveLayer();
        if (!layer || !this.layerManager.isEditable(layer) || layer.isBase || layer.isGroup) return;
        if (layer.shapeData) return this.editShapeLayer(layer, { color });

        if (layer.type === 'text' && layer.textData) {
            const before = JSON.parse(JSON.stringify(layer.textData));
            layer.textData.color = color;
            layer.textData.shadowColor = this.tools.tools['text']?.computeShadowColor(color);
            this.tools.tools['text']?.renderTextLayer(layer);
            this.tools.tools['text']?.syncUIWithLayer(layer);
            this.history.push(new TextDataCommand(layer, before, layer.textData, this.bus));
            this.bus.emit('CANVAS_UPDATED');
            return;
        }

        const beforeData = layer.getImageData();
        const w = layer.width;
        const h = layer.height;

        layer.ctx.save();
        layer.ctx.globalCompositeOperation = 'source-in';
        layer.ctx.fillStyle = color;
        layer.ctx.fillRect(0, 0, w, h);
        layer.ctx.restore();

        layer.invalidateSource?.();
        const afterData = layer.getImageData();
        this.history.push(new DrawCommand(layer, beforeData, afterData));
        this.bus.emit('CANVAS_UPDATED');
    }

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
        proj.layers = [...this.layerManager.layers];
        proj.activeLayerId = this.layerManager.activeLayerId;
        proj.selectedLayerIds = [...this.layerManager.selectedLayerIds];
        proj.layerCounter = this.layerManager.counter;
        proj.undoStack = [...this.history.undoStack];
        proj.redoStack = [...this.history.redoStack];
    }

    loadProjectState(id) {
        const proj = this.projects.find(p => p.id === id);
        if (!proj) return;

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

            this.layerManager.clearLayers();
            if (proj.layers && proj.layers.length > 0) {
                if (proj.layers[0] instanceof Layer) {
                    this.layerManager.setLayers([...proj.layers]);
                } else {
                    this.layerManager.layers = [];
                    this.layerManager.activeLayerId = null;
                    proj.layers.forEach(lData => {
                        const layer = this.layerManager.addLayer(lData.name, null, lData.isBase, lData.type || 'bitmap');
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

            this.layerManager.counter = proj.layerCounter || 1;
            if (proj.activeLayerId) {
                this.layerManager.activeLayerId = proj.activeLayerId;
            }

            this.layerManager.selectedLayerIds = new Set(proj.selectedLayerIds || (proj.activeLayerId ? [proj.activeLayerId] : []));
            this.history.undoStack = [...(proj.undoStack || [])];
            this.history.redoStack = [...(proj.redoStack || [])];
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
            const active = this.layerManager.getActiveLayer();
            if (active) {
                this.bus.emit('LAYER_ACTIVE_CHANGED', active);
            } else {
                this.layerPanel.render();
            }

            this.updateProjectTypeUI(proj);
            this.renderTabs();
        } finally {
            if (this.projectManager) this.projectManager.autosaveSuppressed = autosaveWasSuppressed;
        }
    }

    updateProjectTypeUI(proj) {
        if (!proj) proj = this.getActiveProject();
        if (!proj) return;

        const isCanvas = proj.type !== 'gui';
        const isDeluxeMenu = proj.type === 'deluxemenu';
        void this.prefixEditor.show(proj);
        this.deluxeMenusEditor?.show(proj);

        // 1. Doc Info badge in status bar
        const infoEl = document.getElementById('doc-info');
        if (infoEl) {
            infoEl.innerHTML = isDeluxeMenu ? '<i class="material-symbols-rounded" style="font-size: 13px; margin-right: 4px; vertical-align: middle;">dashboard_customize</i> Конструктор меню' : `<i class="material-symbols-rounded" style="font-size: 13px; margin-right: 4px; vertical-align: middle;">${isCanvas ? 'palette' : 'grid_view'}</i> ${this.config.width} × ${this.config.height} px`;
            infoEl.title = isDeluxeMenu ? 'Конструктор меню — экспорт YAML для выбранного плагина' : `Размер холста: ${this.config.width} × ${this.config.height} px — ${isCanvas ? 'Обычный холст' : 'Minecraft GUI'}. Кликните или нажмите Ctrl+Alt+C для изменения`;
        }

        // 2. Minecraft Items Library in Sidebar
        const itemsSection = document.getElementById('items-panel-section');
        if (itemsSection) {
            if (isCanvas) {
                // In Aseprite canvas mode, collapse items section to give maximum space to Layers
                itemsSection.classList.remove('expanded');
            } else {
                // In GUI mode, expand items library
                itemsSection.classList.add('expanded');
            }
        }

        // 3. GUI Template Menu Item in File Menu
        const tplMenuItem = document.querySelector('[data-action="file-template"]');
        if (tplMenuItem) {
            if (isCanvas) {
                tplMenuItem.classList.add('disabled-action');
                tplMenuItem.style.opacity = '0.45';
                tplMenuItem.title = 'Шаблоны контейнеров доступны только для проектов типа Minecraft GUI';
            } else {
                tplMenuItem.classList.remove('disabled-action');
                tplMenuItem.style.opacity = '';
                tplMenuItem.title = '';
            }
        }
        const exportMenuItem = document.querySelector('[data-action="file-export-png"] span:first-child');
        if (exportMenuItem) exportMenuItem.textContent = isDeluxeMenu ? 'Экспорт меню в YAML' : 'Экспорт в PNG';
        const exportLayerItem = document.querySelector('[data-action="file-export-layer"]');
        if (exportLayerItem) {
            exportLayerItem.classList.toggle('disabled-action', isDeluxeMenu);
            exportLayerItem.style.opacity = isDeluxeMenu ? '0.45' : '';
            exportLayerItem.title = isDeluxeMenu ? 'У проекта меню нет растровых слоёв' : '';
        }
        const exportButton = document.getElementById('btn-export-png');
        if (exportButton) {
            exportButton.title = isDeluxeMenu ? 'Экспорт конфигурации меню в YAML' : 'Экспорт в PNG Ctrl+Shift+E';
            const text = [...exportButton.childNodes].find(node => node.nodeType === Node.TEXT_NODE);
            if (text) text.textContent = isDeluxeMenu ? ' Экспорт YAML' : ' Экспорт';
        }
    }

    addProjectData(data) {
        const project = normalizeProjectData(data);
        const previousId = this.activeProjectId;
        this.addProject(
            project.name,
            project.template,
            project.width,
            project.height,
            project.hasFrame,
            project.type,
            project.bg
        );
        const created = this.getActiveProject();
        if (!created || created.id === previousId) return;
        if (created && project.type === 'deluxemenu') {
            created.menuPlugin = project.menuPlugin;
            created.deluxeData = structuredClone(project.deluxeData);
            this.saveProjectState();
            this.deluxeMenusEditor?.show(created);
        }
    }

    addProject(name, template, w = 256, h = 256, hasFrame = false, type = 'gui', bg = 'transparent') {
        if (this.tools?.finishDocument() === false) return;
        this.saveProjectState();
        this.projectManager?.performAutosave(this.activeProjectId);

        const id = 'proj_' + Date.now() + Math.random().toString(36).substr(2, 5);
        const match = template ? template.match(/container_\d+/) : null;
        const isCanvasType = type === 'canvas' || type === 'prefix';
        const isDeluxeMenu = type === 'deluxemenu';
        
        let tplName = 'generic_54';
        if (isCanvasType || isDeluxeMenu) {
            tplName = null;
        } else if (match) {
            tplName = match[0];
        } else if (template && template !== 'none') {
            tplName = template.replace(/\.png$/, '').split('/').pop() || 'gui';
        }

        const newProj = {
            id,
            draftId: globalThis.crypto?.randomUUID?.() || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
            type: type === 'prefix' ? 'prefix' : isCanvasType ? 'canvas' : isDeluxeMenu ? 'deluxemenu' : 'gui',
            ...(type === 'prefix' ? { prefixData: normalizePrefixDocument() } : {}),
            ...(isDeluxeMenu ? { deluxeData: { menu_title: '&8Главное меню', size: 54, open_command: ['menu'], items: {} } } : {}),
            name: name || (isDeluxeMenu ? 'Меню' : isCanvasType ? 'Холст' : 'GUI Меню'),
            templateName: tplName,
            templatePath: isCanvasType || isDeluxeMenu ? null : (template && template !== 'none' ? template : null),
            hasFrame: isCanvasType || isDeluxeMenu ? false : (hasFrame || (template ? template.includes('_frame') : false)),
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
        this.projects.push(newProj);
        
        this.activeProjectId = id;

        this.config.width = newProj.config.width;
        this.config.height = newProj.config.height;
        this.renderer.resize(this.config.width, this.config.height);
        this.history.clear();
        this.layerManager.clearLayers();

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
        } else if (isDeluxeMenu) {
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
        if (this.settingsManager?.get('confirmClose') && this.projectManager?.hasUnsavedChanges(id)) {
            const confirmed = await confirmDialog({ title: 'Закрыть проект?', message: `Изменения в «${p.name}» не сохранены в файл. Они останутся в автокопии на главном экране.`, confirmLabel: 'Закрыть с автокопией' });
            if (!confirmed) { p.closing = false; return; }
        }
        await this.projectManager?.waitForPendingSaves();
        if (this.activeProjectId === id) this.saveProjectState();
        await this.projectManager?.performAutosave(id);
        if (this.projectManager?.autosaveDirtyIds.has(id)) {
            p.closing = false;
            this.showToast('Не удалось сохранить черновик. Вкладка оставлена открытой.', 'error');
            return;
        }
        
        const index = this.projects.findIndex(p => p.id === id);
        if (index === -1) return;

        this.projects.splice(index, 1);

        if (this.projects.length === 0) {
            this.activeProjectId = null;
            window.location.href = 'index.html';
            return;
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
    }

    getNounPlural(number, one, two, five) {
        let n = Math.abs(number);
        n %= 100;
        if (n >= 5 && n <= 20) return five;
        n %= 10;
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return two;
        return five;
    }

    setupAutosave() {
        if (this.autosaveTimer) {
            clearInterval(this.autosaveTimer);
            this.autosaveTimer = null;
        }
        const mins = this.settingsManager?.get('autosaveInterval') || 0;
        if (mins > 0) {
            this.autosaveTimer = setInterval(() => {
                if (this.activeProjectId) {
                    this.saveProjectState();
                    void this.projectManager?.performAutosave().then(saved => {
                        if (saved) this.showToast('Черновик сохранён', 'cloud_done', 1500);
                    });
                }
            }, mins * 60 * 1000);
        }
    }

    setupDiscordPresence() {
        const update = () => this.updateDiscordPresence();
        this.bus.on('TOOL_CHANGED', update);
        this.bus.on('LAYER_ADDED', update);
        this.bus.on('LAYER_REMOVED', update);
        this.bus.on('LAYER_ORDER_CHANGED', update);
        this.bus.on('LAYER_ACTIVE_CHANGED', update);
        this.bus.on('SETTINGS_CHANGED', update);
        this.bus.on('CANVAS_RESIZED', update);
        this.bus.on('PROJECT_LOADED', update);
        setTimeout(update, 100);
        setTimeout(update, 800);
        setInterval(update, 15000);
    }

    updateDiscordPresence() {
        if (!window.electronAPI?.updateDiscordPresence) return;

        const discordEnabled = this.settingsManager.get('discordRPC') ?? true;
        if (!discordEnabled) {
            window.electronAPI.clearDiscordPresence?.();
            return;
        }

        const activeProj = this.getActiveProject();
        const isCanvas = activeProj?.type === 'canvas';
        const projName = activeProj?.name || (isCanvas ? 'Холст' : 'GUI Меню');
        const layers = this.layerManager?.getLayers() || [];
        const layerCount = layers.length || 1;
        const currentToolId = this.tools?.currentToolId || 'move';

        const toolNames = {
            'move': 'Перемещение',
            'marquee': 'Выделение',
            'brush': 'Кисть',
            'pencil': 'Карандаш',
            'eraser': 'Ластик',
            'bucket': 'Заливка',
            'fill': 'Заливка',
            'gradient': 'Градиент',
            'pipette': 'Пипетка',
            'line': 'Линия',
            'rect-empty': 'Контур прямоуг.',
            'rect-filled': 'Прямоугольник',
            'circle-empty': 'Контур круга',
            'circle-filled': 'Круг',
            'text': 'Текст',
            'hand': 'Панорама'
        };

        const toolName = toolNames[currentToolId] || 'Редактирование';
        const showProject = this.settingsManager.get('discordShowProject') ?? true;
        const showTool = this.settingsManager.get('discordShowTool') ?? true;
        const showTime = this.settingsManager.get('discordShowTime') ?? true;

        const prefix = activeProj?.type === 'deluxemenu' ? 'Меню' : activeProj?.type === 'prefix' ? 'Префиксы' : isCanvas ? 'Холст' : 'GUI Меню';
        const details = showProject ? `${prefix}: ${projName}` : 'MollyStudio';
        const layersText = `${layerCount} ${this.getNounPlural(layerCount, 'слой', 'слоя', 'слоёв')}`;
        const state = showTool ? `Инструмент: ${toolName} • ${layersText}` : `Холст ${this.config.width}×${this.config.height} • ${layersText}`;

        try {
            window.electronAPI?.updateDiscordPresence?.({
                details,
                state,
                showTime,
                startTimestamp: this.projectStartTimestamp || Date.now()
            })?.catch?.(() => {});
        } catch (_) {}
    }

    renderTabs() {
        const tabBar = document.getElementById('doc-tab-container');
        if (!tabBar) return;

        tabBar.innerHTML = '';
        this.projects.forEach(p => {
            const isActive = p.id === this.activeProjectId;
            const isCanvas = p.type === 'canvas';
            const isPrefix = p.type === 'prefix';
            const isDeluxeMenu = p.type === 'deluxemenu';
            const tab = document.createElement('div');
            tab.className = `doc-tab ${isCanvas || isPrefix ? 'tab-canvas' : 'tab-gui'} ${isActive ? 'active' : ''}`;
            tab.title = `${p.name} (${isDeluxeMenu ? 'Конструктор меню' : isPrefix ? 'Префиксы' : isCanvas ? 'Обычный холст' : 'Minecraft GUI'})`;
            tab.id = `doc-tab-${p.id}`;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(isActive));
            tab.setAttribute('aria-controls', isDeluxeMenu ? 'deluxe-editor' : 'canvas-wrapper');
            tab.setAttribute('aria-label', `${p.name}${isActive ? ', активный проект' : ''}. Нажмите Delete, чтобы закрыть`);
            tab.setAttribute('aria-keyshortcuts', 'Delete Backspace');
            tab.tabIndex = isActive ? 0 : -1;
            const zoomText = `@ ${Math.round((isActive ? this.workspace.zoom : p.zoom) * 100)}%`;
            const iconName = isDeluxeMenu ? 'dashboard_customize' : isPrefix ? 'badge' : isCanvas ? 'palette' : 'grid_view';
            tab.innerHTML = `
                <i class="material-symbols-rounded doc-tab-icon">${iconName}</i>
                <span class="doc-tab-title"></span>
                <span class="doc-tab-zoom md-badge">${zoomText}</span>
                <span class="doc-tab-close md-icon-btn-micro" title="Закрыть проект" aria-hidden="true"><i class="material-symbols-rounded">close</i></span>
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
        const workspace = document.getElementById('canvas-wrapper');
        if (workspace && activeTab) workspace.setAttribute('aria-labelledby', activeTab.id);
        this.updateDiscordPresence();
    }
}
