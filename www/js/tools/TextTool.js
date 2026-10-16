import { setPressedState } from '../ui/ControlState.js';
import Tool from './Tool.js';
import { CreateObjectCommand, TextDataCommand } from '../core/Commands.js';
import { fontMaps, fontReplacements } from '../utils/FontData.js';
import { Palettes } from '../utils/Palettes.js';
import { captureGradientFocus, restoreGradientFocus } from '../ui/GradientFocus.js';

export default class TextTool extends Tool {
    constructor(bus, layerManager, history) {
        super(bus, layerManager, history);
        this.fontImages = {};
        this.activeFontId = 'minecraft';
        this.charWidth = 8;
        this.charHeight = 8;
        this.charsPerRow = 16;

        this.charWidthCache = new Map();
        this.tintCanvas = document.createElement('canvas');
        this.tintCanvas.width = 32;
        this.tintCanvas.height = 32;
        this.tintCtx = this.tintCanvas.getContext('2d', { willReadFrequently: true });

        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.textStartX = 0;
        this.textStartY = 0;
        this.dragLayer = null;
        this.dragBeforeData = null;

        this.activeGradientStopIndex = 0;
        this.activePalette = 'minecraft';

        this.preloadFonts();
        this.setupUIBindings();
        this.setupPalettesUI();

        this.bus.on('RENDER_TEXT_LAYER', (layer) => this.renderTextLayer(layer));
        this.bus.on('LAYER_ACTIVE_CHANGED', (layer) => {
            this.commitPendingEdit?.();
            if (layer && layer.type === 'text' && layer.textData) {
                this.syncUIWithLayer(layer);
            }
        });
        this.bus.on('COLOR_CHANGED', color => {
            const active = this.layerManager.getActiveLayer();
            if (this.toolManager?.currentToolId !== 'text' || !this.canEditText(active)) return;
            this.capturePendingEdit?.();
            this.setSolidColor(active, color);
            this.commitPendingEdit?.();
            this.syncUIWithLayer(active);
        });
    }

    canEditText(layer) {
        return !!layer && layer.type === 'text' && !!layer.textData && !layer.locked
            && layer.visible !== false && (this.layerManager.isEditable?.(layer) ?? true);
    }

    preloadFonts() {
        const fonts = [
            { id: 'minecraft', file: 'default.png' },
            { id: 'smallcaps', file: 'smallcaps.png' },
            { id: 'minecraft-ten', file: 'ten.png' },
            { id: 'other', file: 'other.png' }
        ];

        fonts.forEach(f => {
            const img = new Image();
            img.onload = () => {
                this.fontImages[f.id] = img;
                this.reRenderAllTextLayers();
            };
            img.onerror = () => console.error(`Unable to load bitmap font: ${f.file}`);
            img.src = `assets/images/${f.file}`;
        });
    }

