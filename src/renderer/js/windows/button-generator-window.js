import {createGradientRow,createColorPreview,createHexInput} from '../ui/Controls.mjs';
import {labelHTML, bindAttribute, bindText} from '../core/Locale.mjs';
import { setPressedState } from '../ui/ControlState.js';
import ButtonGeneratorModel from '../ui/ButtonGeneratorModel.js';
import { Palettes, populatePaletteSelect } from '../utils/Palettes.js';
import { captureGradientFocus, restoreGradientFocus } from '../ui/GradientFocus.js';
/**
 * ButtonGeneratorController - Controller for standalone Button Generator window in MollyStudio.
 * Features:
 * - Google Material Design 3 / Material You aesthetic
 * - Exclusive GUI chest container preview (container_54.png)
 * - Bedrock chin height: 1..5 px, default 1 px
 * - Procedural pixel rendering: JAVA, Bedrock, FLAT, OUTLINE, DOUBLE
 * - Full color shading and up to 8 gradient colors at any angle (0..360°)
 * - Full MollyStudio palette library
 * - Direct import into the active project
 * - Zero parentheses in Russian UI strings
 */
export class ButtonGeneratorController extends ButtonGeneratorModel {
    constructor() {
        super();
        // State
        this.guiCol = 0; // 0..8
        this.guiRow = 0; // 0..5
        this.currentCols = 1;
        this.currentRows = 1;
        this.currentZoom = 3;
        this.currentStyle = 'default'; // The saved 'ten' ID is displayed as Bedrock.
        this.currentSlotMode = 'full'; // 'full' 18px or 'inner' 16px
        this.currentSlotSize = 18;

        this.currentChin = 1;
        this.currentShadow = 1;
        this.currentOpacity = 100;
        this.tintedBorderEnabled = false;
        this.transparentBorder = false;


        // DOM elements
        this.canvas = document.getElementById('previewCanvas');
        this.ctx = this.canvas?.getContext('2d');
        this.canvasWrap = document.getElementById('canvasWrapper');

        // Preload chest texture
        this.mcGuiImg = new Image();
        this.mcGuiLoaded = false;
        this.mcGuiImg.onload = () => {
            this.mcGuiLoaded = true;
            this.updateView();
        };
        this.mcGuiImg.src = 'assets/images/container/default/container_54.png';

        this.init();
    }

    init() {
        this.setupWindowControls();
        this.renderDynamicControls();
        this.setupEventListeners();
        this.setupPalettesUI();
        this.syncStyleControls(document);
        this.updateShading();
        this.updateView();
    }

    renderDynamicControls() {
        const colsRow = document.getElementById('colsChipsRow');
        if (colsRow) {
            colsRow.innerHTML = Array.from({ length: 9 }, (_, i) => i + 1)
                .map(col => `<button type="button" class="m3-chip ${col === this.currentCols ? 'active' : ''}" data-col="${col}">${col}</button>`)
                .join('');
        }

        const rowsRow = document.getElementById('rowsChipsRow');
        if (rowsRow) {
            rowsRow.innerHTML = Array.from({ length: 6 }, (_, i) => i + 1)
                .map(row => `<button type="button" class="m3-chip ${row === this.currentRows ? 'active' : ''}" data-row="${row}">${row}</button>`)
                .join('');
        }

        const presetsRow = document.getElementById('presetsRow');
        if (presetsRow) {
            const presets = [
                { cols: 1, rows: 1, label: '1×1' },
                { cols: 2, rows: 1, label: '2×1' },
                { cols: 3, rows: 1, label: '3×1' },
                { cols: 9, rows: 1, label: 'Строка 9×1' },
                { cols: 9, rows: 4, label: 'Окно 9×4' },
                { cols: 9, rows: 6, label: 'Сундук 9×6' }
            ];
            presetsRow.innerHTML = presets
                .map(p => `<button type="button" class="m3-preset-btn" data-cols="${p.cols}" data-rows="${p.rows}">${labelHTML(p.label)}</button>`)
                .join('');
        }

        const chinRow = document.getElementById('chinChipsRow');
        if (chinRow) {
            chinRow.innerHTML = [1, 2, 3, 4, 5]
                .map(px => `<button type="button" class="m3-chip ${px === this.currentChin ? 'active' : ''}" data-chin="${px}">${px} px</button>`)
                .join('');
        }

        const shadowRow = document.getElementById('shadowChipsRow');
        if (shadowRow) {
            shadowRow.innerHTML = [1, 2, 3, 4, 5]
                .map(px => `<button type="button" class="m3-chip ${px === this.currentShadow ? 'active' : ''}" data-shadow="${px}">${px} px</button>`)
                .join('');
        }

        const angleRow = document.getElementById('gradAngleChipsRow');
        if (angleRow) {
            angleRow.innerHTML = [0, 45, 90, 135, 180, 270]
                .map(deg => `<button type="button" class="m3-chip ${deg === this.gradientAngle ? 'active' : ''}" data-angle="${deg}">${deg}°</button>`)
                .join('');
        }
    }

