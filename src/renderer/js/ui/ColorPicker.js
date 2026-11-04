import {bindAttribute, uiLabel, localeValue} from '../core/Locale.mjs';
import { Palettes, populatePaletteSelect } from '../utils/Palettes.js';
import { isShortcutTarget } from './KeyboardNavigation.js';
import {normalizeColorHistory} from '../core/ColorHistory.mjs';

/**
 * ColorPicker - Unified HSV color picker with primary/secondary swatches,
 * rich preset palettes, custom user color swatches, and color history.
 */
export default class ColorPicker {
    constructor(bus) {
        this.bus = bus;
        this.activeTarget = 'fg';
        this.fgColor = '#3B82F6';
        this.bgColor = '#111318';

        this.hue = 215;
        this.sat = 75;
        this.val = 96;

        let savedHistory={};try{savedHistory=JSON.parse(localStorage.getItem('molly_color_history')||'{}');}catch{}
        const colors=normalizeColorHistory(savedHistory);this.history=colors.recent;this.pinnedColors=colors.pinned;
        this.customPalette = this.loadCustomPalette();

        this.palettes = { ...Palettes, 'custom': this.customPalette };
        this.activePalette = 'accents';

        this.canvas = document.getElementById('picker-sb-canvas');
        this.ctx = this.canvas?.getContext('2d');
        this.sliderHue = document.getElementById('picker-hue-slider');
        this.inputHex = document.getElementById('picker-hex-input');
        this.previewBlock = document.getElementById('color-preview');
        this.cursor = document.getElementById('picker-cursor');
        this.paletteList = document.getElementById('palette-color-list');
        this.historyList = document.getElementById('color-history-list');
        this.paletteSelect = document.getElementById('palette-select');
        populatePaletteSelect(this.paletteSelect,{custom:true,selected:this.activePalette});

        this.fgSwatch = document.getElementById('swatch-fg');
        this.bgSwatch = document.getElementById('swatch-bg');
        this.btnSwap = document.getElementById('btn-swap-colors');
        this.btnDefault = document.getElementById('btn-default-colors');
        this.btnAddCustom = document.getElementById('btn-add-palette-color');


        this.shadingRampList = document.getElementById('shading-ramp-list');
        this.btnAddRamp = document.getElementById('btn-add-ramp-palette');
        this.btnRampDarker = document.getElementById('btn-ramp-darker');
        this.btnRampLighter = document.getElementById('btn-ramp-lighter');
        this.selectRampSteps = document.getElementById('ramp-steps-select');
        this.selectRampStrength = document.getElementById('ramp-strength-select');

        this.rampSteps = parseInt(localStorage.getItem('molly_ramp_steps') || '5', 10);
        this.rampStrength = localStorage.getItem('molly_ramp_strength') || 'normal';
        this.rampBaseColor = this.fgColor;
        this.activeRampLevel = 0;

        this.btnImportPalette = document.getElementById('btn-import-palette');
        this.inputPaletteFile = document.getElementById('input-palette-file');

        if (this.canvas) {
            this.init();
        }

        this.bus.on('COLOR_SELECTED', (hex) => {
            this.setColorFromHex(hex);
        });
        this.bus.on('COLOR_COMMITTED',hex=>this.addToHistory(hex));
        this.sliderHue?.addEventListener('change',()=>this.addToHistory(this.activeTarget==='bg'?this.bgColor:this.fgColor));
        document.getElementById('btn-clear-color-history')?.addEventListener('click',()=>{this.history=[];this.saveHistory();this.renderHistory();});
        window.addEventListener('storage',event=>{if(event.key==='molly_color_history'){let data={};try{data=JSON.parse(event.newValue||'{}');}catch{}const colors=normalizeColorHistory(data);this.history=colors.recent;this.pinnedColors=colors.pinned;this.renderHistory();}});
    }