    /* ==========================================================================
       COLOR SHADING & MATH (from buttons.html)
       ========================================================================== */
    hexToRgb(hex) {
        hex = hex.replace('#', '').trim();
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const num = parseInt(hex, 16);
        return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, l];
    }

    hslToRgb(h, s, l) {
        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    calculateMinecraftShades(baseHex) {
        if (!baseHex) return { surface: '#FFFFFF', highlight: '#FFFFFF', shadow: '#7C7C7C', border: '#000000' };
        if (baseHex.toUpperCase() === '#C5C5C5') {
            return {
                surface: '#C5C5C5',
                highlight: '#ECECEC',
                shadow: '#7C7C7C',
                border: '#000000'
            };
        }
        const [r, g, b] = this.hexToRgb(baseHex);
        const [h, s, l] = this.rgbToHsl(r, g, b);

        const hl_l = Math.min(1.0, l + (1.0 - l) * 0.45);
        const hl_s = Math.max(0.0, s * 0.85);
        const [hl_r, hl_g, hl_b] = this.hslToRgb(h, hl_s, hl_l);

        const sh_l = Math.max(0.0, l * 0.63);
        const sh_s = Math.min(1.0, s * 1.05);
        const [sh_r, sh_g, sh_b] = this.hslToRgb(h, sh_s, sh_l);

        return {
            surface: baseHex.toUpperCase(),
            highlight: this.rgbToHex(hl_r, hl_g, hl_b),
            shadow: this.rgbToHex(sh_r, sh_g, sh_b),
            border: '#000000'
        };
    }

    updateMiniSwatches(baseHex) {
        const shades = this.calculateMinecraftShades(baseHex);
        const elBd = document.getElementById('textMiniSwatchBd');
        const elHl = document.getElementById('textMiniSwatchHl');
        const elSh = document.getElementById('textMiniSwatchSh');
        const elSf = document.getElementById('textMiniSwatchSf');
        if (elBd) { elBd.style.background = shades.border; elBd.dataset.color = shades.border; }
        if (elHl) { elHl.style.background = shades.highlight; elHl.dataset.color = shades.highlight; }
        if (elSh) { elSh.style.background = shades.shadow; elSh.dataset.color = shades.shadow; }
        if (elSf) { elSf.style.background = shades.surface; elSf.dataset.color = shades.surface; }
    }

    setupPalettesUI() {
        this.renderPaletteSwatches(this.activePalette);
    }

    renderPaletteSwatches(palName) {
        const container = document.getElementById('textPaletteSwatchesGrid');
        if (!container) return;
        container.innerHTML = '';
        this.activePalette = palName;
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
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                this.capturePendingEdit?.();
                const mode = active.textData.colorMode || 'solid';
                if (mode === 'solid') {
                    this.setSolidColor(active, hex);
                } else {
                    this.setGradientStopColor(active, this.activeGradientStopIndex, hex);
                }
                this.commitPendingEdit?.();
            });
            container.appendChild(btn);
        });
    }

    setSolidColor(active, hex) {
        if (!this.canEditText(active)) return;
        const upper = hex.toUpperCase();
        active.textData.color = upper;
        if (active.textData.shadowMode !== 'custom') {
            active.textData.shadowColor = this.computeShadowColor(upper);
        }

        const colorInput = document.getElementById('textMasterColorInput');
        const hexInput = document.getElementById('textHexTextInput');
        if (colorInput) colorInput.value = upper;
        if (hexInput) hexInput.value = upper;

        this.updateMiniSwatches(upper);

        const autoPreview = document.getElementById('textShadowAutoColorPreview');
        const autoHex = document.getElementById('textShadowAutoColorHex');
        const autoShade = this.computeShadowColor(upper);
        if (autoPreview) autoPreview.style.background = autoShade;
        if (autoHex) autoHex.textContent = autoShade;

        this.renderTextLayer(active);
    }

    setGradientStopColor(active, idx, hex, refresh = true) {
        if (!this.canEditText(active)) return;
        if (!active.textData.gradientColors) {
            active.textData.gradientColors = ['#3B82F6', '#1D4ED8'];
        }
        if (idx < 0 || idx >= active.textData.gradientColors.length) return;
        active.textData.gradientColors[idx] = hex.toUpperCase();
        if (refresh) this.renderGradientStopsUI(active);
        this.renderTextLayer(active);
    }

    setGradAngle(active, deg) {
        if (!this.canEditText(active)) return;
        const angle = Math.max(0, Math.min(360, parseInt(deg, 10) || 0));
        active.textData.gradientAngle = angle;
        const input = document.getElementById('textGradAngleInput');
        const valText = document.getElementById('textGradAngleValText');
        if (input) input.value = angle;
        if (valText) valText.textContent = `${angle}°`;
        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === angle);
        });
        this.renderTextLayer(active);
    }

    setupUIBindings() {
        const textInput = document.getElementById('text-input');
        const fontSelect = document.getElementById('font-select');
        const textSpacing = document.getElementById('text-spacing');
        const shadowToggle = document.getElementById('text-shadow-toggle');
        const shadowOffX = document.getElementById('text-shadow-ox');
        const shadowOffY = document.getElementById('text-shadow-oy');

        // Color & Gradient elements (from buttons.html)
        const segSolid = document.getElementById('textSegColorSolid');
        const segGrad = document.getElementById('textSegColorGradient');
        const solidColorInput = document.getElementById('textMasterColorInput');
        const hexTextInput = document.getElementById('textHexTextInput');
        const btnAddGradColor = document.getElementById('textBtnAddGradColor');
        const gradAngleInput = document.getElementById('textGradAngleInput');
        const paletteSelect = document.getElementById('textPaletteSelect');

        // Shadow mode elements
        const shadowOptions = document.getElementById('text-shadow-options');
        const segShadowAuto = document.getElementById('textSegShadowAuto');
        const segShadowCustom = document.getElementById('textSegShadowCustom');
        const shadowAutoSection = document.getElementById('textShadowAutoSection');
        const shadowCustomSection = document.getElementById('textShadowCustomSection');
        const shadowCustomColorInput = document.getElementById('textShadowCustomColorInput');
        const shadowCustomHexInput = document.getElementById('textShadowCustomHexInput');

        let beforeSnapshot = null;
        let snapshotLayer = null;
        const commitSnapshot = () => {
            const target = snapshotLayer;
            const before = beforeSnapshot;
            beforeSnapshot = null;
            snapshotLayer = null;
            if (target?.textData && before && JSON.stringify(before) !== JSON.stringify(target.textData)) {
                this.history.push(new TextDataCommand(target, before, target.textData, this.bus));
            }
        };
        const captureSnapshot = () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            if (snapshotLayer && snapshotLayer !== active) commitSnapshot();
            if (!beforeSnapshot) {
                snapshotLayer = active;
                beforeSnapshot = JSON.parse(JSON.stringify(active.textData));
            }
        };
        this.capturePendingEdit = captureSnapshot;
        this.commitPendingEdit = commitSnapshot;

        const updateActiveFromUI = () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;

            if (!beforeSnapshot) {
                captureSnapshot();
            }

            active.textData.text = textInput ? textInput.value.slice(0, 4096) : active.textData.text;
            active.textData.fontId = fontSelect ? fontSelect.value : active.textData.fontId;
            active.textData.letterSpacing = textSpacing ? parseInt(textSpacing.value, 10) || 0 : 0;
            active.textData.shadow = shadowToggle ? shadowToggle.checked : true;
            active.textData.shadowOffsetX = shadowOffX ? parseInt(shadowOffX.value, 10) || 0 : 1;
            active.textData.shadowOffsetY = shadowOffY ? parseInt(shadowOffY.value, 10) || 0 : 1;

            const isCustom = segShadowCustom && segShadowCustom.classList.contains('active');
            active.textData.shadowMode = isCustom ? 'custom' : 'auto';
            if (isCustom) {
                const customColor = shadowCustomHexInput ? shadowCustomHexInput.value.trim().toUpperCase() : '#000000';
                active.textData.shadowCustomColor = customColor;
                active.textData.shadowColor = customColor;
            } else {
                active.textData.shadowColor = this.computeShadowColor(active.textData.color || '#FFFFFF');
            }

            active.name = `Текст: "${active.textData.text.slice(0, 10)}"`;

            this.renderTextLayer(active);
            this.bus.emit('LAYER_NAME_CHANGED', active);
            this.bus.emit('CANVAS_UPDATED');
        };

        [fontSelect, textSpacing, shadowOffX, shadowOffY, shadowCustomColorInput, solidColorInput, gradAngleInput].forEach(input => input?.addEventListener('blur', commitSnapshot));
        textInput?.addEventListener('focus', captureSnapshot);
        textInput?.addEventListener('blur', commitSnapshot);
        textInput?.addEventListener('input', updateActiveFromUI);

        fontSelect?.addEventListener('focus', captureSnapshot);
        fontSelect?.addEventListener('change', () => {
            updateActiveFromUI();
            commitSnapshot();
        });

        textSpacing?.addEventListener('focus', captureSnapshot);
        textSpacing?.addEventListener('input', updateActiveFromUI);
        textSpacing?.addEventListener('change', commitSnapshot);

        shadowToggle?.addEventListener('change', () => {
            captureSnapshot();
            if (shadowOptions) {
                shadowOptions.style.display = shadowToggle.checked ? 'flex' : 'none';
            }
            updateActiveFromUI();
            commitSnapshot();
        });

        shadowOffX?.addEventListener('focus', captureSnapshot);
        shadowOffX?.addEventListener('input', updateActiveFromUI);
        shadowOffX?.addEventListener('change', commitSnapshot);

        shadowOffY?.addEventListener('focus', captureSnapshot);
        shadowOffY?.addEventListener('input', updateActiveFromUI);
        shadowOffY?.addEventListener('change', commitSnapshot);

        // Shadow mode segmented buttons
        segShadowAuto?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            active.textData.shadowMode = 'auto';
            active.textData.shadowColor = this.computeShadowColor(active.textData.color || '#FFFFFF');
            this.syncUIWithLayer(active);
            this.renderTextLayer(active);
            commitSnapshot();
        });

        segShadowCustom?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            active.textData.shadowMode = 'custom';
            if (!active.textData.shadowCustomColor) {
                active.textData.shadowCustomColor = '#000000';
            }
            active.textData.shadowColor = active.textData.shadowCustomColor;
            this.syncUIWithLayer(active);
            this.renderTextLayer(active);
            commitSnapshot();
        });

        // Custom shadow color inputs
        shadowCustomColorInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            const upper = e.target.value.toUpperCase();
            active.textData.shadowMode = 'custom';
            active.textData.shadowCustomColor = upper;
            active.textData.shadowColor = upper;
            if (shadowCustomHexInput) shadowCustomHexInput.value = upper;
            this.renderTextLayer(active);
        });
        shadowCustomColorInput?.addEventListener('change', commitSnapshot);

        shadowCustomHexInput?.addEventListener('change', (e) => {
            let val = e.target.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                captureSnapshot();
                const upper = val.toUpperCase();
                active.textData.shadowMode = 'custom';
                active.textData.shadowCustomColor = upper;
                active.textData.shadowColor = upper;
                if (shadowCustomColorInput) shadowCustomColorInput.value = upper;
                e.target.value = upper;
                this.renderTextLayer(active);
                commitSnapshot();
            }
        });

        // Mini swatches click handlers
        ['textMiniSwatchBd', 'textMiniSwatchHl', 'textMiniSwatchSh', 'textMiniSwatchSf'].forEach(id => {
            const el = document.getElementById(id);
            el?.addEventListener('click', () => {
                const active = this.layerManager.getActiveLayer();
                if (!active || active.type !== 'text' || !active.textData || !el.dataset.color) return;
                captureSnapshot();
                const mode = active.textData.colorMode || 'solid';
                if (mode === 'solid') {
                    this.setSolidColor(active, el.dataset.color);
                } else {
                    this.setGradientStopColor(active, this.activeGradientStopIndex, el.dataset.color);
                }
                commitSnapshot();
            });
        });

        // Segmented buttons switching
        segSolid?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            active.textData.colorMode = 'solid';
            this.syncUIWithLayer(active);
            this.renderTextLayer(active);
            commitSnapshot();
        });

        segGrad?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            active.textData.colorMode = 'gradient';
            if (!active.textData.gradientColors || active.textData.gradientColors.length < 2) {
                active.textData.gradientColors = ['#3B82F6', '#1D4ED8'];
            }
            if (active.textData.gradientAngle === undefined) {
                active.textData.gradientAngle = 90;
            }
            this.syncUIWithLayer(active);
            this.renderTextLayer(active);
            commitSnapshot();
        });

        // Solid Color Inputs
        solidColorInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.setSolidColor(active, e.target.value);
        });
        solidColorInput?.addEventListener('change', commitSnapshot);

        hexTextInput?.addEventListener('change', (e) => {
            let val = e.target.value.trim();
            if (!val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                captureSnapshot();
                this.setSolidColor(active, val);
                commitSnapshot();
            }
        });

        // Add Gradient Stop
        btnAddGradColor?.addEventListener('click', () => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            if (!active.textData.gradientColors) {
                active.textData.gradientColors = ['#3B82F6', '#1D4ED8'];
            }
            if (active.textData.gradientColors.length >= 8) return;
            captureSnapshot();
            const lastColor = active.textData.gradientColors[active.textData.gradientColors.length - 1];
            active.textData.gradientColors.push(lastColor);
            this.activeGradientStopIndex = active.textData.gradientColors.length - 1;
            this.renderGradientStopsUI(active);
            this.renderTextLayer(active);
            commitSnapshot();
        });

        // Gradient Angle Slider & Chips
        gradAngleInput?.addEventListener('input', (e) => {
            const active = this.layerManager.getActiveLayer();
            if (!this.canEditText(active)) return;
            captureSnapshot();
            this.setGradAngle(active, e.target.value);
        });
        gradAngleInput?.addEventListener('change', commitSnapshot);

        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const active = this.layerManager.getActiveLayer();
                if (!this.canEditText(active)) return;
                captureSnapshot();
                this.setGradAngle(active, chip.dataset.angle);
                commitSnapshot();
            });
        });

        // Palette selector dropdown
        paletteSelect?.addEventListener('change', (e) => {
            this.renderPaletteSwatches(e.target.value);
        });
    }

    renderGradientStopsUI(layer) {
        const container = document.getElementById('textGradientStopsList');
        const bar = document.getElementById('textGradPreviewBar');
        if (!layer || !layer.textData) return;

        const colors = layer.textData.gradientColors || ['#3B82F6', '#1D4ED8'];

        if (bar) {
            bar.style.background = `linear-gradient(to right, ${colors.join(', ')})`;
        }
        if (!container) return;
        const focusToken = captureGradientFocus(container);
        container.innerHTML = '';

        colors.forEach((hex, idx) => {
            const row = document.createElement('div');
            row.className = 'grad-stop-row';
            row.dataset.gradientIndex = String(idx);
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.padding = '4px 6px';
            row.style.borderRadius = 'var(--md-shape-corner-small, 8px)';
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
                    this.capturePendingEdit?.();
                    this.setGradientStopColor(layer, idx, color.trim());
                    this.commitPendingEdit?.();
                }
            });
            row.addEventListener('click', e => {
                this.activeGradientStopIndex = idx;
                if (e.target === row || e.target === label) this.renderGradientStopsUI(layer);
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
            circle.style.width = '26px';
            circle.style.height = '26px';

            const colInput = document.createElement('input');
            colInput.type = 'color';
            colInput.id = `text-gradient-color-${idx}`;
            colInput.dataset.gradientRole = 'color';
            colInput.setAttribute('aria-label', `Цвет точки градиента ${idx + 1}`);
            colInput.value = hex;
            colInput.addEventListener('input', (e) => {
                this.capturePendingEdit?.();
                this.setGradientStopColor(layer, idx, e.target.value, false);
                textInput.value = e.target.value;
            });
            colInput.addEventListener('change', () => this.commitPendingEdit?.());
            circle.appendChild(colInput);
            row.appendChild(circle);

            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.id = `text-gradient-hex-${idx}`;
            textInput.dataset.gradientRole = 'hex';
            textInput.setAttribute('aria-label', `HEX точки градиента ${idx + 1}`);
            textInput.className = 'm3-text-field';
            textInput.value = hex;
            textInput.maxLength = 7;
            textInput.style.padding = '3px 8px';
            textInput.style.fontSize = '0.76rem';
            textInput.addEventListener('change', (e) => {
                let val = e.target.value.trim();
                if (!val.startsWith('#')) val = '#' + val;
                if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                    this.capturePendingEdit?.();
                    this.setGradientStopColor(layer, idx, val);
                    this.commitPendingEdit?.();
                }
            });
            row.appendChild(textInput);

            if (colors.length > 2) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'icon-btn';
                delBtn.style.padding = '0 4px';
                delBtn.style.height = '26px';
                delBtn.style.background = 'transparent';
                delBtn.style.border = 'none';
                delBtn.style.cursor = 'pointer';
                delBtn.title = 'Удалить';
                delBtn.innerHTML = '<span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-on-surface-variant);">close</span>';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!this.canEditText(layer)) return;
                    this.capturePendingEdit?.();
                    colors.splice(idx, 1);
                    if (this.activeGradientStopIndex >= colors.length) {
                        this.activeGradientStopIndex = colors.length - 1;
                    }
                    this.renderGradientStopsUI(layer);
                    this.renderTextLayer(layer);
                    this.commitPendingEdit?.();
                });
                row.appendChild(delBtn);
            }

            container.appendChild(row);
        });
        restoreGradientFocus(container, focusToken);
    }

    syncUIWithLayer(layer) {
        if (!layer || !layer.textData) return;
        const textInput = document.getElementById('text-input');
        const fontSelect = document.getElementById('font-select');
        const textSpacing = document.getElementById('text-spacing');
        const shadowToggle = document.getElementById('text-shadow-toggle');
        const shadowOptions = document.getElementById('text-shadow-options');
        const shadowOffX = document.getElementById('text-shadow-ox');
        const shadowOffY = document.getElementById('text-shadow-oy');

        const segSolid = document.getElementById('textSegColorSolid');
        const segGrad = document.getElementById('textSegColorGradient');
        const solidSection = document.getElementById('textSolidColorSection');
        const gradSection = document.getElementById('textGradientColorSection');
        const solidColorInput = document.getElementById('textMasterColorInput');
        const hexTextInput = document.getElementById('textHexTextInput');
        const gradAngleInput = document.getElementById('textGradAngleInput');
        const gradAngleValText = document.getElementById('textGradAngleValText');

        const segShadowAuto = document.getElementById('textSegShadowAuto');
        const segShadowCustom = document.getElementById('textSegShadowCustom');
        const shadowAutoSection = document.getElementById('textShadowAutoSection');
        const shadowCustomSection = document.getElementById('textShadowCustomSection');
        const shadowAutoColorPreview = document.getElementById('textShadowAutoColorPreview');
        const shadowAutoColorHex = document.getElementById('textShadowAutoColorHex');
        const shadowCustomColorInput = document.getElementById('textShadowCustomColorInput');
        const shadowCustomHexInput = document.getElementById('textShadowCustomHexInput');

        if (textInput) textInput.value = layer.textData.text || '';
        if (fontSelect) fontSelect.value = layer.textData.fontId || 'minecraft';
        if (textSpacing) textSpacing.value = layer.textData.letterSpacing !== undefined ? layer.textData.letterSpacing : 0;
        
        const hasShadow = layer.textData.shadow !== false;
        if (shadowToggle) shadowToggle.checked = hasShadow;
        if (shadowOptions) shadowOptions.style.display = hasShadow ? 'flex' : 'none';
        if (shadowOffX) shadowOffX.value = layer.textData.shadowOffsetX !== undefined ? layer.textData.shadowOffsetX : 1;
        if (shadowOffY) shadowOffY.value = layer.textData.shadowOffsetY !== undefined ? layer.textData.shadowOffsetY : 1;

        // Shadow mode
        const shadowMode = layer.textData.shadowMode || 'auto';
        setPressedState(segShadowAuto, shadowMode === 'auto');
        setPressedState(segShadowCustom, shadowMode === 'custom');
        if (shadowAutoSection) shadowAutoSection.style.display = (shadowMode === 'auto') ? 'flex' : 'none';
        if (shadowCustomSection) shadowCustomSection.style.display = (shadowMode === 'custom') ? 'flex' : 'none';

        const solidColor = (layer.textData.color || '#FFFFFF').toUpperCase();
        const autoShade = this.computeShadowColor(solidColor);
        if (shadowAutoColorPreview) shadowAutoColorPreview.style.background = autoShade;
        if (shadowAutoColorHex) shadowAutoColorHex.textContent = autoShade;

        const customColor = (layer.textData.shadowCustomColor || '#000000').toUpperCase();
        if (shadowCustomColorInput) shadowCustomColorInput.value = customColor;
        if (shadowCustomHexInput) shadowCustomHexInput.value = customColor;

        const mode = layer.textData.colorMode || 'solid';
        setPressedState(segSolid, mode === 'solid');
        setPressedState(segGrad, mode === 'gradient');
        if (solidSection) solidSection.style.display = mode === 'solid' ? 'flex' : 'none';
        if (gradSection) gradSection.style.display = mode === 'gradient' ? 'flex' : 'none';

        if (solidColorInput) solidColorInput.value = solidColor;
        if (hexTextInput) hexTextInput.value = solidColor;
        this.updateMiniSwatches(solidColor);

        const angle = layer.textData.gradientAngle !== undefined ? layer.textData.gradientAngle : 90;
        if (gradAngleInput) gradAngleInput.value = angle;
        if (gradAngleValText) gradAngleValText.textContent = `${angle}°`;
        document.querySelectorAll('#textGradAngleChipsRow .m3-chip').forEach(c => {
            setPressedState(c, parseInt(c.dataset.angle, 10) === angle);
        });

        if (mode === 'gradient') {
            this.renderGradientStopsUI(layer);
        }
    }

    computeShadowColor(hex) {
        if (!hex) return '#3F3F3F';
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        const r = Math.floor(((num >> 16) & 255) * 0.25);
        const g = Math.floor(((num >> 8) & 255) * 0.25);
        const b = Math.floor((num & 255) * 0.25);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    }

    normalizeText(text, fontId) {
        let result = String(text ?? '').slice(0, 4096);
        for (const [key, value] of Object.entries(fontReplacements)) {
            result = result.split(key).join(value);
        }

        if (fontId === 'minecraft') {
            result = result.replace(/Ё/g, 'Е').replace(/Й/g, 'И');
        } else if (fontId === 'smallcaps') {
            result = result.replace(/Ё/g, 'ё').replace(/Й/g, 'й');
            result = result.replace(/[А-Я]/g, (c) => c.toLowerCase());
            result = result.replace(/а/g, 'a');
        }

        return result;
    }

    calculateActualWidth(fontImg, srcX, srcY, w = 8, h = 8, cacheKey = null) {
        if (cacheKey && this.charWidthCache.has(cacheKey)) {
            return this.charWidthCache.get(cacheKey);
        }

        const canvas = this.tintCanvas;
        if (canvas.width < w || canvas.height < h) {
            canvas.width = Math.max(canvas.width, w);
            canvas.height = Math.max(canvas.height, h);
        }
        const ctx = this.tintCtx;
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(fontImg, srcX, srcY, w, h, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h).data;

        let maxRightPixel = 0;
        for (let x = w - 1; x >= 0; x--) {
            for (let y = 0; y < h; y++) {
                const alphaIndex = (y * w + x) * 4 + 3;
                if (imgData[alphaIndex] > 0) { 
                    maxRightPixel = x + 1;
                    break;
                }
            }
            if (maxRightPixel > 0) break;
        }

        const result = maxRightPixel > 0 ? maxRightPixel : 4;
        if (cacheKey) {
            this.charWidthCache.set(cacheKey, result);
        }
        return result;
    }

    onPointerDown(x, y, color, size, layer) {
        const px = Math.floor(x);
        const py = Math.floor(y);

        const clickedLayer = this.layerManager.findLayerAt(px, py);
        if (clickedLayer && clickedLayer.type === 'text') {
            if (!clickedLayer.textData) return;
            if (!this.canEditText(clickedLayer)) return;
            this.layerManager.setActive(clickedLayer.id);
            this.syncUIWithLayer(clickedLayer);

            this.isDragging = true;
            this.dragLayer = clickedLayer;
            this.dragBeforeData = JSON.parse(JSON.stringify(clickedLayer.textData));
            this.dragBeforeRevision = clickedLayer.contentRevision || 0;
            this.dragStartX = px;
            this.dragStartY = py;
            this.textStartX = clickedLayer.textData.x;
            this.textStartY = clickedLayer.textData.y;

            const textInput = document.getElementById('text-input');
            if (textInput) {
                textInput.focus();
                textInput.select();
            }
            return;
        }

        const active = this.layerManager.getActiveLayer();
        if (active && this.layerManager.isEditable?.(active) === false) return;
        if (this.canEditText(active)) {
            const pixel = active.ctx.getImageData(px, py, 1, 1).data;
            if (pixel[3] > 0) {
                this.isDragging = true;
                this.dragLayer = active;
                this.dragBeforeData = JSON.parse(JSON.stringify(active.textData));
                this.dragBeforeRevision = active.contentRevision || 0;
                this.dragStartX = px;
                this.dragStartY = py;
                this.textStartX = active.textData.x;
                this.textStartY = active.textData.y;
                return;
            }
        }

        const textInput = document.getElementById('text-input');
        const defaultText = (textInput && textInput.value) ? textInput.value.slice(0, 4096) : 'Текст';
        const fontSelect = document.getElementById('font-select');
        const fontId = fontSelect ? fontSelect.value : 'minecraft';
        const textSpacing = document.getElementById('text-spacing');
        const spacing = textSpacing ? parseInt(textSpacing.value, 10) || 0 : 0;
        const shadowToggle = document.getElementById('text-shadow-toggle');
        const hasShadow = shadowToggle ? shadowToggle.checked : true;
        const shadowOffX = document.getElementById('text-shadow-ox');
        const shadowOffY = document.getElementById('text-shadow-oy');
        const sX = shadowOffX ? parseInt(shadowOffX.value, 10) || 0 : 1;
        const sY = shadowOffY ? parseInt(shadowOffY.value, 10) || 0 : 1;

        const isCustomShadow = document.getElementById('textSegShadowCustom')?.classList.contains('active');
        const customShadowHex = (document.getElementById('textShadowCustomHexInput')?.value || '#000000').toUpperCase();
        const baseTextColor = color || '#FFFFFF';

        const newLayer = this.layerManager.addTextLayer(`Текст: "${defaultText.slice(0, 10)}"`, {
            text: defaultText,
            fontId,
            letterSpacing: spacing,
            colorMode: 'solid',
            color: baseTextColor,
            gradientColors: ['#FFE066', '#FB8500'],
            gradientAngle: 90,
            shadow: hasShadow,
            shadowOffsetX: sX,
            shadowOffsetY: sY,
            shadowMode: isCustomShadow ? 'custom' : 'auto',
            shadowCustomColor: customShadowHex,
            shadowColor: isCustomShadow ? customShadowHex : this.computeShadowColor(baseTextColor),
            x: px,
            y: py
        });
        if (!newLayer) return;

        if (layer && (layer.isGroup || layer.type === 'group')) {
            newLayer.groupId = layer.id;
        } else if (layer && layer.groupId) {
            newLayer.groupId = layer.groupId;
        }

        this.renderTextLayer(newLayer);
        this.syncUIWithLayer(newLayer);
        this.history.push(new CreateObjectCommand(this.layerManager, newLayer));

        if (textInput) {
            textInput.focus();
            textInput.select();
        }
    }

    onPointerMove(x, y, color, size, layer) {
        if (!this.isDragging) return;
        const active = this.dragLayer;
        if (!this.canEditText(active)) return;

        const px = Math.floor(x);
        const py = Math.floor(y);
        const dx = px - this.dragStartX;
        const dy = py - this.dragStartY;

        const nextX = this.textStartX + dx, nextY = this.textStartY + dy;
        if (active.textData.x === nextX && active.textData.y === nextY) return;
        active.textData.x = nextX;
        active.textData.y = nextY;
        this.renderTextLayer(active);
    }

    onPointerUp(x, y, color, size, target) {
        if (this.isDragging && Number.isFinite(x) && Number.isFinite(y)) this.onPointerMove(x, y, color, size, target);
        const layer = this.dragLayer;
        const before = this.dragBeforeData;
        this.isDragging = false;
        this.dragLayer = null;
        this.dragBeforeData = null;
        if (!layer || !before || !layer.textData) return;
        if (before.x !== layer.textData.x || before.y !== layer.textData.y) {
            this.history.push(new TextDataCommand(layer, before, layer.textData, this.bus));
            this.bus.emit('CANVAS_UPDATED');
        } else if (JSON.stringify(before) === JSON.stringify(layer.textData) && Number.isFinite(this.dragBeforeRevision)) {
            layer.contentRevision = this.dragBeforeRevision;
        }
    }

    cancelAction() {
        if (this.dragLayer && this.dragBeforeData) {
            this.dragLayer.textData = structuredClone(this.dragBeforeData);
            this.renderTextLayer(this.dragLayer, false);
            this.dragLayer.contentRevision = this.dragBeforeRevision;
        }
        this.isDragging = false;
        this.dragLayer = null;
        this.dragBeforeData = null;
        this.bus.emit('CANVAS_UPDATED');
    }

    renderTextLayer(layer, notify = true) {
        if (!layer || layer.type !== 'text' || !layer.textData) return;

        const data = layer.textData;
        const normalized = this.normalizeText(data.text, data.fontId);

        const fontImg = this.fontImages[data.fontId];
        const fontMap = fontMaps[data.fontId];
        if (!fontImg || !fontMap) return;
        layer.clear();

        const spacing = Math.max(-8, Math.min(64, Number(data.letterSpacing) || 0));
        const colorMode = data.colorMode || 'solid';
        const color = data.color || '#FFFFFF';
        const gradientColors = data.gradientColors || ['#FFE066', '#FB8500'];
        const gradientAngle = data.gradientAngle !== undefined ? data.gradientAngle : 90;
        const shadowMode = data.shadowMode || 'auto';
        const customShadowColor = (data.shadowCustomColor || '#000000').toUpperCase();

        const scaleX = Math.max(0.01, Math.min(128, Number(data.scaleX) || 1));
        const scaleY = Math.max(0.01, Math.min(128, Number(data.scaleY) || 1));
        layer.ctx.save();
        layer.ctx.translate(data.x, data.y);
        layer.ctx.scale(scaleX, scaleY);
        if (data.shadow) {
            const sX = data.shadowOffsetX !== undefined ? data.shadowOffsetX : 1;
            const sY = data.shadowOffsetY !== undefined ? data.shadowOffsetY : 1;
            this.drawTextPass(layer.ctx, normalized, sX, sY, color, fontImg, fontMap, data.fontId, spacing, true, colorMode, gradientColors, gradientAngle, shadowMode, customShadowColor);
        }
        this.drawTextPass(layer.ctx, normalized, 0, 0, color, fontImg, fontMap, data.fontId, spacing, false, colorMode, gradientColors, gradientAngle, shadowMode, customShadowColor);

        layer.ctx.restore();
        layer.invalidateSource?.();
        if (notify) this.bus.emit('CANVAS_UPDATED');
    }

    reRenderAllTextLayers() {
        this.layerManager.getLayers().forEach(layer => {
            if (layer.type === 'text') {
                this.renderTextLayer(layer);
            }
        });
    }

    drawTextPass(ctx, text, startX, startY, baseColorHex, fontImg, fontMap, fontId, letterSpacing = 0, isShadow = false, colorMode = 'solid', gradientColors = null, gradientAngle = 90, shadowMode = 'auto', customShadowColor = '#000000') {
        ctx.imageSmoothingEnabled = false;
        const otherImg = this.fontImages['other'];

        // Measure text dimensions to determine total width
        let measuredW = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if ((char === '&' || char === '§') && i + 1 < text.length) {
                i++;
                continue;
            }
            if (char === ' ') {
                measuredW += Math.max(1, 4 + letterSpacing);
                continue;
            }
            if (fontId === 'minecraft-ten' && otherImg && (char === 'Ё' || char === 'Й')) {
                const isYo = (char === 'Ё');
                const slotW = otherImg.width > 16 ? Math.floor(otherImg.width / 2) : 8;
                const slotH = otherImg.height || 10;
                const srcX = isYo ? 0 : slotW;
                const actualWidth = this.calculateActualWidth(otherImg, srcX, 0, slotW, slotH, `other_${char}`);
                measuredW += Math.max(1, actualWidth + 1 + letterSpacing);
                continue;
            }
            let charIndex = fontMap.indexOf(char);
            let activeFontImg = fontImg;
            let activeFontId = fontId;
            if (charIndex === -1 && (fontId === 'minecraft' || fontId === 'smallcaps')) {
                const tenMap = fontMaps['minecraft-ten'];
                const tenImg = this.fontImages['minecraft-ten'];
                if (tenMap && tenImg && tenMap.indexOf(char) !== -1) {
                    charIndex = tenMap.indexOf(char);
                    activeFontImg = tenImg;
                    activeFontId = 'minecraft-ten';
                }
            }
            if (charIndex === -1) {
                measuredW += Math.max(1, 5 + letterSpacing);
                continue;
            }
            const srcX = (charIndex % this.charsPerRow) * this.charWidth;
            const srcY = Math.floor(charIndex / this.charsPerRow) * this.charHeight;
            const actualWidth = this.calculateActualWidth(activeFontImg, srcX, srcY, this.charWidth, this.charHeight, `${activeFontId}_${charIndex}`);
            measuredW += Math.max(1, actualWidth + 1 + letterSpacing);
        }

        const totalW = Math.max(1, Math.min(16384, measuredW));
        const totalH = 12;

        if (colorMode === 'gradient' && gradientColors && gradientColors.length >= 2) {
            // Render text mask offscreen and apply continuous linear gradient
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = totalW;
            maskCanvas.height = totalH;
            const maskCtx = maskCanvas.getContext('2d');
            maskCtx.imageSmoothingEnabled = false;

            let curX = 0;
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                if ((char === '&' || char === '§') && i + 1 < text.length) {
                    i++;
                    continue;
                }
                if (char === ' ') {
                    curX += Math.max(1, 4 + letterSpacing);
                    continue;
                }
                if (fontId === 'minecraft-ten' && otherImg && (char === 'Ё' || char === 'Й')) {
                    const isYo = (char === 'Ё');
                    const slotW = otherImg.width > 16 ? Math.floor(otherImg.width / 2) : 8;
                    const slotH = otherImg.height || 10;
                    const srcX = isYo ? 0 : slotW;
                    const actualWidth = this.calculateActualWidth(otherImg, srcX, 0, slotW, slotH, `other_${char}`);
                    maskCtx.drawImage(otherImg, srcX, 0, slotW, slotH, curX, 0, slotW, slotH);
                    curX += Math.max(1, actualWidth + 1 + letterSpacing);
                    continue;
                }
                let charIndex = fontMap.indexOf(char);
                let activeFontImg = fontImg;
                let activeFontId = fontId;
                if (charIndex === -1 && (fontId === 'minecraft' || fontId === 'smallcaps')) {
                    const tenMap = fontMaps['minecraft-ten'];
                    const tenImg = this.fontImages['minecraft-ten'];
                    if (tenMap && tenImg && tenMap.indexOf(char) !== -1) {
                        charIndex = tenMap.indexOf(char);
                        activeFontImg = tenImg;
                        activeFontId = 'minecraft-ten';
                    }
                }
                if (charIndex === -1) {
                    curX += Math.max(1, 5 + letterSpacing);
                    continue;
                }
                const srcX = (charIndex % this.charsPerRow) * this.charWidth;
                const srcY = Math.floor(charIndex / this.charsPerRow) * this.charHeight;
                const actualWidth = this.calculateActualWidth(activeFontImg, srcX, srcY, this.charWidth, this.charHeight, `${activeFontId}_${charIndex}`);
                maskCtx.drawImage(activeFontImg, srcX, srcY, this.charWidth, this.charHeight, curX, 2, this.charWidth, this.charHeight);
                curX += Math.max(1, actualWidth + 1 + letterSpacing);
            }

            // Create linear gradient
            const angleRad = (Number.isFinite(gradientAngle) ? gradientAngle : 90) * (Math.PI / 180);
            const cx = totalW / 2;
            const cy = totalH / 2;
            const len = Math.abs(totalW * Math.cos(angleRad)) + Math.abs(totalH * Math.sin(angleRad));
            const gx0 = cx - (Math.cos(angleRad) * len) / 2;
            const gy0 = cy - (Math.sin(angleRad) * len) / 2;
            const gx1 = cx + (Math.cos(angleRad) * len) / 2;
            const gy1 = cy + (Math.sin(angleRad) * len) / 2;

            const grad = maskCtx.createLinearGradient(gx0, gy0, gx1, gy1);
            for (let k = 0; k < gradientColors.length; k++) {
                const stopOffset = k / (gradientColors.length - 1);
                let stopHex;
                if (isShadow) {
                    stopHex = (shadowMode === 'custom') ? customShadowColor : this.computeShadowColor(gradientColors[k]);
                } else {
                    stopHex = gradientColors[k];
                }
                grad.addColorStop(stopOffset, stopHex);
            }

            maskCtx.globalCompositeOperation = 'source-in';
            maskCtx.fillStyle = grad;
            maskCtx.fillRect(0, 0, totalW, totalH);

            ctx.drawImage(maskCanvas, startX, startY - 2);
            return;
        }

        // Solid color rendering
        const mcColors = {
            '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
            '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
            '8': '#555555', '9': '#5555FF', 'a': '#55FF55', 'b': '#55FFFF',
            'c': '#FF5555', 'd': '#FF55FF', 'e': '#FFFF55', 'f': '#FFFFFF',
            'r': baseColorHex,
            'а': '#55FF55', 'б': '#55FFFF', 'с': '#FF5555', 'в': '#FF55FF',
            'у': '#FFFF55', 'ф': '#FFFFFF', 'к': baseColorHex
        };
        let currentColorHex;
        if (isShadow) {
            currentColorHex = (shadowMode === 'custom') ? customShadowColor : this.computeShadowColor(baseColorHex);
        } else {
            currentColorHex = baseColorHex;
        }
        let cursorX = startX;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if ((char === '&' || char === '§') && i + 1 < text.length) {
                const code = text[i+1].toLowerCase();
                if (mcColors[code]) {
                    if (isShadow) {
                        currentColorHex = (shadowMode === 'custom') ? customShadowColor : this.computeShadowColor(mcColors[code]);
                    } else {
                        currentColorHex = mcColors[code];
                    }
                    i++;
                    continue;
                }
            }

            if (char === ' ') {
                cursorX += Math.max(1, 4 + letterSpacing);
                continue;
            }

            if (fontId === 'minecraft-ten' && otherImg && (char === 'Ё' || char === 'Й')) {
                const isYo = (char === 'Ё');
                const slotW = otherImg.width > 16 ? Math.floor(otherImg.width / 2) : 8;
                const slotH = otherImg.height || 10;
                const srcX = isYo ? 0 : slotW;
                const actualWidth = this.calculateActualWidth(otherImg, srcX, 0, slotW, slotH, `other_${char}`);

                const tintCanvas = this.tintCanvas;
                if (tintCanvas.width < slotW || tintCanvas.height < slotH) {
                    tintCanvas.width = Math.max(tintCanvas.width, slotW);
                    tintCanvas.height = Math.max(tintCanvas.height, slotH);
                }
                const tintCtx = this.tintCtx;
                tintCtx.clearRect(0, 0, slotW, slotH);
                tintCtx.imageSmoothingEnabled = false;

                tintCtx.globalCompositeOperation = 'source-over';
                tintCtx.drawImage(otherImg, srcX, 0, slotW, slotH, 0, 0, slotW, slotH);
                tintCtx.globalCompositeOperation = 'source-in';
                tintCtx.fillStyle = currentColorHex;
                tintCtx.fillRect(0, 0, slotW, slotH);
                tintCtx.globalCompositeOperation = 'source-over';

                ctx.drawImage(tintCanvas, 0, 0, slotW, slotH, cursorX, startY - 2, slotW, slotH);
                cursorX += Math.max(1, actualWidth + 1 + letterSpacing);
                continue;
            }

            let charIndex = fontMap.indexOf(char);
            let activeFontImg = fontImg;
            let activeFontId = fontId;

            if (charIndex === -1 && (fontId === 'minecraft' || fontId === 'smallcaps')) {
                const tenMap = fontMaps['minecraft-ten'];
                const tenImg = this.fontImages['minecraft-ten'];
                if (tenMap && tenImg && tenMap.indexOf(char) !== -1) {
                    charIndex = tenMap.indexOf(char);
                    activeFontImg = tenImg;
                    activeFontId = 'minecraft-ten';
                }
            }

            if (charIndex === -1) {
                cursorX += Math.max(1, 5 + letterSpacing);
                continue;
            }

            const srcX = (charIndex % this.charsPerRow) * this.charWidth;
            const srcY = Math.floor(charIndex / this.charsPerRow) * this.charHeight;
            const actualWidth = this.calculateActualWidth(activeFontImg, srcX, srcY, this.charWidth, this.charHeight, `${activeFontId}_${charIndex}`);

            const tintCanvas = this.tintCanvas;
            const tintCtx = this.tintCtx;
            tintCtx.clearRect(0, 0, this.charWidth, this.charHeight);
            tintCtx.imageSmoothingEnabled = false;

            tintCtx.globalCompositeOperation = 'source-over';
            tintCtx.drawImage(activeFontImg, srcX, srcY, this.charWidth, this.charHeight, 0, 0, this.charWidth, this.charHeight);
            tintCtx.globalCompositeOperation = 'source-in';
            tintCtx.fillStyle = currentColorHex;
            tintCtx.fillRect(0, 0, this.charWidth, this.charHeight);
            tintCtx.globalCompositeOperation = 'source-over';

            ctx.drawImage(tintCanvas, 0, 0, this.charWidth, this.charHeight, cursorX, startY, this.charWidth, this.charHeight);
            cursorX += Math.max(1, actualWidth + 1 + letterSpacing);
        }
    }
}
