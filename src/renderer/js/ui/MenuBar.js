import {createEditorCommands} from '../core/EditorCommands.mjs';
import {recordFailure} from '../core/Performance.mjs';
import UtilitiesPanel from './UtilitiesPanel.js';
import { isShortcutTarget } from './KeyboardNavigation.js';
import { actionIcon } from './ActionIcons.mjs';
import {bindAttribute, getLabelSource} from '../core/Locale.mjs';

/**
 * MenuBar - Top navigation bar controlling file operations, layer actions,
 * selection tools, view modes, and settings.
 */
export default class MenuBar {
    constructor(app) {
        this.app = app;
        this.utilities = new UtilitiesPanel();
        this.activeDropdown = null;
        this.init();
        app.commands=createEditorCommands(app,this);
    }

    init() {
        const topBar = document.querySelector('.top-bar');
        const menuItems = document.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            const btn = item.querySelector('.menu-btn');
            const dropdown = item.querySelector('.menu-dropdown');

            if (btn && dropdown) {
                btn.setAttribute('aria-haspopup', 'menu');
                btn.setAttribute('aria-expanded', 'false');
                dropdown.setAttribute('role', 'menu');
                bindAttribute(dropdown, 'aria-label', getLabelSource(btn).trim());
                const entries = () => [...dropdown.querySelectorAll('[data-action]')].filter(entry => getComputedStyle(entry).display !== 'none');
                dropdown.querySelectorAll('[data-action]').forEach(entry => {
                    const name = actionIcon(entry.dataset.action);
                    if (name) {
                        const icon = document.createElement('i'); icon.className = 'material-symbols-rounded menu-action-icon';
                        icon.setAttribute('aria-hidden', 'true'); icon.textContent = name; entry.prepend(icon);
                    }
                    entry.setAttribute('role', 'menuitem'); entry.tabIndex = -1;
                    entry.addEventListener('keydown', event => {
                        const items = entries();
                        const index = items.indexOf(entry);
                        let next = null;
                        if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
                        else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
                        else if (event.key === 'Home') next = items[0];
                        else if (event.key === 'End') next = items.at(-1);
                        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); entry.click(); return; }
                        else if (event.key === 'Escape') { event.preventDefault(); this.closeAll(); btn.focus(); return; }
                        else if (event.key === 'Tab') { this.closeAll(); return; }
                        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                            event.preventDefault();
                            const buttons = [...document.querySelectorAll('.menu-btn')].filter(button => button.getClientRects().length);
                            const direction = event.key === 'ArrowRight' ? 1 : -1;
                            const adjacent = buttons[(buttons.indexOf(btn) + direction + buttons.length) % buttons.length];
                            adjacent.click(); adjacent.closest('.menu-item').querySelector('[data-action]')?.focus(); return;
                        }
                        if (next) { event.preventDefault(); next.focus(); }
                    });
                });
                btn.addEventListener('keydown', event => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (!dropdown.classList.contains('show')) btn.click();
                        (event.key === 'ArrowDown' ? entries()[0] : entries().at(-1))?.focus();
                    } else if (event.key === 'Escape') { event.preventDefault(); this.closeAll(); }
                });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.activeDropdown === dropdown) {
                        this.closeAll();
                    } else {
                        this.closeAll();
                        dropdown.classList.add('show');
                        btn.setAttribute('aria-expanded', 'true');
                        btn.classList.add('open');
                        topBar?.classList.add('has-open-dropdown');
                        this.activeDropdown = dropdown;
                        this.positionDropdown(btn, dropdown);
                    }
                });

                item.addEventListener('mouseenter', () => {
                    if (this.activeDropdown && this.activeDropdown !== dropdown) {
                        this.closeAll();
                        dropdown.classList.add('show');
                        btn.setAttribute('aria-expanded', 'true');
                        btn.classList.add('open');
                        topBar?.classList.add('has-open-dropdown');
                        this.activeDropdown = dropdown;
                        this.positionDropdown(btn, dropdown);
                    }
                });
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.menu-item')) {
                this.closeAll();
            }
        });
        window.addEventListener('resize', () => {
            const dropdown = this.activeDropdown;
            const button = dropdown?.closest('.menu-item')?.querySelector('.menu-btn');
            if (button) this.positionDropdown(button, dropdown);
        });

        this.setupActions();
        this.setupRecolorModal();
    }

    positionDropdown(button, dropdown) {
        const anchor = button.getBoundingClientRect();
        const inset = 8;
        const top = Math.min(anchor.bottom + 4, window.innerHeight - inset);
        dropdown.style.top = `${top}px`;
        dropdown.style.maxHeight = `${Math.max(0, window.innerHeight - top - inset)}px`;
        const width = dropdown.getBoundingClientRect().width;
        dropdown.style.left = `${Math.max(inset, Math.min(anchor.left, window.innerWidth - width - inset))}px`;
    }

    closeAll() {
        document.querySelectorAll('.menu-dropdown').forEach(d => d.classList.remove('show'));
        document.querySelectorAll('.menu-btn').forEach(b => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); });
        document.querySelector('.top-bar')?.classList.remove('has-open-dropdown');
        this.activeDropdown = null;
    }

    setupActions() {
        document.querySelectorAll('[data-action]').forEach(el => {
            el.addEventListener('click', () => {
                const action = el.dataset.action;
                this.handleAction(action);
                this.closeAll();
            });
        });
        this.setupHotkeys();
    }

    setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || e.metaKey || isShortcutTarget(e.target, e)) return;

            let action = null;

            if (e.ctrlKey && !e.shiftKey && !e.altKey) {
                switch(e.code) {
                    case 'KeyN': action = 'file-new'; break;
                    case 'KeyO': action = 'file-open'; break;
                    case 'KeyS': action = 'file-save'; break;
                    case 'KeyE': action = 'layer-mergedown'; break;
                    case 'KeyZ': action = 'edit-undo'; break;
                    case 'KeyY': action = 'edit-redo'; break;
                    case 'KeyX': action = 'select-cut'; break;
                    case 'KeyC': action = 'select-copy'; break;
                    case 'KeyV': action = 'select-paste'; break;
                    case 'KeyI': action = 'transform-invert'; break;
                    case 'KeyJ': action = 'layer-duplicate'; break;
                    case 'KeyA': action = 'select-all'; break;
                    case 'KeyD': action = 'select-deselect'; break;
                    case 'KeyR': action = 'view-rulers'; break;
                    case 'Semicolon': action = 'view-guides'; break;
                    case 'Quote': action = 'view-grid'; break;
                    case 'Comma': action = 'settings-open'; break;
                    case 'Equal':
                    case 'NumpadAdd': action = 'view-zoom-in'; break;
                    case 'Minus':
                    case 'NumpadSubtract': action = 'view-zoom-out'; break;
                    case 'Digit0':
                    case 'Numpad0': action = 'view-zoom-reset'; break;
                }
            } else if (e.ctrlKey && e.shiftKey && !e.altKey) {
                switch(e.code) {
                    case 'KeyN': action = 'layer-new'; break;
                    case 'KeyB': action = 'tools-button-generator'; break;
                    case 'KeyE': action = 'file-export-png'; break;
                    case 'KeyS': action = 'file-save-as'; break;
                    case 'KeyI': action = 'select-invert'; break;
                    case 'KeyZ': action = 'edit-redo'; break;
                }
            } else if (e.ctrlKey && e.altKey && !e.shiftKey) {
                switch(e.code) {
                    case 'KeyC': action = 'image-canvas-size'; break;
                }
            } else if (!e.ctrlKey && !e.altKey) {
                if (e.code === 'Delete') {
                    const marquee = this.app.tools?.tools?.['marquee'];
                    if (marquee && (marquee.selection || marquee.hasFloating?.())) {
                        action = 'select-delete';
                    } else {
                        action = 'layer-delete';
                    }
                } else if (e.code === 'KeyF' && !e.shiftKey) {
                    action = 'view-zoom-fit';
                } else if (e.code === 'KeyW' && !e.shiftKey) {
                    action = 'view-tiling';
                } else if (e.code === 'Home' && !e.shiftKey) {
                    action = 'file-home';
                }
            }

            if (action) {
                e.preventDefault();
                this.handleAction(action);
            }
        });
    }

    handleAction(action) {
        try {
            if(!this.app.commands?.has(action))return this.performAction(action);
            const result=this.app.commands.execute(action);
            return result?.catch?result.catch(error=>this.reportActionError(error)):result;
        }
        catch (error) { return this.reportActionError(error); }
    }

    reportActionError(error) {
        recordFailure('command',error);
        console.error('Editor action failed:', error);
        this.app.showToast?.(error.message || 'Не удалось выполнить действие.', 'error');
        return false;
    }

    performAction(action) {
        if(action==='file-texture'){this.app.texturePanel.open();return;}
        if(action==='file-designs'){this.app.designGallery.open();return;}
        if (action.startsWith('utility-')) { this.utilities.open(action.slice(8)); return; }
        if (this.app.getActiveProject?.()?.type === 'prefix' && /^(?:layer-|transform-|select-|image-|tools-|edit-clear-layer|file-template|file-export-layer)/.test(action)) {
            this.app.showToast('Используйте настройки префикса или создайте его копию на холсте.', 'info');
            return;
        }
        if(action.startsWith('tool:')){this.app.workspace.isAltQuickPipette=false;this.app.tools.setTool(action.slice(5));return;}
        if(action==='layer-isolate')return this.app.layerManager.toggleIsolation();
        if(action==='color-swap'||action==='color-default')return document.getElementById(action==='color-swap'?'btn-swap-colors':'btn-default-colors')?.click();
        if(action==='color-replace')return this.app.openQuickRecolor();
        if(action==='symmetry-x'||action==='symmetry-y'){const key=action==='symmetry-x'?'symmetryX':'symmetryY';this.app.tools[key]=!this.app.tools[key];this.app.tools.syncSymmetryUI?.();return;}
        if(action==='brush-smaller'||action==='brush-larger')return this.app.tools.setSize(Math.max(1,this.app.tools.size+(action==='brush-smaller'?-1:1)));
        if(action==='color-darker'||action==='color-lighter')return this.app.colorPicker.stepRamp(action==='color-darker'?-1:1);
        switch (action) {
            case 'file-home':
                this.app.confirmAndGoHome?.();
                break;
            case 'file-new':
                if (window.desktopAPI?.openNewProjectWindow) {
                    window.desktopAPI.openNewProjectWindow();
                } else {
                    const modal = document.getElementById('new-project-modal');
                    if (modal) {
                        modal.classList.add('show');
                        document.getElementById('new-proj-name')?.focus();
                    }
                }
                break;
            case 'file-open':
                this.app.projectManager.openProject();
                break;
            case 'file-save':
                return this.app.projectManager.saveProject();
                break;
            case 'file-save-as':
                return this.app.projectManager.saveProjectAs();
                break;
            case 'file-template': {
                const curProj = this.app.getActiveProject();
                if (curProj?.type === 'canvas') {
                    this.app.showToast('Шаблоны контейнеров доступны только для проектов типа Minecraft GUI', 'info');
                    break;
                }
                const tplModal = document.getElementById('template-modal');
                if (tplModal) {
                    this.app.prepareTemplateModal?.();
                    tplModal.classList.add('show');
                }
                break;
            }
            case 'file-export-png':
                this.app.exportPanel.open();
                break;
            case 'file-export-layer':
                this.app.exportPanel.open('active');
                break;
            case 'file-export-selected':this.app.exportPanel.open('selected');break;
            case 'file-export-repeat':this.app.exportPanel.open('project',true);break;
            case 'edit-undo':
                this.app.history.undo();
                break;
            case 'edit-redo':
                this.app.history.redo();
                break;
            case 'edit-clear-layer': {
                if (this.app.tools?.tools.marquee?.selection) {
                    this.app.tools.tools.marquee.deleteSelection();
                    break;
                }
                const active = this.app.layerManager.getActiveLayer();
                if (active && !active.isBase) this.app.clearActiveLayer();
                break;
            }
            case 'select-cut': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee) {
                    if (!['marquee','lasso','wand'].includes(this.app.tools.currentToolId)) {
                        this.app.tools.selectTool('marquee');
                    }
                    marquee.cut();
                }
                break;
            }
            case 'select-copy': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee) {
                    marquee.copy();
                }
                break;
            }
            case 'select-paste': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee) {
                    if (!['marquee','lasso','wand'].includes(this.app.tools.currentToolId)) {
                        this.app.tools.selectTool('marquee');
                    }
                    marquee.paste();
                }
                break;
            }
            case 'select-delete': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee) marquee.deleteSelection();
                break;
            }
            case 'layer-new': {
                this.app.layerPanel.addLayer();
                break;
            }
            case 'layer-duplicate': {
                this.app.layerPanel.duplicateLayer(this.app.layerManager.getActiveLayer());
                break;
            }
            case 'layer-delete': {
                this.app.layerPanel.deleteSelectedLayers();
                break;
            }
            case 'layer-mergedown': {
                this.app.layerPanel.mergeDownActive();
                break;
            }
            case 'layer-flatten': {
                this.app.layerPanel.flattenImage();
                break;
            }

            case 'tools-button-generator':
                this.app.openButtonGenerator?.();
                break;
            case 'image-canvas-size':
                this.app.openCanvasSizeModal?.();
                break;
            case 'transform-fliph': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                    marquee.flipFloating(true, false);
                } else {
                    document.getElementById('btn-transform-fliph')?.click();
                }
                break;
            }
            case 'transform-flipv': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                    marquee.flipFloating(false, true);
                } else {
                    document.getElementById('btn-transform-flipv')?.click();
                }
                break;
            }
            case 'transform-rotcw': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                    marquee.rotateFloating(90);
                } else {
                    document.getElementById('btn-transform-rotcw')?.click();
                }
                break;
            }
            case 'transform-rotccw': {
                const marquee = this.app.tools?.tools['marquee'];
                if (marquee && (marquee.hasFloating?.() || marquee.floatingData || marquee.floatingCanvas)) {
                    marquee.rotateFloating(-90);
                } else {
                    document.getElementById('btn-transform-rotccw')?.click();
                }
                break;
            }
            case 'transform-invert':
                if(this.app.tools?.tools?.marquee?.selection)this.app.tools.tools.marquee.invertSelectedColors();
                else document.getElementById('btn-transform-invert')?.click();
                break;
            case 'select-all': {
                this.app.bus.emit('SELECT_ALL');
                break;
            }
            case 'select-deselect': {
                this.app.bus.emit('DESELECT');
                break;
            }
            case 'select-invert': {
                this.app.bus.emit('INVERT_SELECTION');
                break;
            }
            case 'select-content': this.app.tools?.tools?.marquee?.selectContent();break;
            case 'select-grow': this.app.tools?.tools?.marquee?.changeBoundary(1);break;
            case 'select-shrink': this.app.tools?.tools?.marquee?.changeBoundary(-1);break;
            case 'view-grid': {
                const sm = this.app.settingsManager;
                if (sm) {
                    sm.set('showPixelGrid', !sm.get('showPixelGrid'));
                }
                break;
            }
            case 'view-zoom-in':
                document.getElementById('btn-zoom-in')?.click();
                break;
            case 'view-zoom-out':
                document.getElementById('btn-zoom-out')?.click();
                break;
            case 'view-zoom-fit':
                document.getElementById('btn-zoom-fit')?.click();
                break;
            case 'view-zoom-reset':
                document.getElementById('btn-zoom-reset')?.click();
                break;
            case 'settings-open':
                if (window.desktopAPI?.openSettingsWindow) {
                    window.desktopAPI.openSettingsWindow();
                } else {
                    this.app.settingsModal?.open();
                }
                break;
            case 'help-hotkeys':
                if (window.desktopAPI?.openSettingsWindow) {
                    window.desktopAPI.openSettingsWindow('hotkeys');
                } else if (this.app.settingsModal) {
                    this.app.settingsModal.activeTab = 'hotkeys';
                    this.app.settingsModal.open();
                }
                break;
            case 'image-recolor': {
                const modal = document.getElementById('recolor-modal');
                const curColor = this.app.colorPicker?.getColor() || '#3B82F6';
                const toColor = document.getElementById('recolor-to-color');
                const toHex = document.getElementById('recolor-to-hex');
                if (toColor) toColor.value = curColor;
                if (toHex) toHex.value = curColor;
                modal?.classList.add('show');
                break;
            }
            case 'image-load-ref':
            case 'image-ref-load':
                document.getElementById('input-ref-file')?.click();
                break;
            case 'image-clear-ref':
            case 'image-ref-clear':
                this.app.workspace?.clearReferenceImage();
                break;
            case 'layer-outline': {
                const color = this.app.colorPicker?.getColor() || '#000000';
                this.app.layerManager?.createOutline(color);
                break;
            }
            case 'layer-dropshadow':
            case 'layer-shadow': {
                this.app.layerManager?.createDropShadow(1, 1, 'rgba(0,0,0,0.5)');
                break;
            }
            case 'view-rulers':
                this.app.workspace?.toggleRulers();
                break;
            case 'view-guides':
                this.app.workspace?.toggleGuides();
                break;
            case 'view-clear-guides':
                this.app.workspace?.clearGuides();
                break;
            case 'view-tiling':
                this.app.workspace?.toggleTiling();
                break;
        }
    }

    setupRecolorModal() {
        const modal = document.getElementById('recolor-modal');
        const fromColor = document.getElementById('recolor-from-color');
        const fromHex = document.getElementById('recolor-from-hex');
        const toColor = document.getElementById('recolor-to-color');
        const toHex = document.getElementById('recolor-to-hex');
        const tol = document.getElementById('recolor-tol');
        const tolVal = document.getElementById('recolor-tol-val');
        const allLayers = document.getElementById('recolor-all-layers');
        const btnApply = document.getElementById('btn-apply-recolor');

        const syncColor = (colorInput, hexInput) => {
            colorInput?.addEventListener('input', () => {
                if (hexInput) hexInput.value = colorInput.value.toUpperCase();
            });
            hexInput?.addEventListener('change', () => {
                let v = hexInput.value.trim();
                if (!v.startsWith('#')) v = '#' + v;
                if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                    if (colorInput) colorInput.value = v;
                }
            });
        };

        syncColor(fromColor, fromHex);
        syncColor(toColor, toHex);

        tol?.addEventListener('input', () => {
            if (tolVal) tolVal.innerText = tol.value;
        });

        btnApply?.addEventListener('click', () => {
            const fHex = fromHex?.value || fromColor?.value || '#000000';
            const tHex = toHex?.value || toColor?.value || '#3B82F6';
            const tolerance = parseInt(tol?.value || '0', 10);
            const isAll = Boolean(allLayers?.checked);

            try {
                this.app.layerManager?.replaceColor(fHex, tHex, tolerance, isAll);
                modal?.classList.remove('show');
            } catch (error) { this.reportActionError(error); }
        });

        modal?.querySelector('.btn-close-modal')?.addEventListener('click', () => modal.classList.remove('show'));
        modal?.querySelector('.btn-cancel-modal')?.addEventListener('click', () => modal.classList.remove('show'));
    }
}
