import {bindText} from '../core/Locale.mjs';
import SettingsManager from '../core/SettingsManager.js';
import { initRippleEffect } from '../ui/Ripple.js';
import { installKeyboardNavigation } from '../ui/KeyboardNavigation.js';
import { buildEditorUrl, createProjectFromForm } from '../core/ProjectFactory.mjs';

class NewProjectWindowApp {
    constructor() {
        this.settings = new SettingsManager();
        this.activeProjectType = 'gui';
        this.newCanvasAspectLocked = true;
        this.newCanvasAspect = 1;
        this.init();
    }

    init() {
        initRippleEffect();
        installKeyboardNavigation();

        // Window controls
        document.getElementById('btn-win-close')?.addEventListener('click', () => {
            window.desktopAPI?.close();
        });

        document.getElementById('btn-cancel')?.addEventListener('click', () => {
            window.desktopAPI?.close();
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.desktopAPI?.close();
            } else if (e.key === 'Enter' && e.target.matches('input[type="text"]')) {
                this.createProject();
            }
        });

        // Shared project type switcher for all project kinds.
        const typeButtons = document.querySelectorAll('#new-proj-type-selector .type-option');
        const secGui = document.getElementById('new-proj-section-gui');
        const secCanvas = document.getElementById('new-proj-section-canvas');
        const newProjName = document.getElementById('new-proj-name');
        const newCanvasName = document.getElementById('new-canvas-name');

        typeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                this.activeProjectType = type;
                typeButtons.forEach(b => {
                    const isSelected = b === btn;
                    b.classList.toggle('active', isSelected);
                    b.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                });
                if (secGui) secGui.style.display = type === 'gui' ? 'block' : 'none';
                if (secCanvas) secCanvas.style.display = type === 'canvas' ? 'block' : 'none';
                for (const [projectType, section] of [['prefix','new-proj-section-prefix']]) {
                    const element = document.getElementById(section);
                    if (element) element.style.display = type === projectType ? 'block' : 'none';
                }
                if (type === 'gui') {
                    newProjName?.focus();
                } else {
                    if (['prefix'].includes(type)) document.getElementById(`new-${type}-name`)?.focus();
                    else newCanvasName?.focus();
                }
            });
        });

        // Vanilla template options include an optional container frame.
        const templateSelect = document.getElementById('new-proj-template');
        const updateTplVisibility = () => {
            const val = templateSelect?.value || '';
            const isVanillaContainer = val.startsWith('gui_container/');
            const frameGroup = document.getElementById('new-proj-frame-group');
            if (frameGroup) frameGroup.style.display = isVanillaContainer ? 'none' : '';
        };
        templateSelect?.addEventListener('change', updateTplVisibility);
        updateTplVisibility();

        // 3. Canvas presets and inputs
        const newCanvasW = document.getElementById('new-canvas-w');
        const newCanvasH = document.getElementById('new-canvas-h');
        const btnNewCanvasLock = document.getElementById('btn-new-canvas-lock-aspect');

        btnNewCanvasLock?.addEventListener('click', () => {
            this.newCanvasAspectLocked = !this.newCanvasAspectLocked;
            btnNewCanvasLock.classList.toggle('active', this.newCanvasAspectLocked);
            btnNewCanvasLock.setAttribute('aria-pressed', String(this.newCanvasAspectLocked));
            if (this.newCanvasAspectLocked) {
                const w = parseInt(newCanvasW?.value, 10) || 32;
                const h = parseInt(newCanvasH?.value, 10) || 32;
                this.newCanvasAspect = w / Math.max(1, h);
            }
        });

        newCanvasW?.addEventListener('input', () => {
            if (this.newCanvasAspectLocked && this.newCanvasAspect) {
                const w = parseInt(newCanvasW.value, 10);
                if (w > 0) newCanvasH.value = Math.min(4096, Math.max(1, Math.round(w / this.newCanvasAspect)));
            }
            document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
                const selected = Number(chip.dataset.w) === Number(newCanvasW.value)
                    && Number(chip.dataset.h) === Number(newCanvasH?.value);
                chip.classList.toggle('active', selected);
                chip.setAttribute('aria-pressed', String(selected));
            });
        });

        newCanvasH?.addEventListener('input', () => {
            if (this.newCanvasAspectLocked && this.newCanvasAspect) {
                const h = parseInt(newCanvasH.value, 10);
                if (h > 0) newCanvasW.value = Math.min(4096, Math.max(1, Math.round(h * this.newCanvasAspect)));
            }
            document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
                const selected = Number(chip.dataset.w) === Number(newCanvasW?.value)
                    && Number(chip.dataset.h) === Number(newCanvasH.value);
                chip.classList.toggle('active', selected);
                chip.setAttribute('aria-pressed', String(selected));
            });
        });

        document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const w = chip.dataset.w;
                const h = chip.dataset.h;
                if (w && h) {
                    if (newCanvasW) newCanvasW.value = w;
                    if (newCanvasH) newCanvasH.value = h;
                    this.newCanvasAspect = parseInt(w, 10) / parseInt(h, 10);
                    document.querySelectorAll('#new-canvas-presets .preset-chip').forEach(item => {
                        const selected = item === chip;
                        item.classList.toggle('active', selected);
                        item.setAttribute('aria-pressed', String(selected));
                    });
                }
            });
        });

        document.getElementById('btn-create')?.addEventListener('click', () => {
            this.createProject();
        });
    }

    async createProject() {
        if (this.creating) return;
        let projectData;
        try {
            projectData = createProjectFromForm(document, this.activeProjectType);
        } catch (_) {
            const widthInput = document.getElementById('new-canvas-w');
            const heightInput = document.getElementById('new-canvas-h');
            widthInput?.reportValidity();
            heightInput?.reportValidity();
            if (!widthInput?.checkValidity()) widthInput?.focus();
            else heightInput?.focus();
            return;
        }

        if (window.desktopAPI?.notifyProjectCreated) {
            this.creating = true;
            try {
                await window.desktopAPI.notifyProjectCreated(projectData);
                await window.desktopAPI.close();
            } catch (error) {
                this.creating = false;
                console.error('Project creation failed:', error);
                const button = document.getElementById('btn-create');
                if (button) bindText(button, 'Повторить создание');
            }
        } else {
            window.location.href = buildEditorUrl(projectData);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.newProjectApp = new NewProjectWindowApp();
    });
} else {
    window.newProjectApp = new NewProjectWindowApp();
}