    setupWindowControls() {
        document.getElementById('btn-win-min')?.addEventListener('click', () => {
            window.desktopAPI?.minimize?.();
        });
        const maxButton = document.getElementById('btn-win-max');
        const maxIcon = document.querySelector('#btn-win-max svg');
        const maxSvg = `<rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2" rx="0.5"/>`;
        const restoreSvg = `<rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1" rx="0.5"/><path d="M3 1h5.5a.5.5 0 0 1 .5.5V7" fill="none" stroke="currentColor" stroke-width="1.1"/>`;


        const updateMaxUI = isMax => {
            if (maxIcon) maxIcon.innerHTML = isMax ? restoreSvg : maxSvg;
            if (maxButton) {
                bindAttribute(maxButton, "title", isMax ? 'Восстановить окно' : 'Развернуть');
                bindAttribute(maxButton, 'aria-label', isMax ? 'Восстановить' : 'Развернуть');
            }
        };
        maxButton?.addEventListener('click', async () => {
            try {
                updateMaxUI(!!(await window.desktopAPI?.maximize?.()));
            } catch (_) {}
        });
        document.getElementById('btn-win-close')?.addEventListener('click', () => {
            window.desktopAPI?.close?.() || window.close();
        });
        window.desktopAPI?.onWindowStateChange?.(updateMaxUI);
        window.desktopAPI?.isMaximized?.()?.then?.(isMax => updateMaxUI(!!isMax))?.catch?.(() => {});
    }

    setupEventListeners() {
        // Slot Mode
        document.getElementById('segSlotFull')?.addEventListener('click', () => this.setSlotMode('full'));
        document.getElementById('segSlotInner')?.addEventListener('click', () => this.setSlotMode('inner'));

        // Columns chips
        document.querySelectorAll('#colsChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setCols(parseInt(chip.dataset.col, 10)));
        });

