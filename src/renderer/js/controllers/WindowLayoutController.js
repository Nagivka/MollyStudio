import { bindAttribute, bindText } from '../core/Locale.mjs';
import {inspectorBounds} from '../core/LayoutMetrics.mjs';

import { createProjectFromForm, resolveGuiTemplate } from '../core/ProjectFactory.mjs';

/** App-facing controller methods; document serialization lives in core. */
export default class WindowLayoutController {
    setupResizablePanels() {
        // 1. Right Inspector Width Resizer
        const vResizer = document.getElementById('right-panel-resizer');
        const savedPanelWidth = localStorage.getItem('molly_panel_width');
        const bounds=()=>inspectorBounds(window.innerWidth,document.getElementById('main-toolbar')?.getBoundingClientRect().width||56,document.documentElement.dataset.theme?.includes('minecraft'));
        if (savedPanelWidth && Number.isFinite(Number(savedPanelWidth))) {
            const {minimum,maximum}=bounds();
            document.documentElement.style.setProperty('--md-panel-width', `${Math.max(minimum,Math.min(maximum,Number(savedPanelWidth)))}px`);
        }

        if (vResizer) {
            let isDraggingV = false;
            let startX = 0;
            let startWidth = 250;

            vResizer.addEventListener('pointerdown', (e) => {
                if(e.button!==0)return;
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
                const {minimum,maximum:maxAllowed}=bounds();
                const newWidth = Math.max(minimum, Math.min(maxAllowed, startWidth + dx));
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
            window.addEventListener('blur', stopDragV);
            vResizer.addEventListener('lostpointercapture', stopDragV);

            const panel = document.getElementById('main-right-panel');
            if (panel && window.ResizeObserver) {
                const ro = new ResizeObserver(() => {
                    this.colorPicker?.resizeSB();
                });
                ro.observe(panel);
            }
        }

        const workspace = document.querySelector('.workspace-layout');
        const tabs = document.querySelector('.doc-tab-bar');
        const layers = document.getElementById('layers-list-scroll-body');
        const specialPanel = () => workspace.querySelector(':is(#prefix-editor, #title-editor):not([hidden])');
        this.setupLayoutHandle(workspace, {
            key: 'molly_generator_width', property: '--custom-generator-width',
            label: 'Ширина панели генератора', className: 'generator-resizer panel-resizer-v',
            minimum: 260, maximum: 580, direction: -1,
            measure: () => specialPanel()?.getBoundingClientRect().width
        });
        this.setupLayoutHandle(tabs, {
            key: 'molly_tab_width', property: '--custom-tab-width',
            label: 'Ширина вкладок', className: 'tabs-resizer',
            minimum: 110, maximum: 340,
            measure: () => tabs.querySelector('.doc-tab')?.getBoundingClientRect().width || 180
        });
        this.setupLayoutHandle(layers?.parentElement, {
            key: 'molly_layers_height', property: '--custom-layers-height',
            label: 'Высота списка слоёв', className: 'layers-resizer',
            minimum: 96, maximum: 640, vertical: true,
            measure: () => layers.getBoundingClientRect().height
        });
    }

    setupLayoutHandle(parent, {key, property, label, className, minimum, maximum, measure, vertical = false, direction = 1}) {
        if (!parent) return;
        const handle = document.createElement('div');
        const style = document.documentElement.style;
        handle.className = `layout-resizer ${className}`;
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
        handle.setAttribute('aria-valuemin', minimum);
        handle.setAttribute('aria-valuemax', maximum);
        bindAttribute(handle, 'aria-label', label);
        bindAttribute(handle, 'title', label);
        parent.append(handle);
        const apply = (value) => {
            const size = Math.round(Math.max(minimum, Math.min(maximum, value)));
            style.setProperty(property, `${size}px`);
            handle.setAttribute('aria-valuenow', size);
            return size;
        };
        const save = (size) => localStorage.setItem(key, size);
        const saved = Number(localStorage.getItem(key));
        if (saved > 0 && Number.isFinite(saved)) apply(saved);
        handle.addEventListener('focus', () => handle.setAttribute('aria-valuenow', Math.round(measure() || minimum)));
        handle.addEventListener('dblclick', () => {
            style.removeProperty(property);
            localStorage.removeItem(key);
            handle.setAttribute('aria-valuenow', Math.round(measure() || minimum));
        });
        const coordinate = event => vertical ? event.clientY : event.clientX;
        let drag;
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            handle.focus({preventScroll: true});
            handle.setPointerCapture(event.pointerId);
            drag = {id: event.pointerId, start: coordinate(event), size: measure() || minimum};
            handle.classList.add('dragging');
        });
        handle.addEventListener('pointermove', event => {
            if (drag?.id !== event.pointerId) return;
            drag.value = apply(drag.size + direction * (coordinate(event) - drag.start));
        });
        handle.addEventListener('lostpointercapture', event => {
            if (drag?.id !== event.pointerId) return;
            if (drag.value !== undefined) save(drag.value);
            drag = null;
            handle.classList.remove('dragging');
        });
        handle.addEventListener('keydown', event => {
            const delta = (vertical ? {ArrowUp: -8, ArrowDown: 8} : {ArrowLeft: -8, ArrowRight: 8})[event.key];
            if (!delta) return;
            event.preventDefault();
            event.stopPropagation();
            save(apply((measure() || minimum) + direction * delta));
        });
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

    showToast(message, icon = 'info', duration = 2800, actions = [], values = {}) {
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
        bindText(messageElement, message, values);
        toast.append(iconElement, messageElement);
        if (actions.length) {
            toast.classList.add('toast-with-actions');
            toast.setAttribute('role','status');
            const controls=document.createElement('div');controls.className='toast-actions';
            for(const action of actions){
                const button=document.createElement('button');button.type='button';button.className='md-btn outlined';
                bindText(button,action.label);
                button.addEventListener('click',async()=>{
                    for(const control of controls.querySelectorAll('button'))control.disabled=true;
                    try { if(await action.run()!==false)toast.remove(); }
                    catch(error){this.showToast(error.message,'error');}
                    finally {for(const control of controls.querySelectorAll('button'))control.disabled=false;}
                });
                controls.append(button);
            }
            const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='md-icon-btn';
            bindAttribute(dismiss,'aria-label','Закрыть уведомление');
            dismiss.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">close</i>';
            dismiss.addEventListener('click',()=>toast.remove());controls.append(dismiss);toast.append(controls);
        }

        toastContainer.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        if(duration>0)setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, duration);
        return toast;
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

        // Shared project type switcher for GUI, canvas and prefixes.
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
                for (const [projectType, section] of [['prefix','new-proj-section-prefix'],['title','new-proj-section-title']]) {
                    const element = document.getElementById(section);
                    if (element) element.style.display = type === projectType ? 'block' : 'none';
                }
                if (type === 'gui') {
                    newProjName?.focus();
                } else {
                    if (['prefix','title'].includes(type)) document.getElementById(`new-${type}-name`)?.focus();
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
            if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : '';
        };
        newProjTplSelect?.addEventListener('change', updateNewProjTplVisibility);
        updateNewProjTplVisibility();

        const tplModalSelect = document.getElementById('proj-template');
        const updateTplModalVisibility = () => {
            const val = tplModalSelect?.value || '';
            const isVanillaContainer = val.startsWith('gui_container/');
            const frameGroup = document.getElementById('proj-frame-group');
            if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : '';
            const style = document.getElementById('proj-style');
            if (style) style.disabled = isVanillaContainer || val === 'none';
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

        const newProjInputs = [newProjName, newCanvasName, newCanvasW, newCanvasH, document.getElementById('new-prefix-name'),document.getElementById('new-title-name')];
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
                        style: document.getElementById('proj-style')?.value || 'default',
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
            bindAttribute(docInfo, "title", 'Изменить размер холста — Ctrl+Alt+C');
            docInfo.addEventListener('click', () => {
                this.openCanvasSizeModal();
            });
        }
    }

    openCanvasSizeModal() {
        const projectType = this.getActiveProject()?.type;
        if(projectType==='title'){this.showToast('Размер надписи задаётся в параметрах 3D-генератора.','info');return;}
        if (projectType==='prefix') { this.showToast('Размер префикса определяется текстом и отступами.', 'info'); return; }
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
}
