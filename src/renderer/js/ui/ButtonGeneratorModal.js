import {createGradientRow,createColorPreview,createHexInput} from './Controls.mjs';
import {bindAttribute} from '../core/Locale.mjs';
import { setPressedState } from './ControlState.js';
import ButtonGeneratorModel from './ButtonGeneratorModel.js';
import { Palettes, populatePaletteSelect } from '../utils/Palettes.js';
import { captureGradientFocus, restoreGradientFocus } from './GradientFocus.js';
import { isShortcutTarget } from './KeyboardNavigation.js';

/**
 * ButtonGeneratorModal - Minecraft GUI Button Generator integrated into MollyStudio.
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
export default class ButtonGeneratorModal extends ButtonGeneratorModel {
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
        this.currentChin = 1;
        this.currentShadow = 1;
        this.currentOpacity = 100;
        this.tintedBorderEnabled = false;
        this.transparentBorder = false;


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
            if (e.defaultPrevented || e.isComposing || e.getModifierState?.('AltGraph')) return;
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyB' || e.key === 'b' || e.key === 'B' || e.key === 'и' || e.key === 'И')) {
                if (!e.repeat && !isShortcutTarget(e.target, e) && !document.querySelector('dialog[open],.modal-overlay.show')) {
                    e.preventDefault();
                    if (window.desktopAPI?.openButtonGeneratorWindow) {
                        window.desktopAPI.openButtonGeneratorWindow();
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
        this.syncStyleControls(this.modalEl,'modal');
        const generation=this.openGeneration=(this.openGeneration||0)+1;
        requestAnimationFrame(() => {
            if(generation!==this.openGeneration)return;
            this.modalEl.classList.add('show');
            this.updateShading();
            this.updateView();
        });
    }

    close() {
        this.openGeneration=(this.openGeneration||0)+1;
        if (this.previewFrame) cancelAnimationFrame(this.previewFrame);
        this.previewFrame = null;
        if (this.modalEl) {
            this.modalEl.classList.remove('show');
        }
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
                        <h2 id="btn-gen-title"><!--i18n-->Генератор кнопок</h2>
                    </div>
                    <button class="md-icon-btn btn-close-modal " id="btn-modal-close-x" title="Закрыть" data-i18n-title="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C" aria-label="Закрыть" data-i18n-aria-label="%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D1%8C" type="button">
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
                                        <span class="material-symbols-rounded">grid_on</span><!--i18n-->
                                        Размеры и слоты
                                    </span>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row"><span><!--i18n-->Режим сетки слотов:</span></div>
                                    <div class="m3-segmented-button">
                                        <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegSlotFull"><!--i18n-->Полный 18×18 px</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegSlotInner"><!--i18n-->Внутренний 16×16 px</button>
                                    </div>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span><!--i18n-->Колонки:</span>
                                        <span class="control-value-text" id="modalColsValText"><!--i18n-->1 слот 18 px</span>
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
                                        <span><!--i18n-->Ряды:</span>
                                        <span class="control-value-text" id="modalRowsValText"><!--i18n-->1 ряд 18 px</span>
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
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="1"><!--i18n-->Строка 9×1</button>
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="4"><!--i18n-->Окно 9×4</button>
                                    <button type="button" class="m3-preset-btn" data-cols="9" data-rows="6"><!--i18n-->Сундук 9×6</button>
                                </div>
                            </div>

                            <!-- 2. ВНЕШНИЙ ВИД И ГЕОМЕТРИЯ -->
                            <div class="m3-card">
                                <div class="card-header">
                                    <span class="card-title">
                                        <span class="material-symbols-rounded">palette</span><!--i18n-->
                                        Внешний вид и геометрия
                                    </span>
                                </div>

                                <div class="control-group">
                                    <div class="control-label-row"><span><!--i18n-->Стиль кнопки:</span></div>
                                    <div class="m3-segmented-button button-style-selector">
                                        <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegStyleDefault" title="DEFAULT — классическая кнопка Java Edition" data-i18n-title="DEFAULT%20%E2%80%94%20%D0%BA%D0%BB%D0%B0%D1%81%D1%81%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B0%D1%8F%20%D0%BA%D0%BD%D0%BE%D0%BF%D0%BA%D0%B0%20Java%20Edition">JAVA</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegStyleTen">Bedrock</button>
                                        <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegStyleFlat">FLAT</button>
                                        <button type="button" class="m3-segment-item" id="modalSegStyleOutline" aria-pressed="false">OUTLINE</button>
                                        <button type="button" class="m3-segment-item" id="modalSegStyleDouble" aria-pressed="false">DOUBLE</button>
                                    </div>
                                </div>

                                <!-- Подбородок Bedrock: от 1 до 5 px -->
                                <div class="control-group" hidden>
                                    <div class="control-label-row">
                                        <span><!--i18n-->Высота подбородка:</span>
                                        <span class="control-value-text" id="modalChinValText">1 px</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalChinInput" aria-label="Высота подбородка, px" data-i18n-aria-label="%D0%92%D1%8B%D1%81%D0%BE%D1%82%D0%B0%20%D0%BF%D0%BE%D0%B4%D0%B1%D0%BE%D1%80%D0%BE%D0%B4%D0%BA%D0%B0%2C%20px" min="1" max="5" value="1">
                                    <div class="m3-chip-row" id="modalChinChipsRow">
                                        <button type="button" class="m3-chip active" data-chin="1">1 px</button>
                                        <button type="button" class="m3-chip" data-chin="2">2 px</button>
                                        <button type="button" class="m3-chip" data-chin="3">3 px</button>
                                        <button type="button" class="m3-chip" data-chin="4">4 px</button>
                                        <button type="button" class="m3-chip" data-chin="5">5 px</button>
                                    </div>
                                </div>

                                <!-- Толщина фаски -->
                                <div class="control-group">
                                    <div class="control-label-row">
                                        <span><!--i18n-->Толщина фаски:</span>
                                        <span class="control-value-text" id="modalShadowValText">1 px</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalShadowInput" aria-label="Толщина фаски, px" data-i18n-aria-label="%D0%A2%D0%BE%D0%BB%D1%89%D0%B8%D0%BD%D0%B0%20%D1%84%D0%B0%D1%81%D0%BA%D0%B8%2C%20px" min="1" max="5" value="1">
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
                                        <span><!--i18n-->Непрозрачность поверхности:</span>
                                        <span class="control-value-text" id="modalOpacityValText">100%</span>
                                    </div>
                                    <input type="range" class="m3-slider" id="modalOpacityInput" aria-label="Непрозрачность поверхности, %" data-i18n-aria-label="%D0%9D%D0%B5%D0%BF%D1%80%D0%BE%D0%B7%D1%80%D0%B0%D1%87%D0%BD%D0%BE%D1%81%D1%82%D1%8C%20%D0%BF%D0%BE%D0%B2%D0%B5%D1%80%D1%85%D0%BD%D0%BE%D1%81%D1%82%D0%B8%2C%20%25" min="0" max="100" value="100">
                                </div>

                                <div class="m3-switch-row">
                                    <span><!--i18n-->Тонированная рамка</span>
                                    <label class="m3-switch">
                                        <input type="checkbox" id="modalTintedBorderCheck" aria-label="Тонированная рамка" data-i18n-aria-label="%D0%A2%D0%BE%D0%BD%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D0%BD%D0%BD%D0%B0%D1%8F%20%D1%80%D0%B0%D0%BC%D0%BA%D0%B0">
                                        <span class="m3-switch-track"><span class="m3-switch-thumb"></span></span>
                                    </label>
                                </div>

                                <div class="m3-switch-row">
                                    <span><!--i18n-->Прозрачная рамка</span>
                                    <label class="m3-switch">
                                        <input type="checkbox" id="modalTranspBorderCheck" aria-label="Прозрачная рамка" data-i18n-aria-label="%D0%9F%D1%80%D0%BE%D0%B7%D1%80%D0%B0%D1%87%D0%BD%D0%B0%D1%8F%20%D1%80%D0%B0%D0%BC%D0%BA%D0%B0">
                                        <span class="m3-switch-track"><span class="m3-switch-thumb"></span></span>
                                    </label>
                                </div>
                            </div>

                            <!-- 3. ЦВЕТ И ГРАДИЕНТЫ -->
                            <div class="m3-card">
                                <div class="card-header">
                                    <span class="card-title">
                                        <span class="material-symbols-rounded">format_paint</span><!--i18n-->
                                        Цвет и градиенты
                                    </span>
                                </div>

                                <div class="m3-segmented-button">
                                    <button type="button" aria-pressed="true" class="m3-segment-item active" id="modalSegColorSolid">
                                        <span class="material-symbols-rounded" style="font-size: 1rem;">format_color_fill</span><!--i18n-->
                                        Сплошной цвет
                                    </button>
                                    <button type="button" aria-pressed="false" class="m3-segment-item" id="modalSegColorGradient">
                                        <span class="material-symbols-rounded" style="font-size: 1rem;">gradient</span><!--i18n-->
                                        Градиент
                                    </button>
                                </div>

                                <!-- Сплошной цвет -->
                                <div id="modalSolidColorSection" class="control-group">
                                    <div class="color-picker-box" id="modalSolidColorBox">
                                        <div class="color-preview-circle" id="modalColorPreviewWrap">
                                            <input type="color" id="modalMasterColorInput" aria-label="Цвет поверхности" data-i18n-aria-label="%D0%A6%D0%B2%D0%B5%D1%82%20%D0%BF%D0%BE%D0%B2%D0%B5%D1%80%D1%85%D0%BD%D0%BE%D1%81%D1%82%D0%B8" value="#C5C5C5">
                                        </div>
                                        <input type="text" class="m3-text-field" id="modalHexTextInput" aria-label="HEX поверхности" data-i18n-aria-label="HEX%20%D0%BF%D0%BE%D0%B2%D0%B5%D1%80%D1%85%D0%BD%D0%BE%D1%81%D1%82%D0%B8" value="#C5C5C5" maxlength="7">
                                        
                                        <div class="mini-shades-palette" title="Палитра: Рамка, Блик, Тень, Поверхность" data-i18n-title="%D0%9F%D0%B0%D0%BB%D0%B8%D1%82%D1%80%D0%B0%3A%20%D0%A0%D0%B0%D0%BC%D0%BA%D0%B0%2C%20%D0%91%D0%BB%D0%B8%D0%BA%2C%20%D0%A2%D0%B5%D0%BD%D1%8C%2C%20%D0%9F%D0%BE%D0%B2%D0%B5%D1%80%D1%85%D0%BD%D0%BE%D1%81%D1%82%D1%8C">
                                            <div class="mini-swatch" id="modalMiniSwatchBd" style="background: #000000;" title="Рамка" data-i18n-title="%D0%A0%D0%B0%D0%BC%D0%BA%D0%B0"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchHl" style="background: #ECECEC;" title="Блик" data-i18n-title="%D0%91%D0%BB%D0%B8%D0%BA"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchSh" style="background: #7C7C7C;" title="Тень" data-i18n-title="%D0%A2%D0%B5%D0%BD%D1%8C"></div>
                                            <div class="mini-swatch" id="modalMiniSwatchSf" style="background: #C5C5C5;" title="Поверхность" data-i18n-title="%D0%9F%D0%BE%D0%B2%D0%B5%D1%80%D1%85%D0%BD%D0%BE%D1%81%D1%82%D1%8C"></div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Градиент -->
                                <div id="modalGradientColorSection" class="control-group" style="display: none; flex-direction: column; gap: 8px;">
                                    <div id="modalGradPreviewBar" style="height: 12px; border-radius: var(--md-shape-corner-small); border: 1px solid var(--md-outline-variant);"></div>
                                    <div id="modalGradientStopsList" style="display: flex; flex-direction: column; gap: 6px;"></div>
                                    <button type="button" class="m3-btn m3-btn-outlined" id="modalBtnAddGradColor" style="padding: 7px 12px; font-size: 0.78rem; gap: 6px; width: 100%;">
                                        <span class="material-symbols-rounded" style="font-size: 16px;">add</span><!--i18n-->
                                        Добавить цвет
                                    </button>

                                    <div class="control-group" style="margin-top: 4px;">
                                        <div class="control-label-row">
                                            <span><!--i18n-->Угол градиента:</span>
                                            <span class="control-value-text" id="modalGradAngleValText">90°</span>
                                        </div>
                                        <input type="range" class="m3-slider" id="modalGradAngleInput" aria-label="Угол градиента" data-i18n-aria-label="%D0%A3%D0%B3%D0%BE%D0%BB%20%D0%B3%D1%80%D0%B0%D0%B4%D0%B8%D0%B5%D0%BD%D1%82%D0%B0" min="0" max="360" value="90">
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
                                        <span><!--i18n-->Библиотека палитр:</span>
                                        <select class="m3-select" id="modalPaletteSelect" aria-label="Библиотека палитр" data-i18n-aria-label="%D0%91%D0%B8%D0%B1%D0%BB%D0%B8%D0%BE%D1%82%D0%B5%D0%BA%D0%B0%20%D0%BF%D0%B0%D0%BB%D0%B8%D1%82%D1%80"><option value="minecraft"><!--i18n-->Minecraft — цвета чата</option></select>
                                    </div>
                                    <div class="color-palette-grid" id="modalPaletteSwatchesGrid"></div>
                                </div>
                            </div>

                        </div>

                        <!-- ИМПОРТ ТОЛЬКО В ПРОЕКТ -->
                        <div class="buttons-sidebar-footer">
                            <button type="button" class="m3-btn m3-btn-primary" id="modalBtnImportProject" style="width: 100%;">
                                <span class="material-symbols-rounded">smart_button</span><!--i18n-->
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
        this.setupInspector(overlay,'button-generator-modal');
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
        o.querySelector('#modalSegStyleOutline')?.addEventListener('click', () => this.setStyle('outline'));
        o.querySelector('#modalSegStyleDouble')?.addEventListener('click', () => this.setStyle('double'));

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
        o.querySelectorAll('.viewport-toolbar .icon-btn[data-z]').forEach(btn => {
            btn.addEventListener('click', () => this.setZoom(parseInt(btn.dataset.z, 10)));
        });

        // Import button
        o.querySelector('#modalBtnImportProject')?.addEventListener('click', () => this.importToProject());
    }

    setupPalettesUI() {
        populatePaletteSelect(this.modalEl?.querySelector('#modalPaletteSelect'));
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
            colInput.id = `modal-gradient-color-${idx}`;
            colInput.dataset.gradientRole = 'color';
            bindAttribute(colInput, "aria-label", "Цвет точки градиента {0}", {0: idx + 1});
            colInput.value = hex;
            colInput.addEventListener('input', (e) => {
                this.setGradientStopColor(idx, e.target.value);
            });
            circle.appendChild(colInput);
            row.appendChild(circle);

            const textInput = createHexInput(hex);
            textInput.id = `modal-gradient-hex-${idx}`;
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
        this.currentStyle=st;
        if(this.modalEl)this.syncStyleControls(this.modalEl,'modal');
        this.updateView();
    }

    setChin(val) {
        const parsed = Number.parseInt(val, 10);
        this.currentChin = Math.max(1, Math.min(5, Number.isFinite(parsed) ? parsed : 1));
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
        this.autoFitPreview=false;
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
        this.syncPreviewZoom();

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
        try { this.ctx.drawImage(btnCanvas, btnX, btnY); }
        finally { btnCanvas.width = btnCanvas.height = 1; }

        if (this.canvasWrap) {
            this.canvasWrap.style.width = (176 * this.currentZoom) + 'px';
            this.canvasWrap.style.height = (222 * this.currentZoom) + 'px';
        }
        this.canvas.style.width = (176 * this.currentZoom) + 'px';
        this.canvas.style.height = (222 * this.currentZoom) + 'px';

        if (this.modalEl) {
            const colsVal = this.modalEl.querySelector('#modalColsValText');
            const rowsVal = this.modalEl.querySelector('#modalRowsValText');

            if (colsVal) colsVal.textContent = `${this.currentCols} · ${btnW} px`;
            if (rowsVal) rowsVal.textContent = `${this.currentRows} · ${btnH} px`;
        }
    }

    updateView() {
        if (this.previewFrame || !this.modalEl?.classList.contains('show')) return;
        this.previewFrame = requestAnimationFrame(() => {
            this.previewFrame = null;
            this.renderGuiView();
        });
    }

    async importToProject() {
        if (this.importing) return false;
        this.importing = true;
        const generation = this.openGeneration;
        const button = this.modalEl?.querySelector('#modalBtnImportProject');
        if (button) button.disabled = true;
        try {
            const imported = await this.app.insertGeneratedButton(this.createButtonData());
            if (imported && generation === this.openGeneration) this.close();
            return imported;
        } catch (error) {
            console.error('Failed to generate button:', error);
            this.app.showToast('Не удалось подготовить кнопку. Повторите вставку.', 'error');
            return false;
        } finally {
            this.importing = false;
            if (button) button.disabled = false;
        }
    }
}