    loadCustomPalette() {
        try {
            const raw = localStorage.getItem('molly_custom_palette');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return [...new Set(parsed.filter(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)).map(color => color.toUpperCase()))].slice(0, 512);
            }
            return ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
        } catch (e) {
            return ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
        }
    }

    saveCustomPalette() {
        try {
            localStorage.setItem('molly_custom_palette', JSON.stringify(this.customPalette));
            this.palettes['custom'] = this.customPalette;
        } catch (e) {
            console.warn('Failed to save custom palette:', e);
        }
    }

    appendPaletteColors(colors) {
        const existing = new Set(this.customPalette);
        let added = 0, skipped = 0;
        for (const value of colors) {
            if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) continue;
            const color = value.toUpperCase();
            if (existing.has(color)) continue;
            if (existing.size >= 512) { skipped++; continue; }
            existing.add(color); this.customPalette.push(color); added++;
        }
        if (skipped) window.mollyEditor?.showToast?.('В палитре может быть до 512 цветов. Лишние цвета не добавлены.', 'warning');
        return added;
    }

    init() {
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute('role', 'slider');
        bindAttribute(this.canvas, "aria-label", 'Насыщенность и яркость цвета');
        this.canvas.setAttribute('aria-description', 'Влево и вправо — насыщенность, вверх и вниз — яркость. Shift увеличивает шаг.');
        this.canvas.setAttribute('aria-valuemin', '0');
        this.canvas.setAttribute('aria-valuemax', '100');
        this.canvas.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'ArrowLeft') this.sat = Math.max(0, this.sat - step);
            if (event.key === 'ArrowRight') this.sat = Math.min(100, this.sat + step);
            if (event.key === 'ArrowDown') this.val = Math.max(0, this.val - step);
            if (event.key === 'ArrowUp') this.val = Math.min(100, this.val + step);
            this.updateCursorPosition(); this.updateColor();
        });
        this.resizeSB();
        this.updateSwatches();
        this.renderHistory();

        const container = this.canvas?.parentElement;
        if (window.ResizeObserver && (container || this.canvas)) {
            const ro = new ResizeObserver(() => {
                this.resizeSB();
            });
            ro.observe(container || this.canvas);
        }

        this.sliderHue?.addEventListener('input', (e) => {
            this.hue = parseInt(e.target.value, 10);
            this.drawSB();
            this.updateColor();
        });

        let isMouseDown = false;
        const handleSB = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

            this.sat = (x / rect.width) * 100;
            this.val = 100 - (y / rect.height) * 100;

            this.updateCursor(x, y);
            this.updateColor();
        };

        this.canvas?.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isMouseDown = true;
            handleSB(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isMouseDown) handleSB(e);
        });

        window.addEventListener('blur', () => { isMouseDown = false; });
        window.addEventListener('mouseup', () => {
            if (isMouseDown) {
                isMouseDown = false;
                const activeColor = this.activeTarget === 'fg' ? this.fgColor : this.bgColor;
                this.addToHistory(activeColor);
            }
        });

        this.bindHexInput();

        this.paletteSelect?.addEventListener('change', (e) => {
            this.activePalette = e.target.value;
            this.renderPalette();
        });

        for (const [swatch, target, label] of [[this.fgSwatch, 'fg', 'Основной цвет'], [this.bgSwatch, 'bg', 'Фоновый цвет']]) {
            if (!swatch) continue;
            swatch.setAttribute('role', 'button');
            swatch.tabIndex = 0;
            bindAttribute(swatch, "aria-label", "{0} — открыть палитру", {0: uiLabel(label)});
            swatch.addEventListener('click', () => {
                this.setActiveTarget(target);
                const section = document.getElementById('color-panel-section');
                section?.classList.add('expanded');
                const heading = section?.querySelector('.md-panel-header');
                heading?.setAttribute('aria-expanded', 'true');
                heading?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
                requestAnimationFrame(() => this.resizeSB());
            });
            swatch.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); swatch.click(); }
            });
        }

        this.btnSwap?.addEventListener('click', () => {
            this.swapColors();
        });

        this.btnDefault?.addEventListener('click', () => {
            this.resetDefaultColors();
        });

        this.btnAddCustom?.addEventListener('click', () => {
            this.addCurrentColorToCustomPalette();
        });

        this.btnAddRamp?.addEventListener('click', () => {
            this.addRampToPalette();
        });


        if (this.selectRampSteps) {
            this.selectRampSteps.value = String(this.rampSteps);
            this.selectRampSteps.addEventListener('change', (e) => {
                this.rampSteps = parseInt(e.target.value, 10);
                localStorage.setItem('molly_ramp_steps', String(this.rampSteps));
                this.renderShadingRamp();
            });
        }

        if (this.selectRampStrength) {
            this.selectRampStrength.value = this.rampStrength;
            this.selectRampStrength.addEventListener('change', (e) => {
                this.rampStrength = e.target.value;
                localStorage.setItem('molly_ramp_strength', this.rampStrength);
                this.renderShadingRamp();
            });
        }

        this.btnRampDarker?.addEventListener('click', () => {
            this.stepRamp(-1);
        });

        this.btnRampLighter?.addEventListener('click', () => {
            this.stepRamp(1);
        });

        this.btnImportPalette?.addEventListener('click', () => {
            this.inputPaletteFile?.click();
        });

        this.inputPaletteFile?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                this.importPaletteFile(file);
                e.target.value = '';
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || isShortcutTarget(e.target, e)) return;
            const isX = e.code === 'KeyX' || e.key === 'x' || e.key === 'X' || e.key === 'ч' || e.key === 'Ч';
            const isD = e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В';
            const isLeftBracket = e.code === 'BracketLeft' || e.key === '[' || e.key === 'х' || e.key === 'Х';
            const isRightBracket = e.code === 'BracketRight' || e.key === ']' || e.key === 'ъ' || e.key === 'Ъ';
            
            if (isX && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                this.swapColors();
            } else if (isD && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                this.resetDefaultColors();
            } else if (isLeftBracket && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.stepRamp(-1);
            } else if (isRightBracket && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.stepRamp(1);
            }
        });

        this.renderPalette();
        this.renderHistory();
        this.renderShadingRamp();
    }

    setActiveTarget(target) {
        this.activeTarget = target;
        if (target === 'fg') {
            this.fgSwatch?.classList.add('active');
            this.bgSwatch?.classList.remove('active');
            this.setColorFromHex(this.fgColor, false);
        } else {
            this.bgSwatch?.classList.add('active');
            this.fgSwatch?.classList.remove('active');
            this.setColorFromHex(this.bgColor, false);
        }
    }

    swapColors() {
        const temp = this.fgColor;
        this.fgColor = this.bgColor;
        this.bgColor = temp;
        this.updateSwatches();
        if (this.activeTarget === 'fg') {
            this.setColorFromHex(this.fgColor, false);
        } else {
            this.setColorFromHex(this.bgColor, false);
        }
        this.bus.emit('COLOR_CHANGED', this.fgColor);
    }

    resetDefaultColors() {
        this.fgColor = '#3B82F6';
        this.bgColor = '#111318';
        this.updateSwatches();
        if (this.activeTarget === 'fg') {
            this.setColorFromHex(this.fgColor, false);
        } else {
            this.setColorFromHex(this.bgColor, false);
        }
        this.bus.emit('COLOR_CHANGED', this.fgColor);
    }

    updateSwatches() {
        if (this.fgSwatch) this.fgSwatch.style.backgroundColor = this.fgColor;
        if (this.bgSwatch) this.bgSwatch.style.backgroundColor = this.bgColor;
    }

    resizeSB(force = false) {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;
        const rect = container ? container.getBoundingClientRect() : this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const w = Math.round(rect.width);
            const h = Math.round(rect.height);
            if (this.canvas.width !== w || this.canvas.height !== h || force) {
                this.canvas.width = w;
                this.canvas.height = h;
                this.drawSB();
                this.updateCursorPosition();
            }
        }
    }

    drawSB() {
        if (!this.ctx || !this.canvas) return;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.ctx.fillStyle = `hsl(${this.hue}, 100%, 50%)`;
        this.ctx.fillRect(0, 0, w, h);

        const whiteGrad = this.ctx.createLinearGradient(0, 0, w, 0);
        whiteGrad.addColorStop(0, 'rgba(255,255,255,1)');
        whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
        this.ctx.fillStyle = whiteGrad;
        this.ctx.fillRect(0, 0, w, h);

        const blackGrad = this.ctx.createLinearGradient(0, 0, 0, h);
        blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
        blackGrad.addColorStop(1, 'rgba(0,0,0,1)');
        this.ctx.fillStyle = blackGrad;
        this.ctx.fillRect(0, 0, w, h);
    }

    updateCursor(x, y) {
        if (this.cursor) {
            this.cursor.style.left = `${x}px`;
            this.cursor.style.top = `${y}px`;
        }
    }

    updateCursorPosition() {
        if (!this.canvas) return;
        this.canvas.setAttribute('aria-valuenow', String(Math.round(this.val)));
        this.canvas.setAttribute('aria-valuetext', `Насыщенность ${Math.round(this.sat)}%, яркость ${Math.round(this.val)}%`);
        const w = this.canvas.offsetWidth || this.canvas.width;
        const h = this.canvas.offsetHeight || this.canvas.height;
        const x = (this.sat / 100) * w;
        const y = (1 - (this.val / 100)) * h;
        this.updateCursor(x, y);
    }

    updateColor() {
        this.updateCursorPosition();
        const hex = this.hsvToHex(this.hue, this.sat, this.val);
        if (this.activeTarget === 'fg') {
            this.fgColor = hex;
        } else {
            this.bgColor = hex;
        }

        this.rampBaseColor = hex;

        this.updateSwatches();
        if (this.previewBlock) this.previewBlock.style.backgroundColor = hex;
        if (this.inputHex) this.inputHex.value = hex;

        this.renderShadingRamp();
        if (this.activeTarget === 'fg') this.bus.emit('COLOR_CHANGED', this.fgColor);
    }

    bindHexInput() {
        const input = this.inputHex;
        if (!input) return;
        const current = () => this.activeTarget === 'bg' ? this.bgColor : this.fgColor;
        const apply = commit => {
            let color = input.value.trim();
            if (!color.startsWith('#')) color = '#' + color;
            if (commit && /^#[0-9a-f]{3}$/i.test(color)) color = '#' + [...color.slice(1)].map(c => c + c).join('');
            if (!/^#[0-9a-f]{6}$/i.test(color)) {
                if (commit) input.value = current();
                return;
            }
            color = color.toUpperCase();
            const start = input.selectionStart, end = input.selectionEnd;
            if (color !== current()) this.setColorFromHex(color);
            else if (commit) input.value = color;
            if (!commit && typeof start === 'number') input.setSelectionRange?.(start, end);
            if (commit) this.addToHistory(color);
        };
        input.addEventListener('input', () => apply(false));
        input.addEventListener('change', () => apply(true));
        input.addEventListener('blur', () => apply(true));
        input.addEventListener('keydown', event => {
            if (!['Enter', 'Escape'].includes(event.key)) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Enter') apply(true);
            else input.value = current();
        });
    }

    getColor() {
        return this.fgColor;
    }

    getBgColor() {
        return this.bgColor;
    }

    setColorFromHex(hex, emit = true, source = 'picker') {
        if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
        const uHex = hex.toUpperCase();
        if (this.activeTarget === 'fg') {
            this.fgColor = uHex;
        } else {
            this.bgColor = uHex;
        }

        if (source !== 'ramp') {
            this.rampBaseColor = uHex;
        }

        this.updateSwatches();
        if (this.previewBlock) this.previewBlock.style.backgroundColor = uHex;
        if (this.inputHex) this.inputHex.value = uHex;

        const hsv = this.hexToHSV(uHex);
        this.hue = hsv.h;
        this.sat = hsv.s;
        this.val = hsv.v;

        if (this.sliderHue) this.sliderHue.value = this.hue;
        this.drawSB();
        this.updateCursorPosition();
        this.renderShadingRamp();

        if (emit && this.activeTarget === 'fg') {
            this.bus.emit('COLOR_CHANGED', this.fgColor);
        }
    }

    addToHistory(hex) {
        if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
        const uHex = hex.toUpperCase();
        this.history = this.history.filter(c => c.toUpperCase() !== uHex);
        this.history.unshift(uHex);
        if (this.history.length > 24) this.history.length=24;
        this.saveHistory();
        this.renderHistory();
    }

    saveHistory(){try{localStorage.setItem('molly_color_history',JSON.stringify({recent:this.history,pinned:this.pinnedColors||[]}));}catch{}}

    addCurrentColorToCustomPalette() {
        const current = (this.activeTarget === 'bg' ? this.bgColor : this.fgColor).toUpperCase();
        if (this.appendPaletteColors([current])) {
            this.saveCustomPalette();
            if (this.paletteSelect) this.paletteSelect.value = 'custom';
            this.activePalette = 'custom';
            this.renderPalette();
        }
    }

    renderPalette() {
        if (!this.paletteList) return;
        this.paletteList.innerHTML = '';
        const colors = this.palettes[this.activePalette] || this.palettes['material'];
        colors.forEach(hex => {
            const slot = document.createElement('button');
            slot.type = 'button';
            bindAttribute(slot, "aria-label", "Выбрать цвет {0}", {0: hex});
            slot.className = 'color-square-slot';
            slot.style.backgroundColor = hex;
            bindAttribute(slot, "title", "{0}\nЛКМ — выбрать цвет", {0: hex});

            slot.addEventListener('click', () => {
                this.setColorFromHex(hex);
                this.addToHistory(hex);
            });

            // Right-click in custom palette deletes the color
            if (this.activePalette === 'custom') {
                slot.title += '\nПКМ — удалить из палитры';
                slot.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.customPalette = this.customPalette.filter(c => c !== hex);
                    this.saveCustomPalette();
                    this.renderPalette();
                });
            }

            this.paletteList.appendChild(slot);
        });
    }

    renderHistory() {
        if (!this.historyList) return;
        this.historyList.innerHTML = '';
        [...new Set([...(this.pinnedColors||[]),...this.history])].forEach(hex => {
            const cell=document.createElement('div');cell.className='history-color-cell';
            const slot = document.createElement('button');
            slot.type = 'button';
            bindAttribute(slot, "aria-label", "Выбрать цвет {0}", {0: hex});
            slot.className = 'color-square-slot history-slot';
            slot.style.backgroundColor = hex;
            slot.title = hex;
            slot.addEventListener('click', () => {
                this.setColorFromHex(hex);
            });
            slot.draggable=true;slot.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',hex);event.dataTransfer.setData('application/x-molly-color',hex);});
            const pin=document.createElement('button');pin.type='button';pin.className='history-color-pin';pin.setAttribute('aria-pressed',String(this.pinnedColors.includes(hex)));
            bindAttribute(pin,'aria-label',this.pinnedColors.includes(hex)?'Открепить цвет {0}':'Закрепить цвет {0}',{0:hex});pin.innerHTML='<i class="material-symbols-rounded" aria-hidden="true">star</i>';
            pin.addEventListener('click',()=>{if(this.pinnedColors.includes(hex))this.pinnedColors=this.pinnedColors.filter(c=>c!==hex);else if(this.pinnedColors.length<12)this.pinnedColors.push(hex);this.saveHistory();this.renderHistory();});
            pin.disabled=this.pinnedColors.length>=12&&!this.pinnedColors.includes(hex);
            cell.append(slot,pin);this.historyList.append(cell);
        });
    }

    hsvToHex(h, s, v) {
        s /= 100;
        v /= 100;
        const k = (n) => (n + h / 60) % 6;
        const f = (n) => v * (1 - s * Math.max(0, Math.min(k(n), 4 - k(n), 1)));
        const r = Math.round(255 * f(5));
        const g = Math.round(255 * f(3));
        const b = Math.round(255 * f(1));
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    }

    hexToHSV(hex) {
        let r = parseInt(hex.slice(1, 3), 16) / 255;
        let g = parseInt(hex.slice(3, 5), 16) / 255;
        let b = parseInt(hex.slice(5, 7), 16) / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        const v = max;
        const d = max - min;
        const s = max === 0 ? 0 : d / max;

        if (max !== min) {
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        // Keep full precision internally: rounding percentages changes a picked
        // HEX color before the user actually adjusts a slider or the color field.
        return { h: h * 360, s: s * 100, v: v * 100 };
    }

    computeHueShiftRamp(hex, steps = this.rampSteps, strength = this.rampStrength) {
        const hsv = this.hexToHSV(hex);
        const { h, s, v } = hsv;

        const mults = { subtle: 0.6, normal: 1.0, vibrant: 1.5 };
        const str = mults[strength] || 1.0;
        const isGray = s < 8;

        const getShiftedHue = (baseH, level, t) => {
            if (isGray) return baseH;

            let deltaH = 0;
            // Pure natural color-wheel quadrant shifts (warm highlights, cool ambient shadows, zero violet bias)
            if (baseH >= 0 && baseH <= 65) {
                // Reds, Oranges, Yellows: Highlights towards 55° (warm gold), Shadows towards 0°..345° (deep crimson/burnt umber, NOT purple!)
                deltaH = (level > 0) ? (55 - baseH) * 0.4 * t : -22 * t;
            } else if (baseH > 65 && baseH <= 165) {
                // Greens, Emeralds: Highlights towards 60° (lime/yellow), Shadows towards 165° (forest pine/teal, NOT purple!)
                deltaH = (level > 0) ? -22 * t : +24 * t;
            } else if (baseH > 165 && baseH <= 245) {
                // Cyans, Blues: Highlights towards 180° (cyan/sky), Shadows towards 230° (deep royal navy, capped at 235° so it never turns purple!)
                if (level > 0) {
                    deltaH = (180 - baseH) * 0.35 * t;
                } else {
                    const maxNavy = 232;
                    deltaH = Math.min(14 * t, maxNavy - baseH);
                    if (baseH >= 232) deltaH = -6 * t;
                }
            } else {
                // Purples, Magentas, Pinks (245°..360°): Highlights towards 345° (peach/rose), Shadows towards 275° (deep royal plum)
                deltaH = (level > 0) ? +20 * t : -18 * t;
            }

            return (baseH + deltaH * str + 360) % 360;
        };

        let offsets;
        let maxL;
        if (steps === 9) {
            offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
            maxL = 4;
        } else if (steps === 7) {
            offsets = [-3, -2, -1, 0, 1, 2, 3];
            maxL = 3;
        } else {
            offsets = [-2, -1, 0, 1, 2];
            maxL = 2;
        }

        return offsets.map(level => {
            if (level === 0) {
                return {
                    level: 0,
                    hex: hex.toUpperCase(),
                    label: 'Базовый цвет (0)',
                    h: Math.round(h),
                    s: Math.round(s),
                    v: Math.round(v)
                };
            }

            const t = Math.abs(level) / maxL;
            const curH = getShiftedHue(h, level, t);

            let curS = s;
            let curV = v;

            if (level < 0) {
                curS = isGray ? Math.round(10 * t * str) : Math.min(100, Math.round(s * (1 + 0.18 * t)));
                curV = Math.max(8, Math.round(v * (1 - 0.46 * t)));
            } else {
                curS = isGray ? Math.round(6 * t * str) : Math.max(0, Math.round(s * (1 - 0.28 * t)));
                curV = Math.min(100, Math.round(v + (100 - v) * (0.60 * t)));
            }

            const outHex = this.hsvToHex(curH, curS, curV);
            let name;
            if (level === -4) name = 'Ультра тень (-4)';
            else if (level === -3) name = 'Экстра тень (-3)';
            else if (level === -2) name = 'Глубокая тень (-2)';
            else if (level === -1) name = 'Мягкая тень (-1)';
            else if (level === 1) name = 'Мягкий блик (+1)';
            else if (level === 2) name = 'Яркий блик (+2)';
            else if (level === 3) name = 'Экстра блик (+3)';
            else if (level === 4) name = 'Сверхблик (+4)';

            return {
                level,
                hex: outHex,
                label: name,
                h: Math.round(curH),
                s: curS,
                v: curV
            };
        });
    }

    renderShadingRamp() {
        if (!this.shadingRampList) return;
        this.shadingRampList.innerHTML = '';

        const baseHex = this.rampBaseColor || (this.activeTarget === 'fg' ? this.fgColor : this.bgColor);
        const ramp = this.computeHueShiftRamp(baseHex, this.rampSteps, this.rampStrength);
        this.currentRamp = ramp;

        const currentHex = (this.activeTarget === 'fg' ? this.fgColor : this.bgColor).toUpperCase();

        ramp.forEach((item) => {
            const slot = document.createElement('button');
            slot.type = 'button';
            bindAttribute(slot, "aria-label", "Выбрать цвет {0}", {0: item.hex});
            slot.className = 'shading-ramp-slot';
            slot.style.backgroundColor = item.hex;
            slot.setAttribute('data-level', item.level);

            const isCurrent = item.hex.toUpperCase() === currentHex;
            const isBase = item.level === 0;

            if (isCurrent) {
                slot.classList.add('active');
            }
            if (isBase) {
                slot.classList.add('base-slot');
            }

            const tag = document.createElement('span');
            tag.className = 'ramp-slot-tag';
            tag.textContent = item.level === 0 ? '●' : (item.level > 0 ? `+${item.level}` : `${item.level}`);
            slot.appendChild(tag);

            bindAttribute(slot, "title", "{0}: {1}\nHSV: {2}°, {3}%, {4}%\nЛКМ: {5}\nПКМ / Alt+клик: Фоновый цвет (BG)", {0: uiLabel(item.label), 1: item.hex, 2: item.h, 3: item.s, 4: item.v, 5: uiLabel(this.activeTarget === 'bg' ? 'Фоновый цвет (BG)' : 'Основной цвет (FG)')});

            slot.addEventListener('click', (e) => {
                if (e.altKey) {
                    this.bgColor = item.hex.toUpperCase();
                    this.updateSwatches();
                    if (this.activeTarget === 'bg') this.setColorFromHex(this.bgColor, false, 'ramp');
                    this.addToHistory(item.hex);
                    this.renderShadingRamp();
                    window.mollyEditor?.showToast?.(`Фоновый цвет: ${item.hex}`, 'info');
                } else {
                    this.setColorFromHex(item.hex, true, 'ramp');
                    this.addToHistory(item.hex);
                }
            });

            slot.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.bgColor = item.hex.toUpperCase();
                this.updateSwatches();
                if (this.activeTarget === 'bg') this.setColorFromHex(this.bgColor, false, 'ramp');
                this.addToHistory(item.hex);
                this.renderShadingRamp();
                window.mollyEditor?.showToast?.(`Фоновый цвет: ${item.hex}`, 'info');
            });

            this.shadingRampList.appendChild(slot);
        });
    }

    stepRamp(delta) {
        if (!this.currentRamp || this.currentRamp.length === 0) return;
        const currentHex = (this.activeTarget === 'fg' ? this.fgColor : this.bgColor).toUpperCase();
        
        let currIdx = this.currentRamp.findIndex(s => s.hex.toUpperCase() === currentHex);
        if (currIdx === -1) {
            currIdx = this.currentRamp.findIndex(s => s.level === 0);
            if (currIdx === -1) currIdx = Math.floor(this.currentRamp.length / 2);
        }

        const nextIdx = Math.max(0, Math.min(this.currentRamp.length - 1, currIdx + delta));
        const nextItem = this.currentRamp[nextIdx];
        if (nextItem) {
            this.setColorFromHex(nextItem.hex, true, 'ramp');
            this.addToHistory(nextItem.hex);
            window.mollyEditor?.showToast?.(`${nextItem.label} (${nextItem.hex})`, 'info');
        }
    }

    addRampToPalette() {
        if (!this.currentRamp || this.currentRamp.length === 0) return;
        const addedCount = this.appendPaletteColors(this.currentRamp.map(item => item.hex));
        if (addedCount > 0) {
            this.saveCustomPalette();
            if (this.paletteSelect) this.paletteSelect.value = 'custom';
            this.activePalette = 'custom';
            this.renderPalette();
            window.mollyEditor?.showToast?.(`Добавлено ${addedCount} оттенков в палитру`, 'check_circle');
        } else {
            window.mollyEditor?.showToast?.('Все оттенки уже в палитре', 'info');
        }
    }

    async importPaletteFile(file) {
        try {
            if (file.size > 1024 * 1024) { window.mollyEditor?.showToast?.('Файл палитры превышает 1 МБ.', 'error'); return; }
            const text = await file.text();
            const colors = this.parsePaletteText(text, file.name);
            if (!colors || colors.length === 0) {
                window.mollyEditor?.showToast?.('Не удалось распознать цвета в файле', 'error');
                return;
            }

            const added = this.appendPaletteColors(colors);

            this.saveCustomPalette();
            if (this.paletteSelect) this.paletteSelect.value = 'custom';
            this.activePalette = 'custom';
            this.renderPalette();
            window.mollyEditor?.showToast?.(`Импортировано цветов: ${colors.length} (новых: ${added})`, 'check_circle');
        } catch (err) {
            console.error('Ошибка импорта палитры:', err);
            window.mollyEditor?.showToast?.('Ошибка чтения файла палитры', 'error');
        }
    }

    parsePaletteText(text, fileName) {
        const isGpl = fileName.toLowerCase().endsWith('.gpl') || text.includes('GIMP Palette');
        const colors = [];

        if (isGpl) {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('GIMP') || trimmed.startsWith('Name:') || trimmed.startsWith('Columns:')) {
                    continue;
                }
                const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\d+)/);
                if (match) {
                    const r = Math.min(255, parseInt(match[1], 10));
                    const g = Math.min(255, parseInt(match[2], 10));
                    const b = Math.min(255, parseInt(match[3], 10));
                    const hex = '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
                    colors.push(hex);
                }
            }
        } else {
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim().replace(/^#/, '');
                if (/^[0-9A-Fa-f]{6}$/.test(trimmed)) {
                    colors.push('#' + trimmed.toUpperCase());
                } else if (/^[0-9A-Fa-f]{3}$/.test(trimmed)) {
                    const full = trimmed[0] + trimmed[0] + trimmed[1] + trimmed[1] + trimmed[2] + trimmed[2];
                    colors.push('#' + full.toUpperCase());
                }
            }
        }

        return colors;
    }
}
