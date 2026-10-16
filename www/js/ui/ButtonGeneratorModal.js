import { setPressedState } from './ControlState.js';
import ButtonRenderer from '../graphics/ButtonRenderer.js';
import { Palettes } from '../utils/Palettes.js';
import { captureGradientFocus, restoreGradientFocus } from './GradientFocus.js';

/**
 * ButtonGeneratorModal - Minecraft GUI Button Generator integrated into MollyStudio.
 * Features:
 * - Google Material Design 3 / Material You aesthetic
 * - Exclusive GUI chest container preview (container_54.png)
 * - Default chin height: 0 px
 * - Procedural pixel-perfect rendering (DEFAULT, TEN, FLAT)
 * - Full color shading and 2-stop linear gradient at any angle (0..360°)
 * - Full MollyStudio palette library
 * - Direct import into active project with choice of state: Normal, Pressed, or Both
 * - Zero parentheses in Russian UI strings
 */
export default class ButtonGeneratorModal extends ButtonRenderer {
    constructor(app) {
        super();
        this.app = app;
        this.bus = app.bus;
        this.modalEl = null;

        // Viewport & GUI State
        this.guiCol = 0; // 0..8
        this.guiRow = 0; // 0..5
        this.currentCols = 1;
        this.currentRows = 1;
        this.currentZoom = 3;
        this.currentStyle = 'default'; // 'default', 'ten', 'flat'
        this.currentSlotMode = 'full'; // 'full' 18px or 'inner' 16px
        this.currentSlotSize = 18;

        // No lower shadow strip unless requested.
        this.currentChin = 0;
        this.currentShadow = 1;
        this.currentOpacity = 100;
        this.tintedBorderEnabled = false;
        this.transparentBorder = false;

        // Colors & Gradient
        this.colorMode = 'solid'; // 'solid' or 'gradient'
        this.autoShadeEnabled = true;
        this.masterBaseColor = '#C5C5C5';
        this.gradientColors = ['#3B82F6', '#1D4ED8'];
        this.activeGradientStopIndex = 0;
        this.gradientAngle = 90; // 0..360

        this.colors = {
            border: '#000000',
            highlight: '#ECECEC',
            shadow: '#7C7C7C',
            surface: '#C5C5C5'
        };

        // Preload chest texture
        this.mcGuiImg = new Image();
        this.mcGuiLoaded = false;
        this.mcGuiImg.onload = () => {
            this.mcGuiLoaded = true;
            if (this.modalEl?.classList.contains('show')) {
                this.updateView();
            }
        };
        this.mcGuiImg.src = 'assets/images/container/default/container_54.png';

        this.init();
    }