        // Rows chips
        document.querySelectorAll('#rowsChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setRows(parseInt(chip.dataset.row, 10)));
        });

        // Presets
        document.querySelectorAll('.m3-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const c = parseInt(btn.dataset.cols, 10);
                const r = parseInt(btn.dataset.rows, 10);
                this.setCols(c);
                this.setRows(r);
            });
        });

        // Style segmented
        document.getElementById('segStyleDefault')?.addEventListener('click', () => this.setStyle('default'));
        document.getElementById('segStyleTen')?.addEventListener('click', () => this.setStyle('ten'));
        document.getElementById('segStyleFlat')?.addEventListener('click', () => this.setStyle('flat'));
        document.getElementById('segStyleOutline')?.addEventListener('click', () => this.setStyle('outline'));
        document.getElementById('segStyleDouble')?.addEventListener('click', () => this.setStyle('double'));

        // Chin slider & chips (default: 0)
        const chinInput = document.getElementById('chinInput');
        chinInput?.addEventListener('input', (e) => this.setChin(parseInt(e.target.value, 10)));
        document.querySelectorAll('#chinChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setChin(parseInt(chip.dataset.chin, 10)));
        });

        // Shadow slider & chips
        const shadowInput = document.getElementById('shadowInput');
        shadowInput?.addEventListener('input', (e) => this.setShadow(parseInt(e.target.value, 10)));
        document.querySelectorAll('#shadowChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setShadow(parseInt(chip.dataset.shadow, 10)));
        });

        // Opacity slider
        const opacityInput = document.getElementById('opacityInput');
        opacityInput?.addEventListener('input', (e) => {
            this.currentOpacity = parseInt(e.target.value, 10);
            const valText = document.getElementById('opacityValText');
            if (valText) valText.textContent = `${this.currentOpacity}%`;
            this.updateView();
        });

        // Switches
        document.getElementById('tintedBorderCheck')?.addEventListener('change', (e) => {
            this.tintedBorderEnabled = e.target.checked;
            this.updateShading();
            this.updateView();
        });
        document.getElementById('transpBorderCheck')?.addEventListener('change', (e) => {
            this.transparentBorder = e.target.checked;
            this.updateView();
        });
        // Color Mode (Solid vs Gradient)
        document.getElementById('segColorSolid')?.addEventListener('click', () => this.setColorMode('solid'));
        document.getElementById('segColorGradient')?.addEventListener('click', () => this.setColorMode('gradient'));

        // Solid Color picker & hex & drop target
        const masterColorInput = document.getElementById('masterColorInput');
        const hexTextInput = document.getElementById('hexTextInput');
        const solidColorBox = document.getElementById('solidColorBox');

        masterColorInput?.addEventListener('input', (e) => this.setMasterColor(e.target.value));
        hexTextInput?.addEventListener('change', (e) => {
            let v = e.target.value.trim();
            if (!v.startsWith('#')) v = '#' + v;
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                this.setMasterColor(v);
            }
        });

        solidColorBox?.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            solidColorBox.style.borderColor = 'var(--md-primary)';
        });
        solidColorBox?.addEventListener('dragleave', () => {
            solidColorBox.style.borderColor = '';
        });
        solidColorBox?.addEventListener('drop', (e) => {
            e.preventDefault();
            solidColorBox.style.borderColor = '';
            const color = e.dataTransfer.getData('text/plain');
            if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
                this.setMasterColor(color.trim());
            }
        });

        // Add Gradient Stop button
        document.getElementById('btnAddGradColor')?.addEventListener('click', () => this.addGradientStop());

        const gradAngleInput = document.getElementById('gradAngleInput');
        gradAngleInput?.addEventListener('input', (e) => this.setGradAngle(e.target.value));
        document.querySelectorAll('#gradAngleChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setGradAngle(chip.dataset.angle));
        });

        // Palette Selector
        document.getElementById('paletteSelect')?.addEventListener('change', (e) => {
            this.renderPaletteSwatches(e.target.value);
        });

        // Zoom buttons
        document.querySelectorAll('.viewport-toolbar .icon-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setZoom(parseInt(btn.dataset.z, 10)));
        });

        // Import Action Button
        document.getElementById('btnImportProject')?.addEventListener('click', () => this.importToProject());
    }

    /* ==========================================================================
       PALETTES
       ========================================================================== */
    setupPalettesUI() {
        populatePaletteSelect(document.getElementById('paletteSelect'));
        this.renderPaletteSwatches('minecraft');
        this.renderGradientStopsUI();
    }

    renderPaletteSwatches(palName) {
        const container = document.getElementById('paletteSwatchesGrid');
        if (!container) return;
        container.innerHTML = '';
        const list = Palettes[palName] || Palettes.minecraft;
        list.forEach(hex => {
            const btn = document.createElement('button');
            btn.type = 'button';
            bindAttribute(btn, "aria-label", "Выбрать цвет {0}", {0: hex});
            btn.className = 'swatch-btn';
            btn.style.backgroundColor = hex;
            btn.title = hex;
            btn.draggable = true;
            btn.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', hex);
                e.dataTransfer.effectAllowed = 'copy';
            });
            btn.addEventListener('click', () => {
                if (this.colorMode === 'solid') {
                    this.setMasterColor(hex);
                } else {
                    this.setGradientStopColor(this.activeGradientStopIndex, hex);
                }
            });
            container.appendChild(btn);
        });
    }

    /* ==========================================================================
       COLOR SHADING & MATH
       ========================================================================== */






    updateMiniSwatches() {
        const elBd = document.getElementById('miniSwatchBd');
        const elHl = document.getElementById('miniSwatchHl');
        const elSh = document.getElementById('miniSwatchSh');
        const elSf = document.getElementById('miniSwatchSf');
        if (elBd) elBd.style.background = this.colors.border;
        if (elHl) elHl.style.background = this.colors.highlight;
        if (elSh) elSh.style.background = this.colors.shadow;
        if (elSf) elSf.style.background = this.colors.surface;
    }

    setMasterColor(hex) {
        this.masterBaseColor = hex.toUpperCase();
        const mc = document.getElementById('masterColorInput');
        const ht = document.getElementById('hexTextInput');
        if (mc) mc.value = this.masterBaseColor;
        if (ht) ht.value = this.masterBaseColor;
        this.updateShading();
        this.updateView();
    }

    setColorMode(mode) {
        this.colorMode = mode;
        const solidButton = document.getElementById('segColorSolid');
        const gradientButton = document.getElementById('segColorGradient');
        setPressedState(solidButton, mode === 'solid');
        setPressedState(gradientButton, mode === 'gradient');
        solidButton?.setAttribute('aria-pressed', String(mode === 'solid'));
        gradientButton?.setAttribute('aria-pressed', String(mode === 'gradient'));
        const solidEl = document.getElementById('solidColorSection');
        const gradEl = document.getElementById('gradientColorSection');
        if (solidEl) solidEl.style.display = (mode === 'solid') ? 'flex' : 'none';
        if (gradEl) gradEl.style.display = (mode === 'gradient') ? 'flex' : 'none';
        if (mode === 'gradient') {
            this.renderGradientStopsUI();
        }
        this.updateShading();
        this.updateView();
    }




    renderGradientStopsUI() {
        const container = document.getElementById('gradientStopsList');
        const bar = document.getElementById('gradPreviewBar');
        if (bar) {
            bar.style.background = `linear-gradient(to right, ${this.gradientColors.join(', ')})`;
        }
        if (!container) return;
        const focusToken = captureGradientFocus(container);
        container.innerHTML = '';

        this.gradientColors.forEach((hex, idx) => {
            const row = createGradientRow(idx,idx===this.activeGradientStopIndex);

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                row.style.borderColor = 'var(--md-primary)';
                row.style.backgroundColor = 'var(--md-surface-container-highest)';
            });
            row.addEventListener('dragleave', () => {
                row.style.borderColor = (idx === this.activeGradientStopIndex) ? 'var(--md-primary)' : 'var(--md-outline-variant)';
                row.style.backgroundColor = 'var(--md-surface-container-high)';
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                const color = e.dataTransfer.getData('text/plain');
                if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
                    this.setGradientStopColor(idx, color.trim());
                }
            });
            row.addEventListener('click', event => {
                this.activeGradientStopIndex = idx;
                if (event.target === row || event.target === label) this.renderGradientStopsUI();
            });

            const label = document.createElement('button');
            label.type = 'button'; label.className = 'md-icon-btn gradient-stop-select';
            label.dataset.gradientRole = 'select';
            bindAttribute(label, "aria-label", "Выбрать точку градиента {0}", {0: idx + 1});
            label.setAttribute('aria-pressed', String(idx === this.activeGradientStopIndex));
            label.style.fontFamily = "'Google Sans', sans-serif";
            label.style.fontSize = '0.74rem';
            label.style.color = 'var(--md-on-surface-variant)';
            label.style.minWidth = '14px';
            label.textContent = `${idx + 1}`;
            row.appendChild(label);

            const {circle,input:colInput} = createColorPreview(hex,28);
            colInput.id = `button-gradient-color-${idx}`;
            colInput.dataset.gradientRole = 'color';
            bindAttribute(colInput, "aria-label", "Цвет точки градиента {0}", {0: idx + 1});
            colInput.value = hex;
            colInput.addEventListener('input', (e) => {
                this.setGradientStopColor(idx, e.target.value);
            });
            circle.appendChild(colInput);
            row.appendChild(circle);

            const textInput = createHexInput(hex);
            textInput.id = `button-gradient-hex-${idx}`;
            textInput.dataset.gradientRole = 'hex';
            bindAttribute(textInput, "aria-label", "HEX точки градиента {0}", {0: idx + 1});
            textInput.className = 'm3-text-field';
            textInput.value = hex;
            textInput.maxLength = 7;
            textInput.style.padding = '4px 8px';
            textInput.style.fontSize = '0.78rem';
            textInput.addEventListener('change', (e) => {
                let val = e.target.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                    this.setGradientStopColor(idx, val);
                }
            });
            row.appendChild(textInput);

            if (this.gradientColors.length > 2) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'icon-btn';
                delBtn.style.padding = '0 6px';
                delBtn.style.height = '28px';
                bindAttribute(delBtn, "title", "Удалить цвет {0}", {0: idx + 1});
                delBtn.setAttribute('aria-label', delBtn.title);
                delBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-on-surface-variant);">close</span>';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.removeGradientStop(idx);
                });
                row.appendChild(delBtn);
            }

            container.appendChild(row);
        });
        restoreGradientFocus(container, focusToken);
    }

    setGradAngle(deg) {
        this.gradientAngle = Math.max(0, Math.min(360, parseInt(deg, 10) || 0));
        const input = document.getElementById('gradAngleInput');
        const valText = document.getElementById('gradAngleValText');
        if (input) input.value = this.gradientAngle;
        if (valText) valText.textContent = `${this.gradientAngle}°`;
        document.querySelectorAll('#gradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === this.gradientAngle);
        });
        this.updateView();
    }

    /* ==========================================================================
       SLOT & DIMENSION CONTROLS
       ========================================================================== */
    setSlotMode(mode) {
        this.currentSlotMode = mode;
        const innerButton = document.getElementById('segSlotInner');
        const fullButton = document.getElementById('segSlotFull');
        setPressedState(innerButton, mode === 'inner');
        setPressedState(fullButton, mode === 'full');
        innerButton?.setAttribute('aria-pressed', String(mode === 'inner'));
        fullButton?.setAttribute('aria-pressed', String(mode === 'full'));
        this.updateView();
    }

    setCols(c) {
        this.currentCols = Math.max(1, Math.min(9, parseInt(c, 10) || 1));
        document.querySelectorAll('#colsChipsRow .m3-chip').forEach((btn, i) => {
            setPressedState(btn, i + 1 === this.currentCols);
        });
        this.updateView();
    }

    setRows(r) {
        this.currentRows = Math.max(1, Math.min(6, parseInt(r, 10) || 1));
        document.querySelectorAll('#rowsChipsRow .m3-chip').forEach((btn, i) => {
            setPressedState(btn, i + 1 === this.currentRows);
        });
        this.updateView();
    }

    setStyle(st) {
        this.currentStyle=st;
        this.syncStyleControls(document);
        this.updateView();
    }

    setChin(val) {
        const parsed = Number.parseInt(val, 10);
        this.currentChin = Math.max(1, Math.min(5, Number.isFinite(parsed) ? parsed : 1));
        const input = document.getElementById('chinInput');
        const valText = document.getElementById('chinValText');
        if (input) input.value = this.currentChin;
        if (valText) valText.textContent = `${this.currentChin} px`;
        document.querySelectorAll('#chinChipsRow .m3-chip').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.chin, 10) === this.currentChin);
        });
        this.updateView();
    }

    setShadow(val) {
        this.currentShadow = Math.max(1, Math.min(5, parseInt(val, 10) || 1));
        const input = document.getElementById('shadowInput');
        const valText = document.getElementById('shadowValText');
        if (input) input.value = this.currentShadow;
        if (valText) valText.textContent = `${this.currentShadow} px`;
        document.querySelectorAll('#shadowChipsRow .m3-chip').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.shadow, 10) === this.currentShadow);
        });
        this.updateView();
    }


    setZoom(z) {
        z = Math.max(1, Math.min(8, Math.round(Number(z) || 3)));
        this.currentZoom = z;
        document.querySelectorAll('.viewport-toolbar .icon-btn').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.z, 10) === z);
        });
        this.updateView();
    }





    renderGuiView() {
        if (!this.canvas || !this.ctx) return;

        this.canvas.width = 176;
        this.canvas.height = 222;
        this.ctx.imageSmoothingEnabled = false;

        // Отрисовка шаблона сундука
        if (this.mcGuiLoaded && this.mcGuiImg.complete) {
            this.ctx.drawImage(this.mcGuiImg, 0, 0, 176, 222, 0, 0, 176, 222);
        } else {
            this.ctx.fillStyle = '#C6C6C6';
            this.ctx.fillRect(0, 0, 176, 222);
        }

        const btnW = this.getWidth(this.currentCols);
        const btnH = this.getHeight(this.currentRows);
        const btnX = (this.currentSlotMode === 'full' ? 7 : 8);
        const btnY = (this.currentSlotMode === 'full' ? 17 : 18);

        const btnCanvas = this.renderButton(
            btnW, btnH, this.colors, this.currentStyle,
            this.currentOpacity, this.transparentBorder,
            this.currentChin, this.currentShadow
        );
        try { this.ctx.drawImage(btnCanvas, btnX, btnY); }
        finally { btnCanvas.width = btnCanvas.height = 1; }

        if (this.canvasWrap) {
            this.canvasWrap.style.width = (176 * this.currentZoom) + 'px';
            this.canvasWrap.style.height = (222 * this.currentZoom) + 'px';
        }
        this.canvas.style.width = (176 * this.currentZoom) + 'px';
        this.canvas.style.height = (222 * this.currentZoom) + 'px';

        const colsVal = document.getElementById('colsValText');
        const rowsVal = document.getElementById('rowsValText');

        if (colsVal) colsVal.textContent = `${this.currentCols} · ${btnW} px`;
        if (rowsVal) rowsVal.textContent = `${this.currentRows} · ${btnH} px`;
    }

    updateView() {
        if (this.previewFrame) return;
        this.previewFrame = requestAnimationFrame(() => {
            this.previewFrame = null;
            this.renderGuiView();
        });
    }

    /* ==========================================================================
       IMPORT TO PROJECT: NORMAL BUTTON ONLY
       ========================================================================== */
    async importToProject() {
        if (this.importing) return false;
        this.importing = true;
        const button = document.getElementById('btnImportProject');
        if (button) button.disabled = true;
        try {
            const buttonData = this.createButtonData();
            if (typeof window.desktopAPI?.notifyButtonGenerated === 'function') {
                await window.desktopAPI.notifyButtonGenerated(buttonData);
                this.showToast(`Кнопка ${buttonData.w}×${buttonData.h} px добавлена в редактор.`);
            } else {
                const channel = new BroadcastChannel('molly_button_generator');
                try { channel.postMessage({ action: 'insert_button', data: buttonData }); }
                finally { channel.close(); }
                this.showToast(`Кнопка ${buttonData.w}×${buttonData.h} px отправлена в редактор.`);
            }
            return true;
        } catch (error) {
            console.error('Failed to send generated button:', error);
            this.showToast(error.message || 'Не удалось передать кнопку. Откройте редактор и повторите вставку.');
            return false;
        } finally {
            this.importing = false;
            if (button) button.disabled = false;
        }
    }

    showToast(msg) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        const text = document.getElementById('toastText');
        if (text) bindText(text, msg);
        toast.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.buttonGenApp = new ButtonGeneratorController();
});