    init() {
        // Global shortcut Ctrl+Shift+B
        window.addEventListener('keydown', (e) => {
            if (e.defaultPrevented) return;
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyB' || e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И')) {
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    if (window.electronAPI?.openButtonGeneratorWindow) {
                        window.electronAPI.openButtonGeneratorWindow();
                    } else {
                        this.toggle();
                    }
                }
            } else if (e.key === 'Escape' && this.modalEl?.classList.contains('show')) {
                this.close();
            }
        });
    }

    toggle() {
        if (this.modalEl?.classList.contains('show')) {
            this.close();
        } else {
            this.open();
        }
    }

    open() {
        this.createDOM();
        requestAnimationFrame(() => {
            this.modalEl.classList.add('show');
            this.updateShading();
            this.updateView();
        });
    }

    close() {
        if (this.modalEl) {
            this.modalEl.classList.remove('show');
        }
        this.isTestingClick = false;
    }

    createDOM() {
        if (this.modalEl) return;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay btn-gen-overlay';
        overlay.id = 'button-generator-modal';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'btn-gen-title');

        overlay.innerHTML = `
            <div class="modal btn-gen-modal" tabindex="-1">
                <!-- Modal Header -->
                <div class="modal-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="material-symbols-rounded" style="color: var(--md-primary); font-size: 22px;">smart_button</span>
                        <h2 id="btn-gen-title">Генератор кнопок</h2>
                    </div>
                    <button class="md-icon-btn btn-close-modal " id="btn-modal-close-x" title="Закрыть" aria-label="Закрыть" type="button">
                        <span class="material-symbols-rounded">close</span>
                    </button>
                </div>

                <!-- Modal Body -->
                <div class="modal-body buttons-win-body">
                    
                    <!-- Left Sidebar (Controls) -->
                    <aside class="buttons-sidebar">
                        <div class="buttons-sidebar-scroll-area">
                        
                            <!-- 1. РАЗМЕРЫ И СЛОТЫ -->
                            <div class="m3-card">
                                <div class="card-header">
                                    <span class="card-title">
                                        <span class="material-symbols-rounded">grid_on</span>
                                        Размеры и слоты
                                    </span>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row"><span>Режим сетки слотов:</span></div>
                                    <div class="m3-segmented-button">
                                        <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegSlotFull">Полный 18×18 px</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegSlotInner">Внутренний 16×16 px</button>
                                    </div>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span>Колонки:</span>
                                        <span class="control-value-text" id="modalColsValText">1 слот 18 px</span>
                                    </div>
                                    <div class="m3-chip-row" id="modalColsChipsRow">
                                        <button type="button" class="m3-chip active" data-col="1">1</button>
                                        <button type="button" class="m3-chip" data-col="2">2</button>
                                        <button type="button" class="m3-chip" data-col="3">3</button>
                                        <button type="button" class="m3-chip" data-col="4">4</button>
                                        <button type="button" class="m3-chip" data-col="5">5</button>
                                        <button type="button" class="m3-chip" data-col="6">6</button>
                                        <button type="button" class="m3-chip" data-col="7">7</button>
                                        <button type="button" class="m3-chip" data-col="8">8</button>
                                        <button type="button" class="m3-chip" data-col="9">9</button>
                                    </div>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span>Ряды:</span>
                                        <span class="control-value-text" id="modalRowsValText">1 ряд 18 px</span>
                                    </div>
                                    <div class="m3-chip-row" id="modalRowsChipsRow">
                                        <button type="button" class="m3-chip active" data-row="1">1</button>
                                        <button type="button" class="m3-chip" data-row="2">2</button>
                                        <button type="button" class="m3-chip" data-row="3">3</button>
                                        <button type="button" class="m3-chip" data-row="4">4</button>
                                        <button type="button" class="m3-chip" data-row="5">5</button>
                                        <button type="button" class="m3-chip" data-row="6">6</button>
                                    </div>
                                </div>

                                <div class="m3-presets-row">
                                    <button type="button" class="m3-preset-btn" data-cols="1" data-rows="1">1×1</button>
                                    <button type="button" class="m3-preset-btn" data-cols="2" data-rows="1">2×1</button>
                                    <button type="button" class="m3-preset-btn" data-cols="3" data-rows="1">3×1</button>
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="1">Строка 9×1</button>
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="4">Окно 9×4</button>
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="6">Сундук 9×6</button>
                                </div>
                            </div>

                            <!-- 2. ВНЕШНИЙ ВИД И ГЕОМЕТРИЯ -->
                            <div class="m3-card">
                                <div class="card-header">
                                    <span class="card-title">
                                        <span class="material-symbols-rounded">palette</span>
                                        Внешний вид и геометрия
                                    </span>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row"><span>Стиль кнопки:</span></div>
                                    <div class="m3-segmented-button">
                                        <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegStyleDefault">DEFAULT</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegStyleTen">TEN</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegStyleFlat">FLAT</button>
                                    </div>
                                </div>

                                <!-- Высота подбородка: по умолчанию выключена -->
                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span>Высота подбородка:</span>
                                        <span class="control-value-text" id="modalChinValText">0 px</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalChinInput" min="0" max="5" value="0">
                                    <div class="m3-chip-row" id="modalChinChipsRow">
                                        <button type="button" class="m3-chip active" data-chin="0">0 px</button>
                                        <button type="button" class="m3-chip" data-chin="1">1 px</button>
                                        <button type="button" class="m3-chip" data-chin="2">2 px</button>
                                        <button type="button" class="m3-chip" data-chin="3">3 px</button>
                                        <button type="button" class="m3-chip" data-chin="4">4 px</button>
                                        <button type="button" class="m3-chip" data-chin="5">5 px</button>
                                    </div>
                                </div>

                                <!-- Толщина фаски -->
                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span>Толщина фаски:</span>
                                        <span class="control-value-text" id="modalShadowValText">1 px</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalShadowInput" min="1" max="5" value="1">
                                    <div class="m3-chip-row" id="modalShadowChipsRow">
                                        <button type="button" class="m3-chip active" data-shadow="1">1 px</button>
                                        <button type="button" class="m3-chip" data-shadow="2">2 px</button>
                                        <button type="button" class="m3-chip" data-shadow="3">3 px</button>
                                        <button type="button" class="m3-chip" data-shadow="4">4 px</button>
                                        <button type="button" class="m3-chip" data-shadow="5">5 px</button>
                                    </div>
                                </div>

                                <!-- Непрозрачность -->
                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span>Непрозрачность поверхности:</span>
                                        <span class="control-value-text" id="modalOpacityValText">100%</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalOpacityInput" min="0" max="100" value="100">
                                </div>

                                <div class="m3-switch-row">
                                    <span>Тонированная рамка</span>
                                    <label class="m3-switch">
                                        <input type="checkbox" id="modalTintedBorderCheck">
                                        <span class="m3-switch-track"><span class="m3-switch-thumb"></span></span>
                                    </label>
                                </div>

                                <div class="m3-switch-row">
                                    <span>Прозрачная рамка</span>
                                    <label class="m3-switch">
                                        <input type="checkbox" id="modalTranspBorderCheck">
                                        <span class="m3-switch-track"><span class="m3-switch-thumb"></span></span>
                                    </label>
                                </div>
                            </div>

                            <!-- 3. ЦВЕТ И ГРАДИЕНТЫ -->
                            <div class="m3-card">
                                <div class="card-header">
                                    <span class="card-title">
                                        <span class="material-symbols-rounded">format_paint</span>
                                        Цвет и градиенты
                                    </span>
                                </div>

                                <div class="m3-segmented-button">
                                    <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegColorSolid">
                                        <span class="material-symbols-rounded" style="font-size: 1rem;">format_color_fill</span>
                                        Сплошной цвет
                                    </button>
                                    <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegColorGradient">
                                        <span class="material-symbols-rounded" style="font-size: 1rem;">gradient</span>
                                        Градиент
                                    </button>
                                </div>

                                <!-- Сплошной цвет -->
                                <div id="modalSolidColorSection" class="control-group">
                                    <div class="color-picker-box" id="modalSolidColorBox">
                                        <div class="color-preview-circle" id="modalColorPreviewWrap">
                                            <input type="color" id="modalMasterColorInput" value="#C5C5C5">
                                        </div>
                                        <input type="text" class="m3-text-field" id="modalHexTextInput" value="#C5C5C5" maxlength="7">
                                        
                                        <div class="mini-shades-palette" title="Палитра: Рамка, Блик, Тень, Поверхность">
                                            <div class="mini-swatch" id="modalMiniSwatchBd" style="background: #000000;" title="Рамка"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchHl" style="background: #ECECEC;" title="Блик"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchSh" style="background: #7C7C7C;" title="Тень"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchSf" style="background: #C5C5C5;" title="Поверхность"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Градиент -->
                                <div id="modalGradientColorSection" class="control-group" style="display: none; flex-direction: column; gap: 8px;">
                                    <div id="modalGradPreviewBar" style="height: 12px; border-radius: var(--md-shape-corner-small); border: 1px solid var(--md-outline-variant);"></div>
                                    <div id="modalGradientStopsList" style="display: flex; flex-direction: column; gap: 6px;"></div>
                                    <button type="button" class="m3-btn m3-btn-outlined" id="modalBtnAddGradColor" style="padding: 7px 12px; font-size: 0.78rem; gap: 6px; width: 100%;">
                                        <span class="material-symbols-rounded" style="font-size: 16px;">add</span>
                                        Добавить цвет
                                    </button>

                                    <div class="control-group" style="margin-top: 4px;">
                                        <div class="control-label-row">
                                            <span>Угол градиента:</span>
                                            <span class="control-value-text" id="modalGradAngleValText">90°</span>
                                        </div>
                                        <input type="range" class="m3-slider" id="modalGradAngleInput" min="0" max="360" value="90">
                                        <div class="m3-chip-row" id="modalGradAngleChipsRow">
                                            <button type="button" class="m3-chip" data-angle="0">0°</button>
                                            <button type="button" class="m3-chip" data-angle="45">45°</button>
                                            <button type="button" class="m3-chip active" data-angle="90">90°</button>
                                            <button type="button" class="m3-chip" data-angle="135">135°</button>
                                            <button type="button" class="m3-chip" data-angle="180">180°</button>
                                            <button type="button" class="m3-chip" data-angle="270">270°</button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Библиотека палитр MollyStudio -->
                                <div class="control-group" style="margin-top: 4px;">
                                    <div class="control-label-row">
                                        <span>Библиотека палитр:</span>
                                        <select class="m3-select" id="modalPaletteSelect">
                                            <option value="minecraft" selected>Minecraft Vanilla</option>
                                            <option value="material">Google Material</option>
                                            <option value="nord">Nord Theme</option>
                                            <option value="dracula">Dracula</option>
                                            <option value="pico8">PICO-8</option>
                                            <option value="endesga32">Endesga 32</option>
                                            <option value="resurrect64">Resurrect 64</option>
                                            <option value="dawnbringer16">DawnBringer</option>
                                            <option value="solarized">Solarized</option>
                                            <option value="gameboy">Game Boy</option>
                                            <option value="c64">Commodore 64</option>
                                        </select>
                                    </div>
                                    <div class="color-palette-grid" id="modalPaletteSwatchesGrid"></div>
                                </div>
                            </div>

                        </div>

                        <!-- ИМПОРТ ТОЛЬКО В ПРОЕКТ -->
                        <div class="buttons-sidebar-footer">
                            <button type="button" class="m3-btn m3-btn-primary" id="modalBtnImportProject" style="width: 100%;">
                                <span class="material-symbols-rounded">smart_button</span>
                                Импортировать в проект
                            </button>
                        </div>

                    </aside>

                    <!-- Right Viewport Column (GUI EXCLUSIVE) -->
                    <main class="buttons-viewport">
                        <!-- Toolbar -->
                        <div class="viewport-toolbar">
                            <div class="toolbar-group">
                                <button type="button" class="icon-btn" data-z="1">1x</button>
                                <button type="button" class="icon-btn" data-z="2">2x</button>
                                <button type="button" class="icon-btn active" data-z="3">3x</button>
                                <button type="button" class="icon-btn" data-z="4">4x</button>
                            </div>
                        </div>

                        <!-- Canvas Stage -->
                        <div class="canvas-stage" id="modalCanvasStageArea">
                            <div class="canvas-card-wrapper" id="modalCanvasWrapper">
                                <canvas id="modalPreviewCanvas"></canvas>
                            </div>
                        </div>
                    </main>

                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.modalEl = overlay;
        this.canvas = overlay.querySelector('#modalPreviewCanvas');
        this.ctx = this.canvas?.getContext('2d');
        this.canvasWrap = overlay.querySelector('#modalCanvasWrapper');

        this.bindEvents();
        this.setupPalettesUI();
    }

    bindEvents() {
        const o = this.modalEl;
        if (!o) return;

        // Close handlers
        o.querySelectorAll('.btn-close-modal').forEach(b => b.addEventListener('click', () => this.close()));
        o.addEventListener('click', (e) => {
            if (e.target === o) this.close();
        });

        // Slot mode
        o.querySelector('#modalSegSlotFull')?.addEventListener('click', () => this.setSlotMode('full'));
        o.querySelector('#modalSegSlotInner')?.addEventListener('click', () => this.setSlotMode('inner'));

        // Columns chips
        o.querySelectorAll('#modalColsChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setCols(parseInt(chip.dataset.col, 10)));
        });

        // Rows chips
        o.querySelectorAll('#modalRowsChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setRows(parseInt(chip.dataset.row, 10)));
        });

        // Presets
        o.querySelectorAll('.m3-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setCols(parseInt(btn.dataset.cols, 10));
                this.setRows(parseInt(btn.dataset.rows, 10));
            });
        });

        // Style
        o.querySelector('#modalSegStyleDefault')?.addEventListener('click', () => this.setStyle('default'));
        o.querySelector('#modalSegStyleTen')?.addEventListener('click', () => this.setStyle('ten'));
        o.querySelector('#modalSegStyleFlat')?.addEventListener('click', () => this.setStyle('flat'));

        // Chin slider & chips (default: 0)
        const chinInput = o.querySelector('#modalChinInput');
        chinInput?.addEventListener('input', (e) => this.setChin(parseInt(e.target.value, 10)));
        o.querySelectorAll('#modalChinChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setChin(parseInt(chip.dataset.chin, 10)));
        });

        // Shadow slider & chips
        const shadowInput = o.querySelector('#modalShadowInput');
        shadowInput?.addEventListener('input', (e) => this.setShadow(parseInt(e.target.value, 10)));
        o.querySelectorAll('#modalShadowChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setShadow(parseInt(chip.dataset.shadow, 10)));
        });

        // Opacity
        o.querySelector('#modalOpacityInput')?.addEventListener('input', (e) => {
            this.currentOpacity = parseInt(e.target.value, 10);
            const valText = o.querySelector('#modalOpacityValText');
            if (valText) valText.textContent = `${this.currentOpacity}%`;
            this.updateView();
        });

        // Switches
        o.querySelector('#modalTintedBorderCheck')?.addEventListener('change', (e) => {
            this.tintedBorderEnabled = e.target.checked;
            this.updateShading();
            this.updateView();
        });
        o.querySelector('#modalTranspBorderCheck')?.addEventListener('change', (e) => {
            this.transparentBorder = e.target.checked;
            this.updateView();
        });

        // Color mode
        o.querySelector('#modalSegColorSolid')?.addEventListener('click', () => this.setColorMode('solid'));
        o.querySelector('#modalSegColorGradient')?.addEventListener('click', () => this.setColorMode('gradient'));

        // Solid color & drop target
        const solidBox = o.querySelector('#modalSolidColorBox');
        o.querySelector('#modalMasterColorInput')?.addEventListener('input', (e) => this.setMasterColor(e.target.value));
        o.querySelector('#modalHexTextInput')?.addEventListener('change', (e) => {
            let v = e.target.value.trim();
            if (!v.startsWith('#')) v = '#' + v;
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) this.setMasterColor(v);
        });

        solidBox?.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            solidBox.style.borderColor = 'var(--md-primary)';
        });
        solidBox?.addEventListener('dragleave', () => {
            solidBox.style.borderColor = '';
        });
        solidBox?.addEventListener('drop', (e) => {
            e.preventDefault();
            solidBox.style.borderColor = '';
            const color = e.dataTransfer.getData('text/plain');
            if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
                this.setMasterColor(color.trim());
            }
        });

        // Gradient
        o.querySelector('#modalBtnAddGradColor')?.addEventListener('click', () => this.addGradientStop());
        o.querySelector('#modalGradAngleInput')?.addEventListener('input', (e) => this.setGradAngle(e.target.value));
        o.querySelectorAll('#modalGradAngleChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => this.setGradAngle(chip.dataset.angle));
        });

        // Palettes dropdown
        o.querySelector('#modalPaletteSelect')?.addEventListener('change', (e) => {
            this.renderPaletteSwatches(e.target.value);
        });

        // Zoom
        o.querySelectorAll('.viewport-toolbar .icon-btn').forEach(btn => {
            btn.addEventListener('click', () => this.setZoom(parseInt(btn.dataset.z, 10)));
        });

        // Import button
        o.querySelector('#modalBtnImportProject')?.addEventListener('click', () => this.importToProject());
    }

    setupPalettesUI() {
        this.renderPaletteSwatches('minecraft');
        this.renderGradientStopsUI();
    }

    renderPaletteSwatches(palName) {
        const container = this.modalEl?.querySelector('#modalPaletteSwatchesGrid');
        if (!container) return;
        container.innerHTML = '';
        const list = Palettes[palName] || Palettes.minecraft;
        list.forEach(hex => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', `Выбрать цвет ${hex}`);
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






    updateShading() {
        if (this.colorMode === 'solid') {
            if (this.autoShadeEnabled) {
                this.colors = this.calculateMinecraftShades(this.masterBaseColor, this.tintedBorderEnabled);
            } else {
                this.colors.surface = this.masterBaseColor;
            }
        }
        this.updateMiniSwatches();
    }

    updateMiniSwatches() {
        if (!this.modalEl) return;
        const elBd = this.modalEl.querySelector('#modalMiniSwatchBd');
        const elHl = this.modalEl.querySelector('#modalMiniSwatchHl');
        const elSh = this.modalEl.querySelector('#modalMiniSwatchSh');
        const elSf = this.modalEl.querySelector('#modalMiniSwatchSf');
        if (elBd) elBd.style.background = this.colors.border;
        if (elHl) elHl.style.background = this.colors.highlight;
        if (elSh) elSh.style.background = this.colors.shadow;
        if (elSf) elSf.style.background = this.colors.surface;
    }

    setMasterColor(hex) {
        this.masterBaseColor = hex.toUpperCase();
        if (this.modalEl) {
            const mc = this.modalEl.querySelector('#modalMasterColorInput');
            const ht = this.modalEl.querySelector('#modalHexTextInput');
            if (mc) mc.value = this.masterBaseColor;
            if (ht) ht.value = this.masterBaseColor;
        }
        this.updateShading();
        this.updateView();
    }

    setColorMode(mode) {
        this.colorMode = mode;
        if (!this.modalEl) return;
        setPressedState(this.modalEl.querySelector('#modalSegColorSolid'), mode === 'solid');
        setPressedState(this.modalEl.querySelector('#modalSegColorGradient'), mode === 'gradient');
        const solidEl = this.modalEl.querySelector('#modalSolidColorSection');
        const gradEl = this.modalEl.querySelector('#modalGradientColorSection');
        if (solidEl) solidEl.style.display = (mode === 'solid') ? 'flex' : 'none';
        if (gradEl) gradEl.style.display = (mode === 'gradient') ? 'flex' : 'none';
        if (mode === 'gradient') {
            this.renderGradientStopsUI();
        }
        this.updateShading();
        this.updateView();
    }

    addGradientStop() {
        if (this.gradientColors.length >= 8) return;
        const lastColor = this.gradientColors[this.gradientColors.length - 1];
        this.gradientColors.push(lastColor);
        this.activeGradientStopIndex = this.gradientColors.length - 1;
        this.renderGradientStopsUI();
        this.updateView();
    }

    removeGradientStop(idx) {
        if (this.gradientColors.length <= 2) return;
        this.gradientColors.splice(idx, 1);
        if (this.activeGradientStopIndex >= this.gradientColors.length) {
            this.activeGradientStopIndex = this.gradientColors.length - 1;
        }
        this.renderGradientStopsUI();
        this.updateView();
    }

    setGradientStopColor(idx, hex) {
        if (idx < 0 || idx >= this.gradientColors.length) return;
        this.gradientColors[idx] = hex.toUpperCase();
        this.renderGradientStopsUI();
        this.updateView();
    }

    renderGradientStopsUI() {
        if (!this.modalEl) return;
        const container = this.modalEl.querySelector('#modalGradientStopsList');
        const bar = this.modalEl.querySelector('#modalGradPreviewBar');
        if (bar) {
            bar.style.background = `linear-gradient(to right, ${this.gradientColors.join(', ')})`;
        }
        if (!container) return;
        const focusToken = captureGradientFocus(container);
        container.innerHTML = '';

        this.gradientColors.forEach((hex, idx) => {
            const row = document.createElement('div');
            row.className = 'grad-stop-row';
            row.dataset.gradientIndex = String(idx);
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.padding = '4px 6px';
            row.style.borderRadius = 'var(--md-shape-corner-small)';
            row.style.backgroundColor = 'var(--md-surface-container-high)';
            row.style.border = (idx === this.activeGradientStopIndex) ? '1px solid var(--md-primary)' : '1px solid var(--md-outline-variant)';
            row.style.transition = 'all 0.15s ease';

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
            label.setAttribute('aria-label', `Выбрать точку градиента ${idx + 1}`);
            label.setAttribute('aria-pressed', String(idx === this.activeGradientStopIndex));
            label.style.fontFamily = "'Google Sans', sans-serif";
            label.style.fontSize = '0.74rem';
            label.style.color = 'var(--md-on-surface-variant)';
            label.style.minWidth = '14px';
            label.textContent = `${idx + 1}`;
            row.appendChild(label);

            const circle = document.createElement('div');
            circle.className = 'color-preview-circle';
            circle.style.width = '28px';
            circle.style.height = '28px';

            const colInput = document.createElement('input');
            colInput.type = 'color';
            colInput.id = `modal-gradient-color-${idx}`;
            colInput.dataset.gradientRole = 'color';
            colInput.setAttribute('aria-label', `Цвет точки градиента ${idx + 1}`);
            colInput.value = hex;
            colInput.addEventListener('input', (e) => {
                this.setGradientStopColor(idx, e.target.value);
            });
            circle.appendChild(colInput);
            row.appendChild(circle);

            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.id = `modal-gradient-hex-${idx}`;
            textInput.dataset.gradientRole = 'hex';
            textInput.setAttribute('aria-label', `HEX точки градиента ${idx + 1}`);
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
                delBtn.title = 'Удалить';
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
        if (!this.modalEl) return;
        const input = this.modalEl.querySelector('#modalGradAngleInput');
        const valText = this.modalEl.querySelector('#modalGradAngleValText');
        if (input) input.value = this.gradientAngle;
        if (valText) valText.textContent = `${this.gradientAngle}°`;
        this.modalEl.querySelectorAll('#modalGradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === this.gradientAngle);
        });
        this.updateView();
    }

    setSlotMode(mode) {
        this.currentSlotMode = mode;
        if (!this.modalEl) return;
        setPressedState(this.modalEl.querySelector('#modalSegSlotInner'), mode === 'inner');
        setPressedState(this.modalEl.querySelector('#modalSegSlotFull'), mode === 'full');
        this.updateView();
    }

    setCols(c) {
        this.currentCols = Math.max(1, Math.min(9, parseInt(c, 10) || 1));
        if (!this.modalEl) return;
        this.modalEl.querySelectorAll('#modalColsChipsRow .m3-chip').forEach((btn, i) => {
            setPressedState(btn, i + 1 === this.currentCols);
        });
        this.updateView();
    }

    setRows(r) {
        this.currentRows = Math.max(1, Math.min(6, parseInt(r, 10) || 1));
        if (!this.modalEl) return;
        this.modalEl.querySelectorAll('#modalRowsChipsRow .m3-chip').forEach((btn, i) => {
            setPressedState(btn, i + 1 === this.currentRows);
        });
        this.updateView();
    }

    setStyle(st) {
        this.currentStyle = st;
        if (!this.modalEl) return;
        setPressedState(this.modalEl.querySelector('#modalSegStyleDefault'), st === 'default');
        setPressedState(this.modalEl.querySelector('#modalSegStyleTen'), st === 'ten');
        setPressedState(this.modalEl.querySelector('#modalSegStyleFlat'), st === 'flat');
        this.updateView();
    }

    setChin(val) {
        const parsed = Number.parseInt(val, 10);
        this.currentChin = Math.max(0, Math.min(5, Number.isFinite(parsed) ? parsed : 0));
        if (!this.modalEl) return;
        const input = this.modalEl.querySelector('#modalChinInput');
        const valText = this.modalEl.querySelector('#modalChinValText');
        if (input) input.value = this.currentChin;
        if (valText) valText.textContent = `${this.currentChin} px`;
        this.modalEl.querySelectorAll('#modalChinChipsRow .m3-chip').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.chin, 10) === this.currentChin);
        });
        this.updateView();
    }

    setShadow(val) {
        this.currentShadow = Math.max(1, Math.min(5, parseInt(val, 10) || 1));
        if (!this.modalEl) return;
        const input = this.modalEl.querySelector('#modalShadowInput');
        const valText = this.modalEl.querySelector('#modalShadowValText');
        if (input) input.value = this.currentShadow;
        if (valText) valText.textContent = `${this.currentShadow} px`;
        this.modalEl.querySelectorAll('#modalShadowChipsRow .m3-chip').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.shadow, 10) === this.currentShadow);
        });
        this.updateView();
    }




    setZoom(z) {
        z = Math.max(1, Math.min(8, Math.round(Number(z) || 3)));
        this.currentZoom = z;
        if (!this.modalEl) return;
        this.modalEl.querySelectorAll('.viewport-toolbar .icon-btn').forEach(btn => {
            setPressedState(btn, parseInt(btn.dataset.z, 10) === z);
        });
        this.updateView();
    }





    renderGuiView() {
        if (!this.canvas || !this.ctx) return;

        this.canvas.width = 176;
        this.canvas.height = 222;
        this.ctx.imageSmoothingEnabled = false;

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
        this.ctx.drawImage(btnCanvas, btnX, btnY);

        if (this.canvasWrap) {
            this.canvasWrap.style.width = (176 * this.currentZoom) + 'px';
            this.canvasWrap.style.height = (222 * this.currentZoom) + 'px';
        }
        this.canvas.style.width = (176 * this.currentZoom) + 'px';
        this.canvas.style.height = (222 * this.currentZoom) + 'px';

        if (this.modalEl) {
            const colsVal = this.modalEl.querySelector('#modalColsValText');
            const rowsVal = this.modalEl.querySelector('#modalRowsValText');

            if (colsVal) colsVal.textContent = `${this.currentCols} слотов ${btnW} px`;
            if (rowsVal) rowsVal.textContent = `${this.currentRows} рядов ${btnH} px`;
        }
    }

    updateView() {
        if (this.previewFrame) return;
        this.previewFrame = requestAnimationFrame(() => {
            this.previewFrame = null;
            this.renderGuiView();
        });
    }

    importToProject() {
        const w = this.getWidth(this.currentCols);
        const h = this.getHeight(this.currentRows);

        const normalCanvas = this.renderButton(
            w, h, this.colors, this.currentStyle,
            this.currentOpacity, this.transparentBorder,
            this.currentChin, this.currentShadow
        );

        const buttonData = {
            importId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
            w,
            h,
            cols: this.currentCols,
            rows: this.currentRows,
            slotMode: this.currentSlotMode,
            guiCol: this.guiCol,
            guiRow: this.guiRow,
            style: this.currentStyle,
            mode: 'normal',
            normalDataUrl: normalCanvas.toDataURL('image/png')
        };

        this.app.insertGeneratedButton(buttonData);
        this.close();
    }
}
